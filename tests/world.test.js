import { test } from "node:test";
import assert from "node:assert/strict";
import { readGameData } from "../src/gamedata/read.js";
import { missionMeets, missionObjectives } from "../src/world/quests.js";
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

test("Plankerton, Canny Valley and Twine Peaks need the previous zone's Launch the Rocket quest completed", () => {
  const quests = readGameData("quests", {});
  const gates = info.theaters.map((theater) => theater.runtimeInfo.requirements.questDefinition);
  assert.deepEqual(gates, [undefined,
    "/Game/Quests/Stonewood/StonewoodQuest_LaunchRocket_D5.StonewoodQuest_LaunchRocket_D5",
    "/Game/Quests/Plankerton/PlankertonQuest_LaunchRocket_D5.PlankertonQuest_LaunchRocket_D5",
    "/Game/Quests/CannyValley/CannyValleyQuest_LaunchRocket_D5.CannyValleyQuest_LaunchRocket_D5",
    undefined]);
  // Each gate is the quest that grants that zone's first storm shield quest.
  for (const [gate, outpostQuest] of [[gates[1], "outpostquest_t2_l1"], [gates[2], "outpostquest_t3_l1"], [gates[3], "outpostquest_t4_l1"]]) {
    const questId = gate.split(".").pop().toLowerCase();
    assert.ok(quests[questId].hiddenRewards.some((reward) => reward.templateId === `Quest:${outpostQuest}`), questId);
  }
  for (const theater of info.theaters) assert.equal(theater.runtimeInfo.theaterVisibilityRequirements.questDefinition, undefined);
});

