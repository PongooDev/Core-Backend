import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionStore, normalizeAddress, sessionJson } from "../src/matchmaking/sessions.js";
import { defaultEmptyServerWaitMs } from "../src/services/matchmaking/sessions.js";
import http from "node:http";
import { certUserAgent, clientToken, del, get, openTunnel, post, request, send, startBackend, userLogin } from "./helpers.js";

const base = "/fortnite/api/matchmaking/session";

// What an idle gameserver registers, in OnlineSubsystemMcp's session JSON.
const emptyServer = {
  ownerId: "server", ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
  maxPublicPlayers: 4, maxPrivatePlayers: 0, openPublicPlayers: 4, openPrivatePlayers: 0,
  shouldAdvertise: true, allowJoinInProgress: true, isDedicated: true, usesStats: false, allowInvites: false,
  usesPresence: false, allowJoinViaPresence: false, allowJoinViaPresenceFriendsOnly: false, buildUniqueId: "595160781",
  attributes: { REGION_s: "NA", MATCHMAKINGPOOL_s: "Any", GAMEMODE_s: "FORTEMPTY", BEACONPORT_i: 15009 }
};

// The Cert client's request when a mission is started (from its own log).
const clientSearch = {
  criteria: [
    { type: "EQUAL", key: "REGION_s", value: "NA" },
    { type: "IN", key: "MATCHMAKINGPOOL_s", value: ["Desktop", "Any"] },
    { type: "EQUAL", key: "GAMEMODE_s", value: "FORTEMPTY" }
  ],
  requireDedicated: true, maxCurrentPlayers: 0, buildUniqueId: "595160781", maxResults: 30
};

test("a server registers an empty session and the client's mission search finds it", async () => {
  const backend = await startBackend();
  try {
    const server = await clientToken(backend.port);
    const { token } = await userLogin(backend.port, "CoreTest");

    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token, clientSearch)).body, []);

    const created = await post(backend.port, base, server, emptyServer);
    assert.equal(created.status, 200);
    assert.match(created.body.id, /^[0-9a-f]{32}$/);
    for (const key of Object.keys(emptyServer)) assert.ok(key in created.body, key);

    const found = await post(backend.port, `${base}/matchMakingRequest`, token, clientSearch);
    assert.deepEqual(found.body.map((session) => session.id), [created.body.id]);
    assert.equal(found.body[0].serverPort, 7777);
    assert.equal(found.body[0].buildUniqueId, "595160781");

    const otherBuild = await post(backend.port, `${base}/matchMakingRequest`, token, { ...clientSearch, buildUniqueId: "1" });
    assert.deepEqual(otherBuild.body, []);
    const otherMode = await post(backend.port, `${base}/matchMakingRequest`, token,
      { ...clientSearch, criteria: [{ type: "EQUAL", key: "GAMEMODE_s", value: "FORTPVE" }] });
    assert.deepEqual(otherMode.body, []);

    const busy = await request(backend.port, "PUT", `${base}/${created.body.id}`, server, { attributes: { ...emptyServer.attributes, GAMEMODE_s: "FORTPVE" } });
    assert.equal(busy.body.attributes.GAMEMODE_s, "FORTPVE");
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token, clientSearch)).body, []);
  } finally {
    backend.close();
  }
});

