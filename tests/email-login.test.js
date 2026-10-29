import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateEmail } from "../src/accounts/email.js";
import { createAccountStore } from "../src/accounts/store.js";
import { get, post, requestToken, send, startBackend } from "./helpers.js";

// Core-Backend #120: an optional contact email, linked at registration or later, that signs in with the password.

const register = (backend, body) => post(backend.port, "/api/register", null, body);
const login = (backend, username, password) => requestToken(backend.port, { grant_type: "password", username, password });
const settings = (backend, body) => post(backend.port, "/admin/api/settings", null, body);

test("email validation: trimmed, case-insensitive, and never an @core.com address", () => {
  assert.equal(validateEmail("player@example.com"), null);
  assert.equal(validateEmail("  First.Last+tag@Mail.Example.co.uk  "), null);
  for (const bad of ["", "   ", "player", "player@", "@example.com", "player@example", "a@b@example.com", "pla yer@example.com",
    "player@exa mple.com", "player@-example.com", "player@example.c", ".player@example.com", "pla..yer@example.com",
    `${"a".repeat(65)}@example.com`, `player@${"a".repeat(250)}.com`]) {
    assert.ok(validateEmail(bad), `${JSON.stringify(bad)} should be refused`);
  }
  assert.match(validateEmail("Someone@core.com"), /core\.com/);
  assert.match(validateEmail("someone@mail.CORE.com"), /core\.com/);
  assert.ok(validateEmail(42));
});

test("registering with an email links it; without one links none; the game still sees <name>@core.com", async () => {
  const backend = await startBackend();
  try {
    const withEmail = await register(backend, { username: "MailHero", password: "SuperSecret123", email: "  Mail.Hero@Example.COM " });
    assert.equal(withEmail.status, 201);
    assert.equal(withEmail.body.email, "mail.hero@example.com");
    const stored = JSON.parse(fs.readFileSync(path.join(backend.dataDir, "accounts", withEmail.body.id, "account.json"), "utf8"));
    assert.equal(stored.contactEmail, "mail.hero@example.com");
    assert.equal(stored.email, "MailHero@core.com");

    const without = await register(backend, { username: "NoMail", password: "SuperSecret123" });
    assert.equal(without.status, 201);
    assert.equal(without.body.email, null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(backend.dataDir, "accounts", without.body.id, "account.json"), "utf8")).contactEmail, undefined);

    // What the game reads of its own account: the synthetic address, never the contact email.
    const token = await login(backend, "mail.hero@example.com", "SuperSecret123");
    assert.equal(token.status, 200);
    const info = await get(backend.port, `/account/api/public/account/${withEmail.body.id}`, token.body.access_token);
    assert.equal(info.body.email, "MailHero@core.com");
    assert.equal(info.body.displayName, "MailHero");
    assert.equal(JSON.stringify(info.body).includes("example.com"), false);
    // Nor anyone else's account info or lookups.
    const other = await login(backend, "NoMail", "SuperSecret123");
    for (const route of [`/account/api/public/account/${withEmail.body.id}`, `/account/api/public/account?accountId=${withEmail.body.id}`,
      "/account/api/public/account/displayName/MailHero", "/persona/api/public/account/lookup?q=MailHero"]) {
      const response = await get(backend.port, route, other.body.access_token);
      assert.equal(response.status, 200, route);
      assert.equal(JSON.stringify(response.body).includes("example.com"), false, route);
    }
  } finally {
    backend.close();
  }
});

test("registration refuses a taken or badly formed email and makes no account", async () => {
  const backend = await startBackend();
  try {
    assert.equal((await register(backend, { username: "FirstOne", password: "SuperSecret123", email: "taken@example.com" })).status, 201);

    const duplicate = await register(backend, { username: "SecondOne", password: "SuperSecret123", email: " TAKEN@example.com" });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.errorMessage, /already linked/);
    for (const email of ["not-an-email", "someone@core.com", "FirstOne@core.com", "x@y"]) {
      const bad = await register(backend, { username: "SecondOne", password: "SuperSecret123", email });
      assert.equal(bad.status, 400, email);
    }
    const check = await send({ host: "127.0.0.1", port: backend.port, path: "/api/check-username?username=SecondOne" });
    assert.equal(check.body.available, true);
  } finally {
    backend.close();
  }
});