test("each zone of a theater opens with its Storm Shield Defense, and only storm shields and the tutorial are open before", () => {
  const quests = readGameData("quests", {});
  const questId = (path) => path.split(".").pop().toLowerCase();
  for (const [index, theater] of info.theaters.entries()) {
    const regionOf = new Map(theater.regions.flatMap((region) => region.tileIndices.map((tile) => [tile, region])));
    for (const region of theater.regions) {
      const zone = region.regionTags.gameplayTags.map(({ tagName }) => /^Stat\.Theater\.PvE0(\d)\.Difficulty0(\d)$/.exec(tagName)).find(Boolean);
      const gate = region.requirements.questDefinition;
      if (!zone) {
        assert.equal(gate, undefined);
        continue;
      }
      assert.equal(gate, `/Game/Quests/Outpost/OutpostQuest_T${zone[1]}_L${zone[2]}.OutpostQuest_T${zone[1]}_L${zone[2]}`);
      assert.ok(quests[questId(gate)], gate);
    }
    for (const mission of info.missions[index].availableMissions) {
      if (regionOf.get(mission.tileIndex).requirements.questDefinition) continue;
      assert.ok(["Outpost", "AlwaysActive"].includes(theater.tiles[mission.tileIndex].tileType), `${theater.uniqueId} tile ${mission.tileIndex}`);
      assert.match(mission.missionDifficultyInfo.rowName, /_Outpost1$|^Theater_Tutorial_/);
    }
  }
  // Plankerton, Canny Valley and Twine Peaks hand out each zone's first story quest from that zone's defense.
  for (const [theater, prefix] of [[2, "plankertonquest"], [3, "cannyvalleyquest"], [4, "twinepeaksquest"]]) {
    for (let zone = 1; zone <= 5; zone += 1) {
      const defense = quests[`outpostquest_t${theater}_l${zone}`];
      assert.ok(defense.hiddenRewards.some((reward) => reward.templateId === `Quest:${prefix}_filler_1_d${zone}`), `${prefix} ${zone}`);
    }
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

// Which storm shield defenses a quest can't be given before: the ones every chain of quests that grants it goes through.
function questChains() {
  const quests = readGameData("quests", {});
  const grantedBy = {};
  for (const [id, quest] of Object.entries(quests)) {
    for (const reward of [...(quest.rewards ?? []), ...(quest.hiddenRewards ?? [])]) {
      if (/^quest:/i.test(reward.templateId)) (grantedBy[reward.templateId.slice(6).toLowerCase()] ??= []).push(id);
    }
  }
  const before = new Map();
  const doneBefore = (id, path = new Set()) => {
    if (before.has(id)) return before.get(id);
    if (path.has(id)) return null;
    path.add(id);
    let done = null;
    for (const parent of grantedBy[id] ?? []) {
      const parentDone = doneBefore(parent, path);
      if (!parentDone) continue;
      const withParent = new Set([...parentDone, parent]);
      done = done ? new Set([...done].filter((quest) => withParent.has(quest))) : withParent;
    }
    path.delete(id);
    if (!grantedBy[id]?.length) done = new Set();
    before.set(id, done);
    return done;
  };
  return { quests, grantedBy, doneBefore };
}

test("every story quest that names a mission finds one on the map, in a zone open by the time it is given, every day", () => {
  const { quests, grantedBy, doneBefore } = questChains();
  const questId = (path) => path?.split(".").pop().toLowerCase();
  const theaterNumber = { stonewoodquest: 1, plankertonquest: 2, cannyvalleyquest: 3, twinepeaksquest: 4 };
  let checked = 0;
  for (let day = 0; day < 14; day += 1) {
    const today = worldInfo(new Date(Date.UTC(2026, 9, 19 + day, 12)));
    for (const [id, quest] of Object.entries(quests)) {
      if (!["Task", "Onboarding", "Optional"].includes(quest.type) || /^(test|progressiontest|achievement|challenge|halloween)/.test(id)) continue;
      if (!grantedBy[id]?.length) continue; // Never given in this build (Twine Peaks' story stops at its storm shields).
      const done = doneBefore(id);
      if (!done) continue;
      for (const objective of missionObjectives(id)) {
        if (objective.missionTag.startsWith("Stat.Mission.Primary.Outpost")) continue; // The storm shield tile, always there.
        const wanted = objective.theaterTag ?? (theaterNumber[id.split("_")[0]] && `Stat.Theater.PvE0${theaterNumber[id.split("_")[0]]}`);
        const found = today.theaters.slice(0, 4).some((theater, index) => {
          if (wanted && !theater.regions.some((region) => region.regionTags.gameplayTags.some(({ tagName }) => tagName.startsWith(wanted)))) return false;
          if (theater.runtimeInfo.requirements.questDefinition && !done.has(questId(theater.runtimeInfo.requirements.questDefinition))) return false;
          const regionOf = new Map(theater.regions.flatMap((region) => region.tileIndices.map((tile) => [tile, region])));
          return today.missions[index].availableMissions.some((mission) => {
            const gate = regionOf.get(mission.tileIndex).requirements.questDefinition;
            return (!gate || done.has(questId(gate))) && missionMeets(objective, mission.missionGenerator, mission.missionDifficultyInfo.rowName);
          });
        });
        assert.ok(found, `${id} ${objective.stat} on day ${day}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 14 * 40, `${checked} objectives checked`);
});

test("tiles carry the story quests they were placed for (LinkedQuests)", () => {
  const quests = readGameData("quests", {});
  const linked = (theater, tile) => theater.tiles[tile].linkedQuests.map(({ questDefinition }) => questDefinition.split(".").pop());
  const [stonewood, plankerton, , twinePeaks] = info.theaters;
  assert.deepEqual(linked(stonewood, 37), ["StonewoodQuest_Filler_1_D3"]); // Rescue the Survivors, zone 3
  assert.deepEqual(linked(stonewood, 61), ["StonewoodQuest_LaunchBalloon_D1"]);
  assert.deepEqual(linked(stonewood, 29), ["StonewoodQuest_RetrieveData_D1"]);
  assert.deepEqual(linked(stonewood, 8), ["StonewoodQuest_LaunchRocket_D5"]);
  assert.deepEqual(linked(stonewood, 64), Array.from({ length: 10 }, (_, level) => `OutpostQuest_T1_L${level + 1}`));
  assert.deepEqual(linked(stonewood, 36).sort(), ["Daily_High_Priority", "StonewoodQuest_Side_1_D4"]);
  assert.deepEqual(linked(plankerton, 14).sort(), ["PlankertonQuest_Filler_2_D2", "PlankertonQuest_Filler_4_D2"]);
  assert.deepEqual(linked(plankerton, 35), ["PlankertonQuest_Filler_2_D1"]);
  assert.deepEqual(linked(twinePeaks, 10), ["Daily_High_Priority"]);
  for (const theater of info.theaters) {
    for (const tile of theater.tiles) {
      for (const { questDefinition } of tile.linkedQuests) {
        assert.match(questDefinition, /^\/Game\/Quests\/.+\/(\w+)\.\1$/);
        assert.ok(quests[questDefinition.split(".").pop().toLowerCase()], questDefinition);
      }
      if (tile.tileType === "Outpost" || tile.tileType === "CriticalMission") continue;
      for (const { questDefinition } of tile.linkedQuests) {
        const objectives = missionObjectives(questDefinition.split(".").pop());
        const [generator] = tile.missionWeightOverrides;
        assert.ok(objectives.some((objective) => missionMeets(objective, generator.missionGenerator, "Theater_Nightmare_Zone5")), questDefinition);
      }
    }
  }
});

test("a mission and its alert last the UTC day, and the theater's missions refresh at midnight", () => {
  for (const [index, theater] of info.missions.entries()) {
    assert.equal(theater.nextRefresh, "2026-10-19T23:59:59.999Z");
    assert.equal(info.missionAlerts[index].nextRefresh, "2026-10-19T23:59:59.999Z");
    for (const alert of info.missionAlerts[index].availableMissionAlerts) assert.equal(alert.availableUntil, "2026-10-19T23:59:59.999Z");
  }
  // Fixed tiles keep their mission across days (a new one each day), rolled tiles may change it.
  const tomorrow = worldInfo(new Date("2026-10-20T12:00:00Z"));
  const rescue = (world) => world.missions[0].availableMissions.find((mission) => mission.tileIndex === 37);
  assert.equal(rescue(tomorrow).missionGenerator, rescue(info).missionGenerator);
  assert.notEqual(rescue(tomorrow).missionGuid, rescue(info).missionGuid);
});

// Issue #49: Epic's missions of one difficulty each drew their own two zone card packs (mostly the tier's XP packs,
// sometimes materials), where Core used to give every mission of a loot tier group the same pair.
test("missions roll their rewards from their loot tier group's packs, so one difficulty's missions differ; storm shields keep theirs", () => {
  const info = worldInfo(new Date("2026-10-26T12:00:00Z"));
  const missions = info.missions.flatMap((theater) => theater.availableMissions);
  const byGroup = new Map();
  for (const { missionRewards } of missions) {
    const sets = byGroup.get(missionRewards.tierGroupName) ?? new Set();
    sets.add(missionRewards.items.map((item) => item.itemType).sort().join(","));
    byGroup.set(missionRewards.tierGroupName, sets);
    if (missionRewards.tierGroupName.startsWith("Mission_Select_T")) {
      assert.equal(missionRewards.items.length, 2);
      assert.ok(missionRewards.items.every((item) => item.itemType.startsWith("CardPack:zcp_")), missionRewards.tierGroupName);
    }
  }
  assert.ok([...byGroup].some(([group, sets]) => group.startsWith("Mission_Select_T") && sets.size > 1), "some difficulty shows different rewards");
  assert.deepEqual([...(byGroup.get("Outpost_Select_Theater1") ?? [])], ["CardPack:zcp_heroxp_outpost_theater1,CardPack:zcp_voucher_basicpack"]);
  assert.deepEqual(worldInfo(new Date("2026-10-26T12:00:00Z")), info, "the same for everyone on a day");
});
