import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { isEventQuest } from "../src/events/quests.js";
import { getQuest } from "../src/gamedata/quests.js";
import { buildGameData } from "../src/gamedata/read.js";
import { claimQuest, completeQuest, grant } from "../src/profiles/progress.js";
import { questLineGiftBox, questLineGiftBoxText, settleQuestLine } from "../src/profiles/questline.js";
import { findQuestItem, questIdOf } from "../src/profiles/quests.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { hasUnlocked } from "../src/profiles/unlocks.js";
import { clientQuestLogin } from "../src/services/mcp/commands/ClientQuestLogin.js";
import { plankertonLandmarks, stonewoodLandmarks } from "../src/world/landmarks.js";
import { generatorMissionTags, missionMeets, missionObjectives, questPath } from "../src/world/quests.js";
import { worldInfo } from "../src/world/theaters.js";
import { get, post, startBackend, userLogin } from "./helpers.js";

// Core-Backend #368: an account that went through Stonewood and Plankerton before 6.30 had, on 6.30 and 6.31, none of
// the squad slots and feature unlocks (Transformation, Research, building upgrades...) 6.30 moved into quest rewards, and
// none of the quests 6.30 put ahead of where it was.
const v12 = "3541083";
const v622 = "4543176";
const v630 = "4573096";
const v631 = "4573279";
const now = new Date("2026-11-16T12:00:00Z");

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-questline-"));
  try {
    return run(createProfileStore(dataDir));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const isCampaign = (item) => {
  const questId = questIdOf(item);
  return questId && getQuest(questId) && !isEventQuest(questId) && getQuest(questId).type !== "DailyQuest";
};

// A player who does every quest they have, a round at a time, until stop(profile) or the rounds run out.
function play(session, rounds, stop = () => false) {
  const tracker = session.profile("profile0");
  clientQuestLogin({ session, notifications: [], profileId: "profile0" });
  for (let round = 0; round < rounds && !stop(tracker.profile); round++) {
    const active = Object.keys(tracker.profile.items)
      .filter((itemId) => tracker.profile.items[itemId].attributes?.quest_state === "Active" && isCampaign(tracker.profile.items[itemId]));
    if (!active.length) break;
    for (const itemId of active) {
      if (tracker.profile.items[itemId]?.attributes.quest_state === "Active") completeQuest(session, itemId);
      if (tracker.profile.items[itemId]?.attributes.quest_state === "Completed") claimQuest(session, itemId);
      if (stop(tracker.profile)) break;
    }
  }
}

const stateOf = (profile, questId) => profile.items[findQuestItem(profile, questId) ?? ""]?.attributes.quest_state;
const claimedDefenses = (profile) => Object.values(profile.items)
  .filter((item) => /^outpostquest_/.test(questIdOf(item) ?? "") && item.attributes.quest_state === "Claimed").map(questIdOf).sort();

test("6.31's quest login settles a 6.22 account's quest line: the quests it's past claimed, their unlocks in a gift box (#368)", () => withStore((store) => {
  let defenses;
  inBuild(v622, () => {
    const session = openSession(store, "past622");
    play(session, 60);
    const { profile } = session.profile("profile0");
    assert.equal(stateOf(profile, "outpostquest_t2_l3"), "Claimed", "past Plankerton's SSD 3 on 6.22");
    assert.equal(stateOf(profile, "stonewoodquest_filler_1_d3"), "Claimed");
    // On its own build nothing changes.
    const before = JSON.stringify(profile.items);
    assert.deepEqual(settleQuestLine(session), { claimed: [], granted: [], unlocks: [] });
    assert.equal(JSON.stringify(profile.items), before);
    assert.equal(hasUnlocked(profile, ["Unlocks.DirectedAcquisition.People.Worker"]), false);
    defenses = claimedDefenses(profile);
    session.commit();
  });
  inBuild(v631, () => {
    const session = openSession(store, "past622");
    const { profile } = session.profile("profile0");
    // What #210's rule gave out before: a defense's new quest, active, though the player is past it.
    grant(session, "Quest:stonewoodquest_fetch_researchcrates", 1);
    assert.equal(stateOf(profile, "stonewoodquest_fetch_researchcrates"), "Active");

    const settled = settleQuestLine(session);
    // 6.30's quests between Stonewood's SSD 3 and StonewoodQuest_Filler_1_D3, which the player holds, are claimed in place.
    for (const questId of ["stonewoodquest_fetch_researchcrates", "stonewoodquest_landmark_buildoff", "plankertonquest_outpost_l3"]) {
      assert.ok(settled.claimed.includes(questId), questId);
      assert.equal(stateOf(profile, questId), "Claimed", questId);
      const item = profile.items[findQuestItem(profile, questId)];
      for (const objective of getQuest(questId).objectives) assert.equal(item.attributes[`completion_${objective.name}`], objective.count, questId);
    }
    // No storm shield defense is ever claimed for the player.
    assert.ok(settled.claimed.every((questId) => !/^outpostquest_/.test(questId)));
    assert.deepEqual(claimedDefenses(profile), defenses);
    // The unlocks: Plankerton's SSD 3 now gives Transformation, the Research Crates the research system, Build Off the
    // building upgrades, every defense its squad slots.
    for (const node of ["questreward_transformation", "questreward_feature_researchsystem", "questreward_buildingupgradelevel",
      "questreward_stonewood_squad_ssd1", "questreward_plankerton_squad_ssd3"]) {
      assert.ok(settled.unlocks.includes(`homebasenode:${node}`), node);
    }
    assert.ok(hasUnlocked(profile, ["Unlocks.DirectedAcquisition.People.Worker"]), "the transform list");
    // In one gift box, Epic's make-good with its Migration.General text.
    const boxes = Object.values(profile.items).filter((item) => item.templateId === questLineGiftBox);
    assert.equal(boxes.length, 1);
    assert.deepEqual(boxes[0].attributes.params, { assetString: questLineGiftBoxText });
    assert.deepEqual(boxes[0].attributes.lootList.map(({ itemType }) => itemType).sort(), [...settled.unlocks].sort());
    // A tutorial the claim of a defense gives on 6.31 is given to play, as the claim would.
    assert.ok(settled.granted.includes("plankertonquest_tutorial_transform"));
    assert.equal(stateOf(profile, "plankertonquest_tutorial_transform"), "Active");

    // Once.
    assert.deepEqual(settleQuestLine(session), { claimed: [], granted: [], unlocks: [] });
    clientQuestLogin({ session, notifications: [], profileId: "profile0" });
    assert.equal(Object.values(profile.items).filter((item) => item.templateId === questLineGiftBox).length, 1);
    assert.equal(stateOf(profile, "stonewoodquest_landmark_buildoff"), "Claimed");
  });
}));

test("a quest 6.30 put after where the player is comes to play, and leads on to Build Off (#368)", () => withStore((store) => {
  inBuild(v622, () => {
    const session = openSession(store, "ssd3on622");
    play(session, 60, (profile) => stateOf(profile, "outpostquest_t1_l3") === "Claimed");
    const { profile } = session.profile("profile0");
    assert.equal(stateOf(profile, "outpostquest_t1_l3"), "Claimed");
    assert.equal(findQuestItem(profile, "stonewoodquest_filler_1_d3"), undefined);
    session.commit();
  });
  inBuild(v631, () => {
    const session = openSession(store, "ssd3on622");
    const { profile } = session.profile("profile0");
    clientQuestLogin({ session, notifications: [], profileId: "profile0" });
    assert.equal(stateOf(profile, "stonewoodquest_fetch_researchcrates"), "Active", "not past it: given to play");
    assert.equal(findQuestItem(profile, "stonewoodquest_landmark_buildoff"), undefined);
    const crates = findQuestItem(profile, "stonewoodquest_fetch_researchcrates");
    completeQuest(session, crates);
    claimQuest(session, crates);
    assert.equal(stateOf(profile, "stonewoodquest_landmark_buildoff"), "Active");
    // Its claim gives its own rewards, the research system among them.
    assert.ok(Object.values(profile.items).some((item) => item.templateId.toLowerCase() === "homebasenode:questreward_feature_researchsystem"));
  });
}));

test("the quest line a build's own player went through is left as it is (1.2, 6.22, 6.31)", () => withStore((store) => {
  for (const build of [v12, v622, v631]) {
    inBuild(build, () => {
      const session = openSession(store, `own${build}`);
      play(session, 40);
      const { profile } = session.profile("profile0");
      const before = JSON.stringify(profile.items);
      assert.deepEqual(settleQuestLine(session), { claimed: [], granted: [], unlocks: [] }, build);
      assert.equal(JSON.stringify(profile.items), before, build);
    });
  }
}));

test("a quest taken out of the quest log comes back at the next quest login (#368)", () => withStore((store) => inBuild(v631, () => {
  const session = openSession(store, "removed631");
  play(session, 6);
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const [itemId] = Object.entries(profile.items).find(([, item]) => item.attributes?.quest_state === "Active" && isCampaign(item)
    && Object.values(profile.items).some((parent) => parent.attributes?.quest_state === "Claimed"
      && (getQuest(questIdOf(parent) ?? "")?.hiddenRewards ?? []).concat(getQuest(questIdOf(parent) ?? "")?.rewards ?? [])
        .some(({ templateId }) => templateId.toLowerCase() === item.templateId.toLowerCase()))) ?? [];
  assert.ok(itemId, "an active quest a claimed one gave");
  const questId = questIdOf(profile.items[itemId]);
  tracker.removeItem(itemId);
  assert.equal(findQuestItem(profile, questId), undefined);
  clientQuestLogin({ session, notifications: [], profileId: "profile0" });
  assert.equal(stateOf(profile, questId), "Active", questId);
})));

test("the admin panel moves quests on but no longer takes them out (#368)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "NoRemove");
    const admin = (route, body) => (body === undefined ? get(backend.port, `/admin/api${route}`) : post(backend.port, `/admin/api${route}`, undefined, body));
    const details = (await admin(`/accounts/${player.accountId}/grant`, { templateId: "Quest:outpostquest_t1_l2", quantity: 1 })).body;
    const quest = details.quests.find((entry) => entry.questId === "outpostquest_t1_l2");
    assert.equal((await admin(`/accounts/${player.accountId}/quests`, { itemId: quest.itemId, action: "remove" })).status, 400);
    const after = (await admin(`/accounts/${player.accountId}`)).body;
    assert.ok(after.quests.some((entry) => entry.itemId === quest.itemId));
    const panel = fs.readFileSync(new URL("../src/admin/panel.html", import.meta.url), "utf8");
    assert.ok(!panel.includes('action: "remove"'));
  } finally {
    backend.close();
  }
});

