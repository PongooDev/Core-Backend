import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { anyBattlePassOffer, battlePassOffers, tierOfferId } from "../src/battlepass/season2.js";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { contentUpdateStates, updatedLootTables } from "../src/events/contentupdates.js";
import { activeEventFlags, fiftyFifty, isEventActive, passiveMiniBosses, passiveStorms, spring2018, spring2018Phase1,
  spring2018Valentines } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaLootTables, athenaObjectiveStat, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket, showsMatchStart } from "../src/matchmaking/service.js";
import { advanceAthenaObjectives, athenaQuestLogin, awardVictory, grantAthenaQuest, recordMatchProgress, seasonRewardFunctions, settleBattlePassDaily } from "../src/profiles/athena.js";
import { challengeSeasonBegin, challengesAllUnlocked, challengeWeekCount, configureChallenges, settleChallengeSchedules, weekPlan } from "../src/profiles/challenges.js";
import { claimQuest, completeQuest, grant } from "../src/profiles/progress.js";
import { findQuestItem } from "../src/profiles/quests.js";
import { clientQuestLogin } from "../src/services/mcp/commands/ClientQuestLogin.js";
import { buildOfSeason, buyBattlePass, buyTiers, takeUpSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { eventStoreOffers } from "../src/store/eventstore.js";
import { storefronts } from "../src/store/catalog.js";
import { configureItemShop, itemShopOffers, seasonEnd, seasonStart, shopDay } from "../src/store/itemshop.js";

// Fortnite 3.0 (++Fortnite+Release-3.0.0-CL-3901517, UE 4.20, 21 February 2018): Season 3's first build. Its own data
// (gamedata/3901517), Season 3's level, Battle Pass, weekly challenges, shop and umbrella, Spring It On!'s Luck Explosion,
// the Bald Eagle in the Weekly Store and the Hand Cannon in its loot tables.
const v30 = "3901517";
const v25 = "3889387";
const now = new Date("2026-11-03T12:00:00Z");
const dayMs = 24 * 60 * 60 * 1000;
const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
const tiers = "/Game/Items/Datatables/AthenaLootTierData_Client.AthenaLootTierData_Client";
function withSession(name, run) {
  return inBuild(v30, () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build30-"));
    try {
      const session = openSession(createProfileStore(dataDir), name);
      takeUpSeason(session);
      return run(session);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}
const itemsOf = (tracker, type) => Object.entries(tracker.profile.items).filter(([, item]) => item.templateId.toLowerCase().startsWith(`${type.toLowerCase()}:`));

test("3.0 is known by its version, plays on its own game data and is Season 3", () => {
  assert.equal(versionOf(v30), "3.0");
  assert.equal(dataBuild(v30), v30);
  assert.ok(buildChoices().includes(v30));
  assert.equal(allowedBuildList(["3.0"]).join(), v30);
  assert.equal(seasonName(3), "Season 3 (3.0 – 3.6)");
  const season = inBuild(v30, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.numBookLevels, season.numSeasonLevels, season.storefront], [3, 100, 100, "BRSeason3"]);
  assert.equal(season.battlePassLevelOfferId, "E2D7975EFEC54A45900D8D9A6D9D273C");
  assert.deepEqual(season.challengeSchedulesAlwaysShown, ["season3_challenge_schedule"]);
  // Season 3's newest data is 3.1's (build31.test.js).
  assert.equal(buildOfSeason(3), "3915963");
  assert.equal(inBuild(v25, athenaSeason).seasonNumber, 2, "2.5 stays Season 2");
  assert.equal(buildOfSeason(2), v25);
  const cosmetics = inBuild(v30, athenaCosmetics);
  for (const id of ["AthenaCharacter:cid_080_athena_commando_m_space", "AthenaCharacter:cid_084_athena_commando_m_assassin",
    "AthenaGlider:umbrella_paperparasol"]) assert.ok(cosmetics[id], id);
  assert.equal(inBuild(v30, () => getItem("PersonalVehicle:vid_hoverboard")).profile, "profile");
  assert.equal(inBuild(v25, () => getItem("PersonalVehicle:vid_hoverboard")), undefined);
});

test("Season 3's shop replays Epic's 68 days from 22 February 2018, and its season ends with them", () => inBuild(v30, () => {
  const config = { rotationHour: 0, seasonStarts: { 3: "2026-11-03" } };
  assert.equal(seasonStart(3, now, config), Date.parse("2026-11-03T00:00:00Z"));
  assert.equal(shopDay(now, config, 3).date, "2018-02-22");
  assert.equal(shopDay(new Date(now.getTime() + 67 * dayMs), config, 3).date, "2018-04-30");
  assert.equal(shopDay(new Date(now.getTime() + 68 * dayMs), config, 3).date, "2018-02-22");
  assert.equal(seasonEnd(now, config, 3).toISOString(), new Date(Date.parse("2026-11-03T00:00:00Z") + 68 * dayMs).toISOString());
  const day1 = itemShopOffers(now, { mode: "fnbr", ...config });
  // Alpine Ace and Mogul Master with their country styles, each outfit's eight in one tile (Core-Backend #217).
  const styles = ["", "_usa", "_can", "_gbr", "_fra", "_ger", "_chn", "_kor"];
  assert.deepEqual(day1.BRWeeklyStorefront.map(({ templateId }) => templateId),
    [...styles.map((style, i) => `AthenaCharacter:cid_${String(53 + i).padStart(3, "0")}_athena_commando_m_skidude${style}`),
      ...styles.map((style, i) => `AthenaCharacter:cid_${String(61 + i).padStart(3, "0")}_athena_commando_f_skigirl${style}`)]);
}));

// Core-Backend #217: Epic's Season 3 shop put several items in one tile, cycling through them ("1 of 8"), as 3.0's
// AthenaDirectAcquisitionScreen does for the offers of one category (FCatalogOffer Categories[0]); the tile's callout is
// the offers' BannerOverride.
test("Season 3's shop puts a tile's items in one category, with its callout as their BannerOverride (Core-Backend #217)", () => inBuild(v30, () => {
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 3: "2026-11-03" } };
  const entriesOn = (offset) => {
    const fronts = storefronts(null, new Date(now.getTime() + offset * dayMs));
    return Object.fromEntries(["BRWeeklyStorefront", "BRDailyStorefront"]
      .map((name) => [name, fronts.find((front) => front.name === name)?.catalogEntries ?? []]));
  };
  configureItemShop(config);
  try {
    const day1 = entriesOn(0);
    const featured = day1.BRWeeklyStorefront;
    assert.equal(featured.length, 16);
    assert.deepEqual([...new Set(featured.map(({ categories }) => categories.join()))], ["Panel 01", "Panel 02"]);
    assert.deepEqual(featured[0].categories, ["Panel 01"]);
    assert.deepEqual(featured[8].categories, ["Panel 02"]);
    assert.ok(featured.every(({ metaInfo }) => metaInfo.some(({ key, value }) => key === "BannerOverride" && value === "PickYourStyle")));
    // The daily items are tiles of their own.
    assert.ok(day1.BRDailyStorefront.length && day1.BRDailyStorefront.every(({ categories, metaInfo }) => !categories.length && !metaInfo.length));
    // 27 February: Dragon Axe, Wukong, Crimson Scout and Scarlet Defender in one tile, Royale Dragon on its own.
    const day6 = entriesOn(5).BRWeeklyStorefront;
    assert.deepEqual(day6.map(({ itemGrants, categories }) => [itemGrants[0].templateId.split(":")[1], categories.join()]), [
      ["pickaxe_id_025_dragon", "Panel 01"], ["cid_071_athena_commando_m_wukong", "Panel 01"],
      ["cid_086_athena_commando_m_redsilk", "Panel 01"], ["cid_087_athena_commando_f_redsilk", "Panel 01"],
      ["glider_id_014_dragon", ""]]);
    // A custom shop keeps the tiles an admin gives its items.
    configureItemShop({ ...config, mode: "custom", custom: { featured: [["AthenaCharacter:cid_053_athena_commando_m_skidude", 1500, { tile: 3, banner: "CollectTheSet" }],
      ["AthenaCharacter:cid_061_athena_commando_f_skigirl", 1500, { tile: 3 }]], daily: [] } });
    const custom = entriesOn(0).BRWeeklyStorefront;
    assert.deepEqual(custom.map(({ categories }) => categories), [["Panel 03"], ["Panel 03"]]);
    assert.deepEqual(custom.map(({ metaInfo }) => metaInfo.length), [1, 0]);
  } finally {
    configureItemShop(null);
  }
  // Season 2's history has no shared tiles: 2.5's shop is as it was.
  assert.ok(inBuild(v25, () => storefronts(null, now)).filter(({ name }) => name.startsWith("BR"))
    .every(({ catalogEntries }) => catalogEntries.every(({ categories }) => !categories.length)));
}));

