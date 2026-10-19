import { test } from "node:test";
import assert from "node:assert/strict";
import { readGameData } from "../src/gamedata/read.js";
import { worldInfo } from "../src/world/theaters.js";
import { get, startBackend, userLogin } from "./helpers.js";

const world = readGameData("world", {});

test("world info has a theater whose tiles and missions all point at assets in the paks", () => {
  const info = worldInfo(new Date("2026-10-19T12:00:00Z"));
  const [theater] = info.theaters;
  assert.equal(info.theaters.length, 1);
  assert.equal(theater.runtimeInfo.theaterType, "Standard");
  assert.equal(theater.tiles[0].tileType, "Outpost");

  for (const tile of theater.tiles) assert.ok(world.zoneThemes[tile.zoneTheme], tile.zoneTheme);
  const covered = theater.regions.flatMap((region) => region.tileIndices).sort((a, b) => a - b);
  assert.deepEqual(covered, theater.tiles.map((_, index) => index));
  const coordinates = new Set(theater.tiles.map((tile) => `${tile.xCoordinate},${tile.yCoordinate}`));
  assert.equal(coordinates.size, theater.tiles.length);

  const [missions] = info.missions;
  assert.equal(missions.theaterId, theater.uniqueId);
  assert.deepEqual(missions.availableMissions.map((mission) => mission.tileIndex).sort((a, b) => a - b), covered);
  for (const mission of missions.availableMissions) {
    assert.ok(world.missionGenerators[mission.missionGenerator], mission.missionGenerator);
    assert.ok(world.difficulties[mission.missionDifficultyInfo.rowName], mission.missionDifficultyInfo.rowName);
    assert.match(mission.missionGuid, /^[0-9A-F]{32}$/);
    assert.equal(mission.availableUntil, "2026-10-20T00:00:00.000Z");
  }
  assert.equal(info.missionAlerts[0].theaterId, theater.uniqueId);
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
    assert.equal(response.body.theaters[0].displayName, "Stonewood");
    assert.equal((await get(backend.port, "/fortnite/api/game/v2/world/info")).status, 401);
  } finally {
    backend.close();
  }
});
