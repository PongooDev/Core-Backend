import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { inBuild } from "../src/builds/context.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { act1ZoneThemes, cannyValleyId, hasAct1Zones } from "../src/world/cannyvalley.js";
import { landmarkMissions } from "../src/world/landmarks.js";
import { difficultyOf } from "../src/world/quests.js";
import { worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #341: from 5.10 Canny Valley's first act is in the desert (Thunder Route 99, the desert, its bunkers), but
// Core served Epic's 2017 Canny Valley to every build: forest, grassland and towns, the storm shield the only desert tile.
const now = new Date("2026-11-13T12:00:00Z");
const day = 86400000;
// 5.10 (CL-4240749), 6.02.0 (CL-4442095, the reporter's, on 6.02's data), 6.02 (CL-4461277), 6.10 (CL-4480234), 6.20 (CL-4497486),
// 6.21 (CL-4526925).
const actOneBuilds = ["4240749", "4442095", "4461277", "4480234", "4497486", "4526925"];
const olderBuilds = ["3532353", "3700114", "3807424", "4166199", "4214610"];
const route99 = /\/ZT_Route99\/BP_ZT_Route99_[12]\./;
const bunkers = /\/(ZT_Arid\/BP_ZT_Desert_Bunker|ZT_Route99\/BP_ZT_Route99_Bunker_[12])\./;
const temperate = /\/ZT_The(Forest|Grasslands|Suburbs|City|IndustrialPark)\/BP_ZT_The\w+\.BP_ZT_The(Forest|Grasslands|Suburbs|City|IndustrialPark)_C$/;
const desertTiles = ["/Game/World/ZoneThemes/ZT_Arid/BP_Hex_Arid01", "/Game/World/ZoneThemes/ZT_Route99/BP_Hex_Route99", "/Game/World/ZoneThemes/ZT_GhostTown/BP_Hex_GhostTown"];
const dump = JSON.parse(fs.readFileSync(new URL("../gamedata/theaters.json", import.meta.url), "utf8"));
const dumpOf = (uniqueId) => dump.theaters.find(({ data }) => data.uniqueId === uniqueId).data;
const zoneOf = (region) => Number((region.regionTags?.gameplayTags ?? []).map(({ tagName }) => /^Stat\.Theater\.PvE03\.Difficulty0(\d)$/.exec(tagName)?.[1]).find(Boolean) ?? 0);
const cannyValleyOf = (info) => {
  const index = info.theaters.findIndex((theater) => theater.uniqueId === cannyValleyId);
  return { theater: info.theaters[index], missions: info.missions[index].availableMissions };
};
// The least Zone.Difficulty a quest's objectives ask for (ObjectiveStatTable conditions), from the build's data.
function minimumDifficulty(build, questId) {
  const quests = buildGameData(dataBuild(build), "quests", {});
  const stats = buildGameData(dataBuild(build), "objectivestats", {});
  return Math.max(...quests[questId].objectives.map(({ stat, name }) => Number(/Zone\.Difficulty\s*>=\s*(\d+)/.exec(stats[stat ?? name]?.condition ?? "")?.[1] ?? 0)));
}

test("5.10 is the first build with Canny Valley's first act: its quests and zones (#341)", () => {
  for (const build of [...actOneBuilds, ...olderBuilds]) {
    const world = buildGameData(dataBuild(build), "world", {});
    const quests = buildGameData(dataBuild(build), "quests", {});
    const act = actOneBuilds.includes(build);
    assert.equal(hasAct1Zones(world), act, build);
    assert.equal(Boolean(quests.cannyvalley_reactive_route99), act, build);
  }
});

test("from 5.10 Canny Valley's first two zones are the act's desert, Thunder Route 99 and bunkers (#341)", () => {
  for (const build of actOneBuilds) {
    const world = buildGameData(dataBuild(build), "world", {});
    const landmarkThemes = new Set(landmarkMissions.map(({ zoneTheme }) => zoneTheme));
    const roadTrip = minimumDifficulty(build, "cannyvalley_reactive_route99");
    const bunkerQuests = Math.max(minimumDifficulty(build, "cannyvalley_reactive_periscopes"), minimumDifficulty(build, "cannyvalley_reactive_bases"));
    assert.equal(roadTrip, 22, build);
    assert.equal(bunkerQuests, 24, build);
    for (const offset of [0, 1, 2]) {
      const { theater, missions } = inBuild(build, () => cannyValleyOf(worldInfo(new Date(now.getTime() + offset * day))));
      const where = `${build} day ${offset}`;
      const zones = theater.regions.filter((region) => [1, 2].includes(zoneOf(region)));
      assert.equal(zones.length, 2, where);
      for (const region of zones) {
        for (const index of region.tileIndices) {
          const { zoneTheme } = theater.tiles[index];
          assert.ok(act1ZoneThemes.includes(zoneTheme) || landmarkThemes.has(zoneTheme), `${where} tile ${index} ${zoneTheme}`);
          assert.ok(world.zoneThemes[zoneTheme], `${where} tile ${index}`);
        }
      }
      // Road Trip ("Can be only completed in a Thunder Route 99 zone", Zone.Difficulty >= 22) has a Route 99 mission every
      // day it can be done in, in the first zone, as the bunker quests (>= 24) have a bunker mission in the second.
      const rowOf = (mission) => mission.missionDifficultyInfo.rowName;
      const zoneTiles = (zone) => new Set(zones.find((region) => zoneOf(region) === zone).tileIndices);
      const onRoute = missions.filter((mission) => zoneTiles(1).has(mission.tileIndex) && route99.test(theater.tiles[mission.tileIndex].zoneTheme));
      assert.ok(onRoute.some((mission) => theater.tiles[mission.tileIndex].tileType === "AlwaysActive" && difficultyOf(rowOf(mission)) >= roadTrip), where);
      const inBunkers = missions.filter((mission) => zoneTiles(2).has(mission.tileIndex) && bunkers.test(theater.tiles[mission.tileIndex].zoneTheme));
      assert.ok(inBunkers.some((mission) => theater.tiles[mission.tileIndex].tileType === "AlwaysActive" && difficultyOf(rowOf(mission)) >= bunkerQuests), where);
      // On the map the first zone is all desert and highway (the town zones' arid twins, in the second, keep their town tiles).
      for (const index of zoneTiles(1)) assert.ok(desertTiles.includes(world.zoneThemes[theater.tiles[index].zoneTheme].tileClass), `${where} tile ${index}`);
    }
  }
});

test("from 5.10 the act's landmarks sit in its zones: Hit the Road on the highway, the Memorial and High Noon in the desert (#341)", () => {
  for (const build of actOneBuilds) {
    const { theater } = inBuild(build, () => cannyValleyOf(worldInfo(now)));
    const near = (index) => {
      const tile = theater.tiles[index];
      return theater.tiles.filter((other) => other !== tile && Math.hypot(other.xCoordinate - tile.xCoordinate, other.yCoordinate - tile.yCoordinate) <= 1.5);
    };
    const tileOf = (questId) => theater.tiles.findIndex((tile) => tile.linkedQuests.some(({ questDefinition }) => questDefinition.toLowerCase().endsWith(`.${questId}`)));
    const welcome = tileOf("cannyvalley_landmark_welcome");
    assert.ok(near(welcome).some((tile) => route99.test(tile.zoneTheme)), `${build}: Hit the Road beside Thunder Route 99`);
    for (const questId of ["cannyvalley_landmark_memorial", "cannyvalley_landmark_highnoon"]) {
      assert.ok(near(tileOf(questId)).some((tile) => /\/ZT_Arid\/BP_ZT_Desert(_Bunker)?\./.test(tile.zoneTheme)), `${build}: ${questId} in the desert`);
    }
  }
});

test("from 5.10 the rest of Canny Valley and the other theaters stay Epic's 2017 layout; before 5.10 all of it does (#341)", () => {
  const themesOf = (build) => inBuild(build, () => worldInfo(now)).theaters.map((theater) => [theater.uniqueId, theater.tiles.map((tile) => tile.zoneTheme)]);
  for (const build of olderBuilds) {
    for (const [uniqueId, themes] of themesOf(build)) {
      if (dump.theaters.some(({ data }) => data.uniqueId === uniqueId)) assert.deepEqual(themes, dumpOf(uniqueId).tiles.map((tile) => tile.zoneTheme), `${build} ${uniqueId}`);
    }
  }
  for (const build of actOneBuilds) {
    for (const [uniqueId, themes] of themesOf(build)) {
      if (!dump.theaters.some(({ data }) => data.uniqueId === uniqueId)) continue;
      const original = dumpOf(uniqueId);
      if (uniqueId !== cannyValleyId) {
        assert.deepEqual(themes, original.tiles.map((tile) => tile.zoneTheme), `${build} ${uniqueId}`);
        continue;
      }
      const actZones = new Set(original.regions.filter((region) => [1, 2].includes(zoneOf(region))).flatMap((region) => region.tileIndices));
      original.tiles.forEach((tile, index) => {
        if (actZones.has(index) || tile.tileType === "NonMission") return;
        assert.equal(themes[index], tile.zoneTheme, `${build} Canny Valley tile ${index} (zone 3 to 5, the critical mission, the storm shield)`);
      });
      // Its scenery is desert around the act and the storm shield, and keeps the 2017 look elsewhere.
      const scenery = original.tiles.map((tile, index) => [tile, index]).filter(([tile]) => tile.tileType === "NonMission");
      const desert = scenery.filter(([, index]) => themes[index].endsWith("/ZT_Arid/BP_ZT_Desert.BP_ZT_Desert_C"));
      assert.ok(desert.length > 0 && desert.length < scenery.length, build);
      for (const [tile, index] of scenery) assert.ok(themes[index] === tile.zoneTheme || desert.some(([, other]) => other === index), `${build} scenery ${index}`);
      assert.ok(!themes.some((theme, index) => actZones.has(index) && temperate.test(theme)), build);
    }
  }
});

test("a 6.02 client's world info draws Canny Valley's first zone as desert and Thunder Route 99 (#341)", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Desert602");
    const response = await send({ host: "127.0.0.1", port: backend.port, path: "/fortnite/api/game/v2/world/info",
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-6.02-CL-4442095", Authorization: `bearer ${token}` } });
    assert.equal(response.status, 200);
    const { theater, missions } = cannyValleyOf(response.body);
    const zone1 = theater.regions.find((region) => zoneOf(region) === 1);
    const themes = new Set(zone1.tileIndices.map((index) => theater.tiles[index].zoneTheme.split(".").pop()));
    assert.ok(themes.has("BP_ZT_Desert_C") && themes.has("BP_ZT_Route99_1_C") && themes.has("BP_ZT_Route99_2_C"), [...themes].join());
    assert.ok(![...themes].some((name) => /^BP_ZT_The(Forest|Grasslands|Suburbs|City|IndustrialPark)_C$/.test(name)));
    assert.ok(missions.some((mission) => zone1.tileIndices.includes(mission.tileIndex) && route99.test(theater.tiles[mission.tileIndex].zoneTheme)));
  } finally {
    backend.close();
  }
});
