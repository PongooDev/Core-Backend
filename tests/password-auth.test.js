import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, validatePassword, validateUsername, verifyPassword } from "../src/accounts/password.js";
import { post, requestToken, send, startBackend } from "./helpers.js";

test("password hashing and timing-safe verification", () => {
  const plain = "SecretPassword123!";
  const stored = hashPassword(plain);

  assert.ok(stored.salt && stored.salt.length === 32);
  assert.ok(stored.hash && stored.hash.length === 128);

  assert.equal(verifyPassword(plain, stored), true);
  assert.equal(verifyPassword("WrongPassword!", stored), false);
  assert.equal(verifyPassword("", stored), false);
  assert.equal(verifyPassword(null, stored), false);
});

test("username and password validation rules", () => {
  assert.equal(validateUsername("ValidUser"), null);
  assert.equal(validateUsername("User-Name_123"), null);
  assert.ok(validateUsername("ab")); // too short
  assert.ok(validateUsername("a".repeat(25))); // too long
  assert.ok(validateUsername("Bad@User!")); // invalid characters

  assert.equal(validatePassword("validPassword123"), null);
  assert.ok(validatePassword("short")); // < 8
  assert.ok(validatePassword("a".repeat(129))); // > 128
});

test("player web portal and registration API", async () => {
  const backend = await startBackend();
  try {
    // Portal HTML is served
    const registerPage = await send({ host: "127.0.0.1", port: backend.port, path: "/register" });
    assert.equal(registerPage.status, 200);
    assert.ok(registerPage.body.includes("<h1>Core</h1>"));
    assert.equal(registerPage.body.includes("Account creation & password management"), false);
    assert.equal(registerPage.body.includes("Powered by Core-Backend"), false);
    assert.equal(registerPage.body.includes("status-badge"), false);

    const portalPage = await send({ host: "127.0.0.1", port: backend.port, path: "/portal" });
    assert.equal(portalPage.status, 200);

    // Check status
    const status = await send({ host: "127.0.0.1", port: backend.port, path: "/api/portal/status" });
    assert.equal(status.status, 200);
    assert.equal(status.body.status, "online");

    // Check username availability
    const check1 = await send({ host: "127.0.0.1", port: backend.port, path: "/api/check-username?username=PortalHero" });
    assert.equal(check1.status, 200);
    assert.equal(check1.body.available, true);

    // Register new account
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

test("admin settings API and toggling requirePassword", async () => {
  const backend = await startBackend();
  try {
    // Read default settings
    const settingsRes = await send({ host: "127.0.0.1", port: backend.port, path: "/admin/api/settings" });
    assert.equal(settingsRes.status, 200);
    assert.equal(settingsRes.body.requirePassword, false);
    assert.equal(settingsRes.body.allowRegistration, true);

    // Register a player account
    const regRes = await post(backend.port, "/api/register", null, {
      username: "ProtectedUser",
      password: "CorrectPassword123"
    });
    assert.equal(regRes.status, 201);

    // In default mode (requirePassword: false), any password works
    const defaultLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "ProtectedUser",
      password: "AnyPasswordWorks"
    });
    assert.equal(defaultLogin.status, 200);

    // Toggle requirePassword: true via admin API
    const updateSettings = await post(backend.port, "/admin/api/settings", null, {
      requirePassword: true,
      allowAutoRegistration: false
    });
    assert.equal(updateSettings.status, 200);
    assert.equal(updateSettings.body.requirePassword, true);

    // Login with wrong password now FAILS
    const wrongLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "ProtectedUser",
      password: "WrongPassword"
    });
    assert.equal(wrongLogin.status, 400);
    assert.equal(wrongLogin.body.errorCode, "errors.com.epicgames.account.invalid_account_credentials");

    // Login with correct password SUCCEEDS
    const correctLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "ProtectedUser",
      password: "CorrectPassword123"
    });
    assert.equal(correctLogin.status, 200);
    assert.equal(correctLogin.body.account_id, regRes.body.id);

    // Unknown user rejected when auto-registration is disabled
    const unknownLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "NonExistentUser",
      password: "SomePassword123"
    });
    assert.equal(unknownLogin.status, 400);

    // Admin resets player password
    const adminReset = await post(backend.port, `/admin/api/accounts/${regRes.body.id}/password/reset`, null, {
      newPassword: "AdminResetPassword456"
    });
    assert.equal(adminReset.status, 200);
    assert.equal(adminReset.body.hasPassword, true);

    // Old password fails, admin-reset password works
    const oldLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "ProtectedUser",
      password: "CorrectPassword123"
    });
    assert.equal(oldLogin.status, 400);

    const resetLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "ProtectedUser",
      password: "AdminResetPassword456"
    });
    assert.equal(resetLogin.status, 200);

    // Toggle requirePassword back to false
    const toggleBack = await post(backend.port, "/admin/api/settings", null, {
      requirePassword: false,
      allowAutoRegistration: true
    });
    assert.equal(toggleBack.status, 200);
    assert.equal(toggleBack.body.requirePassword, false);

    // Auto registration works again with a password
    const autoLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "FreshNewPlayer",
      password: "whatever"
    });
    assert.equal(autoLogin.status, 200);
    assert.ok(autoLogin.body.access_token);
    assert.ok(autoLogin.body.account_id);

    // Verify portalUrl uses public address when configured
    const netUpdate = await post(backend.port, "/admin/api/network", null, {
      publicAddress: "203.0.113.7"
    });
    assert.equal(netUpdate.status, 200);

    const publicSettings = await send({ host: "127.0.0.1", port: backend.port, path: "/admin/api/settings" });
    assert.equal(publicSettings.status, 200);
    assert.equal(publicSettings.body.portalUrl, `http://203.0.113.7:${backend.port}/register`);
    assert.equal(publicSettings.body.publicAddress, "203.0.113.7");
  } finally {
    backend.close();
  }
});

