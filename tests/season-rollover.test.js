import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { resetBattlePass } from "../src/battlepass/reset.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { addSeasonXp, advanceAthenaObjectives, athenaQuestLogin, grantCosmetic, seasonRewardFunctions } from "../src/profiles/athena.js";
import { heldGiftBoxes } from "../src/profiles/giftboxes.js";
import { buyBattlePass, buyTiers, inProfileSeason, seasonNeedsSwitch, takeUpSeason } from "../src/profiles/seasons.js";
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
    // A request that names no build (CoreV2's match report, the admin panel): the profile as it opens, no quest login.
    login.noBuild = (then) => {
      const session = openSession(store, "rollover");
      const result = then(session, session.profile("athena").profile);
      session.commit();
      return result;
    };
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

// Season 4 to Season 5 (5.0, CL-4214610), as Season 3 to 4: a Season 4 profile on 4.5, then 5.0, then back.
const v45 = "4166199";
const v50 = "4214610";
const v500 = "4204761";
const finish = (session, profile, itemIds) => advanceAthenaObjectives(session, itemIds.flatMap((id) => Object.keys(profile.items[id].attributes)
  .filter((name) => name.startsWith("completion_")).map((name) => ({ statName: name.slice("completion_".length), count: 100000 }))));
const bundleQuests = (profile, bundleId) => {
  const held = Object.values(profile.items).find((item) => item.templateId.toLowerCase() === `challengebundle:${bundleId}`);
  return held ? held.attributes.grantedquestinstanceids.map((id) => profile.items[id] ? idOf(profile.items[id]) : null) : null;
};

function playSeasonFour(login) {
  return login(v45, (session, profile) => {
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    seasonRewardFunctions().grantAthenaQuest(session.profile("athena"), daily);
    const [, week1] = held(profile, "ChallengeBundle").find(([, item]) => idOf(item) === "questbundle_s4_week_001");
    const [questId] = week1.attributes.grantedquestinstanceids;
    finish(session, profile, [questId]);
    return { questId, state: profile.items[questId].attributes.quest_state, stats: { ...profile.stats.attributes } };
  });
}

