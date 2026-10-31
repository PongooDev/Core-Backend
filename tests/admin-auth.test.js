import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAdminAuthStore, normalizeIp, isValidIp, parseCookies, ADMIN_COOKIE_NAME } from "../src/admin/auth.js";
import { startBackend, send } from "./helpers.js";
import { createServer } from "../src/server.js";
import { once } from "node:events";

async function startAuthBackend() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  // Play with friends' remote access on, as a host's backend has it: other machines' connections get through to the admin's
  // own gate (otherwise server.js drops them before any route).
  fs.writeFileSync(path.join(dataDir, "network.json"), JSON.stringify({ remoteAccess: true }));
  const from = { address: "127.0.0.1" };
  const server = await createServer({ dataDir, requestLog: false, emptyServerWaitMs: 0, earnScoreWaitMs: 0, defaultFoundersAccess: true });
  server.prependListener("connection", (socket) => {
    Object.defineProperty(socket, "remoteAddress", { get: () => from.address, configurable: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    dataDir,
    port: server.address().port,
    from,
    close() {
      server.closeAllConnections();
      server.close();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

test("admin auth store: user CRUD, scrypt hashing, and validation", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-auth-unit-"));
  try {
    const store = createAdminAuthStore(tmpDir);
    assert.equal(store.hasUsers(), false);
    assert.deepEqual(store.listUsers(), []);

    // Username validation
    await assert.rejects(() => store.addUser({ username: "ab", password: "ValidPassword123" }), /at least 3 characters/);
    await assert.rejects(() => store.addUser({ username: "bad@user!", password: "ValidPassword123" }), /letters, numbers/);

    // Password validation
    await assert.rejects(() => store.addUser({ username: "admin", password: "123" }), /at least 8 characters/);

    // IP validation
    await assert.rejects(() => store.addUser({ username: "admin", password: "ValidPassword123", allowedIp: "not-an-ip" }), /Invalid IP/);

    // Valid user creation
    const user = await store.addUser({ username: "admin", password: "ValidPassword123", allowedIp: "192.168.1.50" });
    assert.equal(user.username, "admin");
    assert.equal(user.allowedIp, "192.168.1.50");
    assert.ok(user.id);
    assert.ok(user.created);
    assert.equal(user.lastLogin, null);

    // Ensure password is not stored plaintext
    const rawUser = store.getUserById(user.id);
    assert.ok(rawUser.salt);
    assert.ok(rawUser.hash);
    assert.notEqual(rawUser.hash, "ValidPassword123");
    assert.equal(rawUser.hash.length, 128); // 64 bytes hex

    // Duplicate username rejection
    await assert.rejects(() => store.addUser({ username: "ADMIN", password: "AnotherPassword123" }), /already exists/);

    // Cannot delete the only remaining admin
    assert.throws(() => store.deleteUser(user.id), /only remaining admin credential/);

    // Add a second user with no IP restriction
    const user2 = await store.addUser({ username: "operator", password: "OperatorPassword123", allowedIp: null });
    assert.equal(user2.username, "operator");
    assert.equal(user2.allowedIp, null);
    assert.equal(store.listUsers().length, 2);

    // Update IP for user2
    const updatedUser2 = store.updateAllowedIp(user2.id, "10.0.0.10");
    assert.equal(updatedUser2.allowedIp, "10.0.0.10");

    // Clear IP for user2
    const clearedUser2 = store.updateAllowedIp(user2.id, "");
    assert.equal(clearedUser2.allowedIp, null);

    // Now deleting user2 is permitted since 2 users exist
    const delResult = store.deleteUser(user2.id);
    assert.equal(delResult.success, true);
    assert.equal(store.listUsers().length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("admin auth store: credentials verification, dummy scrypt timing safety, and IP binding", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-auth-verify-"));
  try {
    const store = createAdminAuthStore(tmpDir);
    await store.addUser({ username: "SecAdmin", password: "CorrectPassword123!", allowedIp: "192.168.1.50" });
    await store.addUser({ username: "GlobalAdmin", password: "GlobalPassword123!", allowedIp: null });

    // 1. Unknown username (should execute dummy scrypt and fail cleanly)
    const unknownRes = await store.verifyCredentials("nonexistent", "SomePassword123!", "127.0.0.1");
    assert.equal(unknownRes.success, false);
    assert.equal(unknownRes.error, "Invalid username or password");

    // 2. Wrong password
    const wrongPassRes = await store.verifyCredentials("SecAdmin", "WrongPassword123!", "192.168.1.50");
    assert.equal(wrongPassRes.success, false);
    assert.equal(wrongPassRes.error, "Invalid username or password");

    // 3. Correct password but IP mismatch
    const ipMismatchRes = await store.verifyCredentials("SecAdmin", "CorrectPassword123!", "10.0.0.99");
    assert.equal(ipMismatchRes.success, false);
    assert.equal(ipMismatchRes.ipMismatch, true);
    assert.ok(ipMismatchRes.error.includes("IP address"));

    // 4. Correct password and matching IP
    const validRes = await store.verifyCredentials("SecAdmin", "CorrectPassword123!", "192.168.1.50");
    assert.equal(validRes.success, true);
    assert.equal(validRes.user.username, "SecAdmin");
    assert.ok(validRes.user.lastLogin);
    assert.equal(validRes.user.lastIp, "192.168.1.50");

    // 5. Global user with no IP restriction logging in from any IP
    const globalRes = await store.verifyCredentials("GlobalAdmin", "GlobalPassword123!", "172.16.5.4");
    assert.equal(globalRes.success, true);
    assert.equal(globalRes.user.username, "GlobalAdmin");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("admin auth store: rate limiting / brute-force lockout after 5 failed attempts", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-auth-rate-"));
  try {
    const store = createAdminAuthStore(tmpDir);
    await store.addUser({ username: "TargetAdmin", password: "CorrectPassword123!" });

    const clientIp = "192.168.1.75";

    // 4 failed attempts: not yet locked out
    for (let i = 0; i < 4; i++) {
      const res = await store.verifyCredentials("TargetAdmin", "WrongPassword", clientIp);
      assert.equal(res.success, false);
      assert.equal(res.lockedOut, undefined);
    }

    // 5th failed attempt: triggers lockout
    const fifth = await store.verifyCredentials("TargetAdmin", "WrongPassword", clientIp);
    assert.equal(fifth.success, false);

    // 6th attempt: immediately locked out without scrypt check
    const locked = await store.verifyCredentials("TargetAdmin", "CorrectPassword123!", clientIp);
    assert.equal(locked.success, false);
    assert.equal(locked.lockedOut, true);
    assert.ok(locked.retryAfter > 0);
    assert.ok(locked.error.includes("Too many failed attempts"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("admin auth store: session issuance, per-request IP validation, and revocation", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-auth-session-"));
  try {
    const store = createAdminAuthStore(tmpDir);
    const user = await store.addUser({ username: "IpUser", password: "Password123!", allowedIp: "192.168.1.50" });

    // Issue session
    const { token, session, cookie } = store.issueSession(user, "192.168.1.50");
    assert.ok(token);
    assert.equal(session.username, "IpUser");
    assert.ok(cookie.includes("core_admin_session="));
    assert.ok(cookie.includes("HttpOnly"));
    assert.ok(cookie.includes("SameSite=Strict"));

    // Validate from matching IP -> success
    const valid = store.validateSession(token, "192.168.1.50");
    assert.ok(valid);
    assert.equal(valid.user.username, "IpUser");

    // Validate from mismatched IP -> rejected!
    const mismatched = store.validateSession(token, "10.0.0.1");
    assert.equal(mismatched, null);

    // Updating password revokes sessions
    await store.updatePassword(user.id, "BrandNewPassword123!");
    const afterPasswordChange = store.validateSession(token, "192.168.1.50");
    assert.equal(afterPasswordChange, null);

    // Issue new session and manually revoke
    const newSess = store.issueSession(user, "192.168.1.50");
    assert.ok(store.validateSession(newSess.token, "192.168.1.50"));
    store.revokeSession(newSess.token);
    assert.equal(store.validateSession(newSess.token, "192.168.1.50"), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// One request to the test backend, from whichever address backend.from says.
function requester(backend) {
  return (method, path, { body, cookie, bearer, host = "127.0.0.1", headers = {} } = {}) => send({
    host: "127.0.0.1",
    port: backend.port,
    method,
    path,
    headers: {
      Host: host,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers
    }
  }, body !== undefined ? JSON.stringify(body) : undefined);
}

const cookieOf = (response) => {
  const header = [response.headers["set-cookie"]].flat().find((line) => line?.startsWith(`${ADMIN_COOKIE_NAME}=`));
  return header ? `${ADMIN_COOKIE_NAME}=${parseCookies(header)[ADMIN_COOKIE_NAME]}` : null;
};

test("admin HTTP routes: login, session cookies, Bearer tokens, and route protection", async () => {
  const backend = await startAuthBackend();
  const request = requester(backend);
  try {
    // The panel serves its login screen.
    const panelHtml = await request("GET", "/admin");
    assert.equal(panelHtml.status, 200);
    assert.ok(panelHtml.body.includes("id=\"admin-login-screen\""));
    assert.ok(panelHtml.body.includes("id=\"admin-user-bar\""));
    assert.ok(panelHtml.body.includes("Admin From Other Devices"));

    // This PC is the admin without signing in.
    const meInitial = await request("GET", "/admin/api/auth/me");
    assert.equal(meInitial.status, 200);
    assert.equal(meInitial.body.authenticated, true);
    assert.equal(meInitial.body.hasUsers, false);
    assert.equal(meInitial.body.isLoopback, true);
    assert.equal(meInitial.body.remoteAdmin, false);
    assert.equal((await request("GET", "/admin/api/overview")).status, 200);

    // Remote admin needs a credential first.
    const enableWithoutUsers = await request("POST", "/admin/api/settings", { body: { remoteAdmin: true } });
    assert.equal(enableWithoutUsers.status, 400);
    assert.match(enableWithoutUsers.body.errorMessage, /Add an admin credential/);

    // The first credential, made on this PC: no session cookie (this PC needs none), and remote admin stays off.
    const createFirst = await request("POST", "/admin/api/admin-users", { body: { username: "superadmin", password: "MasterPassword123!", allowedIp: null } });
    assert.equal(createFirst.status, 201);
    assert.equal(createFirst.body.user.username, "superadmin");
    assert.equal(cookieOf(createFirst), null);
    assert.equal(createFirst.body.user.hash, undefined);
    assert.equal(createFirst.body.user.salt, undefined);
    const superadminId = createFirst.body.user.id;
    assert.equal((await request("GET", "/admin/api/settings")).body.remoteAdmin, false);
    assert.equal((await request("GET", "/admin/api/overview")).status, 200);

    // With remote admin off, another device gets nothing, not even the sign-in.
    backend.from.address = "192.168.1.50";
    assert.equal((await request("GET", "/admin/api/overview")).status, 403);
    assert.equal((await request("GET", "/admin")).status, 403);
    assert.equal((await request("POST", "/admin/api/auth/login", { body: { username: "superadmin", password: "MasterPassword123!" } })).status, 403);

    // This PC switches remote admin on.
    backend.from.address = "127.0.0.1";
    const enable = await request("POST", "/admin/api/settings", { body: { remoteAdmin: true } });
    assert.equal(enable.status, 200);
    assert.equal(enable.body.remoteAdmin, true);

    // Now another device reaches the sign-in, and nothing else without a session.
    backend.from.address = "192.168.1.50";
    assert.equal((await request("GET", "/admin")).status, 200);
    assert.equal((await request("GET", "/admin/api/overview")).status, 401);
    const meRemote = await request("GET", "/admin/api/auth/me");
    assert.equal(meRemote.body.authenticated, false);
    assert.equal(meRemote.body.requireAuth, true);

    const loginFail = await request("POST", "/admin/api/auth/login", { body: { username: "superadmin", password: "WrongPassword" } });
    assert.equal(loginFail.status, 401);
    assert.equal((await request("POST", "/admin/api/auth/login", { body: { username: { $ne: "" }, password: "x" } })).status, 400);

    const loginSuccess = await request("POST", "/admin/api/auth/login", { body: { username: "superadmin", password: "MasterPassword123!" } });
    assert.equal(loginSuccess.status, 200);
    assert.equal(loginSuccess.body.success, true);
    assert.ok(loginSuccess.body.token);
    const setCookie = [loginSuccess.headers["set-cookie"]].flat()[0];
    assert.ok(setCookie.includes("HttpOnly"));
    assert.ok(setCookie.includes("SameSite=Strict"));
    const cookie = cookieOf(loginSuccess);

    assert.equal((await request("GET", "/admin/api/overview", { cookie })).status, 200);
    assert.equal((await request("GET", "/admin/api/overview", { bearer: loginSuccess.body.token })).status, 200);
    const meAuth = await request("GET", "/admin/api/auth/me", { cookie });
    assert.equal(meAuth.body.authenticated, true);
    assert.equal(meAuth.body.user.username, "superadmin");

    // A signed-in device still can't switch remote admin or manage credentials; it may change its own password.
    assert.equal((await request("POST", "/admin/api/settings", { cookie, body: { remoteAdmin: false } })).status, 403);
    assert.equal((await request("POST", "/admin/api/admin-users", { cookie, body: { username: "sneaky", password: "SneakyPassword1" } })).status, 403);
    assert.equal((await request("DELETE", `/admin/api/admin-users/${superadminId}`, { cookie })).status, 403);
    assert.equal((await request("POST", `/admin/api/admin-users/${superadminId}/ip`, { cookie, body: { allowedIp: null } })).status, 403);
    assert.equal((await request("GET", "/admin/api/admin-users", { cookie })).body.users.length, 1);

    // This PC adds an IP-bound credential and manages it.
    backend.from.address = "127.0.0.1";
    const addSecond = await request("POST", "/admin/api/admin-users", { body: { username: "lan_admin", password: "LanPassword123!", allowedIp: "192.168.1.99" } });
    assert.equal(addSecond.status, 201);
    assert.equal(addSecond.body.user.allowedIp, "192.168.1.99");
    const lanAdminId = addSecond.body.user.id;
    assert.equal((await request("GET", "/admin/api/admin-users")).body.users.length, 2);
    const updateIp = await request("POST", `/admin/api/admin-users/${lanAdminId}/ip`, { body: { allowedIp: "10.0.0.88" } });
    assert.equal(updateIp.status, 200);
    assert.equal(updateIp.body.user.allowedIp, "10.0.0.88");
    assert.equal((await request("POST", `/admin/api/admin-users/${lanAdminId}/password`, { body: { newPassword: "NewLanPassword123!" } })).status, 200);

    // superadmin's device may not change lan_admin's password, only its own.
    backend.from.address = "192.168.1.50";
    assert.equal((await request("POST", `/admin/api/admin-users/${lanAdminId}/password`, { cookie, body: { newPassword: "Hijacked123456" } })).status, 403);

    backend.from.address = "127.0.0.1";
    assert.equal((await request("DELETE", `/admin/api/admin-users/${lanAdminId}`)).status, 200);
    assert.equal((await request("DELETE", `/admin/api/admin-users/${superadminId}`)).status, 400);

    // Signing out ends the session; this PC is unaffected.
    backend.from.address = "192.168.1.50";
    assert.equal((await request("POST", "/admin/api/auth/logout", { cookie, body: {} })).status, 200);
    assert.equal((await request("GET", "/admin/api/overview", { cookie })).status, 401);
    backend.from.address = "127.0.0.1";
    assert.equal((await request("GET", "/admin/api/overview")).status, 200);
    // A stale cookie on this PC (a restart forgets sessions) doesn't lock the owner out.
    assert.equal((await request("GET", "/admin/api/overview", { cookie })).status, 200);

    // Signing out on one device signs the credential out on all of them.
    backend.from.address = "192.168.1.50";
    const loginA = await request("POST", "/admin/api/auth/login", { body: { username: "superadmin", password: "MasterPassword123!" } });
    const loginB = await request("POST", "/admin/api/auth/login", { body: { username: "superadmin", password: "MasterPassword123!" } });
    assert.notEqual(loginA.body.token, loginB.body.token);
    assert.equal((await request("GET", "/admin/api/overview", { bearer: loginA.body.token })).status, 200);
    assert.equal((await request("GET", "/admin/api/overview", { bearer: loginB.body.token })).status, 200);
    await request("POST", "/admin/api/auth/logout", { bearer: loginA.body.token });
    assert.equal((await request("GET", "/admin/api/overview", { bearer: loginB.body.token })).status, 401);

    // Switching remote admin off shuts other devices out again, sessions or not.
    const loginC = await request("POST", "/admin/api/auth/login", { body: { username: "superadmin", password: "MasterPassword123!" } });
    backend.from.address = "127.0.0.1";
    assert.equal((await request("POST", "/admin/api/settings", { body: { remoteAdmin: false } })).status, 200);
    backend.from.address = "192.168.1.50";
    assert.equal((await request("GET", "/admin/api/overview", { bearer: loginC.body.token })).status, 403);
    assert.equal((await request("GET", "/admin/api/overview")).status, 403);
  } finally {
    backend.close();
  }
});

test("admin HTTP routes: no way in for another device without a session", async () => {
  const backend = await startAuthBackend();
  const request = requester(backend);
  try {
    await request("POST", "/admin/api/admin-users", { body: { username: "owner", password: "OwnerPassword123" } });
    await request("POST", "/admin/api/settings", { body: { remoteAdmin: true } });

    backend.from.address = "192.168.1.50";
    // Every admin router: the Play with friends page's too (it has a router of its own, mounted first).
    for (const [method, path, body] of [
      ["GET", "/admin/api/network"],
      ["POST", "/admin/api/network", { remoteAccess: true }],
      ["GET", "/admin/api/settings"],
      ["POST", "/admin/api/settings", { allowRegistration: true }],
      ["GET", "/admin/api/accounts"],
      ["GET", "/admin/api/admin-users"],
      ["GET", "/ADMIN/API/OVERVIEW"],
      ["GET", "/admin/api/overview/"],
      ["GET", "/admin/api/auth/../overview"],
      ["GET", "/admin/api/logs"]
    ]) {
      const response = await request(method, path, { body });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
    // Not even with a made-up token.
    assert.equal((await request("GET", "/admin/api/network", { bearer: "0".repeat(64) })).status, 401);

    // Signing out without a session signs nobody out.
    const login = await request("POST", "/admin/api/auth/login", { body: { username: "owner", password: "OwnerPassword123" } });
    assert.equal(login.status, 200);
    await request("POST", "/admin/api/auth/logout", { body: { username: "owner" } });
    await request("POST", "/admin/api/auth/logout", { body: {} });
    assert.equal((await request("GET", "/admin/api/network", { bearer: login.body.token })).status, 200);

    // Another site's page can't write through a signed-in browser.
    const crossSite = await request("POST", "/admin/api/settings", { bearer: login.body.token, body: { allowRegistration: true }, headers: { Origin: "http://evil.example" } });
    assert.equal(crossSite.status, 403);
    // A hostname that isn't this backend's address (DNS rebinding) is refused.
    assert.equal((await request("GET", "/admin/api/overview", { bearer: login.body.token, host: "evil.example" })).status, 403);

    // An IP-bound credential works only from its device, and its sessions too.
    backend.from.address = "127.0.0.1";
    await request("POST", "/admin/api/admin-users", { body: { username: "bound", password: "BoundPassword123", allowedIp: "192.168.1.77" } });
    backend.from.address = "192.168.1.50";
    const wrongDevice = await request("POST", "/admin/api/auth/login", { body: { username: "bound", password: "BoundPassword123" } });
    assert.equal(wrongDevice.status, 401);
    assert.equal(wrongDevice.body.ipMismatch, true);
    backend.from.address = "192.168.1.77";
    const rightDevice = await request("POST", "/admin/api/auth/login", { body: { username: "bound", password: "BoundPassword123" } });
    assert.equal(rightDevice.status, 200);
    backend.from.address = "192.168.1.50";
    assert.equal((await request("GET", "/admin/api/overview", { bearer: rightDevice.body.token })).status, 401);
  } finally {
    backend.close();
  }
});

test("admin HTTP routes: the first credential can only be made on this PC", async () => {
  const backend = await startAuthBackend();
  const request = requester(backend);
  try {
    backend.from.address = "192.168.1.50";
    assert.equal((await request("POST", "/admin/api/admin-users", { body: { username: "intruder", password: "IntruderPassword1" } })).status, 403);
    assert.equal((await request("GET", "/admin/api/auth/me")).status, 403);
    backend.from.address = "127.0.0.1";
    assert.equal((await request("GET", "/admin/api/admin-users")).body.users.length, 0);
  } finally {
    backend.close();
  }
});

test("admin HTTP routes: brute force lockout returns HTTP 429 with Retry-After", async () => {
  const backend = await startBackend();
  try {
    const port = backend.port;

    // Create user
    await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/admin-users",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
    }, JSON.stringify({ username: "lockout_admin", password: "Password12345!" }));

    // 4 failed attempts -> 401
    for (let i = 0; i < 4; i++) {
      const res = await send({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/admin/api/auth/login",
        headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
      }, JSON.stringify({ username: "lockout_admin", password: "WrongPassword" }));
      assert.equal(res.status, 401);
    }

    // 5th attempt -> 401, triggers lockout
    const fifth = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/auth/login",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
    }, JSON.stringify({ username: "lockout_admin", password: "WrongPassword" }));
    assert.equal(fifth.status, 401);

    // 6th attempt -> 429 Too Many Requests with Retry-After header!
    const sixth = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/auth/login",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
    }, JSON.stringify({ username: "lockout_admin", password: "Password12345!" }));
    assert.equal(sixth.status, 429);
    assert.ok(sixth.headers["retry-after"]);
    assert.equal(sixth.body.errorCode, "errors.com.epicgames.common.throttled");
    assert.ok(sixth.body.retryAfter > 0);
  } finally {
    backend.close();
  }
});