test("only CoreServer{n} or Server{n} accounts can be created without a password", async () => {
  const backend = await startBackend();
  try {
    const { isServerAccountName } = await import("../src/accounts/password.js");

    // 1. isServerAccountName matching
    assert.equal(isServerAccountName("CoreServer1"), true);
    assert.equal(isServerAccountName("CoreServer2"), true);
    assert.equal(isServerAccountName("coreserver99"), true);
    assert.equal(isServerAccountName("Server1"), true);
    assert.equal(isServerAccountName("Server2"), true);
    assert.equal(isServerAccountName("server10"), true);
    assert.equal(isServerAccountName("Server 1"), true);
    assert.equal(isServerAccountName("CoreServer_2"), true);
    assert.equal(isServerAccountName("Server-3"), true);

    // Non-server names must not match
    assert.equal(isServerAccountName("CoreServer"), false); // missing {n}
    assert.equal(isServerAccountName("Server"), false); // missing {n}
    assert.equal(isServerAccountName("Player1"), false);
    assert.equal(isServerAccountName("ServerPlayer"), false);
    assert.equal(isServerAccountName("CoreTest"), false);
    assert.equal(isServerAccountName(""), false);
    assert.equal(isServerAccountName(null), false);

    // 2. Portal reserves server account names
    const checkServer = await send({ host: "127.0.0.1", port: backend.port, path: "/api/check-username?username=CoreServer1" });
    assert.equal(checkServer.status, 200);
    assert.equal(checkServer.body.available, false);
    assert.ok(checkServer.body.error.includes("reserved for dedicated servers"));

    const regServer = await post(backend.port, "/api/register", null, {
      username: "Server1",
      password: "ValidPassword123"
    });
    assert.equal(regServer.status, 400);
    assert.equal(regServer.body.errorCode, "errors.com.epicgames.account.reserved_name");

    // 3. Non-server accounts CANNOT be created without a password
    const noPasswordLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "PlayerWithoutPassword"
    });
    assert.equal(noPasswordLogin.status, 400);
    assert.equal(noPasswordLogin.body.errorCode, "errors.com.epicgames.account.invalid_account_credentials");
    assert.ok(noPasswordLogin.body.errorMessage.includes("Only CoreServer{n} or Server{n} accounts can be created without a password"));

    // 4. Server accounts (CoreServer{n} or Server{n}) CAN be created without a password
    const server1Login = await requestToken(backend.port, {
      grant_type: "password",
      username: "CoreServer1"
    });
    assert.equal(server1Login.status, 200);
    assert.ok(server1Login.body.access_token);
    assert.ok(server1Login.body.account_id);

    const server2Login = await requestToken(backend.port, {
      grant_type: "password",
      username: "Server2"
    });
    assert.equal(server2Login.status, 200);
    assert.ok(server2Login.body.access_token);
    assert.ok(server2Login.body.account_id);

    // 5. Server accounts can log in without password even when requirePassword is true
    await post(backend.port, "/admin/api/settings", null, { requirePassword: true });

    const server1RequirePwLogin = await requestToken(backend.port, {
      grant_type: "password",
      username: "CoreServer1"
    });
    assert.equal(server1RequirePwLogin.status, 200);
    assert.equal(server1RequirePwLogin.body.account_id, server1Login.body.account_id);

    // 6. Admin API reflects isServer property
    const adminDetails = await send({ host: "127.0.0.1", port: backend.port, path: `/admin/api/accounts/${server1Login.body.account_id}` });
    assert.equal(adminDetails.status, 200);
    assert.equal(adminDetails.body.isServer, true);
    assert.equal(adminDetails.body.hasPassword, false);
  } finally {
    backend.close();
  }
});