test("Season 3's Battle Pass: its offers in BRSeason3, its tier offer by either id, and the tier rewards", () => withSession("pass30", (session) => {
  const offers = battlePassOffers();
  assert.deepEqual(offers.map(({ battlePass, storefront, price }) => [battlePass, storefront, price]),
    [["pass", "BRSeason3", 950], ["bundle", "BRSeason3", 2800], ["tier", "BRSeason3", 150]]);
  assert.match(offers[0].description, /^Season 3: Feb 22 - Apr 30/);
  assert.equal(offers[1].displayAssetPath, "/Game/Catalog/DisplayAssets/DA_BR_Season3_BattlePassWithLevels.DA_BR_Season3_BattlePassWithLevels");
  assert.equal(offers[2].offerId, "E2D7975EFEC54A45900D8D9A6D9D273C");
  assert.equal(anyBattlePassOffer(tierOfferId).battlePass, "tier");
  assert.equal(inBuild(v25, () => anyBattlePassOffer(tierOfferId)).offerId, tierOfferId);
  const tracker = session.profile("athena");
  assert.equal(tracker.profile.stats.attributes.season_num, 3);
  buyBattlePass(session, seasonRewardFunctions());
  assert.ok(tracker.profile.items[Object.keys(tracker.profile.items).find((id) => tracker.profile.items[id].templateId === "AthenaCharacter:cid_080_athena_commando_m_space")]);
  // No Season 2 daily: the pass's challenges are weekly bundles.
  settleBattlePassDaily(session);
  assert.equal(Object.values(tracker.profile.items).filter((item) => getAthenaQuest(item.templateId.split(":")[1] ?? "")?.type === "AthenaBattlePassQuest").length, 0);
}));

