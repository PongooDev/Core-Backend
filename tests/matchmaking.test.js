import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionStore, normalizeAddress, sessionJson } from "../src/matchmaking/sessions.js";
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

    const busy = await request(backend.port, "PUT", `${base}/${created.body.id}`, server, { openPublicPlayers: 3, attributes: { ...emptyServer.attributes, GAMEMODE_s: "FORTPVE" } });
    assert.equal(busy.body.openPublicPlayers, 3);
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

    for (const serverAddress of [undefined, "", "0.0.0.0"]) {
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

  const session = createSessionStore().create(certCreate, "::ffff:127.0.0.1");
  const viewer = (remoteAddress, localAddress) => ({ socket: { remoteAddress, localAddress } });
  assert.equal(sessionJson(session, viewer("::ffff:127.0.0.1", "::ffff:127.0.0.1")).serverAddress, "127.0.0.1");
  assert.equal(sessionJson(session, viewer("::ffff:192.168.1.30", "::ffff:192.168.1.10")).serverAddress, "192.168.1.10");
  assert.equal(session.serverAddress, "127.0.0.1", "the stored address stays the server's own");

  const remoteServer = createSessionStore().create(certCreate, "::ffff:192.168.1.40");
  assert.equal(sessionJson(remoteServer, viewer("::ffff:192.168.1.30", "::ffff:192.168.1.10")).serverAddress, "192.168.1.40");
});
