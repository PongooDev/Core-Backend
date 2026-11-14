import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { inBuild } from "../src/builds/context.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { act1ZoneThemes, act2ZoneThemes, cannyValleyId, hasAct2Zones } from "../src/world/cannyvalley.js";
import { landmarkMissions } from "../src/world/landmarks.js";
import { difficultyOf, missionMeets, missionObjectives, questPath } from "../src/world/quests.js";
import { worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

// 6.31 (CL-4573279) grants Canny Valley Act 2 as quests (Core-Backend 830f4e5), most of them "in a [UIRating]+ Ghost Town
// zone", with Stabilize the Rift as its landmark; Core's world map had only Act 1 (world/cannyvalley.js).
const now = new Date("2026-11-14T12:00:00Z");
const day = 86400000;
const actTwoBuild = "4573279";
// 5.10, 6.02, 6.20, 6.21, 6.22 (CL-4543176) and 6.30 (CL-4573096), and builds before the rework.
const olderBuilds = ["3700114", "4214610", "4240749", "4461277", "4497486", "4526925", "4543176", "4573096"];
const rift = landmarkMissions.find(({ questId }) => questId === "cannyvalley_landmark_rift");
const ghostTown = /\/ZT_GhostTown\/BP_ZT_GhostTown_[AB]\./;
const dump = JSON.parse(fs.readFileSync(new URL("../gamedata/theaters.json", import.meta.url), "utf8"));
const dumpTiles = dump.theaters.find(({ data }) => data.uniqueId === cannyValleyId).data.tiles;
const zoneOf = (region) => Number((region.regionTags?.gameplayTags ?? []).map(({ tagName }) => /^Stat\.Theater\.PvE03\.Difficulty0(\d)$/.exec(tagName)?.[1]).find(Boolean) ?? 0);
const cannyValleyOf = (info) => {
  const index = info.theaters.findIndex((theater) => theater.uniqueId === cannyValleyId);
  return { theater: info.theaters[index], missions: info.missions[index].availableMissions, alerts: info.missionAlerts[index].availableMissionAlerts };
};
// The least Zone.Difficulty a quest's objectives ask for (ObjectiveStatTable conditions), from the build's data.
function minimumDifficulty(questId) {
  const quests = buildGameData(dataBuild(actTwoBuild), "quests", {});
  const stats = buildGameData(dataBuild(actTwoBuild), "objectivestats", {});
  return Math.max(...quests[questId].objectives.map(({ stat, name }) => Number(/Zone\.Difficulty\s*>=\s*(\d+)/.exec(stats[stat ?? name]?.condition ?? "")?.[1] ?? 0)));
}

test("6.31 is the first build with Canny Valley Act 2's Ghost Town zones and Stabilize the Rift", () => {
  for (const build of [actTwoBuild, ...olderBuilds]) {
    const world = buildGameData(dataBuild(build), "world", {});
    const quests = buildGameData(dataBuild(build), "quests", {});
    const act = build === actTwoBuild;
    assert.equal(hasAct2Zones(world), act, build);
    assert.equal(Boolean(world.missionGenerators[rift.missionGenerator] && world.zoneThemes[rift.zoneTheme]), act, build);
    // 6.30's data already has the act's quests (not its zones or landmark); 6.22 and earlier only the pamphlets.
    assert.equal(Boolean(quests.cannyvalley_landmark_rift && quests.cannyvalley_reactive_truther), act || build === "4573096", build);
  }
});

test("6.31's Canny Valley zones 3 and 4 are Act 2's Ghost Town, opened by Storm Shield Defense 3 and 4", () => {
  const world = buildGameData(dataBuild(actTwoBuild), "world", {});
  const quests = buildGameData(dataBuild(actTwoBuild), "quests", {});
  // The act starts at Storm Shield Defense 3 (CannyValleyQuest_Outpost_L3, done with OutpostQuest_T3_L3, grants the
  // Truther) at 26 and its second half at Defense 4 (Outpost_L4 grants the stores) at 28.
  assert.ok(quests.cannyvalleyquest_outpost_l3.hiddenRewards.some(({ templateId }) => templateId === "Quest:cannyvalley_reactive_truther"));
  assert.ok(quests.cannyvalleyquest_outpost_l4.hiddenRewards.some(({ templateId }) => templateId === "Quest:cannyvalley_reactive_stores"));
  const zoneQuests = { 3: ["cannyvalley_reactive_truther", "cannyvalley_reactive_pueblos", "cannyvalley_reactive_coaches", "cannyvalley_reactive_forts", "cannyvalley_mechanical_exploration"],
    4: ["cannyvalley_reactive_stores", "cannyvalley_reactive_dredgers", "cannyvalley_reactive_cards", "cannyvalley_reactive_musichalls", "cannyvalley_reactive_trainstations"] };
  for (const offset of [0, 1, 2]) {
    const where = `day ${offset}`;
    const { theater, missions } = inBuild(actTwoBuild, () => cannyValleyOf(worldInfo(new Date(now.getTime() + offset * day))));
    for (const zone of [3, 4]) {
      const region = theater.regions.find((candidate) => zoneOf(candidate) === zone);
      const [row] = region.missionData.difficultyWeights;
      assert.equal(row.difficultyInfo.rowName, `Theater_Hard_Zone${zone}`, where);
      // The client shows the zone once its Storm Shield Defense quest is held (IsRequirementsMet).
      assert.equal(region.requirements.questDefinition, `/Game/Quests/Outpost/OutpostQuest_T3_L${zone}.OutpostQuest_T3_L${zone}`, where);
      for (const questId of zoneQuests[zone]) assert.equal(minimumDifficulty(questId), difficultyOf(row.difficultyInfo.rowName), `${where} ${questId}`);
      for (const index of region.tileIndices) {
        const { zoneTheme } = theater.tiles[index];
        assert.ok(act2ZoneThemes.includes(zoneTheme) || act1ZoneThemes.includes(zoneTheme) || zoneTheme === rift.zoneTheme, `${where} zone ${zone} tile ${index} ${zoneTheme}`);
        assert.ok(world.zoneThemes[zoneTheme], `${where} tile ${index}`);
      }
      const themes = new Set(region.tileIndices.map((index) => theater.tiles[index].zoneTheme));
      for (const path of act2ZoneThemes) assert.ok(themes.has(path), `${where} zone ${zone} ${path}`);
      // Every day there is a Ghost Town mission the zone's Ghost Town quests count, on an AlwaysActive tile.
      assert.ok(missions.some((mission) => region.tileIndices.includes(mission.tileIndex) && theater.tiles[mission.tileIndex].tileType === "AlwaysActive"
        && ghostTown.test(theater.tiles[mission.tileIndex].zoneTheme) && difficultyOf(mission.missionDifficultyInfo.rowName) >= minimumDifficulty(zoneQuests[zone][1])), `${where} zone ${zone}`);
    }
    // Zone 5 (Act 3) keeps Epic's 2017 tiles.
    for (const index of theater.regions.find((candidate) => zoneOf(candidate) === 5).tileIndices) {
      assert.equal(theater.tiles[index].zoneTheme, dumpTiles[index].zoneTheme, `${where} zone 5 tile ${index}`);
    }
  }
});

test("6.31's Stabilize the Rift is a landmark mission on a quest tile of zone 4, linked to CannyValley_Landmark_Rift", () => {
  inBuild(actTwoBuild, () => {
    for (const offset of [0, 1, 2]) {
      const where = `day ${offset}`;
      const { theater, missions, alerts } = cannyValleyOf(worldInfo(new Date(now.getTime() + offset * day)));
      const tiles = theater.tiles.map((tile, index) => [tile, index]).filter(([tile]) => tile.missionWeightOverrides.some(({ missionGenerator }) => missionGenerator === rift.missionGenerator));
      assert.equal(tiles.length, 1, where);
      const [[tile, tileIndex]] = tiles;
      assert.equal(tile.tileType, "AlwaysActive", where);
      assert.equal(tile.zoneTheme, rift.zoneTheme, where);
      assert.equal(tile.canBeMissionAlert, false, where);
      assert.equal(tile.requirements.activeQuestDefinition, questPath("cannyvalley_landmark_rift"), where);
      assert.deepEqual(tile.linkedQuests, [{ questDefinition: questPath("cannyvalley_landmark_rift") }], where);
      const mission = missions.find((candidate) => candidate.tileIndex === tileIndex);
      assert.equal(mission?.missionGenerator, rift.missionGenerator, where);
      const [objective] = missionObjectives("cannyvalley_landmark_rift");
      assert.equal(objective.minimumDifficulty, 28);
      assert.ok(missionMeets(objective, mission.missionGenerator, mission.missionDifficultyInfo.rowName), where);
      assert.equal(mission.missionDifficultyInfo.rowName, "Theater_Hard_Zone4", where);
      assert.ok(!alerts.some((alert) => alert.tileIndex === tileIndex), where);
      assert.equal(zoneOf(theater.regions.find((region) => region.tileIndices.includes(tileIndex))), 4, where);
      // Act 1's three landmarks stay where they were.
      assert.equal(theater.tiles.filter((candidate) => candidate.requirements.activeQuestDefinition).length, landmarkMissions.length, where);
    }
  });
});

test("6.31 keeps 6.30's Act 1 zones, and 6.30 and earlier have no Ghost Town zone or Rift", () => {
  const cannyValley = (build) => inBuild(build, () => cannyValleyOf(worldInfo(now)).theater);
  const before = cannyValley("4573096");
  const after = cannyValley(actTwoBuild);
  for (const region of before.regions.filter((candidate) => [1, 2].includes(zoneOf(candidate)))) {
    for (const index of region.tileIndices) {
      const { tileType, zoneTheme, missionWeightOverrides } = after.tiles[index];
      assert.deepEqual({ tileType, zoneTheme, missionWeightOverrides }, { tileType: before.tiles[index].tileType, zoneTheme: before.tiles[index].zoneTheme,
        missionWeightOverrides: before.tiles[index].missionWeightOverrides }, `tile ${index}`);
    }
  }
  for (const build of olderBuilds) {
    const theater = cannyValley(build);
    assert.ok(theater.tiles.every((tile) => !act2ZoneThemes.includes(tile.zoneTheme) && tile.zoneTheme !== rift.zoneTheme), build);
    for (const index of theater.regions.filter((region) => [3, 4, 5].includes(zoneOf(region))).flatMap((region) => region.tileIndices)) {
      assert.equal(theater.tiles[index].zoneTheme, dumpTiles[index].zoneTheme, `${build} tile ${index}`);
    }
  }
});

test("a 6.31 client's world info has Act 2's Ghost Town zones and Stabilize the Rift", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "GhostTown631");
    const response = await send({ host: "127.0.0.1", port: backend.port, path: "/fortnite/api/game/v2/world/info",
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-6.31-CL-4573279", Authorization: `bearer ${token}` } });
    assert.equal(response.status, 200);
    const { theater, missions } = cannyValleyOf(response.body);
    const zone3 = theater.regions.find((region) => zoneOf(region) === 3);
    assert.ok(missions.some((mission) => zone3.tileIndices.includes(mission.tileIndex) && ghostTown.test(theater.tiles[mission.tileIndex].zoneTheme)));
    const tileIndex = theater.tiles.findIndex((tile) => tile.linkedQuests.some(({ questDefinition }) => questDefinition.endsWith(".CannyValley_Landmark_Rift")));
    assert.ok(tileIndex >= 0);
    assert.equal(missions.find((mission) => mission.tileIndex === tileIndex)?.missionGenerator, rift.missionGenerator);
  } finally {
    backend.close();
  }
});