test("Season 3's challenges: the pass's schedule unlocks a week at a time, its quests pay their Battle Stars as they complete, and a bundle's threshold pays its reward", () => withSession("challenges30", (session) => {
  const schedules = inBuild(v30, athenaChallengeSchedules);
  assert.deepEqual(Object.keys(schedules).sort(), ["season3_challenge_schedule", "season3_tier_100_schedule", "season3_tier_2_schedule"]);
  assert.equal(inBuild(v30, athenaChallengeBundles).s3_week1_questbundle.completionThreshold, 4);
  const tracker = session.profile("athena");
  buyBattlePass(session, seasonRewardFunctions());
  const [[scheduleId, schedule]] = itemsOf(tracker, "ChallengeBundleSchedule");
  assert.equal(schedule.templateId, "ChallengeBundleSchedule:season3_challenge_schedule");
  const bundles = itemsOf(tracker, "ChallengeBundle");
  assert.ok(bundles.length >= 1 && bundles.length <= 9);
  assert.deepEqual(schedule.attributes.granted_bundles, bundles.map(([id]) => id));
  const [week1Id, week1] = bundles.find(([, item]) => item.templateId === "ChallengeBundle:s3_week1_questbundle");
  assert.equal(week1.attributes.challenge_bundle_schedule_id, scheduleId);
  assert.equal(week1.attributes.num_granted_bundle_quests, 7);
  for (const questItemId of week1.attributes.grantedquestinstanceids) {
    assert.equal(tracker.profile.items[questItemId].attributes.challenge_bundle_id, week1Id);
    assert.equal(tracker.profile.items[questItemId].attributes.quest_state, "Active");
  }
  // "Deal 500 damage with Pistols": its 5 Battle Stars at once, Claimed, and the bundle counts it.
  const before = tracker.profile.stats.attributes.book_xp ?? 0;
  advanceAthenaObjectives(session, [{ statName: "battlepass_damage_athena_player_pistol", count: 500 }]);
  const pistol = week1.attributes.grantedquestinstanceids.find((id) => tracker.profile.items[id].templateId === "Quest:quest_br_damage_pistol");
  assert.equal(tracker.profile.items[pistol].attributes.quest_state, "Claimed");
  assert.equal(tracker.profile.stats.attributes.book_xp, before + 5);
  assert.equal(tracker.profile.items[week1Id].attributes.num_quests_completed, 1);
  // Four of the seven pay the week's 4,000 season XP.
  const levelBefore = tracker.profile.stats.attributes.level;
  advanceAthenaObjectives(session, [{ statName: "battlepass_athena_revive_player", count: 5 },
    { statName: "battlepass_killingblow_athena_player_sniper", count: 2 }, { statName: "battlepass_killingblow_athena_player_fatalfields", count: 3 }]);
  assert.equal(tracker.profile.items[week1Id].attributes.num_quests_completed, 4);
  assert.ok(tracker.profile.stats.attributes.level > levelBefore || tracker.profile.stats.attributes.xp > 0);
  // Free tier 2 gives the Tier 2 challenges, whose Reach Season Level 25 counts the level.
  buyTiers(session, 1, seasonRewardFunctions());
  assert.ok(itemsOf(tracker, "ChallengeBundle").some(([, item]) => item.templateId === "ChallengeBundle:s3_tier_2_questbundle"));
  athenaQuestLogin(session);
  assert.equal(itemsOf(tracker, "ChallengeBundleSchedule").length, 2);
}));

