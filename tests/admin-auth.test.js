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

test("admin HTTP routes: login, session cookies, Bearer tokens, and route protection", async () => {
  const backend = await startAuthBackend();
  try {
    const port = backend.port;

    // 0. GET /admin serves HTML with login screen & admin-user-bar
    const panelHtml = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin",
      headers: { Host: "127.0.0.1" }
    });
    assert.equal(panelHtml.status, 200);
    assert.ok(panelHtml.body.includes("id=\"admin-login-screen\""));
    assert.ok(panelHtml.body.includes("id=\"admin-user-bar\""));
    assert.ok(panelHtml.body.includes("Admin Menu Credentials"));

    // 1. Initial state: on 127.0.0.1, authenticated is true because loopback does not require a session
    const meInitial = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/auth/me",
      headers: { Host: "127.0.0.1" }
    });
    assert.equal(meInitial.status, 200);
    assert.equal(meInitial.body.authenticated, true);
    assert.equal(meInitial.body.hasUsers, false);
    assert.equal(meInitial.body.isLoopback, true);

    // Overview is initially accessible before credentials are configured
    const overviewInitial = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/overview",
      headers: { Host: "127.0.0.1" }
    });
    assert.equal(overviewInitial.status, 200);

    // 1b. Reject enabling requireAdminAuth when 0 admin credentials exist
    const enableWithoutUsers = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/settings",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
    }, JSON.stringify({ requireAdminAuth: true }));
    assert.equal(enableWithoutUsers.status, 400);
    assert.ok(enableWithoutUsers.body.errorMessage.includes("Cannot require admin login before creating at least one admin credential"));

    // 2. Create the first admin user
    const createFirst = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/admin-users",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
    }, JSON.stringify({ username: "superadmin", password: "MasterPassword123!", allowedIp: null }));
    assert.equal(createFirst.status, 201);
    assert.equal(createFirst.body.user.username, "superadmin");
    const initSetCookie = createFirst.headers["set-cookie"]?.[0] || createFirst.headers["set-cookie"];
    assert.ok(initSetCookie.includes("core_admin_session="));
    const superadminId = createFirst.body.user.id;

    // 3. Accessed from 127.0.0.1: does NOT require a session even when admin credentials exist!
    const overviewFromLocal = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/overview",
      headers: { Host: "127.0.0.1" }
    });
    assert.equal(overviewFromLocal.status, 200);

    // 3b. Remote requests from 192.168.1.50 DO require a session and are rejected with 401 when unauthenticated
    backend.from.address = "192.168.1.50";
    const overviewBlocked = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/overview",
      headers: { Host: "127.0.0.1" }
    });
    assert.equal(overviewBlocked.status, 401);

    // 4. Login with bad password -> 401
    const loginFail = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/auth/login",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
    }, JSON.stringify({ username: "superadmin", password: "WrongPassword" }));
    assert.equal(loginFail.status, 401);

    // 5. Login with correct password -> 200, sets HttpOnly cookie, returns token
    const loginSuccess = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/auth/login",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
    }, JSON.stringify({ username: "superadmin", password: "MasterPassword123!" }));
    assert.equal(loginSuccess.status, 200);
    assert.equal(loginSuccess.body.success, true);
    assert.ok(loginSuccess.body.token);

    const setCookie = loginSuccess.headers["set-cookie"]?.[0] || loginSuccess.headers["set-cookie"];
    assert.ok(setCookie.includes("core_admin_session="));
    assert.ok(setCookie.includes("HttpOnly"));
    assert.ok(setCookie.includes("SameSite=Strict"));

    // Extract cookie value for request
    const parsed = parseCookies(Array.isArray(setCookie) ? setCookie[0] : setCookie);
    const sessionCookieHeader = `core_admin_session=${parsed.core_admin_session}`;

    // 6. Access /admin/api/overview with cookie -> 200 OK
    const overviewWithCookie = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/overview",
      headers: { Host: "127.0.0.1", Cookie: sessionCookieHeader }
    });
    assert.equal(overviewWithCookie.status, 200);

    // 7. Access /admin/api/overview with Bearer token -> 200 OK
    const overviewWithBearer = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/overview",
      headers: { Host: "127.0.0.1", Authorization: `Bearer ${loginSuccess.body.token}` }
    });
    assert.equal(overviewWithBearer.status, 200);

    // 8. GET /admin/api/auth/me with session
    const meAuth = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/auth/me",
      headers: { Host: "127.0.0.1", Cookie: sessionCookieHeader }
    });
    assert.equal(meAuth.status, 200);
    assert.equal(meAuth.body.authenticated, true);
    assert.equal(meAuth.body.user.username, "superadmin");

    // 8b. Toggle requireAdminAuth off and on
    const disableAuth = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/settings",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json", Cookie: sessionCookieHeader }
    }, JSON.stringify({ requireAdminAuth: false }));
    assert.equal(disableAuth.status, 200);
    assert.equal(disableAuth.body.requireAdminAuth, false);

    const overviewUnauthWhenDisabled = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/overview",
      headers: { Host: "127.0.0.1" }
    });
    assert.equal(overviewUnauthWhenDisabled.status, 200);

    const reenableAuth = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/settings",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json", Cookie: sessionCookieHeader }
    }, JSON.stringify({ requireAdminAuth: true }));
    assert.equal(reenableAuth.status, 200);
    assert.equal(reenableAuth.body.requireAdminAuth, true);

    // 9. Add a second admin user with IP restriction via API
    const addSecond = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/admin-users",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json", Cookie: sessionCookieHeader }
    }, JSON.stringify({ username: "lan_admin", password: "LanPassword123!", allowedIp: "192.168.1.99" }));
    assert.equal(addSecond.status, 201);
    assert.equal(addSecond.body.user.allowedIp, "192.168.1.99");
    const lanAdminId = addSecond.body.user.id;

    // List admin users
    const listRes = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/admin-users",
      headers: { Host: "127.0.0.1", Cookie: sessionCookieHeader }
    });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.users.length, 2);

    // Update IP for lan_admin via API
    const updateIpRes = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: `/admin/api/admin-users/${lanAdminId}/ip`,
      headers: { Host: "127.0.0.1", "Content-Type": "application/json", Cookie: sessionCookieHeader }
    }, JSON.stringify({ allowedIp: "10.0.0.88" }));
    assert.equal(updateIpRes.status, 200);
    assert.equal(updateIpRes.body.user.allowedIp, "10.0.0.88");

    // Update password for lan_admin via API
    const updatePwRes = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: `/admin/api/admin-users/${lanAdminId}/password`,
      headers: { Host: "127.0.0.1", "Content-Type": "application/json", Cookie: sessionCookieHeader }
    }, JSON.stringify({ newPassword: "NewLanPassword123!" }));
    assert.equal(updatePwRes.status, 200);

    // Delete lan_admin via API
    const deleteRes = await send({
      host: "127.0.0.1",
      port,
      method: "DELETE",
      path: `/admin/api/admin-users/${lanAdminId}`,
      headers: { Host: "127.0.0.1", Cookie: sessionCookieHeader }
    });
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.success, true);

    // Cannot delete the only remaining admin
    const deleteLastRes = await send({
      host: "127.0.0.1",
      port,
      method: "DELETE",
      path: `/admin/api/admin-users/${superadminId}`,
      headers: { Host: "127.0.0.1", Cookie: sessionCookieHeader }
    });
    assert.equal(deleteLastRes.status, 400);

    // 10. Logout -> clears session
    const logoutRes = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/auth/logout",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json", Cookie: sessionCookieHeader }
    });
    assert.equal(logoutRes.status, 200);

    // Subsequent access with old cookie from remote returns 401
    const overviewAfterLogout = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/overview",
      headers: { Host: "127.0.0.1", Cookie: sessionCookieHeader }
    });
    assert.equal(overviewAfterLogout.status, 401);

    // But switching back to 127.0.0.1 without expired cookie: no session required, succeeds with 200!
    backend.from.address = "127.0.0.1";
    const overviewLocalAfter = await send({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/admin/api/overview",
      headers: { Host: "127.0.0.1" }
    });
    assert.equal(overviewLocalAfter.status, 200);

    // 11. Multi-device logout test: login on Device A and Device B
    const loginDevA = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/auth/login",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
    }, JSON.stringify({ username: "superadmin", password: "MasterPassword123!" }));
    assert.equal(loginDevA.status, 200);

    const loginDevB = await send({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/admin/api/auth/login",
      headers: { Host: "127.0.0.1", "Content-Type": "application/json" }
    }, JSON.stringify({ username: "superadmin", password: "MasterPassword123!" }));
    assert.equal(loginDevB.status, 200);

    const tokenA = loginDevA.body.token;
    const tokenB = loginDevB.body.token;
    assert.notEqual(tokenA, tokenB);

    // Both tokens valid
    const checkA = await send({ host: "127.0.0.1", port, method: "GET", path: "/admin/api/overview", headers: { Host: "127.0.0.1", Authorization: `Bearer ${tokenA}` } });
    assert.equal(checkA.status, 200);
    const checkB = await send({ host: "127.0.0.1", port, method: "GET", path: "/admin/api/overview", headers: { Host: "127.0.0.1", Authorization: `Bearer ${tokenB}` } });
    assert.equal(checkB.status, 200);

    // Sign out from Device A
    await send({ host: "127.0.0.1", port, method: "POST", path: "/admin/api/auth/logout", headers: { Host: "127.0.0.1", Authorization: `Bearer ${tokenA}` } });

    // Device B's session is now revoked as well!
    const checkBAfter = await send({ host: "127.0.0.1", port, method: "GET", path: "/admin/api/overview", headers: { Host: "127.0.0.1", Authorization: `Bearer ${tokenB}` } });
    assert.equal(checkBAfter.status, 401);
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