const theaterOf = (info, number) => {
  const index = info.theaters.findIndex((theater) => theater.runtimeInfo.theaterTags.gameplayTags.some(({ tagName }) => tagName === `Stat.Theater.PvE0${number}`));
  return { theater: info.theaters[index], missions: info.missions[index].availableMissions, alerts: info.missionAlerts[index].availableMissionAlerts };
};

test("6.30's Build Off!, Plank Harbor and Steel Icarus are landmark missions on quest tiles of their theaters; 6.22 has none (#368)", () => {
  for (const build of [v630, v631]) {
    inBuild(build, () => {
      const info = worldInfo(now);
      for (const [number, landmarks, row] of [[1, stonewoodLandmarks, "Theater_Start_Zone3"], [2, plankertonLandmarks, "Theater_Normal_Zone5"]]) {
        const { theater, missions, alerts } = theaterOf(info, number);
        for (const { questId, missionGenerator, zoneTheme } of landmarks) {
          const where = `${build} ${questId}`;
          const tiles = theater.tiles.map((tile, index) => [tile, index]).filter(([tile]) => tile.missionWeightOverrides.some((weight) => weight.missionGenerator === missionGenerator));
          assert.equal(tiles.length, 1, where);
          const [[tile, tileIndex]] = tiles;
          assert.equal(tile.tileType, "AlwaysActive", where);
          assert.equal(tile.zoneTheme, zoneTheme, where);
          assert.equal(tile.canBeMissionAlert, false, where);
          assert.equal(tile.requirements.activeQuestDefinition, questPath(questId), where);
          assert.deepEqual(tile.linkedQuests, [{ questDefinition: questPath(questId) }], where);
          const mission = missions.find((candidate) => candidate.tileIndex === tileIndex);
          assert.equal(mission?.missionGenerator, missionGenerator, where);
          assert.equal(mission.missionDifficultyInfo.rowName, row, where);
          const [objective] = missionObjectives(questId);
          assert.ok(missionMeets(objective, mission.missionGenerator, mission.missionDifficultyInfo.rowName), where);
          assert.ok(!alerts.some((alert) => alert.tileIndex === tileIndex), where);
        }
        assert.equal(theater.tiles.filter((tile) => tile.requirements.activeQuestDefinition).length, landmarks.length, `${build} ${number}`);
      }
    });
  }
  // 6.30's own paks give the landmarks' missions these tags (its data had 6.22's for them).
  inBuild(v630, () => {
    assert.deepEqual(generatorMissionTags(stonewoodLandmarks[0].missionGenerator), ["Stat.Mission.Primary.Landmark.BuildOff"]);
    assert.deepEqual(generatorMissionTags(plankertonLandmarks[1].missionGenerator), ["Stat.Mission.Primary.Landmark.Lars"]);
  });
  inBuild(v622, () => {
    const info = worldInfo(now);
    for (const number of [1, 2]) assert.ok(theaterOf(info, number).theater.tiles.every((tile) => !tile.requirements.activeQuestDefinition), String(number));
  });
});

