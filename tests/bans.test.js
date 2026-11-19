import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { banUntil, checkBanAddress, isActiveBan } from "../src/accounts/bans.js";
import { certClient, get, post, requestToken, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #390: account bans (permanent as before, or timed), IP bans and hardware bans.

const admin = (backend, urlPath, body) => (body === undefined ? get(backend.port, `/admin/api${urlPath}`) : post(backend.port, `/admin/api${urlPath}`, undefined, body));

// What Core's launcher sends (Core-Launcher BackendAuthClient): a SHA-256, as 64 hex digits.
const machineA = crypto.createHash("sha256").update("CoreLauncher-HWID:machine-a").digest("hex");
const machineB = crypto.createHash("sha256").update("CoreLauncher-HWID:machine-b").digest("hex");

// A password login as the launcher (hardware) or the game (none) sends it, from address (with the backend behind a proxy).
function login(port, username, { hardware, address, grant = { grant_type: "password", username, password: "test" } } = {}) {
  const headers = {
    Authorization: `basic ${Buffer.from(`${certClient}:secret`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Fortnite/++Fortnite+Release-Cert-CL-3532353 Windows/10.0.17134.1.768.64bit"
  };
  if (hardware) headers["X-Core-Hardware-Id"] = hardware;
  if (address) headers["X-Forwarded-For"] = address;
  return send({ host: "127.0.0.1", port, method: "POST", path: "/account/api/oauth/token", headers }, new URLSearchParams(grant).toString());
}

// A data folder with one account already in it, as a backend made before #390 saved it.
function seededData(account, bansFile) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-bans-"));
  fs.mkdirSync(path.join(dataDir, "accounts", account.id), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "accounts", account.id, "account.json"), JSON.stringify(account));
  if (bansFile) fs.writeFileSync(path.join(dataDir, "bans.json"), JSON.stringify(bansFile));
  return dataDir;
}
const oldAccount = (displayName, banned) => ({ id: crypto.randomBytes(16).toString("hex"), displayName, email: `${displayName}@core.com`,
  created: "2026-01-01T00:00:00.000Z", ...(banned ? { banned } : {}) });

test("a ban's end: none is permanent, a past one is over, a bad one stays", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  assert.equal(isActiveBan({ reason: "x", at: "2026-01-01T00:00:00Z" }, now), true, "a ban saved before #390 never ends");
  assert.equal(isActiveBan({ until: "2026-11-19T11:59:59Z" }, now), false);
  assert.equal(isActiveBan({ until: "2026-11-19T12:00:01Z" }, now), true);
  assert.equal(isActiveBan({ until: "soon" }, now), true, "an unreadable end never unbans");
  assert.equal(isActiveBan(null, now), false);
  assert.equal(banUntil(undefined, now), null);
  assert.equal(banUntil(48, now), "2026-11-21T12:00:00.000Z");
  assert.equal(banUntil(0, now), undefined);
  assert.equal(banUntil(1.5, now), undefined);
});

test("loopback and this PC's own addresses are never IP banned; a private one is warned about", () => {
  assert.match(checkBanAddress("127.0.0.1").problem, /loopback/);
  assert.match(checkBanAddress("::1").problem, /loopback/);
  assert.match(checkBanAddress("::ffff:127.0.0.1").problem, /loopback/);
  assert.match(checkBanAddress("not an ip").problem, /IP address/);
  const own = Object.values(os.networkInterfaces()).flat().find((entry) => entry && !entry.internal && entry.family === "IPv4");
  if (own) assert.match(checkBanAddress(own.address).problem, /own addresses/);
  const lan = checkBanAddress("192.168.77.201");
  if (!lan.problem) assert.match(lan.warning, /private address/);
  assert.match(checkBanAddress("25.1.2.3").warning ?? checkBanAddress("25.1.2.3").problem, /private|own/, "Hamachi's range is a VPN's");
  assert.deepEqual(checkBanAddress("203.0.113.9"), { address: "203.0.113.9", warning: null, ipv6: false });
});

test("an account ban saved before #390 is still honoured, and lifting it works as before", async () => {
  const account = oldAccount("OldBanned", { reason: "griefing", at: "2025-06-01T00:00:00.000Z" });
  const dataDir = seededData(account);
  const backend = await startBackend({ dataDir });
  try {
    const refused = await login(backend.port, "OldBanned");
    assert.equal(refused.status, 403);
    assert.equal(refused.body.errorCode, "errors.com.epicgames.account.account_not_active");
    assert.equal(refused.body.errorMessage, "This account is banned: griefing", "the message is the same as before");

    const list = (await admin(backend, "/bans")).body;
    assert.deepEqual(list.map((ban) => [ban.type, ban.displayName, ban.until]), [["account", "OldBanned", null]]);
    // The old body ({reason}) still makes the old, permanent ban, saved as it always was.
    assert.equal((await admin(backend, `/accounts/${account.id}/unban`, {})).status, 200);
    assert.equal((await login(backend.port, "OldBanned")).status, 200);
    await admin(backend, `/accounts/${account.id}/ban`, { reason: "again" });
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "accounts", account.id, "account.json"), "utf8"));
    assert.deepEqual(Object.keys(saved.banned).sort(), ["at", "reason"]);
    assert.equal((await login(backend.port, "OldBanned")).status, 403);
    assert.equal((await admin(backend, "/bans/unban", { id: `account:${account.id}` })).status, 200);
    assert.equal((await login(backend.port, "OldBanned")).status, 200);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a temporary ban refuses logins with its end until it has passed, then lifts itself", async () => {
  const ended = oldAccount("WasBanned", { reason: "spam", at: "2026-11-01T00:00:00.000Z", until: "2026-11-02T00:00:00.000Z" });
  const dataDir = seededData(ended);
  const backend = await startBackend({ dataDir });
  try {
    // Ended while the backend was down or since: the next login goes through and clears it.
    assert.equal((await login(backend.port, "WasBanned")).status, 200);
    assert.equal((await admin(backend, `/accounts/${ended.id}`)).body.banned, null);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "accounts", ended.id, "account.json"), "utf8"));
    assert.equal(saved.banned, undefined);

    // A new timed ban: two days from the panel's hours.
    const player = await userLogin(backend.port, "TimedOut");
    assert.equal((await admin(backend, `/accounts/${player.accountId}/ban`, { type: "account", hours: 0 })).status, 400);
    const details = (await admin(backend, `/accounts/${player.accountId}/ban`, { type: "account", hours: 48, reason: "toxic" })).body;
    const until = Date.parse(details.banned.until);
    assert.ok(Math.abs(until - (Date.now() + 48 * 3600 * 1000)) < 60 * 1000);
    assert.equal((await get(backend.port, "/account/api/oauth/verify", player.token)).status, 401, "the ban logs them out");
    const refused = await login(backend.port, "TimedOut");
    assert.equal(refused.status, 403);
    assert.match(refused.body.errorMessage, /^This account is banned until \d{4}-\d\d-\d\d \d\d:\d\d UTC: toxic$/);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("an IP ban refuses every player login and token from that address, and not from others", async () => {
  const backend = await startBackend();
  try {
    await post(backend.port, "/admin/api/network", undefined, { behindProxy: true });
    const first = await login(backend.port, "Roamer", { address: "203.0.113.50" });
    assert.equal(first.status, 200);
    const details = (await admin(backend, `/accounts/${first.body.account_id}`)).body;
    assert.equal(details.lastAddress, "203.0.113.50");

    assert.equal((await admin(backend, `/accounts/${first.body.account_id}/ban`, { type: "ip", address: "127.0.0.1" })).status, 400, "never loopback");
    const lan = await admin(backend, `/accounts/${first.body.account_id}/ban`, { type: "ip", address: "192.168.250.250" });
    assert.ok([400, 409].includes(lan.status), "a private address needs confirming (or is this PC's own)");
    const banned = await admin(backend, `/accounts/${first.body.account_id}/ban`, { type: "ip", reason: "alts", hours: 24 });
    assert.equal(banned.status, 200);
    assert.equal(banned.body.ban.value, "203.0.113.50");
    assert.equal(banned.body.banned, null, "the account itself isn't banned");

    // Any account from that address, even a new one, and the refresh of a token taken before.
    const other = await login(backend.port, "Alt", { address: "203.0.113.50" });
    assert.equal(other.status, 403);
    assert.match(other.body.errorMessage, /^This IP address is banned until .* UTC: alts$/);
    const refresh = await login(backend.port, "Roamer", { address: "203.0.113.50", grant: { grant_type: "refresh_token", refresh_token: first.body.refresh_token } });
    assert.equal(refresh.status, 400, "the ban revoked their tokens, the refresh token too");
    assert.equal((await login(backend.port, "Roamer", { address: "198.51.100.7" })).status, 200, "another address logs in");
    // Gameservers' accounts aren't players: IP bans don't stop them.
    assert.equal((await login(backend.port, "CoreServer1", { address: "203.0.113.50" })).status, 403, "not a Trusted Hosting IP");
    assert.equal((await login(backend.port, "CoreServer1")).status, 200);

    const list = (await admin(backend, `/bans?accountId=${first.body.account_id}`)).body;
    assert.deepEqual(list.map((ban) => [ban.type, ban.value]), [["ip", "203.0.113.50"]]);
    assert.equal((await admin(backend, "/bans/unban", { id: list[0].id })).status, 200);
    assert.equal((await login(backend.port, "Alt", { address: "203.0.113.50" })).status, 200);
    assert.deepEqual((await admin(backend, "/bans")).body, []);
  } finally {
    backend.close();
  }
});

test("an IP ban that has ended lets the address in again", async () => {
  const account = oldAccount("Returner");
  const dataDir = seededData(account, { salt: "a".repeat(64), bans: [{ id: "x", type: "ip", value: "203.0.113.77", reason: "", at: "2026-11-01T00:00:00Z", until: "2026-11-02T00:00:00Z" }] });
  const backend = await startBackend({ dataDir });
  try {
    await post(backend.port, "/admin/api/network", undefined, { behindProxy: true });
    assert.equal((await login(backend.port, "Returner", { address: "203.0.113.77" })).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "bans.json"), "utf8")).bans, []);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a hardware ban refuses the PC's launcher and game logins, keeps only a salted hash, and lifts", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Cheater");
    assert.equal((await admin(backend, `/accounts/${player.accountId}/ban`, { type: "hardware" })).status, 400, "no hardware id recorded yet");
    assert.equal((await login(backend.port, "Cheater", { hardware: machineA })).status, 200);
    assert.equal((await login(backend.port, "Cheater", { hardware: "not-a-hash" })).status, 200, "a malformed id is no id");

    const saved = JSON.parse(fs.readFileSync(path.join(backend.dataDir, "accounts", player.accountId, "account.json"), "utf8"));
    assert.match(saved.hardware.hash, /^[0-9a-f]{64}$/);
    assert.notEqual(saved.hardware.hash, machineA, "never the launcher's value itself");
    assert.ok(!fs.readFileSync(path.join(backend.dataDir, "accounts", player.accountId, "account.json"), "utf8").includes(machineA));

    const banned = await admin(backend, `/accounts/${player.accountId}/ban`, { type: "hardware", reason: "aimbot" });
    assert.equal(banned.status, 200);
    assert.ok(!fs.readFileSync(path.join(backend.dataDir, "bans.json"), "utf8").includes(machineA));

    // The game's own login (no header) is checked by the hash the account last logged in with.
    const game = await login(backend.port, "Cheater");
    assert.equal(game.status, 403);
    assert.equal(game.body.errorMessage, "This PC is banned: aimbot");
    // A new account from the same PC, through the launcher.
    const alt = await login(backend.port, "CheaterAlt", { hardware: machineA });
    assert.equal(alt.status, 403);
    assert.equal((await admin(backend, "/accounts")).body.some((account) => account.displayName === "CheaterAlt"), false, "no account was made");
    // Another PC is a different machine.
    assert.equal((await login(backend.port, "Innocent", { hardware: machineB })).status, 200);

    const [ban] = (await admin(backend, "/bans")).body;
    assert.equal(ban.type, "hardware");
    assert.equal(ban.value.length, 13, "the panel sees the hash's start only");
    assert.equal((await admin(backend, "/bans/unban", { id: ban.id })).status, 200);
    assert.equal((await login(backend.port, "Cheater")).status, 200);
  } finally {
    backend.close();
  }
});

test("Require hardware ID refuses logins without one, and only while it is on", async () => {
  const backend = await startBackend();
  try {
    assert.equal((await login(backend.port, "NoLauncher")).status, 200, "off by default: older launchers log in");
    await post(backend.port, "/admin/api/settings", undefined, { requireHardwareId: true });
    const refused = await login(backend.port, "NoLauncher");
    assert.equal(refused.status, 403);
    assert.equal(refused.body.errorCode, "errors.com.epicgames.account.hardware_id_required");
    assert.equal((await login(backend.port, "NewPlayer")).status, 403);
    assert.equal((await admin(backend, "/accounts")).body.some((account) => account.displayName === "NewPlayer"), false);
    // The launcher's login records the machine; the game's own login after it is let in.
    assert.equal((await login(backend.port, "NoLauncher", { hardware: machineB })).status, 200);
    assert.equal((await login(backend.port, "NoLauncher")).status, 200);
    // Gameservers send none and don't need one.
    assert.equal((await login(backend.port, "CoreServer2")).status, 200);
    await post(backend.port, "/admin/api/settings", undefined, { requireHardwareId: false });
    assert.equal((await requestToken(backend.port, { grant_type: "password", username: "Plain", password: "test" })).status, 200);
  } finally {
    backend.close();
  }
});