test("client and server get the same encryption key for a player, and sessions can be heartbeat and ended", async () => {
  const backend = await startBackend();
  try {
    const server = await clientToken(backend.port);
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const { body: session } = await post(backend.port, base, server, emptyServer);
    const keyPath = `/fortnite/api/game/v2/matchmaking/account/${accountId}/session/${session.id}`;

    const forClient = await get(backend.port, keyPath, token);
    assert.equal(forClient.status, 200);
    assert.deepEqual(Object.keys(forClient.body), ["accountId", "sessionId", "key"]);
    assert.equal(Buffer.from(forClient.body.key, "base64").length, 32);
    assert.equal((await get(backend.port, keyPath, server)).body.key, forClient.body.key);
    assert.equal((await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${accountId}/session/${"0".repeat(32)}`, token)).status, 404);

    assert.equal((await post(backend.port, `${base}/${session.id}/heartbeat`, server, {})).status, 204);
    assert.equal((await post(backend.port, `${base}/${session.id}/players`, server, { publicPlayers: [accountId] })).status, 200);
    const mine = await get(backend.port, `${base}/findPlayer/${accountId}`, token);
    assert.deepEqual(mine.body.map((found) => found.id), [session.id]);

    assert.equal((await del(backend.port, `${base}/${session.id}`, server)).status, 204);
    assert.equal((await get(backend.port, `${base}/${session.id}`, server)).status, 404);
  } finally {
    backend.close();
  }
});

// The Cert dedicated server's own create body (FOnlineSessionMcp writer sub_380C9D0): no serverAddress without
// -UseLocalIPs, buildUniqueId as a "%d" string, the beacon port it bound.
const certCreate = {
  ownerId: "bd9b28cf858c2beec756b27a82408566", ownerName: "CoreServer1", serverName: "CoreServer1",
  maxPublicPlayers: 4, maxPrivatePlayers: 0, shouldAdvertise: true, allowJoinInProgress: true, isDedicated: true,
  usesStats: false, allowInvites: false, usesPresence: false, allowJoinViaPresence: false,
  allowJoinViaPresenceFriendsOnly: false, buildUniqueId: "595160781",
  attributes: { GAMEMODE_s: "FORTEMPTY", REGION_s: "NA", MATCHMAKINGPOOL_s: "Any", BEACONPORT_i: 15000 },
  serverPort: 7777, openPrivatePlayers: 0, openPublicPlayers: 4, sortWeight: 0
};

test("the Cert server's create gets the address it connected from, kept when its updates echo none", async () => {
  const backend = await startBackend();
  try {
    const server = await clientToken(backend.port);
    const created = await post(backend.port, base, server, certCreate);
    assert.equal(created.status, 200);
    assert.equal(created.body.serverAddress, "127.0.0.1");
    assert.equal(created.body.serverPort, 7777);
    assert.equal(created.body.attributes.BEACONPORT_i, 15000);

    for (const serverAddress of [undefined, "", "0.0.0.0", "0"]) {
      const updated = await request(backend.port, "PUT", `${base}/${created.body.id}`, server, { ...certCreate, serverAddress });
      assert.equal(updated.body.serverAddress, "127.0.0.1");
    }
    const echoed = await request(backend.port, "PUT", `${base}/${created.body.id}`, server, { ...certCreate, serverAddress: "::ffff:192.168.1.20" });
    assert.equal(echoed.body.serverAddress, "192.168.1.20");

    // Through -httpproxy the request arrives inside a CONNECT tunnel; the peer's address is still known.
    const tunnel = await openTunnel(backend.port, "fortnite-public-service-prod11.ol.epicgames.com");
    const proxied = await send({
      createConnection: () => tunnel, method: "POST", path: base,
      headers: { Host: "fortnite-public-service-prod11.ol.epicgames.com", "User-Agent": certUserAgent, Authorization: `bearer ${server}`, "Content-Type": "application/json" }
    }, JSON.stringify(certCreate));
    assert.equal(proxied.status, 200);
    assert.equal(proxied.body.serverAddress, "127.0.0.1");
  } finally {
    backend.close();
  }
});

test("only the Cert build's verbs reach the session routes", async () => {
  const backend = await startBackend();
  try {
    const server = await clientToken(backend.port);
    const { body: session } = await post(backend.port, base, server, certCreate);
    assert.equal((await post(backend.port, `${base}/${session.id}`, server, certCreate)).status, 404, "updates are PUT");
    assert.equal((await get(backend.port, `${base}/${session.id}/heartbeat`, server)).status, 404, "heartbeats are POST");
    for (const action of ["heartbeat", "start", "stop", "join", "invite"]) {
      assert.equal((await post(backend.port, `${base}/${session.id}/${action}`, server)).status, 204, action);
    }
  } finally {
    backend.close();
  }
});

test("RegisterPlayers adds, UnregisterPlayers removes, and the count follows the lists", async () => {
  const backend = await startBackend();
  try {
    const server = await clientToken(backend.port);
    const { token } = await userLogin(backend.port, "CoreTest");
    const { body: session } = await post(backend.port, base, server, certCreate);
    const players = `${base}/${session.id}/players`;
    // The Cert server reads both replies as a JSON object; RegisterPlayers needs both lists and the open slots in it.
    const added = await post(backend.port, players, server, { publicPlayers: ["a", "b"], privatePlayers: [] });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body, { publicPlayers: ["a", "b"], privatePlayers: [], openPublicPlayers: 2, openPrivatePlayers: 0 });
    assert.deepEqual((await post(backend.port, players, server, { publicPlayers: ["a"], privatePlayers: ["c"] })).body,
      { publicPlayers: ["a", "b"], privatePlayers: ["c"], openPublicPlayers: 2, openPrivatePlayers: 0 });
    let current = (await get(backend.port, `${base}/${session.id}`, token)).body;
    assert.deepEqual([current.publicPlayers, current.privatePlayers], [["a", "b"], ["c"]]);
    assert.deepEqual([current.openPublicPlayers, current.openPrivatePlayers], [2, 0]);

    const emptySearch = { criteria: [{ type: "EQUAL", key: "GAMEMODE_s", value: "FORTEMPTY" }], maxCurrentPlayers: 0 };
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token, emptySearch)).body, []);
    const removed = await request(backend.port, "DELETE", players, server, ["a", "c"]);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { publicPlayers: ["b"], privatePlayers: [], openPublicPlayers: 3, openPrivatePlayers: 0 });
    current = (await get(backend.port, `${base}/${session.id}`, token)).body;
    assert.deepEqual([current.publicPlayers, current.privatePlayers], [["b"], []]);
    await request(backend.port, "DELETE", players, server, ["b"]);
    assert.equal((await post(backend.port, `${base}/matchMakingRequest`, token, emptySearch)).body.length, 1);
  } finally {
    backend.close();
  }
});

test("the open slots are each list's maximum less its players, whatever counts the server's create and updates send", async () => {
  const backend = await startBackend();
  try {
    const server = await clientToken(backend.port);
    const created = await post(backend.port, base, server, { ...certCreate, openPublicPlayers: 1, openPrivatePlayers: 3 });
    assert.deepEqual([created.body.openPublicPlayers, created.body.openPrivatePlayers], [4, 0]);
    const session = `${base}/${created.body.id}`;
    await post(backend.port, `${session}/players`, server, { publicPlayers: ["a"], privatePlayers: [] });

    const updated = await request(backend.port, "PUT", session, server, { ...certCreate, openPublicPlayers: 4, openPrivatePlayers: 0 });
    assert.deepEqual([updated.body.openPublicPlayers, updated.body.openPrivatePlayers], [3, 0]);
    const resized = await request(backend.port, "PUT", session, server, { ...certCreate, maxPublicPlayers: 2, maxPrivatePlayers: 1 });
    assert.deepEqual([resized.body.openPublicPlayers, resized.body.openPrivatePlayers], [1, 1]);
    const read = (await get(backend.port, session, server)).body;
    assert.deepEqual([read.openPublicPlayers, read.openPrivatePlayers], [1, 1]);
  } finally {
    backend.close();
  }
});

test("a restarted gameserver's new session replaces the one its exited process left, and live servers are matched first", async () => {
  const backend = await startBackend();
  try {
    const first = await userLogin(backend.port, "CoreServer1");
    const second = await userLogin(backend.port, "CoreServer2");
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const create = (server, serverPort, BEACONPORT_i) =>
      post(backend.port, base, server.token, { ...certCreate, serverPort, attributes: { ...certCreate.attributes, BEACONPORT_i } });

    // CoreServer1 takes a player into a zone and its process exits; CoreServer2's process exits while idle.
    const { body: crashed } = await create(first, 7777, 15000);
    await post(backend.port, `${base}/${crashed.id}/players`, first.token, { publicPlayers: [accountId], privatePlayers: [] });
    const { body: idleCrashed } = await create(second, 7778, 15001);
    await new Promise((resolve) => setTimeout(resolve, 5));

    // The launcher restarts both, on each other's ports.
    const { body: restartedSecond } = await create(second, 7777, 15000);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { body: restartedFirst } = await create(first, 7778, 15001);
    for (const gone of [crashed, idleCrashed]) assert.equal((await get(backend.port, `${base}/${gone.id}`, token)).status, 404);
    assert.deepEqual((await get(backend.port, `${base}/findPlayer/${accountId}`, token)).body, []);
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token, clientSearch)).body.map((session) => session.id),
      [restartedFirst.id, restartedSecond.id]);

    // Of two idle servers, the one heard from last comes first.
    assert.equal((await post(backend.port, `${base}/${restartedSecond.id}/heartbeat`, second.token)).status, 204);
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token, clientSearch)).body.map((session) => session.id),
      [restartedSecond.id, restartedFirst.id]);
  } finally {
    backend.close();
  }
});

test("the Cert server's update writes its address as the IPv4 number, which is kept as the dotted address", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const { body: session } = await post(backend.port, base, server.token, certCreate);
    const updated = await request(backend.port, "PUT", `${base}/${session.id}`, server.token,
      { ...certCreate, serverAddress: "2130706433", attributes: { ...certCreate.attributes, GAMEMODE_s: "FORTPVE" } });
    assert.equal(updated.body.serverAddress, "127.0.0.1");
    assert.equal((await request(backend.port, "PUT", `${base}/${session.id}`, server.token, { ...certCreate, serverAddress: 3232235796 })).body.serverAddress, "192.168.1.20");
  } finally {
    backend.close();
  }
});

test("the launcher lists sessions with their owner, players and game mode, from this machine only", async () => {
  const backend = await startBackend();
  try {
    const server = await clientToken(backend.port);
    const { body: session } = await post(backend.port, base, server, certCreate);
    await post(backend.port, `${base}/${session.id}/players`, server, { publicPlayers: ["a"], privatePlayers: [] });
    const listed = await get(backend.port, "/core/api/sessions");
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.map(({ id, ownerName, gameMode, region, beaconPort, currentPlayers, maxPlayers, serverAddress, serverPort }) =>
      ({ id, ownerName, gameMode, region, beaconPort, currentPlayers, maxPlayers, serverAddress, serverPort })),
    [{ id: session.id, ownerName: "CoreServer1", gameMode: "FORTEMPTY", region: "NA", beaconPort: 15000, currentPlayers: 1, maxPlayers: 4, serverAddress: "127.0.0.1", serverPort: 7777 }]);
  } finally {
    backend.close();
  }
});

test("addresses are what the client's session reader parses, and remote clients get one they can reach", () => {
  assert.equal(normalizeAddress("::ffff:10.0.0.5"), "10.0.0.5");
  assert.equal(normalizeAddress("::1"), "127.0.0.1");
  assert.equal(normalizeAddress("0:0:0:0:0:0:0:1"), "127.0.0.1");
  assert.equal(normalizeAddress("192.168.1.20"), "192.168.1.20");
  assert.equal(normalizeAddress("2130706433"), "127.0.0.1");
  assert.equal(normalizeAddress(167772165), "10.0.0.5");
  assert.equal(normalizeAddress("0"), "0.0.0.0", "an unknown address, which updates leave alone");

  const session = createSessionStore().create(certCreate, "::ffff:127.0.0.1");
  const viewer = (remoteAddress, localAddress) => ({ socket: { remoteAddress, localAddress } });
  assert.equal(sessionJson(session, viewer("::ffff:127.0.0.1", "::ffff:127.0.0.1")).serverAddress, "127.0.0.1");
  assert.equal(sessionJson(session, viewer("::ffff:192.168.1.30", "::ffff:192.168.1.10")).serverAddress, "192.168.1.10");
  assert.equal(session.serverAddress, "127.0.0.1", "the stored address stays the server's own");

  const remoteServer = createSessionStore().create(certCreate, "::ffff:192.168.1.40");
  assert.equal(sessionJson(remoteServer, viewer("::ffff:192.168.1.30", "::ffff:192.168.1.10")).serverAddress, "192.168.1.40");
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timed = async (promise) => {
  const started = Date.now();
  const result = await promise;
  return { ...result, ms: Date.now() - started };
};

// Core-Backend #11: the launcher reports a gameserver ready when its game port is bound, but the server only creates its
// session 35 to 70 s later (a stalled first tick, then login, hotfix check, beacon). A brand-new account's tutorial started matchmaking in that
// gap: every empty-server search came back empty, the client cancelled after four, and Retry (once CoreServer1 had
// registered) worked. Replayed here with the Cert gameserver's calls: create, update, heartbeat, key, join.
test("a new account's tutorial search made before any gameserver has registered is answered when the first one does", async () => {
  const backend = await startBackend({ emptyServerWaitMs: 5000 });
  try {
    const client = await userLogin(backend.port, "Norman");
    const servers = [await userLogin(backend.port, "CoreServer1"), await userLogin(backend.port, "CoreServer2")];

    const search = timed(post(backend.port, `${base}/matchMakingRequest`, client.token, clientSearch));
    await delay(300);
    const { body: first } = await post(backend.port, base, servers[0].token,
      { ...certCreate, ownerId: servers[0].accountId, ownerName: "CoreServer1", serverName: "CoreServer1" });
    const found = await search;
    assert.equal(found.status, 200);
    assert.deepEqual(found.body.map((session) => session.id), [first.id]);
    assert.ok(found.ms >= 250 && found.ms < 5000, `answered when the session registered (${found.ms} ms)`);
    assert.equal(found.body[0].serverAddress, "127.0.0.1");
    assert.equal(found.body[0].attributes.BEACONPORT_i, 15000);

    // What the server sends next: its update (address as the IPv4 number) and its 30 s heartbeat. Then the client's key
    // and join, as on Retry in the report.
    const sessionPath = `${base}/${first.id}`;
    assert.equal((await request(backend.port, "PUT", sessionPath, servers[0].token, { ...certCreate, serverAddress: "2130706433" })).status, 200);
    assert.equal((await post(backend.port, `${sessionPath}/heartbeat`, servers[0].token)).status, 204);
    const key = await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${client.accountId}/session/${first.id}`, client.token);
    assert.equal(key.status, 200);
    assert.equal((await post(backend.port, `${sessionPath}/join?accountId=${client.accountId}`, client.token)).status, 204);

    // CoreServer1 takes the player into the tutorial; the next search waits for CoreServer2, which is still starting.
    await post(backend.port, `${sessionPath}/players`, servers[0].token, { publicPlayers: [client.accountId], privatePlayers: [] });
    await request(backend.port, "PUT", sessionPath, servers[0].token, { ...certCreate, attributes: { ...certCreate.attributes, GAMEMODE_s: "FORTPVE" } });
    await post(backend.port, `${sessionPath}/start`, servers[0].token);
    const other = await userLogin(backend.port, "Podge");
    const next = timed(post(backend.port, `${base}/matchMakingRequest`, other.token, clientSearch));
    await delay(200);
    const { body: second } = await post(backend.port, base, servers[1].token,
      { ...certCreate, ownerId: servers[1].accountId, ownerName: "CoreServer2", serverName: "CoreServer2", serverPort: 7778,
        attributes: { ...certCreate.attributes, BEACONPORT_i: 15001 } });
    assert.deepEqual((await next).body.map((session) => session.id), [second.id]);
  } finally {
    backend.close();
  }
});

test("an empty-server search waits for a busy server to free up, and ends empty when none does", async () => {
  const backend = await startBackend({ emptyServerWaitMs: 600 });
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const { token, accountId } = await userLogin(backend.port, "CoreTest");

    const nothing = await timed(post(backend.port, `${base}/matchMakingRequest`, token, clientSearch));
    assert.deepEqual(nothing.body, []);
    assert.ok(nothing.ms >= 550, `waited for a server (${nothing.ms} ms)`);

    const { body: session } = await post(backend.port, base, server.token, certCreate);
    await post(backend.port, `${base}/${session.id}/players`, server.token, { publicPlayers: [accountId], privatePlayers: [] });
    const freed = timed(post(backend.port, `${base}/matchMakingRequest`, token, clientSearch));
    await delay(100);
    await request(backend.port, "DELETE", `${base}/${session.id}/players`, server.token, [accountId]);
    const found = await freed;
    assert.deepEqual(found.body.map((found) => found.id), [session.id]);
    assert.ok(found.ms < 550, `answered when the player left (${found.ms} ms)`);
  } finally {
    backend.close();
  }
});

