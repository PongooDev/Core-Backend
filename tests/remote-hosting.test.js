import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowsHosting, hostingIp, hostingIps } from "../src/network.js";
import { createSessionStore, managesSession, sessionJson } from "../src/matchmaking/sessions.js";
import { createSettingsStore } from "../src/settings/store.js";
import { createServer } from "../src/server.js";
import { certClient, certUserAgent, get, post, request, requestToken, send } from "./helpers.js";

// Gameservers on other PCs (Core-Backend #125): the admin panel's Trusted Hosting IPs.

const base = "/fortnite/api/matchmaking/session";
const dedicatedServer = ["313dfed3ec3023e52d3be9dda178bdfa", "111aa434a6780d54f5cf759149639f20"];
const euServer = {
  ownerId: "", ownerName: "", serverName: "Core-EU", serverAddress: "127.0.0.1", serverPort: 7777,
  maxPublicPlayers: 4, maxPrivatePlayers: 0, isDedicated: true, buildUniqueId: "595160781",
  attributes: { REGION_s: "EU", MATCHMAKINGPOOL_s: "Any", GAMEMODE_s: "FORTEMPTY", BEACONPORT_i: 15000 }
};
const euSearch = {
  criteria: [{ type: "EQUAL", key: "REGION_s", value: "EU" }, { type: "EQUAL", key: "GAMEMODE_s", value: "FORTEMPTY" }],
  requireDedicated: true, maxCurrentPlayers: 0, buildUniqueId: "595160781", maxResults: 30
};

