import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, isServerAccountName, validatePassword, validateUsername, verifyPassword } from "../src/accounts/password.js";
import { get, post, requestToken, send, startBackend } from "./helpers.js";

test("password hashing and timing-safe verification", async () => {
  const plain = "SecretPassword123!";
  const stored = await hashPassword(plain);

  assert.ok(stored.salt && stored.salt.length === 32);
  assert.ok(stored.hash && stored.hash.length === 128);

  assert.equal(await verifyPassword(plain, stored), true);
  assert.equal(await verifyPassword("  SecretPassword123!  ", stored), true); // trimming test
  assert.equal(await verifyPassword("WrongPassword!", stored), false);
  assert.equal(await verifyPassword("", stored), false);
  assert.equal(await verifyPassword(null, stored), false);
});

test("username and password validation rules", () => {
  assert.equal(validateUsername("ValidUser"), null);
  assert.equal(validateUsername("User-Name_123"), null);
  assert.ok(validateUsername("ab")); // too short
  assert.ok(validateUsername("a".repeat(25))); // too long
  assert.ok(validateUsername("Bad@User!")); // invalid characters

  for (const name of ["CoreServer1", "Server 2", "coreserver_12", "CoreServer-DESKTOP7-1", "CoreServer_pc2_10"]) assert.ok(isServerAccountName(name), name);
  for (const name of ["CoreServer", "CoreServerBob", "CoreServer-Bob", "Server-Bob-1", "CoreServer-a.b-1", "Bob-CoreServer-1"]) {
    assert.equal(isServerAccountName(name), false, name);
  }

  assert.equal(validatePassword("validPassword123"), null);
  assert.equal(validatePassword("  validPassword123  "), null);
  assert.ok(validatePassword("short")); // < 8
  assert.ok(validatePassword("1234567")); // 7 chars
  assert.ok(validatePassword("a".repeat(129))); // > 128
});

test("player web portal and registration API", async () => {
  const backend = await startBackend();
  try {
    // Portal HTML is served on /register, /portal, and /reset-password
    const registerPage = await send({ host: "127.0.0.1", port: backend.port, path: "/register" });
    assert.equal(registerPage.status, 200);
    assert.ok(registerPage.body.includes("<h1>Core</h1>"));

    const portalPage = await send({ host: "127.0.0.1", port: backend.port, path: "/portal" });
    assert.equal(portalPage.status, 200);

    const resetPage = await send({ host: "127.0.0.1", port: backend.port, path: "/reset-password" });
    assert.equal(resetPage.status, 200);

    // Check status
    const status = await send({ host: "127.0.0.1", port: backend.port, path: "/api/portal/status" });
    assert.equal(status.status, 200);
    assert.equal(status.body.status, "online");

    // Check username availability
    const check1 = await send({ host: "127.0.0.1", port: backend.port, path: "/api/check-username?username=PortalHero" });
    assert.equal(check1.status, 200);
    assert.equal(check1.body.available, true);

    // Register new account (enforcing 8+ characters)
    const tooShortRes = await post(backend.port, "/api/register", null, {
      username: "PortalHero",
      password: "short"
    });
    assert.equal(tooShortRes.status, 400);

    const regRes = await post(backend.port, "/api/register", null, {
      username: "PortalHero",
      password: "SuperSecretPassword123"
    });
    assert.equal(regRes.status, 201);
    assert.equal(regRes.body.displayName, "PortalHero");
    assert.ok(regRes.body.id);

    // Check username again - now taken
    const check2 = await send({ host: "127.0.0.1", port: backend.port, path: "/api/check-username?username=PortalHero" });
    assert.equal(check2.status, 200);
    assert.equal(check2.body.available, false);

    // Cannot register duplicate
    const dupRes = await post(backend.port, "/api/register", null, {
      username: "portalhero",
      password: "AnotherPassword123"
    });
    assert.equal(dupRes.status, 409);

    // Change password with wrong current password fails
    const failChange = await post(backend.port, "/api/change-password", null, {
      username: "PortalHero",
      currentPassword: "WrongPassword!",
      newPassword: "BrandNewPassword123"
    });
    assert.equal(failChange.status, 401);

    // Change password with correct current password succeeds
    const okChange = await post(backend.port, "/api/change-password", null, {
      username: "PortalHero",
      currentPassword: "SuperSecretPassword123",
      newPassword: "BrandNewPassword123"
    });
    assert.equal(okChange.status, 200);
    assert.equal(okChange.body.success, true);
  } finally {
    backend.close();
  }
});