test("a Season 4 profile's first 5.0 login retires Season 4's challenges, starts Season 5 at level 1 and gives every player the free weeks", () => withAccount((login) => {
  const before = playSeasonFour(login);
  assert.notEqual(before.state, "Active");
  const s4 = login(v45, (session, profile) => ({ schedules: heldIds(profile, "ChallengeBundleSchedule"), items: { ...profile.items } }));
  assert.ok(s4.schedules.includes("season4_challenge_schedule"));
  const cosmetics = Object.keys(s4.items).filter((id) => /^athena/i.test(s4.items[id].templateId));

  login(v50, (session, profile) => {
    const { attributes } = profile.stats;
    assert.equal(attributes.season_num, 5);
    assert.equal(attributes.level, 1, "Season 5's level starts again");
    assert.equal(attributes.xp, 0);
    assert.equal(attributes.book_purchased, false);
    // Season 4's Battle Pass gave its next-season tier tokens: Season 5 starts 5 tiers in.
    assert.equal(attributes.book_level, 6);
    assert.ok(!heldIds(profile, "ChallengeBundleSchedule").some((id) => id.startsWith("season4")), "no Season 4 schedule");
    assert.ok(!heldIds(profile, "ChallengeBundle").some((id) => id.includes("_s4_")), "no Season 4 bundle");
    assert.ok(!profile.items[before.questId]);
    assert.ok(Object.keys(profile.coreSeasonItems[4]).includes(before.questId), "Season 4's items wait");
    assert.ok(held(profile, "Quest").some(([, item]) => idOf(item) === daily), "the daily stays");
    for (const id of cosmetics) assert.ok(profile.items[id], `${id} stays in the locker`);
    const past = attributes.past_seasons.find((entry) => entry.seasonNumber === 4);
    assert.deepEqual([past.seasonLevel, past.bookLevel, past.purchasedVIP], [before.stats.level, before.stats.book_level, true]);
    assert.equal(attributes.accountLevel, attributes.level + attributes.past_seasons.reduce((sum, entry) => sum + entry.seasonLevel, 0));
    // Every player's free weekly challenges (SeasonGrantsToEveryone): week 1's first three without the pass.
    assert.deepEqual(heldIds(profile, "ChallengeBundleSchedule"), ["season5_free_schedule"]);
    assert.deepEqual(bundleQuests(profile, "questbundle_s5_week_001"), ["quest_br_damage_smg", "quest_br_interact_supplyllamas", "quest_br_eliminate_thrownweapon"]);
    // The pass gives the other four of each week held, the Road Trip and Drift's challenges.
    buyBattlePass(session, seasonRewardFunctions());
    assert.deepEqual(heldIds(profile, "ChallengeBundleSchedule"), ["season5_free_schedule", "season5_paid_schedule", "season5_progressivea_schedule"]);
    assert.equal(bundleQuests(profile, "questbundle_s5_week_001").length, 7);
    assert.ok(bundleQuests(profile, "questbundle_s5_week_001").includes("quest_br_eliminate_location_retailrow"));
    assert.equal(bundleQuests(profile, "questbundle_s5_cumulative").length, 7);
    assert.ok(Object.values(profile.items).some((item) => item.templateId.toLowerCase() === "athenacharacter:cid_161_athena_commando_m_drift"), "Drift");
    assert.equal(seasonNeedsSwitch(profile), false);
  });

  // Back on 4.5: Season 4's challenges come back with their progress, Season 5's go aside; 5.0 swaps them again.
  login(v45, (session, profile) => {
    assert.equal(profile.stats.attributes.season_num, 4);
    assert.deepEqual(heldIds(profile, "ChallengeBundleSchedule"), s4.schedules);
    assert.equal(profile.items[before.questId].attributes.quest_state, before.state);
    assert.ok(!heldIds(profile, "ChallengeBundleSchedule").some((id) => id.startsWith("season5")), "no Season 5 schedule");
    assert.ok(!heldIds(profile, "ChallengeBundle").some((id) => id.includes("_s5_")), "no Season 5 bundle");
    assert.equal(profile.stats.attributes.book_purchased, true, "Season 4's pass");
    assert.ok(Object.keys(profile.coreSeasonItems[5]).length > 0);
  });
  // CL-4204761 plays on CL-4214610's data: the same Season 5.
  login(v500, (session, profile) => {
    assert.equal(profile.stats.attributes.season_num, 5);
    assert.equal(bundleQuests(profile, "questbundle_s5_week_001").length, 7);
    assert.equal(profile.stats.attributes.book_purchased, true, "Season 5's pass is still bought");
    assert.ok(!profile.items[before.questId]);
  });
}));

