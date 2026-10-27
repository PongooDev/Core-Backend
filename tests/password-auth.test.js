import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, validatePassword, validateUsername, verifyPassword } from "../src/accounts/password.js";
import { post, requestToken, send, startBackend } from "./helpers.js";

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

test("account takeover prevention: passwordless accounts require proof of ownership", async () => {
  const backend = await startBackend();
  try {
    // A server account starts with no password configured
    const srvLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "Server99"
    });
    assert.equal(srvLogin.status, 200);
    const validToken = srvLogin.body.access_token;

    // 1. Unauthenticated change-password on passwordless account MUST BE REFUSED (takeover hole closed)
    const takeoverAttempt = await post(backend.port, "/api/change-password", null, {
      username: "Server99",
      newPassword: "AttackerPassword123"
    });
    assert.equal(takeoverAttempt.status, 401);
    assert.equal(takeoverAttempt.body.errorCode, "errors.com.epicgames.account.authentication_failed");

    // 2. Change-password with wrong bearer token fails
    const badTokenAttempt = await post(backend.port, "/api/change-password", "BadToken", {
      username: "Server99",
      newPassword: "AttackerPassword123"
    });
    assert.equal(badTokenAttempt.status, 401);

    // 3. Setting initial password with valid bearer token SUCCEEDS (proof of ownership)
    const authSetup = await post(backend.port, "/api/change-password", validToken, {
      username: "Server99",
      newPassword: "OwnerNewPassword123"
    });
    assert.equal(authSetup.status, 200);
    assert.equal(authSetup.body.success, true);

    // 4. Now account has a password: future changes require current password
    const nextChange = await post(backend.port, "/api/change-password", null, {
      username: "Server99",
      currentPassword: "OwnerNewPassword123",
      newPassword: "NextSecurePassword456"
    });
    assert.equal(nextChange.status, 200);
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

test("automatic reset token emission when account needs a password reset", async () => {
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
    // 1. Enable requirePassword
    await post(backend.port, "/admin/api/settings", null, { requirePassword: true });

    // 2. Attempt login on the legacy passwordless account
    const loginAttempt = await requestToken(backend.port, {
      grant_type: "password",
      username: "LegacyResetHero",
      password: "AnyPassword123!"
    });

    assert.equal(loginAttempt.status, 400);
    assert.equal(loginAttempt.body.needsPasswordReset, true);
    assert.ok(loginAttempt.body.resetToken);
    assert.ok(loginAttempt.body.resetUrl.includes(loginAttempt.body.resetToken));
    assert.ok(loginAttempt.body.errorMessage.includes("requires a password reset"));

    // 3. User uses the emitted token to set their password via POST /api/reset-password
    const resetRes = await post(backend.port, "/api/reset-password", null, {
      token: loginAttempt.body.resetToken,
      newPassword: "BrandNewPassword123!"
    });
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.success, true);

    // 4. Subsequent login succeeds with the newly set password
    const successLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "LegacyResetHero",
      password: "BrandNewPassword123!"
    });
    assert.equal(successLogin.status, 200);
    assert.ok(successLogin.body.access_token);

    // 5. Attempting login with wrong password now fails and does NOT emit a reset token
    const wrongLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "LegacyResetHero",
      password: "WrongPassword123!"
    });
    assert.equal(wrongLogin.status, 400);
    assert.equal(wrongLogin.body.needsPasswordReset, undefined);
    assert.equal(wrongLogin.body.resetToken, undefined);
  } finally {
    backend.close();
  }
});
