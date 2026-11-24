import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { getAthenaQuest } from "../src/gamedata/athena.js";
import { advanceAthenaObjectives, athenaQuestLogin, claimAthenaQuest, seasonRewardFunctions } from "../src/profiles/athena.js";
import { configureChallenges, settleChallengeSchedules } from "../src/profiles/challenges.js";
import { openSession } from "../src/profiles/session.js";
import { buyBattlePass, takeUpSeason } from "../src/profiles/seasons.js";
import { createProfileStore } from "../src/profiles/store.js";

// Core-Backend #426: staged challenges ("Stage 1 of 5 - Land at Fatal Fields"). Completing a stage gives the next stage's
// quest, which belongs to the challenge's bundle: the challenges tab lists a bundle's quests (grantedquestinstanceids), so a
// next stage outside it was never shown and the stage done stayed on screen.
const v840 = "6005771";
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

test("8.40's Fatal Fields stages: each stage's quest comes with the week's bundle, and the challenge counts once", () => {
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
      assert.equal(nextItem.attributes.challenge_linked_quest_parent, item.templateId);
      assert.equal(item.attributes.challenge_linked_quest_given, nextItem.templateId);
      assert.ok(items(session)[bundleId].attributes.grantedquestinstanceids.includes(nextId));
      assert.equal(items(session)[bundleId].attributes.grantedquestinstanceids.length, listed + index + 1);
      assert.equal(items(session)[bundleId].attributes.num_granted_bundle_quests, listed + index + 1);
      assert.ok(stageId);
    });
    // Seven challenges in the week; the chain is one of them, done as its first stage is.
    assert.equal(items(session)[bundleId].attributes.num_quests_completed, 1);
  });
});

test("8.40's stages: the next stage a player holds outside its bundle (collected before the link was made) is linked at the next login", () => {
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