test("from 6.30 Plankerton, Canny Valley and Twine Peaks roll Refuel the Homebase; Stonewood and 6.22 don't (#368)", () => {
  const refuel = "/Game/World/MissionGens/MissionGen_RefuelTheBase.MissionGen_RefuelTheBase_C";
  const rolls = (build, number) => inBuild(build, () => theaterOf(worldInfo(now), number).theater.regions
    .filter((region) => region.missionData?.missionWeights?.length)
    .map((region) => region.missionData.missionWeights.some(({ missionGenerator }) => missionGenerator === refuel)));
  for (const build of [v630, v631]) {
    assert.ok(rolls(build, 1).every((has) => !has), `${build} Stonewood`);
    for (const number of [2, 3, 4]) assert.ok(rolls(build, number).length && rolls(build, number).every(Boolean), `${build} ${number}`);
    inBuild(build, () => {
      // Plankerton's main line asks for one in a 14+ zone; its zones run from 12.
      const [objective] = missionObjectives("plankertonquest_mechanical_refuelintro");
      assert.ok(theaterOf(worldInfo(now), 2).theater.regions.some((region) => (region.missionData?.difficultyWeights ?? [])
        .some(({ difficultyInfo }) => missionMeets(objective, refuel, difficultyInfo.rowName))));
    });
  }
  for (const number of [1, 2, 3, 4]) assert.ok(rolls(v622, number).every((has) => !has), `6.22 ${number}`);
  assert.equal(buildGameData(v622, "world", {}).missionGenerators[refuel], undefined);
});