test("account takeover prevention: passwordless accounts cannot be claimed via change-password", async () => {
  const backend = await startBackend();
  try {
    // A server account starts with no password configured
    const srvLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "Server99",
      password: "AnyPassword123"
    });
    assert.equal(srvLogin.status, 200);
    const validToken = srvLogin.body.access_token;
    const accountId = srvLogin.body.account_id;

    // 1. Unauthenticated change-password on passwordless account MUST BE REFUSED
    const takeoverAttempt = await post(backend.port, "/api/change-password", null, {
      username: "Server99",
      newPassword: "AttackerPassword123"
    });
    assert.equal(takeoverAttempt.status, 401);
    assert.equal(takeoverAttempt.body.errorCode, "errors.com.epicgames.account.authentication_failed");

    // 2. Change-password on passwordless account with a login Bearer token MUST ALSO BE REFUSED (prevents takeover with default requirePassword=false)
    const tokenTakeoverAttempt = await post(backend.port, "/api/change-password", validToken, {
      username: "Server99",
      newPassword: "AttackerPassword123"
    });
    assert.equal(tokenTakeoverAttempt.status, 401);
    assert.equal(tokenTakeoverAttempt.body.errorCode, "errors.com.epicgames.account.authentication_failed");
    assert.ok(tokenTakeoverAttempt.body.errorMessage.includes("does not have a password configured"));

    // 3. Setting initial password on a passwordless account MUST go through an admin-issued reset link
    const linkRes = await post(backend.port, `/admin/api/accounts/${accountId}/password-reset-link`, null, {});
    assert.equal(linkRes.status, 200);
    const resetToken = linkRes.body.token;

    const resetRes = await post(backend.port, "/api/reset-password", null, {
      token: resetToken,
      newPassword: "OwnerNewPassword123"
    });
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.success, true);

    // 4. Now that account has a password configured, future changes via change-password require currentPassword
    const badCurrentChange = await post(backend.port, "/api/change-password", null, {
      username: "Server99",
      currentPassword: "WrongPassword123",
      newPassword: "NextSecurePassword456"
    });
    assert.equal(badCurrentChange.status, 401);

    const goodChange = await post(backend.port, "/api/change-password", null, {
      username: "Server99",
      currentPassword: "OwnerNewPassword123",
      newPassword: "NextSecurePassword456"
    });
    assert.equal(goodChange.status, 200);
    assert.equal(goodChange.body.success, true);
  } finally {
    backend.close();
  }
});

test("password reset links: admin generation, validation, and single-use consumption", async () => {
  const backend = await startBackend();
  try {
    // Create an account
    const regRes = await post(backend.port, "/api/register", null, {
      username: "ResetPlayer",
      password: "InitialPassword123"
    });
    assert.equal(regRes.status, 201);
    const accountId = regRes.body.id;

    // 1. Admin generates a reset link
    const linkRes = await post(backend.port, `/admin/api/accounts/${accountId}/password-reset-link`, null, {});
    assert.equal(linkRes.status, 200);
    assert.ok(linkRes.body.token);
    assert.ok(linkRes.body.url.includes(`/reset-password?token=${linkRes.body.token}`));
    const token = linkRes.body.token;

    // 2. Validate token (public route)
    const validateRes = await send({ host: "127.0.0.1", port: backend.port, path: `/api/reset-password/validate?token=${token}` });
    assert.equal(validateRes.status, 200);
    assert.equal(validateRes.body.valid, true);
    assert.equal(validateRes.body.displayName, "ResetPlayer");

    // Invalid token returns 400
    const badValidate = await send({ host: "127.0.0.1", port: backend.port, path: "/api/reset-password/validate?token=invalidToken123" });
    assert.equal(badValidate.status, 400);
    assert.equal(badValidate.body.valid, false);

    // 3. Complete password reset with < 8 chars fails
    const shortReset = await post(backend.port, "/api/reset-password", null, {
      token,
      newPassword: "short"
    });
    assert.equal(shortReset.status, 400);

    // 4. Complete password reset with valid 8+ chars succeeds
    const goodReset = await post(backend.port, "/api/reset-password", null, {
      token,
      newPassword: "BrandNewPassword789"
    });
    assert.equal(goodReset.status, 200);
    assert.equal(goodReset.body.success, true);

    // 5. Token is SINGLE-USE: second attempt with same token fails
    const reuseAttempt = await post(backend.port, "/api/reset-password", null, {
      token,
      newPassword: "AnotherPassword123"
    });
    assert.equal(reuseAttempt.status, 400);

    // 6. Login works with the newly reset password
    const newLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "ResetPlayer",
      password: "BrandNewPassword789"
    });
    assert.equal(newLogin.status, 200);
    assert.equal(newLogin.body.account_id, accountId);
  } finally {
    backend.close();
  }
});

