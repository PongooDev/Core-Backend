import { mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { getAthenaQuest } from "../src/gamedata/athena.js";
import { advanceAthenaObjectives, athenaQuestLogin, claimAthenaQuest, seasonRewardFunctions } from "../src/profiles/athena.js";
import { configureChallenges, settleChallengeSchedules } from "../src/profiles/challenges.js";
import { configureEvents } from "../src/events/events.js";
import { openSession } from "../src/profiles/session.js";
import { buyBattlePass, takeUpSeason } from "../src/profiles/seasons.js";
import { createProfileStore } from "../src/profiles/store.js";

// Core-Backend #426: staged challenges ("Stage 1 of 5 - Land at Fatal Fields"). Completing a stage gives the next stage's
// quest, which belongs to the challenge's bundle: the challenges tab lists a bundle's quests (grantedquestinstanceids), so a
// next stage outside it was never shown and the stage done stayed on screen.
const v840 = "6058028";
const week6 = "questbundle_s8_week_006";
const stages = ["a", "b", "c", "d", "e"].map((stage) => `quest_br_land_chain_03${stage}`);

function withSession(run) {
  configureChallenges({ challengeUnlock: { season8: { mode: "manual", manualWeeks: 10 } } });
  try {
    return inBuild(v840, () => {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-staged-"));
      try {
        const session = openSession(createProfileStore(dataDir), "player");
        takeUpSeason(session);
        buyBattlePass(session, seasonRewardFunctions());
        athenaQuestLogin(session);
        return run(session);
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });
  } finally {
    configureChallenges(undefined);
  }
}
const items = (session) => session.profile("athena").profile.items;
const held = (session, questId) => Object.entries(items(session)).find(([, item]) => item.templateId.toLowerCase() === `quest:${questId}`);
const bundleOf = (session) => Object.entries(items(session)).find(([, item]) => item.templateId === `ChallengeBundle:${week6}`);
const complete = (session, questId) => advanceAthenaObjectives(session, getAthenaQuest(questId).objectives.map(({ name, count }) => ({ statName: name, count })));

test("8.50's Fatal Fields stages: each stage's quest comes with the week's bundle, and the challenge counts once", () => {
  assert.deepEqual(inBuild(v840, () => getAthenaQuest(stages[0]).rewards.at(-1)), { quantity: 1, templateId: "Quest:quest_br_land_chain_03b" });
  withSession((session) => {
    const [bundleId, bundle] = bundleOf(session);
    assert.ok(bundle.attributes.grantedquestinstanceids.includes(held(session, stages[0])[0]), "the first stage is given with the bundle");
    assert.equal(held(session, stages[1]), undefined);
    const listed = bundle.attributes.grantedquestinstanceids.length;
    stages.forEach((stage, index) => {
      complete(session, stage);
      const [stageId, item] = held(session, stage);
      assert.equal(item.attributes.quest_state, "Claimed", `${stage} is collected as it completes`);
      const next = stages[index + 1];
      if (!next) return;
      const [nextId, nextItem] = held(session, next);
      assert.equal(nextItem.attributes.quest_state, "Active");
      assert.equal(nextItem.attributes.challenge_bundle_id, bundleId, `${next} belongs to the bundle`);
      // Item ids, which the challenges tab follows to the stage it shows (CoreV2 #709).
      assert.equal(nextItem.attributes.challenge_linked_quest_parent, stageId);
      assert.equal(item.attributes.challenge_linked_quest_given, nextId);
      assert.equal(items(session)[bundleId].attributes.num_quests_completed, 0, `the challenge isn't done at ${stage}`);
      assert.ok(items(session)[bundleId].attributes.grantedquestinstanceids.includes(nextId));
      assert.equal(items(session)[bundleId].attributes.grantedquestinstanceids.length, listed + index + 1);
      assert.equal(items(session)[bundleId].attributes.num_granted_bundle_quests, listed + index + 1);
      assert.ok(stageId);
    });
    // Seven challenges in the week; the chain is one of them, done as its last stage is.
    assert.equal(items(session)[bundleId].attributes.num_quests_completed, 1);
  });
});

test("8.50's stages: the next stage a player holds outside its bundle (collected before the link was made) is linked at the next login", () => {
  withSession((session) => {
    const [bundleId] = bundleOf(session);
    complete(session, stages[0]);
    const [nextId] = held(session, stages[1]);
    // The profile as it was kept before: the stage outside the bundle, with no bundle id.
    const tracker = session.profile("athena");
    tracker.setItemAttribute(nextId, "challenge_bundle_id", undefined);
    tracker.setItemAttribute(bundleId, "grantedquestinstanceids", items(session)[bundleId].attributes.grantedquestinstanceids.filter((id) => id !== nextId));
    settleChallengeSchedules(session, seasonRewardFunctions());
    assert.equal(items(session)[nextId].attributes.challenge_bundle_id, bundleId);
    assert.ok(items(session)[bundleId].attributes.grantedquestinstanceids.includes(nextId));
    claimAthenaQuest(session, held(session, stages[0])[0]);
    assert.equal(Object.values(items(session)).filter((item) => item.templateId.toLowerCase() === `quest:${stages[1]}`).length, 1, "no second item");
  });
});

test("8.50's stages: a stage left at 1/1 Active or Completed, or Claimed without its next stage, is finished at the quest login and gives the next one", () => {
  const states = [
    ["Active", (tracker, itemId) => tracker.setItemAttribute(itemId, "completion_battlepass_land_athena_location_fatal_03_a", 1)],
    ["Completed", (tracker, itemId) => {
      tracker.setItemAttribute(itemId, "completion_battlepass_land_athena_location_fatal_03_a", 1);
      tracker.setItemAttribute(itemId, "quest_state", "Completed");
    }],
    ["Claimed", (tracker, itemId) => {
      tracker.setItemAttribute(itemId, "completion_battlepass_land_athena_location_fatal_03_a", 1);
      tracker.setItemAttribute(itemId, "quest_state", "Claimed");
    }]
  ];
  for (const [state, leave] of states) {
    withSession((session) => {
      const tracker = session.profile("athena");
      const [firstId] = held(session, stages[0]);
      leave(tracker, firstId);
      assert.equal(held(session, stages[1]), undefined, state);
      athenaQuestLogin(session);
      assert.equal(items(session)[firstId].attributes.quest_state, "Claimed", state);
      const [nextId, next] = held(session, stages[1]) ?? [];
      assert.ok(next, `${state}: the next stage is given`);
      assert.equal(next.attributes.challenge_bundle_id, bundleOf(session)[0]);
      assert.ok(bundleOf(session)[1].attributes.grantedquestinstanceids.includes(nextId));
      athenaQuestLogin(session);
      assert.equal(Object.values(items(session)).filter((item) => item.templateId.toLowerCase() === `quest:${stages[1]}`).length, 1, "given once");
    });
  }
});

test("8.50's stages linked by template id before #709 are linked by item id at the next login", () => {
  withSession((session) => {
    complete(session, stages[0]);
    const [firstId] = held(session, stages[0]);
    const [nextId, next] = held(session, stages[1]);
    const tracker = session.profile("athena");
    tracker.setItemAttribute(firstId, "challenge_linked_quest_given", next.templateId);
    tracker.setItemAttribute(nextId, "challenge_linked_quest_parent", items(session)[firstId].templateId);
    settleChallengeSchedules(session, seasonRewardFunctions());
    assert.equal(items(session)[firstId].attributes.challenge_linked_quest_given, nextId);
    assert.equal(items(session)[nextId].attributes.challenge_linked_quest_parent, firstId);
  });
});

// CoreV2 #709: 6.21's Fortnitemares Part 3 "Visit Wailing Woods, Fatal Fields and Haunted Hills" (Quest_FNM_Visit_Chain1_
// WailingWoods to _Chain3_HauntedHills). Wailing Woods done, the tab showed stage 1 checked and the part's "complete all"
// reward (the Green Flame contrail) came with the other three challenges, stages 2 and 3 still to do.
test("6.21's Fortnitemares Part 3: the staged visits show their next stage, and the part is complete at Haunted Hills", () => {
  const v621 = "4526925";
  const chain = ["quest_fnm_visit_chain1_wailingwoods", "quest_fnm_visit_chain2_fatalfields", "quest_fnm_visit_chain3_hauntedhills"];
  const others = ["quest_fnm_elim_ai_brute", "quest_fnm_dam_explosiveweapons_ai", "quest_fnm_interact_chests_location_corruptedareas"];
  const contrail = "AthenaSkyDiveContrail:trails_id_31_greenflame";
  configureEvents({ mode: "auto", seasonStarts: { 6: "2018-09-27" } });
  mock.timers.enable({ apis: ["Date"], now: new Date("2018-11-03T12:00:00Z") });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-staged-621-"));
  try {
    inBuild(v621, () => {
      const session = openSession(createProfileStore(dataDir), "fnm621");
      athenaQuestLogin(session);
      const part3 = Object.entries(items(session)).find(([, item]) => item.templateId === "ChallengeBundle:questbundle_fortnitemares_part3");
      assert.ok(part3, "Part 3 is given");
      const [bundleId] = part3;
      const hasContrail = () => Object.values(items(session)).some((item) => item.templateId.toLowerCase() === contrail.toLowerCase());
      for (const questId of others) complete(session, questId);
      complete(session, chain[0]);
      const [firstId] = held(session, chain[0]);
      const [secondId, second] = held(session, chain[1]);
      assert.equal(second.attributes.quest_state, "Active");
      assert.equal(items(session)[firstId].attributes.challenge_linked_quest_given, secondId);
      assert.equal(held(session, chain[2]), undefined, "only the next stage is given");
      assert.equal(items(session)[bundleId].attributes.num_quests_completed, 3);
      assert.equal(hasContrail(), false, "the part isn't complete at stage 1");
      complete(session, chain[1]);
      assert.equal(held(session, chain[2])[1].attributes.quest_state, "Active");
      assert.equal(hasContrail(), false);
      complete(session, chain[2]);
      assert.equal(items(session)[bundleId].attributes.num_quests_completed, 4);
      assert.equal(items(session)[bundleId].attributes.num_progress_quests_completed, 4);
      assert.equal(hasContrail(), true, "the part's reward comes with the last stage");
    });
  } finally {
    mock.timers.reset();
    configureEvents(null);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