// Season 5 to Season 6 (Core-Backend #334): the challenges that outlast their season. AthenaSeason5's
// TokensToRemoveAtSeasonEnd takes its weeks and the Road Trip, not Season5_ProgressiveA_Schedule and
// Season5_ProgressiveB_Schedule (Drift's and Ragnarok's), so 6.01's and 6.02's data keep them past Season 5
// (athena.json's keptPastSeason, tools/extractor) and a Season 5 pass owner who hasn't finished them goes on in Season 6.
const v541 = "4363240";
const v600 = "4402180";
const v601 = "4424678";
const v6010 = "4417689";
const v602 = "4461277";
const v6020 = "4442095";
// 6.10's three changelists (tests/build610.test.js): its data keeps the same two schedules.
const builds610 = ["4480234", "4476098", "4464155"];
const drift = "AthenaCharacter:cid_161_athena_commando_m_drift";
const ragnarok = "AthenaCharacter:cid_165_athena_commando_m_darkviking";
const riftEdge = "AthenaPickaxe:pickaxe_id_068_drift";
const driftSchedule = "season5_progressivea_schedule";
const ragnarokSchedule = "season5_progressiveb_schedule";
const driftBundle = "questbundle_s5_progressivea";
const challengeCompleteBox = "GiftBox:gb_challengecomplete";
const itemsOf = (profile, templateId) => Object.values(profile.items).filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase());
const itemOf = (profile, templateId) => itemsOf(profile, templateId)[0];
const stagesOf = (profile, outfit) => itemOf(profile, outfit).attributes.variants.find(({ channel }) => channel === "Progressive").owned;
const driftStage = (profile, stage) => itemOf(profile, `Quest:quest_br_s5_gain_seasonxp_progressivea_0${stage}`);
const driftProgress = (profile) => [1, 2, 3, 4, 5].map((stage) => {
  const quest = driftStage(profile, stage);
  return quest ? [quest.attributes.quest_state, quest.attributes[`completion_athena_s5_season_gain_xp_progressive_a_0${stage}`]] : null;
});
const isSeasonFive = (item) => /season5_|_s5_|_s5w/.test(item.templateId.toLowerCase());
const s5Items = (profile) => Object.values(profile.items).filter(isSeasonFive).map((item) => item.templateId.toLowerCase()).sort();
const driftItems = ["challengebundle:questbundle_s5_progressivea", "challengebundleschedule:season5_progressivea_schedule",
  ...[1, 2, 3, 4, 5].map((stage) => `quest:quest_br_s5_gain_seasonxp_progressivea_0${stage}`)];
const boxesOf = (session, bundleId) => heldGiftBoxes(session.profile("profile0").profile).map(([, item]) => item)
  .filter((item) => item.templateId.toLowerCase() === challengeCompleteBox.toLowerCase() && item.attributes.params.HeaderTemplateId === `ChallengeBundle:${bundleId}`);

// A Season 5 player on 5.41: the Battle Pass (Drift and his challenges at tier 1) and 30,000 XP, which is Drift's first
// two stages (10,000 and 25,000 XP) and 30,000 of the others'.
function playSeasonFive(login, { xp = 30000, tiers = 0 } = {}) {
  return login(v541, (session, profile) => {
    buyBattlePass(session, seasonRewardFunctions());
    if (tiers) buyTiers(session, tiers, seasonRewardFunctions());
    athenaQuestLogin(session);
    addSeasonXp(session, xp);
    return { stats: { ...profile.stats.attributes }, drift: driftProgress(profile), stages: [...stagesOf(profile, drift)], items: s5Items(profile) };
  });
}