test("admin settings API, password requirement, and loopback rate limit exemption", async () => {
  const backend = await startBackend();
  try {
    // Read default settings (requirePassword is false by default)
    const settingsRes = await send({ host: "127.0.0.1", port: backend.port, path: "/admin/api/settings" });
    assert.equal(settingsRes.status, 200);
    assert.equal(settingsRes.body.requirePassword, false);
    assert.equal(settingsRes.body.allowRegistration, true);

    // Toggle requirePassword to true via Admin API
    const updateRes = await post(backend.port, "/admin/api/settings", null, {
      requirePassword: true,
      allowAutoRegistration: false
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.requirePassword, true);

    // Register an account
    const regRes = await post(backend.port, "/api/register", null, {
      username: "ProtectedUser",
      password: "CorrectPassword123"
    });
    assert.equal(regRes.status, 201);

    // Login with wrong password FAILS
    const wrongLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "ProtectedUser",
      password: "WrongPassword123"
    });
    assert.equal(wrongLogin.status, 400);

    // Login with correct password SUCCEEDS
    const correctLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "ProtectedUser",
      password: "CorrectPassword123"
    });
    assert.equal(correctLogin.status, 200);

    // Admin direct password reset
    const adminReset = await post(backend.port, `/admin/api/accounts/${regRes.body.id}/password/reset`, null, {
      newPassword: "AdminResetPassword456"
    });
    assert.equal(adminReset.status, 200);

    const resetLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "ProtectedUser",
      password: "AdminResetPassword456"
    });
    assert.equal(resetLogin.status, 200);

    // Loopback rate limit exemption: calling check-username 35 times from 127.0.0.1 is NEVER rate limited
    for (let i = 0; i < 35; i++) {
      const check = await send({ host: "127.0.0.1", port: backend.port, path: "/api/check-username?username=LoopbackTest" });
      assert.equal(check.status, 200);
    }
  } finally {
    backend.close();
  }
});

