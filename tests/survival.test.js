import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { snowflakeTickets } from "../src/events/winter2017.js";
import { findMission, worldInfo } from "../src/world/theaters.js";
import { hexsylvaniaId } from "../src/world/hexsylvania.js";
import { survivalGenerators, survivalId, survivalTag } from "../src/world/survival.js";

// Survive the Holidays' Survive the Storm theater (Core-Backend #172).
const builds = { "1.10": "3790078", "1.11": "3807424", "2.1": "3825894", "2.2": "3841827" };
const at = (time) => new Date(`2026-11-01T${time}Z`);
const survivalOf = (info) => {
  const index = info.theaters.findIndex((theater) => theater.uniqueId === survivalId);
  return index < 0 ? undefined
    : { theater: info.theaters[index], missions: info.missions[index].availableMissions, alerts: info.missionAlerts[index].availableMissionAlerts };
};

test("Survive the Storm is on the map from 1.11 to 2.2, while Survive the Holidays runs, and not before", () => {
  for (const changelist of [builds["1.11"], builds["2.1"], builds["2.2"]]) {
    inBuild(changelist, () => assert.ok(survivalOf(worldInfo(at("12:00:00"))), changelist));
  }
  // 1.10 has the missions, dormant, but neither the event nor its holiday pin; 1.8 runs Fortnitemares' Hexsylvania.
  inBuild(builds["1.10"], () => assert.equal(survivalOf(worldInfo(at("12:00:00"))), undefined));
  inBuild("3724489", () => {
    const info = worldInfo(at("12:00:00"));
    assert.equal(survivalOf(info), undefined);
    assert.ok(info.theaters.some((theater) => theater.uniqueId === hexsylvaniaId));
  });
});

test("its theater is the event's: Stat.Theater.Survival, a region per difficulty, the holiday pin", () => inBuild(builds["1.11"], () => {
  const { theater, missions } = survivalOf(worldInfo(at("12:00:00")));
  assert.equal(theater.displayName.en, "Survive the Storm");
  assert.deepEqual(theater.runtimeInfo.theaterTags.gameplayTags, [{ tagName: survivalTag }]);
  assert.equal(theater.runtimeInfo.worldMapPinClass, "/Game/Environments/WorldMap/Blueprints/WM_PinHoliday.WM_PinHoliday_C");
  assert.equal(theater.runtimeInfo.socket, "Survival_Mode");
  const missionRegions = theater.regions.filter((region) => region.missionData);
  // The 7 Day quests' objectives: Stat.Theater.Survival.Difficulty01-03 at difficulty 10, 20 and 30.
  assert.deepEqual(missionRegions.map((region) => region.regionTags.gameplayTags[0].tagName),
    [1, 2, 3].map((n) => `${survivalTag}.Difficulty0${n}`));
  assert.deepEqual(missionRegions.map((region) => region.missionData.difficultyWeights[0].difficultyInfo.rowName),
    ["Theater_Survival_Start_Zone5", "Theater_Survival_Normal_Zone5", "Theater_Survival_Hard_Zone5"]);
  assert.equal(missionRegions[0].requirements.questDefinition, undefined);
  assert.match(missionRegions[1].requirements.questDefinition, /StonewoodQuest_LaunchRocket_D5/);
  assert.match(missionRegions[2].requirements.questDefinition, /PlankertonQuest_LaunchRocket_D5/);
  assert.ok(theater.tiles.every((tile) => tile.zoneTheme === "/Game/World/ZoneThemes/FortniteSurvival/BP_ZT_Survival.BP_ZT_Survival_C"));

  assert.ok(missions.length > 0);
  for (const mission of missions) {
    assert.ok(Object.values(survivalGenerators).includes(mission.missionGenerator));
    assert.match(mission.missionRewards.items.at(-1).itemType, /^CardPack:zcp_survival_t0[123]$/);
  }
  const found = findMission(missions[0].missionGuid, at("12:00:00"));
  assert.equal(found.theaterId, survivalId);
}));

test("its 3 Day and 7 Day alerts go on their own missions and give Snowflake Tickets", () => inBuild(builds["1.11"], () => {
  const { missions, alerts } = survivalOf(worldInfo(at("12:00:00")));
  const generatorOf = (alert) => missions.find((mission) => mission.tileIndex === alert.tileIndex).missionGenerator;
  const of = (category) => alerts.filter(({ categoryName }) => categoryName === category);
  assert.ok(of("Survival3DayCategory").length > 0);
  assert.ok(of("Survival7DayCategory").length > 0);
  assert.equal(of("Survival3DayCategory").length + of("Survival7DayCategory").length, alerts.length);
  for (const alert of of("Survival3DayCategory")) assert.equal(generatorOf(alert), survivalGenerators.threeDay);
  for (const alert of of("Survival7DayCategory")) assert.equal(generatorOf(alert), survivalGenerators.sevenDay);
  for (const alert of alerts) {
    assert.deepEqual(alert.missionAlertRewards.items.map(({ itemType }) => itemType), [snowflakeTickets]);
  }
}));

test("a Survival Rewards pack holds XP and a schematic", () => inBuild(builds["1.11"], () => {
  const contents = rollContents("CardPack:zcp_survival_t02");
  assert.ok(contents.some(({ templateId }) => templateId === "AccountResource:heroxp"), JSON.stringify(contents));
  assert.ok(contents.some(({ templateId }) => templateId.startsWith("Schematic:")), JSON.stringify(contents));
}));