// Core-Backend #214: the gameserver sends these as UpdateQuests (CoreV2 c02db34: AthenaOutlive when another player is
// out, RevivePlayer to the teammate who revived; Interact for a chest), none of them counted from the match results.
test("Season 3's outlive, revive and chest challenges move with the gameserver's UpdateQuests", () => withSession("outlive30", (session) => {
  const tracker = session.profile("athena");
  const outlive = grantAthenaQuest(tracker, "quest_br_outlive");
  const chests = grantAthenaQuest(tracker, "quest_br_interact_chests_location_pleasantpark");
  advanceAthenaObjectives(session, [{ statName: "battlepass_athena_outlive_players", count: 37 },
    { statName: "battlepass_interact_athena_treasurechest_pleasantpark", count: 2 }]);
  assert.equal(tracker.profile.items[outlive].attributes.completion_battlepass_athena_outlive_players, 37);
  assert.equal(tracker.profile.items[chests].attributes.completion_battlepass_interact_athena_treasurechest_pleasantpark, 2);
  recordMatchProgress(session, 2, { place: 1, kills: 3 });
  assert.equal(tracker.profile.items[outlive].attributes.completion_battlepass_athena_outlive_players, 37);
}));

test("Land at different named locations is done at 10 of its 18 objectives", () => withSession("landing30", (session) => {
  assert.equal(inBuild(v30, () => getAthenaQuest("quest_br_land_locations_different")).objectiveCompletionCount, 10);
}));

// bAthenaMustCompleteInSingleMatch (UFortQuestManager::UpdateStatsForSingleMatchQuests, 3.0 0xED1EC0): a match that
// doesn't complete the challenge keeps none of its progress.
test("Season 3's single-match challenges count only a match that completes them, and Athena.Kills is the match's eliminations", () => withSession("single30", (session) => {
  const tracker = session.profile("athena");
  assert.deepEqual(["quest_br_eliminate_singel_match_elemeinations", "quest_br_damage_singlematch", "quest_br_damage"]
    .map((id) => inBuild(v30, () => getAthenaQuest(id)).singleMatch === true), [true, true, false]);
  const fivePlayers = grantAthenaQuest(tracker, "quest_br_eliminate_singel_match_elemeinations");
  const withAKill = grantAthenaQuest(tracker, "quest_br_play_min1elimination");
  const count = (itemId, objective) => tracker.profile.items[itemId].attributes[`completion_${objective}`] ?? 0;
  recordMatchProgress(session, 9, { place: 10, kills: 4 });
  assert.equal(count(fivePlayers, "killingblow_athena_player_singlematch"), 0);
  assert.equal(count(withAKill, "battlepass_complete_athena_with_killingblow"), 1);
  recordMatchProgress(session, 9, { place: 30, kills: 0 });
  assert.equal(count(withAKill, "battlepass_complete_athena_with_killingblow"), 1);
  recordMatchProgress(session, 2, { place: 1, kills: 6 });
  assert.equal(tracker.profile.items[fivePlayers].attributes.quest_state === "Active" ? count(fivePlayers, "killingblow_athena_player_singlematch") : 5, 5);
  assert.notEqual(tracker.profile.items[fivePlayers].attributes.quest_state, "Active");
  // Core-Backend #221: a solo or duo match with an elimination counts too (3.1's row, Athena.Playlist), a win as well.
  assert.equal(count(withAKill, "battlepass_complete_athena_with_killingblow"), 2);
  recordMatchProgress(session, 10, { place: 1, kills: 1 });
  assert.equal(count(withAKill, "battlepass_complete_athena_with_killingblow"), 3);
  recordMatchProgress(session, 2, { place: 1, kills: 0 });
  assert.equal(count(withAKill, "battlepass_complete_athena_with_killingblow"), 3);
  assert.equal(inBuild(v30, () => athenaObjectiveStat("complete_athena_with_a_killingblow")).contextTags, "Athena.Playlist");
  assert.equal(inBuild(v30, () => athenaObjectiveStat("complete_athena_squad_top_3")).contextTags, "Athena.Playlist.Squad");
}));

