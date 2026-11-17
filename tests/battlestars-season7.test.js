import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { getItem } from "../src/gamedata/items.js";
import { advanceAthenaObjectives, athenaQuestLogin, seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { battlePassGiftBox, giveGiftBox, heldGiftBoxes } from "../src/profiles/giftboxes.js";
import { findItem, grantItem } from "../src/profiles/items.js";
import { grant } from "../src/profiles/progress.js";
import { battleStarTemplateId, isBattleStars, settleSeasonPromise, takeUpSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";

// Core-Backend #381: Season 7's Battle Stars are AccountResource:AthenaBattleStar (7.00, CL-4629139, to 7.20), where 1.11
// to 6.31 had AthenaSeasonalBP. A season level's stars were granted as a profile0 item and shown in the GB_BattlePass box
// ("4 items have been unlocked!" over four Battle Stars cards), and a challenge's went nowhere.
const v700 = "4629139";
const v710 = "4667333";
const v720 = "4727874";
const v631 = "4573279";
const battleStar = "AccountResource:athenabattlestar";

const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-381-"));
  try {
    return inBuild(build, () => {
      const session = openSession(createProfileStore(dir), name);
      setUpAthena(session);
      takeUpSeason(session);
      return run(session);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const passBoxes = (session) => heldGiftBoxes(session.profile("profile0").profile).filter(([, item]) => item.templateId.toLowerCase() === battlePassGiftBox.toLowerCase());
const starsIn = (box) => box.attributes.lootList.filter((loot) => isBattleStars(loot.itemType));
const heldQuest = (session, questId) => Object.entries(session.profile("athena").profile.items)
  .find(([, item]) => item.templateId.toLowerCase() === `quest:${questId}`);
// Week 1's free "Search a Common, Uncommon, Rare, Epic and Legendary weapon" (5 Battle Stars) done.
const allRarities = ["common", "uncommon", "rare", "very_rare"].map((name) => ({ statName: `battlepass_collect_all_rarity_${name}`, count: 1 }))
  .concat({ statName: "battlepass_collect_all_super_rare", count: 1 });
// Week 1's free "Dance at forbidden locations" (5 Battle Stars) done: its 15 places.
const forbiddenDances = Array.from({ length: 15 }, (_, at) => ({ statName: `battlepass_dance_athena_location_forbidden_${String(at + 1).padStart(2, "0")}`, count: 1 }));
// The stars the pass holds: tiers of 10 (Season 7's BookXpCurve to tier 100) and those into the tier.
const passStars = (attributes) => ((attributes.book_level ?? 1) - 1) * 10 + (attributes.book_xp ?? 0);

test("#381: each build's Battle Stars, AthenaBattleStar from 7.00 and AthenaSeasonalBP before", () => {
  for (const build of [v700, v710, v720]) {
    assert.equal(inBuild(build, battleStarTemplateId), battleStar, build);
    assert.ok(inBuild(build, () => getItem(battleStar)), build);
    assert.equal(inBuild(build, () => getItem("AccountResource:athenaseasonalbp")), undefined, `${build} has no AthenaSeasonalBP`);
  }
  for (const build of [v631, "3807424", "3901517"]) assert.equal(inBuild(build, battleStarTemplateId), "AccountResource:athenaseasonalbp", build);
  assert.ok(isBattleStars("AccountResource:AthenaBattleStar") && isBattleStars("AccountResource:athenaseasonalbp"));
  assert.equal(isBattleStars("AccountResource:athenaseasonalxp"), false);
});

test("#381: 7.00's season levels give their Battle Stars to the pass, and the box lists the tier's reward, not the stars", () => withSession(v700, "levels700", (session) => {
  const { attributes } = session.profile("athena").profile.stats;
  // Levels 2 to 7: 2, 2, 2, 5, 2, 2 stars (AthenaSeason7's SeasonXpScheduleFree), 15 in all: tier 2 and 5 into it.
  seasonRewardFunctions().addSeasonXp(session, 2150);
  assert.equal(attributes.level, 7);
  assert.deepEqual([attributes.book_level, attributes.book_xp], [2, 5]);
  assert.equal(findItem(session.profile("profile0").profile, battleStar), undefined, "no Battle Stars item in profile0");
  const [[, box]] = passBoxes(session);
  assert.deepEqual(starsIn(box), []);
  assert.ok(box.attributes.lootList.some((loot) => loot.itemType.toLowerCase() === "athenadance:spid_067_ggsnowman"), "free tier 2's spray");
}));

test("#381: a 7.00 challenge's Battle Stars go to the pass", () => withSession(v700, "challenge700", (session) => {
  athenaQuestLogin(session);
  const { attributes } = session.profile("athena").profile.stats;
  const before = passStars(attributes);
  advanceAthenaObjectives(session, allRarities);
  assert.equal(heldQuest(session, "quest_br_collect_item_all_rarity")[1].attributes.quest_state, "Claimed");
  assert.equal(passStars(attributes), before + 5);
}));

test("#381: Season 7's stars from before the fix are paid once: the stray item's and the collected challenges'", () => withSession(v700, "repair700", (session) => {
  athenaQuestLogin(session);
  const athena = session.profile("athena").profile;
  const { attributes } = athena.stats;
  // A profile from before: no note of the settlement, a challenge collected without its stars, and four levels' stars
  // (2, 5, 2, 2) granted to profile0 and listed in a box the client hasn't taken.
  athena.coreMigrations = (athena.coreMigrations ?? []).filter((name) => name !== "season7BattleStars");
  const [collectedId, collected] = heldQuest(session, "quest_br_collect_item_all_rarity");
  for (const { statName } of allRarities) collected.attributes[`completion_${statName}`] = 1;
  collected.attributes.quest_state = "Claimed";
  assert.equal(passBoxes(session).length, 0);
  const stray = [2, 5, 2, 2].flatMap((stars) => grantItem(session, battleStar, stars));
  giveGiftBox(session, battlePassGiftBox, stray);
  assert.deepEqual(starsIn(passBoxes(session)[0][1]).map(({ quantity }) => quantity), [2, 5, 2, 2], "the screen of #381");
  const before = passStars(attributes);

  athenaQuestLogin(session);
  assert.equal(passStars(attributes), before + 11 + 5, "11 from the levels, 5 from the challenge");
  assert.equal(findItem(session.profile("profile0").profile, battleStar), undefined, "the stray item is gone");
  const boxes = passBoxes(session);
  assert.equal(boxes.length, 1);
  assert.deepEqual(starsIn(boxes[0][1]), [], "its cards are gone from the box");
  assert.ok(boxes[0][1].attributes.lootList.some((loot) => loot.itemType.toLowerCase() === "athenadance:spid_067_ggsnowman"), "tier 2's reward instead");
  assert.ok(athena.coreMigrations.includes("season7BattleStars"));

  // Once: a second login pays nothing, and a challenge collected now pays only its own.
  athenaQuestLogin(session);
  assert.equal(passStars(attributes), before + 16);
  advanceAthenaObjectives(session, forbiddenDances);
  assert.equal(heldQuest(session, "quest_br_dance_scavengerhunt_forbidden")[1].attributes.quest_state, "Claimed");
  assert.equal(passStars(attributes), before + 21);
  assert.equal(session.profile("athena").profile.items[collectedId].attributes.quest_state, "Claimed");
}));

test("#381: a claim before the first login after the fix pays the earlier ones first, and itself once", () => withSession(v700, "claimfirst700", (session) => {
  athenaQuestLogin(session);
  const athena = session.profile("athena").profile;
  const { attributes } = athena.stats;
  athena.coreMigrations = (athena.coreMigrations ?? []).filter((name) => name !== "season7BattleStars");
  heldQuest(session, "quest_br_collect_item_all_rarity")[1].attributes.quest_state = "Claimed";
  const before = passStars(attributes);
  advanceAthenaObjectives(session, forbiddenDances);
  assert.equal(passStars(attributes), before + 5 + 5);
  athenaQuestLogin(session);
  assert.equal(passStars(attributes), before + 10, "neither is paid again");
}));

test("#381: the settlement waits for Season 7, and leaves earlier seasons' profiles as they are", () => {
  withSession(v631, "season6", (session) => {
    athenaQuestLogin(session);
    const athena = session.profile("athena").profile;
    session.profile("profile0").addItem("stray381", { templateId: battleStar, attributes: {}, quantity: 7 });
    athenaQuestLogin(session);
    assert.equal((athena.coreMigrations ?? []).includes("season7BattleStars"), false);
    assert.ok(findItem(session.profile("profile0").profile, battleStar), "not touched outside Season 7");
    assert.deepEqual([athena.stats.attributes.book_level, athena.stats.attributes.book_xp], [1, 0]);
  });
});

test("#381: 7.00's Battle Pass Promise box lists AthenaBattleStar", () => withSession(v700, "promise700", (session) => {
  grant(session, "Token:athenanextseasontierboost", 5);
  settleSeasonPromise(session, seasonRewardFunctions());
  const promise = heldGiftBoxes(session.profile("profile0").profile).map(([, item]) => item)
    .find((item) => item.templateId === "GiftBox:gb_battlepasspromise");
  assert.deepEqual(promise.attributes.lootList.map(({ itemType, quantity }) => [itemType, quantity]), [[battleStar, 50]]);
  assert.equal(session.profile("athena").profile.stats.attributes.book_level, 6);
}));