test("the data: 6.01 and 6.02 keep Season 5's Drift and Ragnarok schedules past its end and nothing of Seasons 3 and 4; 6.00's and the earlier seasons' don't", () => {
  for (const build of [v601, v6010, v602, v6020, ...builds610]) {
    inBuild(build, () => {
      const schedules = athenaChallengeSchedules();
      assert.deepEqual(Object.entries(schedules).filter(([, schedule]) => schedule.keptPastSeason !== undefined).map(([id, schedule]) => [id, schedule.keptPastSeason]),
        [[driftSchedule, 5], [ragnarokSchedule, 5]], build);
      assert.deepEqual(schedules[driftSchedule], { bundles: [{ bundle: driftBundle, unlockType: "OnScheduleGranted", unlockValue: 0 }], category: "BattlePass",
        cleanUpOnBundleCompletion: true, keptPastSeason: 5 });
      // Their bundles come with them: five XP stages each and the harvesting tool at four, in GB_ChallengeComplete.
      for (const [bundleId, tool, counts] of [[driftBundle, riftEdge, [10000, 25000, 50000, 100000, 200000]],
        ["questbundle_s5_progressiveb", "AthenaPickaxe:pickaxe_id_069_darkviking", [35000, 75000, 125000, 250000, 500000]]]) {
        const bundle = athenaChallengeBundles()[bundleId];
        assert.deepEqual(bundle.quests.map(({ quest }) => getAthenaQuest(quest).objectives.map(({ itemEvent, count }) => [itemEvent, count])),
          counts.map((count) => [["HasGainedAthenaSeasonXp", count]]));
        assert.deepEqual(bundle.completionSteps, [{ count: 4, rewards: [{ giftBox: challengeCompleteBox, quantity: 1, templateId: tool }] }]);
      }
      // Season 6's own end takes its weeks and the Hunting Party; Calamity's and Dire's aren't named either.
      assert.deepEqual(athenaSeason().removedAtSeasonEnd.filter((id) => id.startsWith("ChallengeBundleSchedule:")),
        ["ChallengeBundleSchedule:season6_free_schedule", "ChallengeBundleSchedule:season6_paid_schedule"]);
      // Nothing of Season 3's or 4's: those seasons take every schedule they give (Carbide's, Omega's, Blockbuster).
      assert.deepEqual(Object.keys(schedules).filter((id) => /^season[34]_/.test(id)), []);
    });
  }
  // Season 5's own data gives them by its tiers, beside the outfits, and doesn't take them back.
  inBuild(v541, () => {
    const season = athenaSeason();
    const paid = (level) => season.bookPaidRewards.find((entry) => entry.level === level).rewards.map(({ templateId }) => templateId);
    assert.ok(paid(1).includes(`ChallengeBundleSchedule:${driftSchedule}`) && paid(1).includes(drift));
    assert.ok(paid(100).includes(`ChallengeBundleSchedule:${ragnarokSchedule}`) && paid(100).includes(ragnarok));
    assert.deepEqual(season.removedAtSeasonEnd.filter((id) => id.startsWith("ChallengeBundleSchedule:")),
      ["ChallengeBundleSchedule:season5_free_schedule", "ChallengeBundleSchedule:season5_paid_schedule"]);
  });
  // 6.00's overlay predates it (its paks aren't at hand), and no earlier build's data keeps another season's schedule.
  for (const build of [v600, "4395664", v541, v50, v45, v40, v36]) {
    assert.equal(Object.values(inBuild(build, athenaChallengeSchedules)).some((schedule) => schedule.keptPastSeason !== undefined), false, build);
  }
});