test("a Season 3 win gives the Paper Parasol", () => withSession("win30", (session) => {
  const granted = awardVictory(session).map(({ templateId }) => templateId);
  assert.ok(granted.includes("AthenaGlider:umbrella_paperparasol"), granted.join());
  assert.ok(!granted.includes("AthenaGlider:umbrella_snowflake"));
}));

test("3.0 runs the passive storms and Mini-Bosses and Spring It On!'s Luck Explosion, without 50v50", () => {
  assert.deepEqual(activeEventFlags(v30), [passiveStorms, passiveMiniBosses, spring2018Valentines, spring2018Phase1]);
  assert.ok(!isEventActive(fiftyFifty, v30));
  assert.ok(isEventActive(spring2018, v30));
  assert.deepEqual(inBuild(v30, eventQuests), ["lovequest_2018_reactive_mailboxes", "springquest_2018_reactive_rescueval", "springquest_2018_reactive_fireworks"]);
  // Luck Explosion's chapter goes on in 3.0's data: the lanterns lead to the fountains, then the Firework Clusters.
  const lanterns = inBuild(v30, () => getQuest("springquest_2018_reactive_lanterns"));
  assert.ok([...lanterns.rewards, ...(lanterns.hiddenRewards ?? [])].some(({ templateId }) => templateId === "Quest:springquest_2018_reactive_fountains"));
  // The Hoverboard: Stonewood's SSD 5 quest leads to its questline.
  assert.ok(inBuild(v30, () => getQuest("outpostquest_t1_l5")).rewards.concat(inBuild(v30, () => getQuest("outpostquest_t1_l5")).hiddenRewards ?? [])
    .some(({ templateId }) => templateId.toLowerCase() === "quest:stonewoodquest_reactive_fetch_hoverboard"));
});

