import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, get, post, request, requestToken, startBackend, userLogin } from "./helpers.js";

const base = "/fortnite/api/matchmaking/session";
const certCreate = {
  ownerId: "", ownerName: "CoreServer1", serverName: "CoreServer1", maxPublicPlayers: 4, maxPrivatePlayers: 0,
  shouldAdvertise: true, allowJoinInProgress: true, isDedicated: true, usesStats: false, allowInvites: false,
  usesPresence: false, allowJoinViaPresence: false, allowJoinViaPresenceFriendsOnly: false, buildUniqueId: "595160781",
  attributes: { GAMEMODE_s: "FORTEMPTY", REGION_s: "NA", MATCHMAKINGPOOL_s: "Any", BEACONPORT_i: 15000 },
  serverPort: 7777, openPrivatePlayers: 0, openPublicPlayers: 4, sortWeight: 0
};

// A Stonewood mission from today's world info, read with the zone server's DedicatedServer token.
async function zoneFor(backend, dedicated) {
  const info = await get(backend.port, "/fortnite/api/game/v2/world/info", dedicated);
  assert.equal(info.status, 200);
  const theater = info.body.missions.find((entry) => entry.availableMissions.length);
  const mission = theater.availableMissions.find((entry) => !/Outpost/.test(entry.missionGenerator));
  const tile = info.body.theaters.find((entry) => entry.uniqueId === theater.theaterId).tiles[mission.tileIndex];
  return { mission, zone: { worldId: "", theaterId: theater.theaterId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: "", zoneThemeClass: tile.zoneTheme } };
}

test("the zone server validates its zone with the Cert body and gets details with the worldId it posted", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const dedicated = await dedicatedServerToken(backend.port);
    const { mission, zone } = await zoneFor(backend, dedicated);

    // The empty server is reserved for this zone: it updates its session with ZONEINSTANCEID_s.
    const { body: session } = await post(backend.port, base, server.token, certCreate);
    await request(backend.port, "PUT", `${base}/${session.id}`, server.token,
      { ...certCreate, attributes: { ...certCreate.attributes, ZONEINSTANCEID_s: JSON.stringify(zone) } });

    const validate = (body) => post(backend.port, `/fortnite/api/game/v2/world/validate?sessionId=${session.id}`, dedicated, body);
    const validated = await validate(zone);
    assert.equal(validated.status, 200);
    assert.equal(validated.body.worldId, "", "an empty worldId makes the server a brand-new world record");
    assert.equal(validated.body.missionGenerator, mission.missionGenerator);
    assert.deepEqual(validated.body.zoneDifficultyInfo, mission.missionDifficultyInfo);
    assert.equal(validated.body.tileIndex, mission.tileIndex);
    assert.deepEqual([validated.body.theaterId, validated.body.theaterMissionId, validated.body.zoneThemeClass],
      [zone.theaterId, zone.theaterMissionId, zone.zoneThemeClass]);

    // A storm shield posts its core item's id, which the server loads the world record by.
    const coreId = "2D6E5BB04A1F4C33B1F8C1A0C7E9F2D4";
    assert.equal((await validate({ ...zone, worldId: coreId })).body.worldId, coreId);

    // An unknown mission in the body falls back to the session's own zone.
    const fallback = await validate({ ...zone, theaterMissionId: "00000000-0000-0000-0000-000000000000" });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.body.missionGenerator, mission.missionGenerator);

    const nothing = await post(backend.port, "/fortnite/api/game/v2/world/validate?sessionId=missing", dedicated,
      { ...zone, theaterMissionId: "00000000-0000-0000-0000-000000000000" });
    assert.equal(nothing.status, 404);
  } finally {
    backend.close();
  }
});

test("dedicated_server commands take only the DedicatedServer client's token, which needs its secret", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ZonePlayer");
    const dedicated = await dedicatedServerToken(backend.port);
    const route = `/fortnite/api/game/v2/profile/${player.accountId}/dedicated_server/QueryProfile?profileId=profile0&rvn=-1`;

    const asPlayer = await post(backend.port, route, player.token, {});
    assert.equal(asPlayer.status, 403);
    assert.equal(asPlayer.body.errorCode, "errors.com.epicgames.common.missing_permission");
    assert.equal((await post(backend.port, route, dedicated, {})).status, 200);

    const wrongSecret = await requestToken(backend.port, { grant_type: "client_credentials" }, "313dfed3ec3023e52d3be9dda178bdfa", "nope");
    assert.equal(wrongSecret.status, 401);
    // Game client tokens still work everywhere else.
    assert.equal((await get(backend.port, "/fortnite/api/game/v2/world/info", player.token)).status, 200);
  } finally {
    backend.close();
  }
});