test("dedicated server accounts, passwordless login, and hosting IP whitelist", async () => {
  const backend = await startBackend();
  try {
    // 1. Server accounts (CoreServer{n} or Server{n}) CAN be created and log in without passwords from loopback
    const server1Login = await requestToken(backend.port, {
      grant_type: "password",
      username: "CoreServer1"
    });
    assert.equal(server1Login.status, 200);
    assert.ok(server1Login.body.access_token);
    assert.ok(server1Login.body.account_id);

    // Server accounts can also log in with any arbitrary password
    const serverWithPw = await requestToken(backend.port, {
      grant_type: "password",
      username: "CoreServer1",
      password: "any-random-password-is-ignored"
    });
    assert.equal(serverWithPw.status, 200);
    assert.equal(serverWithPw.body.account_id, server1Login.body.account_id);

    // Another PC's launcher names its servers CoreServer-<PC>-{n} (Core-Launcher #6): server accounts of their own
    const remoteServer = await requestToken(backend.port, { grant_type: "password", username: "CoreServer-DESKTOP7-1" });
    assert.equal(remoteServer.status, 200);
    assert.notEqual(remoteServer.body.account_id, server1Login.body.account_id);

    // 2. Hosting IP management via Admin API (available under both /settings/hosting-ips and /sessions/hosting-ips)
    const hostingRes = await send({ host: "127.0.0.1", port: backend.port, path: "/admin/api/settings/hosting-ips" });
    assert.equal(hostingRes.status, 200);
    assert.ok(hostingRes.body.allowedHostingIps.includes("127.0.0.1"));

    // Add a remote hosting IP via settings endpoint
    const addIpRes = await post(backend.port, "/admin/api/settings/hosting-ips", null, { ip: "198.51.100.25" });
    assert.equal(addIpRes.status, 200);
    assert.ok(addIpRes.body.allowedHostingIps.includes("198.51.100.25"));

    // Also verifiable on /sessions/hosting-ips
    const checkSessionsRes = await send({ host: "127.0.0.1", port: backend.port, path: "/admin/api/sessions/hosting-ips" });
    assert.ok(checkSessionsRes.body.allowedHostingIps.includes("198.51.100.25"));

    // Remove hosting IP
    const deleteIpRes = await send(
      {
        host: "127.0.0.1",
        port: backend.port,
        path: "/admin/api/settings/hosting-ips/198.51.100.25",
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Content-Length": "2" }
      },
      "{}"
    );
    assert.equal(deleteIpRes.status, 200);
    assert.equal(deleteIpRes.body.allowedHostingIps.includes("198.51.100.25"), false);
  } finally {
    backend.close();
  }
});

test("login does not leak reset tokens and always verifies existing passwords", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");

  // Pre-seed an authentic legacy account with no password
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-legacy-"));
  const accDir = path.join(dataDir, "accounts", "legacy001");
  fs.mkdirSync(accDir, { recursive: true });
  fs.writeFileSync(path.join(accDir, "account.json"), JSON.stringify({
    id: "legacy001",
    displayName: "LegacyResetHero",
    created: new Date().toISOString()
  }));

  const backend = await startBackend({ dataDir });
  try {
    // 1. With requirePassword off (default): passwordless account logs in with any password (e.g. "Core")
    const defaultLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "LegacyResetHero",
      password: "Core"
    });
    assert.equal(defaultLogin.status, 200);
    assert.ok(defaultLogin.body.access_token);

    // 2. Enable requirePassword
    await post(backend.port, "/admin/api/settings", null, { requirePassword: true });

    // 3. Attempt login on the legacy passwordless account: MUST be refused and MUST NOT return resetToken
    const loginAttempt = await requestToken(backend.port, {
      grant_type: "password",
      username: "LegacyResetHero",
      password: "AnyPassword123!"
    });

    assert.equal(loginAttempt.status, 400);
    assert.equal(loginAttempt.body.resetToken, undefined);
    assert.equal(loginAttempt.body.resetUrl, undefined);
    assert.ok(loginAttempt.body.errorMessage.includes("admin-managed") || loginAttempt.body.errorMessage.includes("Password Reset Link"));

    // 4. Admin generates a reset link via loopback admin route
    const adminLinkRes = await post(backend.port, "/admin/api/accounts/legacy001/password-reset-link", null, {});
    assert.equal(adminLinkRes.status, 200);
    assert.ok(adminLinkRes.body.token);

    // 5. User uses the admin-generated token to set their password via POST /api/reset-password
    const resetRes = await post(backend.port, "/api/reset-password", null, {
      token: adminLinkRes.body.token,
      newPassword: "BrandNewPassword123!"
    });
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.success, true);

    // 6. Subsequent login succeeds with the newly set password
    const successLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "LegacyResetHero",
      password: "BrandNewPassword123!"
    });
    assert.equal(successLogin.status, 200);
    assert.ok(successLogin.body.access_token);

    // 7. Turn requirePassword BACK OFF: accounts with a password MUST STILL require their correct password!
    await post(backend.port, "/admin/api/settings", null, { requirePassword: false });

    const wrongLoginWhileOff = await requestToken(backend.port, {
      grant_type: "password",
      username: "LegacyResetHero",
      password: "WrongPassword123!"
    });
    assert.equal(wrongLoginWhileOff.status, 400);
    assert.equal(wrongLoginWhileOff.body.resetToken, undefined);

    const rightLoginWhileOff = await requestToken(backend.port, {
      grant_type: "password",
      username: "LegacyResetHero",
      password: "BrandNewPassword123!"
    });
    assert.equal(rightLoginWhileOff.status, 200);
    assert.ok(rightLoginWhileOff.body.access_token);
  } finally {
    backend.close();
  }
});