// Core-Backend #210: SSD 5 claimed on 2.5 (whose quest has no Hoverboard) gets the questline at 3.0's quest login, and
// SSD 5 claimed on 3.0 grants it as before. The questline's reward is the Hoverboard, a profile0 item.
test("3.0 gives the Hoverboard questline to accounts past Stonewood's SSD 5", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-hoverboard-"));
  const hoverboardQuest = "stonewoodquest_reactive_fetch_hoverboard";
  try {
    const store = createProfileStore(dataDir);
    const claimSsd5 = (session) => {
      grant(session, "Quest:outpostquest_t1_l5", 1);
      const itemId = findQuestItem(session.profile("profile0").profile, "outpostquest_t1_l5");
      completeQuest(session, itemId);
      claimQuest(session, itemId);
    };
    inBuild(v25, () => {
      const session = openSession(store, "hover25");
      claimSsd5(session);
      assert.equal(findQuestItem(session.profile("profile0").profile, hoverboardQuest), undefined);
      clientQuestLogin({ session, notifications: [], profileId: "profile0" });
      assert.equal(findQuestItem(session.profile("profile0").profile, hoverboardQuest), undefined);
      session.commit();
    });
    inBuild(v30, () => {
      const session = openSession(store, "hover25");
      const { profile } = session.profile("profile0");
      clientQuestLogin({ session, notifications: [], profileId: "profile0" });
      const itemId = findQuestItem(profile, hoverboardQuest);
      assert.equal(profile.items[itemId]?.attributes.quest_state, "Active");
      clientQuestLogin({ session, notifications: [], profileId: "profile0" });
      assert.equal(Object.values(profile.items).filter((item) => item.templateId === `Quest:${hoverboardQuest}`).length, 1);
      completeQuest(session, itemId);
      claimQuest(session, itemId);
      assert.ok(Object.values(profile.items).some((item) => item.templateId === "PersonalVehicle:vid_hoverboard"));
      assert.equal(profile.items[findQuestItem(profile, "stonewoodquest_ability_hoverboard")].attributes.quest_state, "Active");

      const fresh = openSession(store, "hover30");
      claimSsd5(fresh);
      assert.equal(fresh.profile("profile0").profile.items[findQuestItem(fresh.profile("profile0").profile, hoverboardQuest)].attributes.quest_state, "Active");
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// "The Bald Eagle Hand Cannon is now available in the Weekly Store."
test("3.0's Weekly Store sells the Bald Eagle; 2.5's doesn't", () => {
  const weekly = (build) => inBuild(build, () => eventStoreOffers(now)).STWRotationalEventStorefront.map(({ templateId }) => templateId);
  assert.equal(weekly(v30)[0], "Schematic:sid_pistol_handcannon_de_sr_ore_t01");
  assert.ok(!weekly(v25).includes("Schematic:sid_pistol_handcannon_de_sr_ore_t01"));
});

// "Hand Cannon added ... Found in Floor Loot, Treasure Chests and Supply Drops", and the pistols' floor loot changes.
test("3.0's loot ships the Hand Cannon and its notes' pistol changes, so it takes no content update", () => {
  const shipped = inBuild(v30, athenaLootTables);
  assert.equal(shipped[tiers].Loot_AthenaFloorLoot_11.Weight, 0.07);
  assert.equal(shipped[tiers].Loot_AthenaTreasure_07.Weight, 0.08);
  assert.equal(shipped[packages]["WorldList.AthenaLoot.Weapon.Handgun.03"].Weight, 0.25);
  assert.equal(shipped[packages]["WorldList.AthenaLoot.Weapon.Handgun.01"].Weight, 0.1);
  assert.deepEqual(inBuild(v30, () => contentUpdateStates(now, { mode: "season" })), []);
  assert.deepEqual(inBuild(v30, () => updatedLootTables(now)), {});
});

test("3.0 takes AssignMatch's six fields and no match start countdown", () => {
  assert.equal(assignmentBucket(`${v30}:0:NA:2`, v30), `Fortnite:Fortnite:${v30}:0:NA:2`);
  assert.ok(!showsMatchStart(v30));
});

// Core-Backend #207: the challenges tab counts down to a locked week from the calendar's seasonBegin (3.0 0x26E0410,
// 0x9AE190), and the admin panel can give every week at once.
test("Season 3's calendar names the season's start for the locked weeks, and every week can be unlocked at once", () => withSession("unlockall30", (session) => {
  const begin = inBuild(v30, () => challengeSeasonBegin(now));
  assert.ok(Date.parse(begin) <= now.getTime() && Date.parse(begin) > now.getTime() - 70 * dayMs);
  assert.equal(inBuild(v25, () => challengeSeasonBegin(now)), null);
  const tracker = session.profile("athena");
  try {
    configureChallenges({ challengesAllUnlocked: true });
    buyBattlePass(session, seasonRewardFunctions());
    const weeks = itemsOf(tracker, "ChallengeBundle").map(([, item]) => item.templateId.toLowerCase());
    for (let week = 1; week <= 9; week++) assert.ok(weeks.includes(`challengebundle:s3_week${week}_questbundle`), `week ${week}`);
  } finally {
    configureChallenges(undefined);
  }
}));

// Core-Backend #219: the admin's unlock modes and the weeks available, and the seasonBegin the client counts down from.
test("Season 3's weekly challenges unlock by the admin's mode and cap, and seasonBegin follows them", () => withSession("unlockmodes30", (session) => {
  const season = (settings) => ({ challengeUnlock: { season3: settings } });
  const openWeeks = (plan) => plan.weeks.filter((week) => week.unlocked).map((week) => week.week);
  try {
    inBuild(v30, () => {
      assert.equal(challengeWeekCount(), 9);
      // Original dates: seasonBegin is the replay's day 1, each week 7 days on.
      const original = weekPlan(now, {});
      assert.equal(original.mode, "original");
      assert.equal(original.begin, challengeSeasonBegin(now));
      assert.equal(Date.parse(original.weeks[8].unlocksAt) - Date.parse(original.begin), 56 * dayMs);
      assert.equal(weekPlan(now, season({ weeksAvailable: 3 })).weeks.filter((w) => w.unlocksAt).length, 3);

      // Every 7 days from a start date: seasonBegin is the start date, so every countdown is exact.
      const weekly = weekPlan(now, season({ mode: "interval", startDate: "2026-10-20", intervalDays: 7 }));
      assert.deepEqual(openWeeks(weekly), [1, 2, 3]);
      assert.equal(weekly.begin, "2026-10-20T00:00:00.000Z");
      assert.equal(weekly.changes.toISOString(), "2026-11-10T00:00:00.000Z");
      // Every 3 days: the next locked week reads right (begin + its 7 days a week).
      const fast = weekPlan(now, season({ mode: "interval", startDate: "2026-10-28", intervalDays: 3 }));
      assert.deepEqual(openWeeks(fast), [1, 2, 3]);
      assert.equal(fast.weeks[3].unlocksAt, "2026-11-06T00:00:00.000Z");
      assert.equal(Date.parse(fast.begin) + 21 * dayMs, Date.parse(fast.weeks[3].unlocksAt));
      // Not yet started: nothing unlocked, Week 1 counts down from the start.
      assert.deepEqual(openWeeks(weekPlan(now, season({ mode: "interval", startDate: "2026-12-01" }))), []);
      // The cap holds in every mode.
      assert.deepEqual(openWeeks(weekPlan(now, season({ mode: "interval", startDate: "2026-01-01", weeksAvailable: 4 }))), [1, 2, 3, 4]);
      assert.equal(weekPlan(now, season({ mode: "interval", startDate: "2026-01-01", weeksAvailable: 4 })).weeks[4].unlocksAt, null);

      // Manual: the first weeks, no dates; the next locked week reads a week from today.
      const manual = weekPlan(now, season({ mode: "manual", manualWeeks: 5, weeksAvailable: 9 }));
      assert.deepEqual(openWeeks(manual), [1, 2, 3, 4, 5]);
      assert.equal(Date.parse(manual.begin) + 35 * dayMs, Date.parse("2026-11-10T00:00:00Z"));
      assert.deepEqual(openWeeks(weekPlan(now, season({ mode: "manual", manualWeeks: 9, weeksAvailable: 2 }))), [1, 2]);
      assert.ok(challengesAllUnlocked(season({ mode: "manual", manualWeeks: 9 })));
      assert.ok(!challengesAllUnlocked(season({ mode: "manual", manualWeeks: 9, weeksAvailable: 8 })));
    });

    // A player gets the unlocked weeks at their next login, and the schedule's unlock_epoch is the calendar's seasonBegin.
    configureChallenges(season({ mode: "manual", manualWeeks: 2 }));
    buyBattlePass(session, seasonRewardFunctions());
    const tracker = session.profile("athena");
    const weeks = () => itemsOf(tracker, "ChallengeBundle").map(([, item]) => item.templateId.toLowerCase()).filter((id) => id.includes("_week"));
    assert.deepEqual(weeks().sort(), ["challengebundle:s3_week1_questbundle", "challengebundle:s3_week2_questbundle"]);
    configureChallenges(season({ mode: "manual", manualWeeks: 4 }));
    settleChallengeSchedules(session, seasonRewardFunctions(), now);
    assert.equal(weeks().length, 4);
    const [, schedule] = itemsOf(tracker, "ChallengeBundleSchedule").find(([, item]) => item.templateId.toLowerCase().endsWith("season3_challenge_schedule"));
    assert.equal(schedule.attributes.unlock_epoch, challengeSeasonBegin(now));
  } finally {
    configureChallenges(undefined);
  }
}));
