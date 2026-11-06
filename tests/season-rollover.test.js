import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { resetBattlePass } from "../src/battlepass/reset.js";
import { advanceAthenaObjectives, athenaQuestLogin, seasonRewardFunctions } from "../src/profiles/athena.js";
import { buyBattlePass, seasonNeedsSwitch } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";

// A new season's first login retires the last season's challenges (profiles/seasons.js settleSeasonItems): a Season 3
// profile on 4.0, then back on 3.6.
const v36 = "4019403";
const v40 = "4039451";
const daily = "athenadaily_solo_top50";

const typeOf = (item) => item.templateId.split(":")[0].toLowerCase();
const idOf = (item) => item.templateId.split(":")[1].toLowerCase();
const held = (profile, type) => Object.entries(profile.items).filter(([, item]) => typeOf(item) === type.toLowerCase());
const heldIds = (profile, type) => held(profile, type).map(([, item]) => idOf(item)).sort();
const challengeItems = (profile) => ["ChallengeBundleSchedule", "ChallengeBundle"].flatMap((type) => held(profile, type));

function withAccount(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-rollover-"));
  try {
    const store = createProfileStore(dataDir);
    // A lobby login on a build: the profile is set up (and its season taken up) as it opens, then the quest login.
    const login = (build, then = () => {}) => inBuild(build, () => {
      const session = openSession(store, "rollover");
      const tracker = session.profile("athena");
      athenaQuestLogin(session);
      const result = then(session, tracker.profile);
      session.commit();
      return result;
    });
    return run(login);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// A Season 3 player: the Battle Pass and its challenges, a week's challenge done, and a daily challenge.
function playSeasonThree(login) {
  return login(v36, (session, profile) => {
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    seasonRewardFunctions().grantAthenaQuest(session.profile("athena"), daily);
    const [, week1] = held(profile, "ChallengeBundle").find(([, item]) => idOf(item) === "s3_week1_questbundle");
    const [questId] = week1.attributes.grantedquestinstanceids;
    const objectives = Object.keys(profile.items[questId].attributes).filter((name) => name.startsWith("completion_"));
    advanceAthenaObjectives(session, objectives.map((name) => ({ statName: name.slice("completion_".length), count: 1000 })));
    return { questId, state: profile.items[questId].attributes.quest_state, stats: { ...profile.stats.attributes } };
  });
}

test("a Season 3 profile's first 4.0 login retires Season 3's challenges and keeps the locker, level, dailies and past season", () => withAccount((login) => {
  const before = playSeasonThree(login);
  assert.notEqual(before.state, "Active", "a Season 3 challenge was done");
  const s3 = login(v36, (session, profile) => ({ schedules: heldIds(profile, "ChallengeBundleSchedule"), items: { ...profile.items } }));
  assert.ok(s3.schedules.includes("season3_challenge_schedule"));
  const cosmetics = Object.keys(s3.items).filter((id) => /^athena/i.test(s3.items[id].templateId));

  login(v40, (session, profile) => {
    const { attributes } = profile.stats;
    assert.equal(attributes.season_num, 4);
    assert.ok(!heldIds(profile, "ChallengeBundleSchedule").some((id) => id.startsWith("season3")), "no Season 3 schedule");
    assert.ok(!heldIds(profile, "ChallengeBundle").some((id) => id.startsWith("s3_")), "no Season 3 bundle");
    assert.ok(!profile.items[before.questId], "no Season 3 bundle quest");
    // Every quest left is the account's (a daily) or Season 4's.
    const s3QuestIds = Object.keys(s3.items).filter((id) => typeOf(s3.items[id]) === "quest" && s3.items[id].attributes.challenge_bundle_id);
    assert.ok(s3QuestIds.length > 0 && s3QuestIds.every((id) => !profile.items[id]));
    assert.ok(held(profile, "Quest").some(([, item]) => idOf(item) === daily), "the daily stays");
    for (const id of cosmetics) assert.ok(profile.items[id], `${id} stays in the locker`);
    // Season 3 is recorded in past_seasons, with its level and Battle Pass.
    const past = attributes.past_seasons.find((entry) => entry.seasonNumber === 3);
    assert.deepEqual([past.seasonLevel, past.bookLevel, past.purchasedVIP], [before.stats.level, before.stats.book_level, true]);
    assert.equal(attributes.accountLevel, attributes.level + attributes.past_seasons.reduce((sum, entry) => sum + entry.seasonLevel, 0));
    // Season 3's items wait, Core's, unsent.
    assert.ok(Object.keys(profile.coreSeasonItems[3]).includes(before.questId));
    // Season 4's own challenges come with its pass.
    buyBattlePass(session, seasonRewardFunctions());
    assert.ok(heldIds(profile, "ChallengeBundleSchedule").includes("season4_challenge_schedule"));
    assert.ok(heldIds(profile, "ChallengeBundle").includes("questbundle_s4_week_001"));
    assert.equal(seasonNeedsSwitch(profile), false, "nothing more to settle");
  });

  // Back on 3.6: Season 3's challenges come back as they were, Season 4's go aside; 4.0 swaps them again.
  login(v36, (session, profile) => {
    assert.equal(profile.stats.attributes.season_num, 3);
    assert.deepEqual(heldIds(profile, "ChallengeBundleSchedule"), s3.schedules);
    assert.equal(profile.items[before.questId].attributes.quest_state, before.state, "its progress kept");
    assert.ok(!heldIds(profile, "ChallengeBundle").some((id) => id.startsWith("questbundle_s4")), "no Season 4 bundle");
    assert.ok(held(profile, "Quest").some(([, item]) => idOf(item) === daily), "the daily stays");
    assert.equal(profile.coreSeasonItems[3], undefined);
    assert.ok(Object.keys(profile.coreSeasonItems[4]).length > 0);
  });
  login(v40, (session, profile) => {
    assert.ok(heldIds(profile, "ChallengeBundleSchedule").includes("season4_challenge_schedule"));
    assert.ok(!profile.items[before.questId]);
    assert.equal(profile.stats.attributes.book_purchased, true, "Season 4's pass is still bought");
  });
}));

test("a profile that took Season 4 up before the fix still holding Season 3's challenges has them put aside at its next login", () => withAccount((login) => {
  const before = playSeasonThree(login);
  login(v40);
  // What a 4.0 login before the fix left: Season 3's challenges in a Season 4 profile.
  login(v40, (session, profile) => {
    for (const [id, item] of Object.entries(profile.coreSeasonItems[3])) profile.items[id] = item;
    delete profile.coreSeasonItems[3];
    session.profile("athena").setStat("season_num", 4);
  });
  login(v40, (session, profile) => {
    assert.ok(!profile.items[before.questId]);
    assert.ok(!heldIds(profile, "ChallengeBundleSchedule").some((id) => id.startsWith("season3")));
  });
  login(v36, (session, profile) => assert.equal(profile.items[before.questId].attributes.quest_state, before.state));
}));

test("a player who stays on Season 3 keeps every challenge", () => withAccount((login) => {
  playSeasonThree(login);
  const first = login(v36, (session, profile) => Object.keys(profile.items).sort());
  const again = login(v36, (session, profile) => {
    assert.equal(profile.coreSeasonItems, undefined);
    return Object.keys(profile.items).sort();
  });
  assert.deepEqual(again, first);
}));

test("the admin panel's Season 3 Battle Pass reset takes the tiers' challenges out of a Season 3 set aside", () => withAccount((login) => {
  playSeasonThree(login);
  login(v40, (session, profile) => {
    // A Season 3 tier challenge schedule the free tier 2 gave, held aside.
    const aside = profile.coreSeasonItems[3];
    aside["tier2-schedule"] = { templateId: "ChallengeBundleSchedule:season3_tier_2_schedule", attributes: { granted_bundles: [] }, quantity: 1 };
    profile.coreSeasonRewards["3"].free = 2;
    const result = resetBattlePass(session, 3);
    assert.ok(result.challenges > 0);
    assert.equal(aside["tier2-schedule"], undefined);
    assert.deepEqual(Object.values(aside).filter((item) => typeOf(item) === "challengebundleschedule").map(idOf), ["season3_challenge_schedule"]);
  });
}));