test("the game's password grant signs in by email or by name, with the password", async () => {
  const backend = await startBackend();
  try {
    const created = await register(backend, { username: "Signer", password: "SuperSecret123", email: "sign.mail@example.com" });

    const byName = await login(backend, "Signer", "SuperSecret123");
    assert.equal(byName.status, 200);
    assert.equal(byName.body.account_id, created.body.id);
    const byCoreAddress = await login(backend, "Signer@core.com", "SuperSecret123");
    assert.equal(byCoreAddress.body.account_id, created.body.id);
    const byEmail = await login(backend, "  SIGN.Mail@Example.com ", "SuperSecret123");
    assert.equal(byEmail.status, 200);
    assert.equal(byEmail.body.account_id, created.body.id);
    // Any other name@domain no account linked is still the name before the @, as before #120.
    const legacy = await login(backend, "Signer@elsewhere.net", "SuperSecret123");
    assert.equal(legacy.body.account_id, created.body.id);
    assert.equal((await login(backend, "Signer@elsewhere.net", "WrongPassword1")).status, 400);

    assert.equal((await login(backend, "sign.mail@example.com", "WrongPassword1")).status, 400);
    // The launcher's fallback password never gets in by email.
    assert.equal((await login(backend, "sign.mail@example.com", "Core")).status, 400);

    // An address nobody linked doesn't make an account, even with auto-registration on.
    const unknown = await login(backend, "nobody@example.com", "SuperSecret123");
    assert.equal(unknown.status, 400);
    assert.equal(fs.readdirSync(path.join(backend.dataDir, "accounts")).length, 1);

    // The launcher's check says an email sign-in needs a password, without saying whether the address is linked.
    const linked = await send({ host: "127.0.0.1", port: backend.port, path: "/core/api/status?username=sign.mail%40example.com" });
    const unlinked = await send({ host: "127.0.0.1", port: backend.port, path: "/core/api/status?username=nobody%40example.com" });
    assert.equal(linked.body.passwordRequired, true);
    assert.equal(linked.body.accountExists, undefined);
    assert.deepEqual({ ...linked.body }, { ...unlinked.body });
  } finally {
    backend.close();
  }
});

test("an account without a password can't be reached by its email, even when passwords aren't required", async () => {
  const backend = await startBackend();
  try {
    assert.equal((await settings(backend, { requirePassword: false, allowAutoRegistration: true })).status, 200);
    // A passwordless account (the launcher's "Core" default), which its name still reaches.
    const made = await login(backend, "OpenDoor", "Core");
    assert.equal(made.status, 200);
    const linked = await post(backend.port, `/admin/api/accounts/${made.body.account_id}/email`, null, { email: "open.door@example.com" });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.contactEmail, "open.door@example.com");
    assert.equal(linked.body.hasPassword, false);

    assert.equal((await login(backend, "OpenDoor", "Core")).status, 200);
    for (const password of ["Core", "", "anything12345"]) {
      const response = await login(backend, "open.door@example.com", password);
      assert.equal(response.status, 400, password);
      assert.equal(response.body.errorCode, "errors.com.epicgames.account.invalid_account_credentials");
    }
    // The portal answers it as it does a wrong password or an unknown address.
    const portal = await post(backend.port, "/api/account", null, { username: "open.door@example.com", password: "anything12345" });
    const nobody = await post(backend.port, "/api/account", null, { username: "nobody@example.com", password: "anything12345" });
    assert.equal(portal.status, 401);
    assert.deepEqual(portal.body, nobody.body);
    const change = await post(backend.port, "/api/change-password", null, { username: "open.door@example.com", currentPassword: "x", newPassword: "BrandNewPassword1" });
    assert.equal(change.status, 401);

    // Once the host sets a password, the email signs in with it.
    await post(backend.port, `/admin/api/accounts/${made.body.account_id}/password/reset`, null, { newPassword: "NowSecret123" });
    const signedIn = await login(backend, "open.door@example.com", "NowSecret123");
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.account_id, made.body.account_id);
  } finally {
    backend.close();
  }
});