test("a Season 5 pass owner's unfinished Drift challenges are still theirs on 6.01 and 6.02, as they stood, and Season 6's XP counts on", () => {
  for (const build of [v602, v6020, v601, v6010, ...builds610]) {
    withAccount((login) => {
      const before = playSeasonFive(login);
      assert.deepEqual(before.drift, [["Claimed", 10000], ["Claimed", 25000], ["Active", 30000], ["Active", 30000], ["Active", 30000]]);
      assert.deepEqual(before.stages, ["Stage0", "Stage1", "Stage2"]);

      login(build, (session, profile) => {
        assert.equal(profile.stats.attributes.season_num, 6, build);
        assert.equal(profile.stats.attributes.level, 1, "Season 6's own level");
        // Drift's schedule, its bundle and the five challenges are the profile's, as they were; the rest of Season 5 waits.
        assert.deepEqual(s5Items(profile), driftItems);
        assert.deepEqual(driftProgress(profile), before.drift);
        const [scheduleId, schedule] = held(profile, "ChallengeBundleSchedule").find(([, item]) => idOf(item) === driftSchedule);
        const [bundleId, bundle] = held(profile, "ChallengeBundle").find(([, item]) => idOf(item) === driftBundle);
        assert.deepEqual(schedule.attributes.granted_bundles, [bundleId]);
        assert.equal(bundle.attributes.challenge_bundle_schedule_id, scheduleId);
        assert.equal(bundle.attributes.num_quests_completed, 2);
        assert.equal(driftStage(profile, 3).attributes.challenge_bundle_id, bundleId);
        const aside = Object.values(profile.coreSeasonItems[5]).map((item) => item.templateId.toLowerCase());
        assert.ok(aside.includes("challengebundleschedule:season5_free_schedule") && aside.includes("challengebundleschedule:season5_paid_schedule"));
        assert.ok(!aside.some((id) => id.includes("progressivea")), "none of Drift's is aside");
        assert.equal(seasonNeedsSwitch(profile), false, "nothing more to settle");
        assert.deepEqual(stagesOf(profile, drift), before.stages, "the stages earned stay");

        // 20,000 XP in Season 6: the third stage's 50,000 is reached from its 30,000.
        addSeasonXp(session, 20000);
        assert.deepEqual(driftProgress(profile), [["Claimed", 10000], ["Claimed", 25000], ["Claimed", 50000], ["Active", 50000], ["Active", 50000]]);
        assert.deepEqual(stagesOf(profile, drift), ["Stage0", "Stage1", "Stage2", "Stage3"]);
        assert.equal(itemOf(profile, riftEdge), undefined, "three of five");
        // 50,000 more: the fourth, and the bundle's harvesting tool at four, in the box its data names.
        addSeasonXp(session, 50000);
        assert.deepEqual(stagesOf(profile, drift), ["Stage0", "Stage1", "Stage2", "Stage3", "Stage4"]);
        assert.ok(itemOf(profile, riftEdge), "Rift Edge at four stages");
        assert.deepEqual(boxesOf(session, driftBundle).map((box) => box.attributes.lootList.map(({ itemType }) => itemType)), [[riftEdge]]);
        athenaQuestLogin(session);
        assert.equal(held(profile, "ChallengeBundleSchedule").filter(([, item]) => idOf(item) === driftSchedule).length, 1, "four of five isn't all of them");
      });

      // Back on 5.41 they are Season 5's as ever, with what Season 6 added; Season 6 has them still.
      login(v541, (session, profile) => {
        assert.equal(profile.stats.attributes.season_num, 5);
        assert.equal(profile.stats.attributes.level, before.stats.level);
        assert.deepEqual(driftProgress(profile), [["Claimed", 10000], ["Claimed", 25000], ["Claimed", 50000], ["Claimed", 100000], ["Active", 100000]]);
        assert.deepEqual(s5Items(profile), before.items, "every Season 5 challenge item, once");
      });
      login(build, (session, profile) => {
        assert.deepEqual(s5Items(profile), driftItems);
        assert.deepEqual(driftProgress(profile), [["Claimed", 10000], ["Claimed", 25000], ["Claimed", 50000], ["Claimed", 100000], ["Active", 100000]]);
        // The last stage: nothing is given twice, and the finished schedule is cleaned up as its data says.
        addSeasonXp(session, 100000);
        assert.deepEqual(stagesOf(profile, drift), ["Stage0", "Stage1", "Stage2", "Stage3", "Stage4", "Stage5"]);
        assert.equal(boxesOf(session, driftBundle).length, 1, "the harvesting tool's box came once");
        assert.equal(itemsOf(profile, riftEdge).length, 1);
        athenaQuestLogin(session);
        assert.deepEqual(s5Items(profile), [], "all five done: the schedule goes with its bundle and challenges");
        assert.ok(profile.coreCleanedUpSchedules.includes(driftSchedule));
        assert.equal(stagesOf(profile, drift).length, 6, "what they gave stays");
      });
      // Season 5's tiers don't give it again, and the rest of Season 5 is as it was.
      login(v541, (session, profile) => {
        assert.deepEqual(s5Items(profile), before.items.filter((id) => !driftItems.includes(id)));
        assert.equal(stagesOf(profile, drift).length, 6);
      });
    });
  }
});

