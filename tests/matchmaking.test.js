import { test } from "node:test";
import assert from "node:assert/strict";
import { clientToken, del, get, post, startBackend, userLogin } from "./helpers.js";

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

    const busy = await post(backend.port, `${base}/${created.body.id}`, server, { openPublicPlayers: 3, attributes: { ...emptyServer.attributes, GAMEMODE_s: "FORTPVE" } });
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
    assert.equal((await post(backend.port, `${base}/${session.id}/players`, server, { publicPlayers: [accountId] })).status, 204);
    const mine = await get(backend.port, `${base}/findPlayer/${accountId}`, token);
    assert.deepEqual(mine.body.map((found) => found.id), [session.id]);

    assert.equal((await del(backend.port, `${base}/${session.id}`, server)).status, 204);
    assert.equal((await get(backend.port, `${base}/${session.id}`, server)).status, 404);
  } finally {
    backend.close();
  }
});