test("status route tells the launcher whether a password is required globally or per account", async () => {
  const backend = await startBackend();
  try {
    // 1. Plain status preserves backward compatibility with name and version
    const plainStatus = await get(backend.port, "/core/api/status");
    assert.equal(plainStatus.status, 200);
    assert.equal(plainStatus.body.name, "Core-Backend");
    assert.ok(plainStatus.body.version);

    // With auth=1 or via /core/api/auth-requirements, it tells the launcher the requirements
    const globalStatus = await get(backend.port, "/core/api/status?auth=1");
    assert.equal(globalStatus.status, 200);
    assert.equal(globalStatus.body.requirePassword, false);
    assert.equal(globalStatus.body.passwordRequired, false);

    const authReq = await get(backend.port, "/core/api/auth-requirements");
    assert.equal(authReq.status, 200);
    assert.equal(authReq.body.requirePassword, false);
    assert.equal(authReq.body.passwordRequired, false);

    // 2. Create an account with a password on the portal
    await post(backend.port, "/api/register", null, {
      username: "SecureUser",
      password: "Password123!"
    });

    // 3. User with password requires a password even when server requirePassword is false
    const userStatus = await get(backend.port, "/core/api/status?username=SecureUser");
    assert.equal(userStatus.status, 200);
    assert.equal(userStatus.body.requirePassword, false);
    assert.equal(userStatus.body.passwordRequired, true);
    assert.equal(userStatus.body.accountExists, true);
    assert.equal(userStatus.body.hasPassword, true);

    const userAuthReq = await get(backend.port, "/core/api/auth-requirements?username=SecureUser");
    assert.equal(userAuthReq.body.passwordRequired, true);
    assert.equal(userAuthReq.body.hasPassword, true);

    // 4. Querying a non-existent or passwordless user when requirePassword is false
    const unknownUser = await get(backend.port, "/core/api/status?username=UnknownUser");
    assert.equal(unknownUser.status, 200);
    assert.equal(unknownUser.body.passwordRequired, false);
    assert.equal(unknownUser.body.accountExists, false);

    // 5. Turn requirePassword ON globally
    await post(backend.port, "/admin/api/settings", null, { requirePassword: true });

    const globalStatusOn = await get(backend.port, "/core/api/status?auth=1");
    assert.equal(globalStatusOn.body.requirePassword, true);
    assert.equal(globalStatusOn.body.passwordRequired, true);

    const unknownUserOn = await get(backend.port, "/core/api/status?username=UnknownUser");
    assert.equal(unknownUserOn.body.requirePassword, true);
    assert.equal(unknownUserOn.body.passwordRequired, true);
  } finally {
    backend.close();
  }
});

test("status route rate limiting protects username enumeration for external IPs while exempting loopback", async () => {
  const backend = await startBackend();
  try {
    // 1. Loopback requests are never throttled, even beyond 30 requests
    for (let i = 0; i < 35; i++) {
      const res = await get(backend.port, "/core/api/status?username=LoopbackCheck");
      assert.equal(res.status, 200);
    }

    // 2. Simulated external IP reaches limit of 30 requests in a minute
    const externalIp = "198.51.100.99";
    for (let i = 0; i < 30; i++) {
      const res = await send({
        host: "127.0.0.1",
        port: backend.port,
        path: "/core/api/auth-requirements?username=ExternalCheck",
        headers: { "x-forwarded-for": externalIp }
      });
      assert.equal(res.status, 200);
    }

    // The 31st request from the external IP is throttled with 429
    const throttled = await send({
      host: "127.0.0.1",
      port: backend.port,
      path: "/core/api/auth-requirements?username=ExternalCheck",
      headers: { "x-forwarded-for": externalIp }
    });
    assert.equal(throttled.status, 429);
    assert.equal(throttled.body.errorCode, "errors.com.epicgames.common.throttled");
    assert.ok(throttled.headers["retry-after"]);
  } finally {
    backend.close();
  }
});