// A backend with remote access on whose connections come from `from.address`, as if made from that machine: the
// connection's own address is the only one the backend goes by.
async function startRemoteBackend() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  const server = await createServer({ dataDir, requestLog: false, emptyServerWaitMs: 0, earnScoreWaitMs: 0, remoteAccess: true });
  const from = { address: "127.0.0.1" };
  server.prependListener("connection", (socket) => {
    Object.defineProperty(socket, "remoteAddress", { get: () => from.address, configurable: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    from,
    close() {
      server.closeAllConnections();
      server.close();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

const login = (port, username, headers = {}) => send({
  host: "127.0.0.1", port, method: "POST", path: "/account/api/oauth/token",
  headers: { Authorization: `basic ${Buffer.from(`${certClient}:secret`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": certUserAgent, ...headers }
}, new URLSearchParams({ grant_type: "password", username, password: "test" }).toString());

test("the Trusted Hosting IPs are IP addresses, and only they and this PC may host", () => {
  assert.equal(hostingIp(" 203.0.113.7 "), "203.0.113.7");
  assert.equal(hostingIp("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(hostingIp("2001:0DB8:0000::0001"), "2001:db8::1");
  for (const bad of ["", "localhost", "my-pc.duckdns.org", "203.0.113.0/24", "203.0.113.*", "0.0.0.0", "::", "1.2.3", 7, null]) {
    assert.equal(hostingIp(bad), null, String(bad));
  }
  assert.deepEqual(hostingIps(["203.0.113.7", "::ffff:203.0.113.7", "nope", "::1"]), ["203.0.113.7", "::1"]);
  assert.equal(hostingIps("203.0.113.7"), undefined);

  assert.equal(allowsHosting("127.0.0.1", []), true, "this PC always hosts");
  assert.equal(allowsHosting("::ffff:127.0.0.1", []), true);
  assert.equal(allowsHosting("::1", []), true);
  assert.equal(allowsHosting("203.0.113.7", ["127.0.0.1", "::1"]), false, "by default nobody else");
  assert.equal(allowsHosting("::ffff:203.0.113.7", ["203.0.113.7"]), true);
  assert.equal(allowsHosting("2001:db8::1", ["2001:0db8::0001"]), true);
  assert.equal(allowsHosting("203.0.113.8", ["203.0.113.7"]), false);
  assert.equal(allowsHosting(undefined, ["203.0.113.7"]), false);
});

test("the settings keep only IP addresses in the Trusted Hosting IPs, saved or sent", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  try {
    assert.deepEqual(createSettingsStore(dataDir).get().allowedHostingIps, ["127.0.0.1", "::1"], "by default this PC only");
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ allowedHostingIps: ["203.0.113.7", "evil.example", 5, "203.0.113.7"] }));
    const settings = createSettingsStore(dataDir);
    assert.deepEqual(settings.get().allowedHostingIps, ["203.0.113.7"]);
    assert.deepEqual(settings.addHostingIp("not an ip").allowedHostingIps, ["203.0.113.7"]);
    assert.deepEqual(settings.addHostingIp("::ffff:198.51.100.4").allowedHostingIps, ["203.0.113.7", "198.51.100.4"]);
    assert.deepEqual(settings.removeHostingIp("203.0.113.7").allowedHostingIps, ["198.51.100.4"]);
    assert.deepEqual(settings.update({ allowedHostingIps: ["198.51.100.4", "x"] }).allowedHostingIps, ["198.51.100.4"]);
    assert.deepEqual(settings.update({ allowedHostingIps: "198.51.100.9" }).allowedHostingIps, ["198.51.100.4"], "not a list: unchanged");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a session from another PC is handed out at that PC's address, which its own updates can't change", () => {
  const store = createSessionStore();
  const remote = store.create({ ...euServer, serverAddress: "192.168.0.20" }, "::ffff:203.0.113.7", "CoreServer1", { remoteHost: true });
  assert.equal(remote.serverAddress, "203.0.113.7");
  store.update(remote.id, { serverAddress: 2130706433 });
  assert.equal(remote.serverAddress, "203.0.113.7");
  const viewer = (remoteAddress, localAddress = "127.0.0.1") => ({ socket: { remoteAddress, localAddress }, headers: {} });
  for (const at of ["127.0.0.1", "192.168.1.30", "198.51.100.9"]) assert.equal(sessionJson(remote, viewer(at)).serverAddress, "203.0.113.7", at);
  assert.equal("hostAddress" in sessionJson(remote, viewer("127.0.0.1")), false);

  // The same server account on this PC is another server: neither replaces the other's session.
  const local = store.create(euServer, "127.0.0.1", "CoreServer1");
  assert.deepEqual(store.list().map(({ id }) => id).sort(), [remote.id, local.id].sort());
  // Restarting on the other PC replaces only that PC's.
  const restarted = store.create(euServer, "203.0.113.7", "CoreServer1", { remoteHost: true });
  assert.deepEqual(store.list().map(({ id }) => id).sort(), [restarted.id, local.id].sort());

  const from = (remoteAddress) => ({ socket: { remoteAddress } });
  assert.equal(managesSession(restarted, from("203.0.113.7"), ["203.0.113.7"]), true);
  assert.equal(managesSession(restarted, from("203.0.113.7"), []), false, "no longer trusted");
  assert.equal(managesSession(restarted, from("198.51.100.4"), ["203.0.113.7", "198.51.100.4"]), false, "another trusted PC's");
  assert.equal(managesSession(local, from("203.0.113.7"), ["203.0.113.7"]), false, "this PC's session");
  assert.equal(managesSession(restarted, from("127.0.0.1"), []), true, "this PC manages any");
});

test("a whitelisted PC's gameserver logs in, registers its region's session and gets its matches; nobody else can (#125)", async () => {
  const backend = await startRemoteBackend();
  const { port, from } = backend;
  const hostPc = "203.0.113.7";
  const otherPc = "198.51.100.9";
  try {
    // Not whitelisted: no server login, no DedicatedServer token, no session, whatever its headers say.
    from.address = hostPc;
    const spoof = { "X-Forwarded-For": "127.0.0.1", "X-Real-IP": "127.0.0.1" };
    assert.equal((await login(port, "CoreServer1", spoof)).status, 403);
    assert.equal((await requestToken(port, { grant_type: "client_credentials" }, ...dedicatedServer)).status, 403);
    const player = await login(port, "RemotePlayer");
    assert.equal(player.status, 200, "players still log in from anywhere");
    assert.equal((await post(port, base, player.body.access_token, euServer)).status, 403);
    assert.equal((await get(port, "/core/api/sessions")).status, 403);

    // The admin panel (on this PC) lists the host PC's IP; it takes only IP addresses.
    from.address = "127.0.0.1";
    assert.equal((await post(port, "/admin/api/settings/hosting-ips", null, { ip: "my-friend.example" })).status, 400);
    assert.equal((await post(port, "/admin/api/settings", null, { allowedHostingIps: ["127.0.0.1", "10.0.0.0/8"] })).status, 400);
    const added = await post(port, "/admin/api/settings/hosting-ips", null, { ip: hostPc });
    assert.equal(added.status, 200);
    assert.ok(added.body.allowedHostingIps.includes(hostPc));

    // This PC's own gameserver, CoreServer1 too, in NA.
    const localServer = (await login(port, "CoreServer1")).body.access_token;
    const local = await post(port, base, localServer, { ...euServer, attributes: { ...euServer.attributes, REGION_s: "NA" } });
    assert.equal(local.status, 200);

    from.address = hostPc;
    const remoteLogin = await login(port, "CoreServer1");
    assert.equal(remoteLogin.status, 200);
    const remoteServer = remoteLogin.body.access_token;
    assert.equal((await requestToken(port, { grant_type: "client_credentials" }, ...dedicatedServer)).status, 200);
    const created = await post(port, base, remoteServer, euServer);
    assert.equal(created.status, 200);
    assert.equal(created.body.serverAddress, hostPc, "the PC's own address, not the 127.0.0.1 it wrote");
    const id = created.body.id;
    assert.equal((await request(port, "PUT", `${base}/${id}`, remoteServer, { serverAddress: "192.168.0.20" })).body.serverAddress, hostPc);
    assert.equal((await post(port, `${base}/${id}/heartbeat`, remoteServer, {})).status, 204);
    assert.equal((await get(port, `/fortnite/api/game/v2/matchmakingservice/ticket/session/${id}?bucketIds=595160781:0:EU:*&maxPlayers=4`, remoteServer)).status, 200);
    const listed = await get(port, "/core/api/sessions");
    assert.equal(listed.status, 200, "the host PC's launcher reads the sessions");
    assert.equal(listed.body.length, 2, "both PCs' CoreServer1 sessions stay");
    assert.equal(listed.body.find((session) => session.id === id).remoteHost, true);

    // A player anywhere looking for EU finds it at the host PC's address.
    from.address = otherPc;
    const found = await post(port, `${base}/matchMakingRequest`, player.body.access_token, euSearch);
    assert.deepEqual(found.body.map((session) => [session.id, session.serverAddress]), [[id, hostPc]]);
    // Another machine can't change it, take its matchmaking ticket or end it.
    assert.equal((await request(port, "PUT", `${base}/${id}`, player.body.access_token, { serverAddress: otherPc })).status, 403);
    assert.equal((await post(port, `${base}/${id}/heartbeat`, player.body.access_token, {})).status, 403);
    assert.equal((await post(port, `${base}/${id}/players`, player.body.access_token, { publicPlayers: ["x"] })).status, 403);
    assert.equal((await get(port, `/fortnite/api/game/v2/matchmakingservice/ticket/session/${id}?bucketIds=595160781:0:EU:*`, player.body.access_token)).status, 403);
    assert.equal((await request(port, "DELETE", `${base}/${id}`, player.body.access_token)).status, 403);
    // Nor can the host PC touch this PC's session.
    from.address = hostPc;
    assert.equal((await post(port, `${base}/${local.body.id}/heartbeat`, remoteServer, {})).status, 403);

    // Taken off the list, the PC hosts no more.
    from.address = "127.0.0.1";
    const removed = await request(port, "DELETE", `/admin/api/settings/hosting-ips/${encodeURIComponent(hostPc)}`);
    assert.equal(removed.body.allowedHostingIps.includes(hostPc), false);
    from.address = hostPc;
    assert.equal((await post(port, `${base}/${id}/heartbeat`, remoteServer, {})).status, 403);
    assert.equal((await post(port, base, remoteServer, euServer)).status, 403);
    assert.equal((await login(port, "CoreServer2")).status, 403);
  } finally {
    backend.close();
  }
});