test("Drift's and Ragnarok's challenges put aside by a Season 6 login before #334 come back at the next 6.02 login, once", () => withAccount((login) => {
  // Tier 100: Ragnarok and his challenges too. 40,000 XP is his first stage (35,000) and Drift's first two (Drift's
  // also counted the 5,000 XP a tier on the way gave).
  const before = playSeasonFive(login, { xp: 40000, tiers: 99 });
  assert.ok(before.items.includes(`challengebundleschedule:${ragnarokSchedule}`));
  assert.deepEqual(before.drift, [["Claimed", 10000], ["Claimed", 25000], ["Active", 45000], ["Active", 45000], ["Active", 45000]]);
  login(v602);
  // What a 6.02 login left before: every Season 5 challenge item aside.
  login(v602, (session, profile) => {
    const tracker = session.profile("athena");
    for (const [id, item] of Object.entries(profile.items).filter(([, held]) => isSeasonFive(held))) {
      profile.coreSeasonItems[5][id] = item;
      tracker.removeItem(id);
    }
    assert.deepEqual(s5Items(profile), []);
  });
  const back = login(v602, (session, profile) => {
    assert.deepEqual(s5Items(profile).filter((id) => !id.startsWith("quest:")), ["challengebundle:questbundle_s5_progressivea", "challengebundle:questbundle_s5_progressiveb",
      `challengebundleschedule:${driftSchedule}`, `challengebundleschedule:${ragnarokSchedule}`]);
    assert.equal(s5Items(profile).filter((id) => id.startsWith("quest:")).length, 10);
    assert.deepEqual(driftProgress(profile), before.drift);
    assert.equal(itemOf(profile, "Quest:quest_br_s5_gain_seasonxp_progressiveb_02").attributes.completion_athena_s5_season_gain_xp_progressive_b_02, 40000);
    assert.deepEqual(stagesOf(profile, ragnarok), ["Stage0", "Stage1"]);
    assert.ok(!Object.values(profile.coreSeasonItems[5]).some((item) => /progressive/.test(item.templateId.toLowerCase())));
    assert.ok(Object.keys(profile.coreSeasonItems[5]).length > 0, "the weeks and the Road Trip still wait");
    assert.equal(seasonNeedsSwitch(profile), false);
    return Object.keys(profile.items).sort();
  });
  assert.deepEqual(login(v602, (session, profile) => Object.keys(profile.items).sort()), back, "nothing more moves");
  // Ragnarok's count Season 6's XP as Drift's do.
  login(v602, (session, profile) => {
    addSeasonXp(session, 35000);
    assert.deepEqual(stagesOf(profile, ragnarok), ["Stage0", "Stage1", "Stage2"]);
    assert.deepEqual(stagesOf(profile, drift), ["Stage0", "Stage1", "Stage2", "Stage3"]);
  });
}));

test("a build whose data keeps no schedule leaves Season 5's aside: 6.00 as before, and 4.5 puts Drift's aside for 6.02 to bring back", () => withAccount((login) => {
  const before = playSeasonFive(login);
  // 6.00's overlay predates the extractor's change: Drift's wait with the rest of Season 5, as they did.
  login(v600, (session, profile) => {
    assert.equal(profile.stats.attributes.season_num, 6);
    assert.deepEqual(s5Items(profile), []);
    assert.ok(Object.values(profile.coreSeasonItems[5]).some((item) => item.templateId.toLowerCase() === `challengebundleschedule:${driftSchedule}`));
    assert.equal(seasonNeedsSwitch(profile), false);
  });
  // A request that names no build (CoreV2's match report, the admin panel) moves them neither way.
  login.noBuild((session, profile) => {
    assert.deepEqual(s5Items(profile), [], "still aside");
    assert.equal(seasonNeedsSwitch(profile), false);
  });
  login(v602, (session, profile) => assert.deepEqual(driftProgress(profile), before.drift));
  login.noBuild((session, profile) => {
    assert.equal(seasonNeedsSwitch(profile), false);
    assert.deepEqual(s5Items(profile), driftItems, "still the profile's");
    assert.deepEqual(driftProgress(profile), before.drift);
    // A match's XP reported without a build is read in the profile's season (battleroyale/recordresults): it counts too.
    inProfileSeason(profile, () => {
      takeUpSeason(session);
      addSeasonXp(session, 5000);
    });
    assert.deepEqual(driftProgress(profile).slice(2), [["Active", 35000], ["Active", 35000], ["Active", 35000]]);
    assert.deepEqual(s5Items(profile), driftItems);
  });
  before.drift = [["Claimed", 10000], ["Claimed", 25000], ["Active", 35000], ["Active", 35000], ["Active", 35000]];
  // Season 4's 4.5 has no Season 5: all of it aside, Drift's too; 6.02 brings his back and 5.41 has everything.
  login(v45, (session, profile) => {
    assert.deepEqual(s5Items(profile), []);
    assert.ok(Object.values(profile.coreSeasonItems[5]).some((item) => item.templateId.toLowerCase() === `challengebundle:${driftBundle}`));
  });
  login(v602, (session, profile) => {
    assert.deepEqual(s5Items(profile), driftItems);
    assert.deepEqual(driftProgress(profile), before.drift);
  });
  login(v541, (session, profile) => {
    assert.deepEqual(s5Items(profile), before.items);
    assert.equal(profile.coreSeasonItems[5], undefined);
  });
}));