test("only empty-server searches wait: a search for an existing session to join is answered at once", async () => {
  const backend = await startBackend({ emptyServerWaitMs: 5000 });
  try {
    const { token } = await userLogin(backend.port, "CoreTest");
    // NONEMPTYONLY sends minCurrentPlayers; the critical mission search looks for a session in that zone.
    const existing = { criteria: [{ type: "EQUAL", key: "GAMEMODE_s", value: "FORTPVE" }], requireDedicated: true, minCurrentPlayers: 1, buildUniqueId: "595160781" };
    const answered = await timed(post(backend.port, `${base}/matchMakingRequest`, token, existing));
    assert.deepEqual(answered.body, []);
    assert.ok(answered.ms < 1000, `${answered.ms} ms`);
  } finally {
    backend.close();
  }
});

test("a client that cancels while its search waits is dropped, and the backend waits 30 s by default", async () => {
  assert.equal(defaultEmptyServerWaitMs, 30_000);
  const backend = await startBackend({ emptyServerWaitMs: undefined });
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const { token } = await userLogin(backend.port, "CoreTest");

    const body = JSON.stringify(clientSearch);
    const cancelled = http.request({ host: "127.0.0.1", port: backend.port, method: "POST", path: `${base}/matchMakingRequest`,
      headers: { "User-Agent": certUserAgent, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } });
    cancelled.on("error", () => {});
    cancelled.end(body);
    await delay(200);
    cancelled.destroy();
    await delay(100);

    const search = timed(post(backend.port, `${base}/matchMakingRequest`, token, clientSearch));
    await delay(200);
    const { body: session } = await post(backend.port, base, server.token, certCreate);
    const found = await search;
    assert.deepEqual(found.body.map((found) => found.id), [session.id]);
    assert.ok(found.ms < 5000, `${found.ms} ms`);
  } finally {
    backend.close();
  }
});

