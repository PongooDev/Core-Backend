import { test } from "node:test";
import assert from "node:assert/strict";
import { readGameData } from "../src/gamedata/read.js";
import { worldInfo } from "../src/world/theaters.js";
import { clientToken, get, post, startBackend, userLogin } from "./helpers.js";

const world = readGameData("world", {});
const info = worldInfo(new Date("2026-10-19T12:00:00Z"));

test("world info serves Epic's theaters, and everything they name exists in this build", () => {
  assert.deepEqual(info.theaters.map((theater) => [theater.displayName.en, theater.runtimeInfo.theaterType, theater.runtimeInfo.socket]), [
    ["Stonewood", "Standard", "PvE_01"], ["Plankerton", "Standard", "PvE_02"], ["Canny Valley", "Standard", "PvE_03"],
    ["Twine Peaks", "Standard", "PvE_04"], ["Stonewood", "Tutorial", "Onboarding_Gate"]
  ]);
  for (const theater of info.theaters) {
    assert.ok(world.mapPins.includes(theater.runtimeInfo.worldMapPinClass), theater.uniqueId);
    for (const tile of theater.tiles) assert.ok(world.zoneThemes[tile.zoneTheme], tile.zoneTheme);
    const covered = theater.regions.flatMap((region) => region.tileIndices).sort((a, b) => a - b);
    assert.deepEqual(covered, theater.tiles.map((_, index) => index));
  }
});

test("missions sit on every AlwaysActive tile, on each region's share of Normal tiles and on the storm shield", () => {
  // The same counts as Epic's world info the theaters come from.
  assert.deepEqual(info.missions.map((theater) => theater.availableMissions.length), [25, 57, 45, 42, 1]);
  const [stonewood] = info.theaters;
  const { availableMissions } = info.missions[0];
  assert.equal(info.missions[0].theaterId, stonewood.uniqueId);
  const types = new Set(availableMissions.map((mission) => stonewood.tiles[mission.tileIndex].tileType));
  assert.deepEqual([...types].sort(), ["AlwaysActive", "Outpost"]);
  assert.equal(new Set(availableMissions.map((mission) => mission.tileIndex)).size, availableMissions.length);

  const outpost = availableMissions.find((mission) => stonewood.tiles[mission.tileIndex].tileType === "Outpost");
  assert.match(outpost.missionGenerator, /MissionGen_TheOutpost_PvE_01/);
  for (const mission of availableMissions) {
    assert.ok(world.missionGenerators[mission.missionGenerator], mission.missionGenerator);
    assert.ok(world.difficulties[mission.missionDifficultyInfo.rowName], mission.missionDifficultyInfo.rowName);
    assert.match(mission.missionGuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(mission.availableUntil, "2026-10-19T23:59:59.999Z");
  }
});

test("missions stay the same all UTC day and change the next", () => {
  const ids = (date) => worldInfo(new Date(date)).missions[0].availableMissions.map((mission) => mission.missionGuid);
  assert.deepEqual(ids("2026-10-19T00:00:01Z"), ids("2026-10-19T23:59:59Z"));
  assert.notDeepEqual(ids("2026-10-19T12:00:00Z"), ids("2026-10-20T12:00:00Z"));
});

test("GET world/info serves it to a logged in client", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "CoreTest");
    const response = await get(backend.port, "/fortnite/api/game/v2/world/info", token);
    assert.equal(response.status, 200);
    assert.equal(response.body.theaters[0].displayName.en, "Stonewood");
    assert.equal((await get(backend.port, "/fortnite/api/game/v2/world/info")).status, 401);
  } finally {
    backend.close();
  }
});

test("world/validate gives the gameserver the zone it posts, as FFortZoneInstanceDetails", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const info = await get(backend.port, "/fortnite/api/game/v2/world/info", token);
    const theater = info.body.missions.find((entry) => entry.availableMissions.length);
    const mission = theater.availableMissions[0];
    const zone = { worldId: "", theaterId: theater.theaterId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: "", zoneThemeClass: "" };
    const details = await post(backend.port, "/fortnite/api/game/v2/world/validate?sessionId=abc", token, zone);
    assert.equal(details.status, 200);
    assert.deepEqual(details.body, {
      worldId: "",
      theaterId: zone.theaterId,
      theaterMissionId: zone.theaterMissionId,
      theaterMissionAlertId: "",
      zoneThemeClass: "",
      missionGenerator: mission.missionGenerator,
      zoneDifficultyInfo: mission.missionDifficultyInfo,
      missionRewards: mission.missionRewards,
      zoneModifiers: { tierGroupName: "", items: [] },
      tileIndex: mission.tileIndex
    });
    const unknown = await post(backend.port, "/fortnite/api/game/v2/world/validate?sessionId=abc", token, { ...zone, theaterMissionId: "nope" });
    assert.equal(unknown.status, 404);
  } finally {
    backend.close();
  }
});