test("a Season 6 player who never had Season 5's pass gets none of its challenges, with Drift in the locker or without", () => {
  for (const build of [v602, v601, builds610[0]]) {
    withAccount((login) => {
      const fresh = login(build, (session, profile) => {
        buyBattlePass(session, seasonRewardFunctions());
        athenaQuestLogin(session);
        addSeasonXp(session, 30000);
        assert.deepEqual(s5Items(profile), []);
        assert.equal(profile.coreSeasonItems, undefined);
        return { schedules: heldIds(profile, "ChallengeBundleSchedule"), bundles: heldIds(profile, "ChallengeBundle") };
      });
      assert.deepEqual(fresh.schedules, ["season6_free_schedule", "season6_paid_schedule", "season6_progressivea_schedule"], build);
      assert.ok(fresh.bundles.every((id) => id.startsWith("questbundle_s6_")), "Season 6's own");
      // Drift from the admin panel isn't Season 5's pass: no tier gave the schedule, so there is none to keep.
      login(build, (session, profile) => {
        grantCosmetic(session, drift);
        athenaQuestLogin(session);
        addSeasonXp(session, 30000);
        assert.deepEqual(s5Items(profile), []);
        assert.deepEqual(heldIds(profile, "ChallengeBundleSchedule"), fresh.schedules);
        assert.deepEqual(stagesOf(profile, drift), ["Stage0"]);
      });
    });
  }
});

test("Season 4's Carbide and Omega challenges go at its end, as AthenaSeason4 says: a Season 5 or 6 login keeps none", () => withAccount((login) => {
  login(v45, (session, profile) => {
    buyBattlePass(session, seasonRewardFunctions());
    buyTiers(session, 99, seasonRewardFunctions());
    athenaQuestLogin(session);
    for (const bundle of ["questbundle_s4_progressivea", "questbundle_s4_progressiveb"]) assert.ok(heldIds(profile, "ChallengeBundle").includes(bundle), bundle);
  });
  for (const build of [v541, v602]) {
    login(build, (session, profile) => {
      assert.ok(!Object.values(profile.items).some((item) => /season4_|_s4_|levelup_seasonlevel_progressive/.test(item.templateId.toLowerCase())), build);
      assert.ok(Object.values(profile.coreSeasonItems[4]).some((item) => item.templateId.toLowerCase() === "challengebundle:questbundle_s4_progressiveb"));
    });
  }
}));

test("the admin panel's Season 5 Battle Pass reset takes Drift's challenges out of a Season 6 profile too", () => withAccount((login) => {
  playSeasonFive(login);
  login(v602, (session, profile) => {
    assert.ok(s5Items(profile).includes(`challengebundleschedule:${driftSchedule}`));
    const result = resetBattlePass(session, 5);
    assert.ok(result.challenges > 0);
    assert.deepEqual(s5Items(profile), []);
    assert.ok(!Object.values(profile.coreSeasonItems[5]).some((item) => /progressive/.test(item.templateId.toLowerCase())));
    athenaQuestLogin(session);
    assert.deepEqual(s5Items(profile), [], "and nothing gives them back in Season 6");
  });
}));
