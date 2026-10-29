import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

// CoreV2 #138: who may use cheats on a Core gameserver, which asks for each player before it runs their "cheat" command
// (services/fortnite/cheats.js).
const settings = (backend, body) => (body === undefined
  ? get(backend.port, "/admin/api/settings")
  : post(backend.port, "/admin/api/settings", undefined, body));
const ask = (backend, token, query) =>
  get(backend.port, `/fortnite/api/game/v2/cheats?${new URLSearchParams(query)}`, token);
const allowed = async (backend, token, query) => (await ask(backend, token, query)).body.allowed;

// An account the backend knows, made by logging in as a game would.
async function account(backend, displayName) {
  const { accountId } = await userLogin(backend.port, displayName);
  return { id: accountId, displayName };
}

test("by default every player may cheat, and the gameserver needs a token to ask", async () => {
  const backend = await startBackend();
  try {
    const current = (await settings(backend)).body;
    assert.deepEqual([current.cheats, current.cheatAccounts], ["everyone", []]);
    const token = await dedicatedServerToken(backend.port);
    assert.deepEqual((await ask(backend, token, { accountId: "0123456789abcdef0123456789abcdef", displayName: "Someone" })).body,
      { accountId: "0123456789abcdef0123456789abcdef", displayName: "Someone", mode: "everyone", allowed: true });
    assert.equal((await ask(backend, undefined, { accountId: "0123456789abcdef0123456789abcdef" })).status, 401);
  } finally {
    backend.close();
  }
});

test("the panel turns cheats off, or gives them to the listed accounts only, by id or display name, and it lasts over a restart", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-cheats-"));
  let backend = await startBackend({ dataDir });
  try {
    let token = await dedicatedServerToken(backend.port);
    const admin = await account(backend, "AdminPlayer");
    const named = await account(backend, "Named Player");
    const other = await account(backend, "OtherPlayer");
    assert.ok(admin?.id && named?.id && other?.id, "the accounts exist");

    let saved = (await settings(backend, { cheats: "off" })).body;
    assert.equal(saved.cheats, "off");
    assert.deepEqual((await ask(backend, token, { accountId: admin.id })).body,
      { accountId: admin.id, displayName: "AdminPlayer", mode: "off", allowed: false });

    // One by its id, one by its display name in another case, and a name no account has yet.
    saved = (await settings(backend, { cheats: "Admins", cheatAccounts: [admin.id, " named player ", "Later", "LATER", "", 5] })).body;
    assert.deepEqual([saved.cheats, saved.cheatAccounts], ["admins", [admin.id, "named player", "Later"]]);
    assert.equal(await allowed(backend, token, { accountId: admin.id }), true);
    assert.equal(await allowed(backend, token, { accountId: named.id }), true, "a listed display name lets its account cheat");
    assert.equal(await allowed(backend, token, { accountId: other.id }), false);
    assert.equal(await allowed(backend, token, { accountId: other.id, displayName: "AdminPlayer" }), false,
      "a known account is matched by itself, not by the name the gameserver sent");
    assert.equal(await allowed(backend, token, { displayName: "adminplayer" }), true, "without an id the account is found by its name");
    assert.equal(await allowed(backend, token, { accountId: "ffffffffffffffffffffffffffffffff", displayName: "later" }), true,
      "an account the backend doesn't know is matched by what the gameserver sent");
    assert.equal(await allowed(backend, token, { accountId: "ffffffffffffffffffffffffffffffff", displayName: "Nobody" }), false);

    // A mode that isn't one, or a list that isn't one, is ignored.
    saved = (await settings(backend, { cheats: "some", cheatAccounts: "AdminPlayer" })).body;
    assert.deepEqual([saved.cheats, saved.cheatAccounts], ["admins", [admin.id, "named player", "Later"]]);

    backend.close();
    backend = await startBackend({ dataDir });
    token = await dedicatedServerToken(backend.port);
    saved = (await settings(backend)).body;
    assert.deepEqual([saved.cheats, saved.cheatAccounts], ["admins", [admin.id, "named player", "Later"]]);
    assert.equal(await allowed(backend, token, { accountId: named.id }), true);

    // Removing one, then cheats for everyone again: the list stays for next time.
    saved = (await settings(backend, { cheatAccounts: [admin.id, "Later"] })).body;
    assert.equal(await allowed(backend, token, { accountId: named.id }), false);
    saved = (await settings(backend, { cheats: "everyone" })).body;
    assert.deepEqual([saved.cheats, saved.cheatAccounts], ["everyone", [admin.id, "Later"]]);
    assert.equal(await allowed(backend, token, { accountId: other.id }), true);
  } finally {
    backend.close();
  }
});

test("config.json's cheats and cheatAccounts are set at every start", async () => {
  const backend = await startBackend({ cheats: "admins", cheatAccounts: ["ConfigAdmin"] });
  try {
    const saved = (await settings(backend)).body;
    assert.deepEqual([saved.cheats, saved.cheatAccounts], ["admins", ["ConfigAdmin"]]);
    const token = await dedicatedServerToken(backend.port);
    assert.equal(await allowed(backend, token, { displayName: "configadmin" }), true);
    assert.equal(await allowed(backend, token, { displayName: "Someone" }), false);
  } finally {
    backend.close();
  }
});