test("the portal links, changes and unlinks an email, and changes the password by email", async () => {
  const backend = await startBackend();
  try {
    const created = await register(backend, { username: "Linker", password: "SuperSecret123" });
    await register(backend, { username: "Holder", password: "SuperSecret123", email: "held@example.com" });

    const shown = await post(backend.port, "/api/account", null, { username: "Linker", password: "SuperSecret123" });
    assert.deepEqual(shown.body, { id: created.body.id, displayName: "Linker", email: null });
    assert.equal((await post(backend.port, "/api/account", null, { username: "Linker", password: "WrongPassword1" })).status, 401);
    // Changing it needs the password.
    assert.equal((await post(backend.port, "/api/account/email", null, { username: "Linker", password: "WrongPassword1", email: "link.mail@example.com" })).status, 401);

    const linked = await post(backend.port, "/api/account/email", null, { username: "Linker", password: "SuperSecret123", email: " Link.Mail@Example.com" });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.email, "link.mail@example.com");
    assert.equal((await login(backend, "link.mail@example.com", "SuperSecret123")).body.account_id, created.body.id);

    // Someone else's, @core.com and bad ones are refused, and the linked one stays.
    const taken = await post(backend.port, "/api/account/email", null, { username: "Linker", password: "SuperSecret123", email: "HELD@example.com" });
    assert.equal(taken.status, 409);
    for (const email of ["Holder@core.com", "nope"]) {
      assert.equal((await post(backend.port, "/api/account/email", null, { username: "Linker", password: "SuperSecret123", email })).status, 400, email);
    }
    assert.equal((await post(backend.port, "/api/account", null, { username: "link.mail@example.com", password: "SuperSecret123" })).body.email, "link.mail@example.com");

    // Signed in by email, change it: the old address stops working and is free again.
    const changed = await post(backend.port, "/api/account/email", null, { username: "LINK.MAIL@example.com", password: "SuperSecret123", email: "fresh.mail@example.com" });
    assert.equal(changed.body.email, "fresh.mail@example.com");
    assert.equal((await login(backend, "link.mail@example.com", "SuperSecret123")).status, 400);
    assert.equal((await login(backend, "fresh.mail@example.com", "SuperSecret123")).status, 200);
    assert.equal((await register(backend, { username: "Reuser", password: "SuperSecret123", email: "link.mail@example.com" })).status, 201);

    // The password changes by email too.
    const changedPassword = await post(backend.port, "/api/change-password", null, { username: "fresh.mail@example.com", currentPassword: "SuperSecret123", newPassword: "EvenMoreSecret1" });
    assert.equal(changedPassword.status, 200);
    assert.equal((await login(backend, "Linker", "EvenMoreSecret1")).status, 200);

    // An empty email unlinks it.
    const unlinked = await post(backend.port, "/api/account/email", null, { username: "Linker", password: "EvenMoreSecret1", email: "" });
    assert.equal(unlinked.body.email, null);
    assert.equal((await login(backend, "fresh.mail@example.com", "EvenMoreSecret1")).status, 400);
    assert.equal((await login(backend, "Linker", "EvenMoreSecret1")).status, 200);
  } finally {
    backend.close();
  }
});

test("the admin panel shows, sets, searches and clears a player's email", async () => {
  const backend = await startBackend();
  try {
    const created = await register(backend, { username: "Managed", password: "SuperSecret123" });
    await register(backend, { username: "Other", password: "SuperSecret123", email: "other@example.com" });
    const url = `/admin/api/accounts/${created.body.id}`;

    assert.equal((await get(backend.port, url)).body.contactEmail, null);
    assert.equal((await get(backend.port, url)).body.email, "Managed@core.com");

    const set = await post(backend.port, `${url}/email`, null, { email: "Boss.Mail@Example.com" });
    assert.equal(set.status, 200);
    assert.equal(set.body.contactEmail, "boss.mail@example.com");
    assert.equal(set.body.email, "Managed@core.com");
    assert.equal((await login(backend, "boss.mail@example.com", "SuperSecret123")).body.account_id, created.body.id);

    assert.equal((await post(backend.port, `${url}/email`, null, { email: "other@EXAMPLE.com" })).status, 409);
    assert.equal((await post(backend.port, `${url}/email`, null, { email: "managed@core.com" })).status, 400);
    assert.equal((await post(backend.port, `${url}/email`, null, { email: "bad" })).status, 400);

    const found = (await get(backend.port, "/admin/api/accounts?search=boss.mail%40example")).body;
    assert.deepEqual(found.map((account) => account.displayName), ["Managed"]);

    const cleared = await post(backend.port, `${url}/email`, null, { email: "" });
    assert.equal(cleared.body.contactEmail, null);
    assert.equal((await login(backend, "boss.mail@example.com", "SuperSecret123")).status, 400);
  } finally {
    backend.close();
  }
});

test("linked emails are indexed again on start and freed when an account is deleted", async () => {
  const backend = await startBackend();
  try {
    const created = await register(backend, { username: "Restarted", password: "SuperSecret123", email: "restarted@example.com" });
    const reloaded = createAccountStore(backend.dataDir);
    assert.equal(reloaded.findByEmail("RESTARTED@example.com")?.id, created.body.id);
    assert.equal(reloaded.findByLogin("restarted@example.com")?.id, created.body.id);
    assert.equal(reloaded.findByLogin("Restarted@core.com")?.id, created.body.id);
    assert.equal(reloaded.findByLogin("restarted")?.id, created.body.id);
    assert.throws(() => reloaded.checkEmail("restarted@example.com"), /already linked/);

    const removed = await post(backend.port, `/admin/api/accounts/${created.body.id}/delete`, null, { confirm: "Restarted" });
    assert.equal(removed.status, 200);
    assert.equal((await register(backend, { username: "Successor", password: "SuperSecret123", email: "restarted@example.com" })).status, 201);
  } finally {
    backend.close();
  }
});