// Core-Backend #27: the map's critical mission tile ("?", "Play with others") looks for a running zone to join with
// FindCriticalMission (sub_646BB0). Its query settings, written by sub_380C0E0 / sub_380B260: the search base
// (sub_674C50, sub_674AE0) REGION_s EQUAL, MATCHMAKINGPOOL_s IN, MINSLOTSAVAILABLE 1 (openPlayersRequired), PLAYLISTID_i
// EQUAL; then MMLVL_i DISTANCE, NEEDS_i GREATER_THAN_OR_EQUAL, NEEDSSORT_i DISTANCE INT32_MIN, MAXDIFFICULTY_i
// LESS_THAN_OR_EQUAL, MINDIFFICULTY_i GREATER_THAN_OR_EQUAL, CRITICALMISSION_b EQUAL true and THEATERID_s EQUAL.
// DISTANCE (EOnlineComparisonOp::Near) only orders the results; Core matched nothing for it, so every such search came
// back empty and the client went round FindCriticalMission / OnNoExistingCriticalMissionsFound / StartCriticalMission
// for good while no empty server was free (all of them busy, one with the zone it was meant to join).
const stonewood = "33A2311D4AE64B361CCE27BC9F313C8B";
const criticalSearch = (overrides = {}) => ({
  criteria: [
    { type: "EQUAL", key: "REGION_s", value: "NA" },
    { type: "IN", key: "MATCHMAKINGPOOL_s", value: ["Desktop", "Any"] },
    { type: "EQUAL", key: "PLAYLISTID_i", value: 2 },
    { type: "DISTANCE", key: "MMLVL_i", value: 5 },
    { type: "GREATER_THAN_OR_EQUAL", key: "NEEDS_i", value: 1 },
    { type: "DISTANCE", key: "NEEDSSORT_i", value: -2147483648 },
    { type: "LESS_THAN_OR_EQUAL", key: "MAXDIFFICULTY_i", value: 900 },
    { type: "GREATER_THAN_OR_EQUAL", key: "MINDIFFICULTY_i", value: 100 },
    { type: "EQUAL", key: "CRITICALMISSION_b", value: true },
    { type: "EQUAL", key: "THEATERID_s", value: stonewood }
  ],
  openPlayersRequired: 1, buildUniqueId: "595160781", maxResults: 50, ...overrides
});

