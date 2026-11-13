import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { landmarkMissions } from "../src/world/landmarks.js";
import { difficultyOf, missionMeets, missionObjectives, questPath } from "../src/world/quests.js";
import { worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #339: 5.10's Canny Valley Act 1 landmark quests had no mission on the map, so 6.02's quest log showed no
// Play for "Please Hold" (CannyValley_Landmark_Welcome) and the pinned quest's Find found nothing.
const now = new Date("2026-11-13T12:00:00Z");
// 5.10 (CL-4240749), 6.02.0 (CL-4442095, the reporter's, on 6.02's data), 6.02 (CL-4461277), 6.10 (CL-4480234) and 6.20 (CL-4497486).
const actOneBuilds = ["4240749", "4442095", "4461277", "4480234", "4497486"];
const zoneTag = (region) => (region.regionTags?.gameplayTags ?? []).map(({ tagName }) => /^Stat\.Theater\.PvE03\.Difficulty0(\d)$/.exec(tagName)?.[1]).find(Boolean);
const cannyValleyOf = (info) => {
  const index = info.theaters.findIndex((theater) => theater.runtimeInfo.theaterTags.gameplayTags.some(({ tagName }) => tagName === "Stat.Theater.PvE03"));
  return { theater: info.theaters[index], missions: info.missions[index].availableMissions, alerts: info.missionAlerts[index].availableMissionAlerts };
};

test("from 5.10 each Canny Valley landmark quest has its mission on a quest tile of its own, linked to it (#339)", () => {
  for (const build of actOneBuilds) {
    inBuild(build, () => {
      const world = buildGameData(dataBuild(build), "world", {});
      for (const day of [0, 1, 2]) {
        const { theater, missions, alerts } = cannyValleyOf(worldInfo(new Date(now.getTime() + day * 86400000)));
        for (const { questId, missionGenerator, zoneTheme } of landmarkMissions) {
          const where = `${build} ${questId} day ${day}`;
          const tiles = theater.tiles.map((tile, index) => [tile, index]).filter(([tile]) => tile.missionWeightOverrides.some((weight) => weight.missionGenerator === missionGenerator));
          assert.equal(tiles.length, 1, where);
          const [[tile, tileIndex]] = tiles;
          assert.equal(tile.tileType, "AlwaysActive", where);
          assert.equal(tile.zoneTheme, zoneTheme, where);
          assert.ok(world.zoneThemes[zoneTheme], where);
          assert.equal(tile.canBeMissionAlert, false, where);
          // Open while the quest is held; the client itself closes the tile once it's completed (sub_1326040).
          assert.equal(tile.requirements.activeQuestDefinition, questPath(questId), where);
          assert.deepEqual(tile.linkedQuests, [{ questDefinition: questPath(questId) }], where);
          // Today's mission there is the landmark, at a difficulty the quest's objective accepts, with no alert on it.
          const mission = missions.find((candidate) => candidate.tileIndex === tileIndex);
          assert.equal(mission?.missionGenerator, missionGenerator, where);
          const [objective] = missionObjectives(questId);
          assert.ok(missionMeets(objective, mission.missionGenerator, mission.missionDifficultyInfo.rowName), where);
          assert.ok(!alerts.some((alert) => alert.tileIndex === tileIndex), where);
          // In the lowest zone that accepts it: Welcome and Memorial in zone 1 (22), High Noon in zone 2 (24), each zone
          // gated by its Storm Shield Defense as the rest of it.
          const region = theater.regions.find((candidate) => candidate.tileIndices.includes(tileIndex));
          const zone = questId === "cannyvalley_landmark_highnoon" ? "2" : "1";
          assert.equal(zoneTag(region), zone, where);
          assert.equal(mission.missionDifficultyInfo.rowName, `Theater_Hard_Zone${zone}`, where);
          assert.equal(difficultyOf(mission.missionDifficultyInfo.rowName), objective.minimumDifficulty, where);
          assert.equal(region.requirements.questDefinition, `/Game/Quests/Outpost/OutpostQuest_T3_L${zone}.OutpostQuest_T3_L${zone}`, where);
        }
        // No other tile carries a quest gate, and the landmark tiles carry no other quest.
        const gated = theater.tiles.filter((tile) => tile.requirements.activeQuestDefinition);
        assert.equal(gated.length, landmarkMissions.length, build);
      }
    });
  }
});

test("builds before 5.10 keep Canny Valley as it was: no landmark mission and no quest tile (#339)", () => {
  const generators = new Set(landmarkMissions.map(({ missionGenerator }) => missionGenerator));
  const tilesOf = (build) => inBuild(build, () => cannyValleyOf(worldInfo(now)).theater.tiles);
  for (const build of ["3532353", "3700114", "4166199", "4214610"]) {
    const tiles = tilesOf(build);
    assert.ok(tiles.every((tile) => !tile.requirements.activeQuestDefinition), build);
    assert.ok(tiles.every((tile) => tile.missionWeightOverrides.every((weight) => !generators.has(weight.missionGenerator))), build);
  }
  // The tiles 5.10 takes were Normal tiles of their zones, and stay so before it.
  const before = tilesOf("4214610");
  const after = tilesOf("4240749");
  const changed = after.map((tile, index) => index).filter((index) => JSON.stringify(after[index]) !== JSON.stringify(before[index]));
  assert.equal(changed.length, landmarkMissions.length);
  for (const index of changed) assert.equal(before[index].tileType, "Normal");
});

test("a 6.02 client's world info has the landmark mission it plays Please Hold on (#339)", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Landmark602");
    const response = await send({ host: "127.0.0.1", port: backend.port, path: "/fortnite/api/game/v2/world/info",
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-6.02-CL-4442095", Authorization: `bearer ${token}` } });
    assert.equal(response.status, 200);
    const { theater, missions } = cannyValleyOf(response.body);
    const tileIndex = theater.tiles.findIndex((tile) => tile.linkedQuests.some(({ questDefinition }) => questDefinition.endsWith(".CannyValley_Landmark_Welcome")));
    assert.ok(tileIndex >= 0);
    assert.equal(theater.tiles[tileIndex].zoneTheme, "/Game/World/ZoneThemes/ZT_Route99/BP_ZT_Route99_Landmark.BP_ZT_Route99_Landmark_C");
    assert.equal(missions.find((mission) => mission.tileIndex === tileIndex)?.missionGenerator,
      "/Game/World/MissionGens/CannyValley/CV_Landmarks/MissionGen_HitTheRoad.MissionGen_HitTheRoad_C");
  } finally {
    backend.close();
  }
});