// What a gameserver's session says once its zone is running: AFortGameModeZone::UpdateSessionForMatchmaking
// (sub_53FB70) sets CRITICALMISSION_b (the zone game mode's +0x7B0, true from its constructor sub_50C560) and
// MIN/MAXDIFFICULTY_i (sub_53AA50), sub_63A050 PLAYLISTID_i, ZONEINSTANCEID_s and THEATERID_s, and the lobby beacon
// host NEEDS_i and NEEDSSORT_i ("Setting GameSession player need size to %d", sub_667CE0).
const runningZone = (attributes = {}) => ({
  ...certCreate,
  attributes: {
    ...certCreate.attributes, GAMEMODE_s: "FORTPVE", PLAYLISTID_i: 2, ZONEINSTANCEID_s: "{zone}", THEATERID_s: stonewood,
    CRITICALMISSION_b: true, MINDIFFICULTY_i: 300, MAXDIFFICULTY_i: 500, NEEDS_i: 3, NEEDSSORT_i: 3, MMLVL_i: 5, ...attributes
  }
});

test("the critical mission tile's search finds a friend's running zone, and DISTANCE orders the results", async () => {
  const backend = await startBackend({ emptyServerWaitMs: 5000 });
  try {
    const friendServer = await userLogin(backend.port, "CoreServer1");
    const otherServer = await userLogin(backend.port, "CoreServer2");
    const idleServer = await userLogin(backend.port, "CoreServer3");
    const friend = await userLogin(backend.port, "Friend");
    const { token, accountId } = await userLogin(backend.port, "MrPodge6");

    // The friend's zone: created idle, then updated, given its player and started, as the Cert server does.
    const { body: zone } = await post(backend.port, base, friendServer.token, certCreate);
    await request(backend.port, "PUT", `${base}/${zone.id}`, friendServer.token, runningZone());
    await post(backend.port, `${base}/${zone.id}/players`, friendServer.token, { publicPlayers: [friend.accountId], privatePlayers: [] });
    assert.equal((await post(backend.port, `${base}/${zone.id}/start`, friendServer.token)).status, 204);
    await post(backend.port, base, idleServer.token, { ...certCreate, serverPort: 7779 });

    const found = await timed(post(backend.port, `${base}/matchMakingRequest`, token, criticalSearch()));
    assert.equal(found.status, 200);
    assert.deepEqual(found.body.map((session) => session.id), [zone.id]);
    assert.ok(found.ms < 1000, `answered at once (${found.ms} ms)`);
    assert.equal(found.body[0].attributes.BEACONPORT_i, 15000);
    assert.equal(found.body[0].openPublicPlayers, 3);

    // The key and join the client sends after the reservation beacon takes it, for the started session.
    const key = await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${accountId}/session/${zone.id}`, token);
    assert.equal(key.status, 200);
    assert.equal((await post(backend.port, `${base}/${zone.id}/join?accountId=${accountId}`, token)).status, 204);

    // Another theater, a harder zone, one that isn't open to the tile and a full one are left out.
    for (const [attributes, why] of [
      [{ THEATERID_s: "D477605B4FA48648107B649CE97FCF27" }, "another theater"],
      [{ MAXDIFFICULTY_i: 1200 }, "too hard"],
      [{ CRITICALMISSION_b: false }, "not open to the critical mission tile"]
    ]) {
      await request(backend.port, "PUT", `${base}/${zone.id}`, friendServer.token, runningZone(attributes));
      assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token, criticalSearch())).body, [], why);
    }
    await request(backend.port, "PUT", `${base}/${zone.id}`, friendServer.token, runningZone());
    await post(backend.port, `${base}/${zone.id}/players`, friendServer.token, { publicPlayers: ["b", "c", "d"], privatePlayers: [] });
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token, criticalSearch())).body, [], "full");
    await request(backend.port, "DELETE", `${base}/${zone.id}/players`, friendServer.token, ["b", "c", "d"]);

    // Two zones to join: the one nearest the searcher's MMLVL_i first, then the one needing the fewest players.
    const { body: other } = await post(backend.port, base, otherServer.token, { ...runningZone({ NEEDS_i: 1, NEEDSSORT_i: 1 }), serverPort: 7778 });
    const order = async () => (await post(backend.port, `${base}/matchMakingRequest`, token, criticalSearch())).body.map((session) => session.id);
    assert.deepEqual(await order(), [other.id, zone.id], "fewest needed first");
    await request(backend.port, "PUT", `${base}/${other.id}`, otherServer.token, { ...runningZone({ NEEDS_i: 1, NEEDSSORT_i: 1, MMLVL_i: 9 }), serverPort: 7778 });
    assert.deepEqual(await order(), [zone.id, other.id], "nearest level first");
    await request(backend.port, "PUT", `${base}/${zone.id}`, friendServer.token, runningZone({ MMLVL_i: undefined }));
    assert.deepEqual(await order(), [other.id, zone.id], "a session without the attribute comes last");

    // A criterion type Core doesn't know still matches nothing.
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token,
      criticalSearch({ criteria: [{ type: "SOMETHING_NEW", key: "THEATERID_s", value: stonewood }] }))).body, []);
  } finally {
    backend.close();
  }
});

test("the join-in-progress search finds a running zone of the same mission", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const { token } = await userLogin(backend.port, "CoreTest");
    const { body: zone } = await post(backend.port, base, server.token, runningZone());
    await post(backend.port, `${base}/${zone.id}/players`, server.token, { publicPlayers: ["friend"], privatePlayers: [] });
    await post(backend.port, `${base}/${zone.id}/start`, server.token);

    // FindJIPSession (sub_6477A0): the search base with the zone instance, NEEDS_i and NEEDSSORT_i.
    const jip = (zoneInstance) => ({
      criteria: [
        { type: "EQUAL", key: "REGION_s", value: "NA" },
        { type: "IN", key: "MATCHMAKINGPOOL_s", value: ["Desktop", "Any"] },
        { type: "EQUAL", key: "PLAYLISTID_i", value: 2 },
        { type: "EQUAL", key: "ZONEINSTANCEID_s", value: zoneInstance },
        { type: "GREATER_THAN_OR_EQUAL", key: "NEEDS_i", value: 1 },
        { type: "DISTANCE", key: "NEEDSSORT_i", value: -2147483648 }
      ],
      openPlayersRequired: 1, buildUniqueId: "595160781"
    });
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token, jip("{zone}"))).body.map((session) => session.id), [zone.id]);
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, token, jip("{other}"))).body, []);
  } finally {
    backend.close();
  }
});

// CoreV2 #42: the storm shield screen's "Send request for help for the next defense" (OutpostScreenStormShieldContent)
// sets BP_PlayerControllerOutpost.GetHelp, and Expand Shield sends ServerStartExpandingOutpost(GetHelp). With GetHelp,
// Mission_Outpost calls UFortOutpostFunctionLibrary::SetCriticalMissionJoinability(true) (sub_6E5410 → sub_539260),
// shows "Searching for Help!" for 90 s, then starts the defense and turns it off again 180 s later (TurnOffJoinability).
// sub_539260 writes CRITICALMISSION_b into the session settings and updates the session (PUT). The storm shield's game
// mode starts with it false (AFortGameModeOutpost ctor sub_50C470: +0x7B0 = 0, GAMEMODE FORTOUTPOST), and
// UpdateSessionForMatchmaking (sub_53FB70) publishes that, so an ordinary storm shield never matches the critical mission
// tile's search. All of this is native and intact in the Cert server: the backend only has to match the attributes.
// The session as the Cert server publishes it for a Stonewood storm shield at its second defense
// (Theater_Start_Outpost2: Difficulty 2, matchmaking range 1-2 → MIN/MAXDIFFICULTY_i 100/200, sub_53AA50). The
// reservation's playlist is -1 (every "empty server reservation request" in the Cert logs), so neither side sends
// PLAYLISTID_i (the search base, sub_674AE0, leaves it out for -1; 🟡 that the tile's search has -1 too is inferred).
const outpostZone = (attributes = {}) => ({
  ...certCreate,
  attributes: {
    ...certCreate.attributes, GAMEMODE_s: "FORTOUTPOST", MATCHMAKINGPOOL_s: "Desktop", THEATERID_s: stonewood,
    ZONEINSTANCEID_s: `{"worldId":"","theaterId":"${stonewood}","theaterMissionId":"e027105a-8a0f-fc0e-d7ea-6920ecdedcbd","theaterMissionAlertId":"","zoneThemeClass":"/Game/World/ZoneThemes/Outposts/BP_ZT_TheOutpost_PvE_01.BP_ZT_TheOutpost_PvE_01_C"}`,
    WUID_s: "5c6eb5b4-57ea-4e91-89aa-8ded5db40785", GATHERABLE_b: true, CRITICALMISSION_b: false,
    MINDIFFICULTY_i: 100, MAXDIFFICULTY_i: 200, NEEDS_i: 3, NEEDSSORT_i: 3, ...attributes
  }
});

// FindCriticalMission from the map's "?" tile (MissionStartQueue: StartCriticalMission(0, the hardest available
// difficulty's matchmaking maximum), or the chosen difficulty's range).
const helperSearch = ({ min = 0, max = 1100 } = {}) => {
  const search = criticalSearch();
  return {
    ...search,
    criteria: search.criteria
      .filter(({ key }) => key !== "PLAYLISTID_i")
      .map((criterion) => criterion.key === "MAXDIFFICULTY_i" ? { ...criterion, value: max }
        : criterion.key === "MINDIFFICULTY_i" ? { ...criterion, value: min } : criterion)
  };
};

test("a storm shield is found by the critical mission tile only while its owner has asked for help", async () => {
  const backend = await startBackend();
  try {
    const shieldServer = await userLogin(backend.port, "CoreServer1");
    const owner = await userLogin(backend.port, "MrPodge6");
    const helper = await userLogin(backend.port, "Helper");

    // The owner's storm shield: created idle, given its zone, its owner registered, started.
    const { body: shield } = await post(backend.port, base, shieldServer.token, certCreate);
    await request(backend.port, "PUT", `${base}/${shield.id}`, shieldServer.token, outpostZone());
    await post(backend.port, `${base}/${shield.id}/players`, shieldServer.token, { publicPlayers: [owner.accountId], privatePlayers: [] });
    assert.equal((await post(backend.port, `${base}/${shield.id}/start`, shieldServer.token)).status, 204);
    const find = async (search = helperSearch()) =>
      (await post(backend.port, `${base}/matchMakingRequest`, helper.token, search)).body.map((session) => session.id);

    // Without a help request it stays to its owner and party: the "?" tile doesn't find it, and nor do the gather and
    // join-in-progress searches, which name the mission they are for (ZONEINSTANCEID_s).
    assert.deepEqual(await find(), [], "no help asked for");
    const otherMission = '{"worldId":"","theaterId":"' + stonewood + '","theaterMissionId":"0f9e3a1c-0000-0000-0000-000000000000"}';
    const regionAndPool = criticalSearch().criteria.slice(0, 2);
    assert.deepEqual(await find({ criteria: [...regionAndPool, { type: "EQUAL", key: "ZONEINSTANCEID_s", value: otherMission },
      { type: "DISTANCE", key: "MMLVL_i", value: 5 }, { type: "GREATER_THAN_OR_EQUAL", key: "NEEDS_i", value: 1 },
      { type: "DISTANCE", key: "NEEDSSORT_i", value: -2147483648 }, { type: "EQUAL", key: "GATHERABLE_b", value: true }],
    openPlayersRequired: 1, buildUniqueId: "595160781" }), [], "a gather search for another mission");

    // Expand Shield with the box ticked: SetCriticalMissionJoinability(true) → PUT with CRITICALMISSION_b true.
    await request(backend.port, "PUT", `${base}/${shield.id}`, shieldServer.token, outpostZone({ CRITICALMISSION_b: true }));
    const found = (await post(backend.port, `${base}/matchMakingRequest`, helper.token, helperSearch())).body;
    assert.deepEqual(found.map((session) => session.id), [shield.id], "help asked for");
    assert.equal(found[0].attributes.GAMEMODE_s, "FORTOUTPOST");
    assert.equal(found[0].openPublicPlayers, 3);
    assert.ok(found[0].shouldAdvertise && found[0].allowJoinInProgress, "the client keeps it (sub_37CF5E0)");

    // Its range (1-2) must lie inside the helper's: a helper who chose a harder difficulty (Theater_Start_Zone3, 5-6)
    // or whose hardest is below the shield's misses it.
    assert.deepEqual(await find(helperSearch({ min: 500, max: 600 })), [], "harder than the shield");
    assert.deepEqual(await find(helperSearch({ min: 100, max: 200 })), [shield.id], "the shield's own range");
    assert.deepEqual(await find(helperSearch({ min: 0, max: 100 })), [], "easier than the shield");

    // The helper joins as from any critical mission: the connection key, then the server registers it.
    const key = await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${helper.accountId}/session/${shield.id}`, helper.token);
    assert.equal(key.status, 200);
    assert.equal((await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${helper.accountId}/session/${shield.id}`, shieldServer.token)).body.key, key.body.key);
    await post(backend.port, `${base}/${shield.id}/players`, shieldServer.token, { publicPlayers: [helper.accountId], privatePlayers: [] });

    // Another random player still finds it while there is room and help is still asked for.
    const second = await userLogin(backend.port, "Helper2");
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, second.token, helperSearch())).body.map((session) => session.id), [shield.id]);

    // TurnOffJoinability (180 s into the defense): SetCriticalMissionJoinability(false) → CRITICALMISSION_b false.
    await request(backend.port, "PUT", `${base}/${shield.id}`, shieldServer.token, outpostZone({ CRITICALMISSION_b: false }));
    assert.deepEqual((await post(backend.port, `${base}/matchMakingRequest`, second.token, helperSearch())).body, [], "help window over");
  } finally {
    backend.close();
  }
});
