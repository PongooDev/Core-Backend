import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { specialBookPages } from "../src/collectionbook/pages.js";
import { blockbusterEventQuests, blockbusterLlama, blockbusterQuests, blockbusterTickets, miniBossTicketsFor,
  upgradeLlamaBlockbusterTickets } from "../src/events/blockbuster2018.js";
import { contentUpdateStates, lootHotfixSection } from "../src/events/contentupdates.js";
import { activeEventFlags, activeMiniBosses, blockbuster2018, blockbuster2018Phase1, hasEventEnded, isEventActive, lobbySeason4,
  passiveStorms, storm2018 } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { convertEventLeftovers } from "../src/events/leftovers.js";
import { hasLtm, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltms } from "../src/events/ltms.js";
import { meteorStrikePhase, meteorStrikeRows } from "../src/events/meteorstrike.js";
import { stormTickets } from "../src/events/mutantstorms.js";
import { intoTheStormLlama } from "../src/events/storm2018.js";
import { stormConversion2018, stormConversion2018Storm } from "../src/events/stormllamas.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason, athenaVariantTokens, getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { advanceAthenaObjectives, athenaQuestLogin, equipCustomization, seasonRewardFunctions } from "../src/profiles/athena.js";
import { mtxProfileId, usesCommonProfiles } from "../src/profiles/common.js";
import { grantItem } from "../src/profiles/items.js";
import { buildOfSeason, buyBattlePass, takeUpSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { setItemFavoriteStatusBatch } from "../src/services/mcp/commands/SetItemFavoriteStatus.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreInstanceNow, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { hasRefunds } from "../src/store/refunds.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 4.0 (++Fortnite+Release-4.0-CL-4039451, UE 4.20, 1 May 2018, Season 4's first build): its own data
// (gamedata/4039451), Season 4's Battle Pass, challenges, shop and lobby, and Save the World's Blockbuster.
const v40 = "4039451";
const v36 = "4019403";
const now = new Date("2026-11-06T12:00:00Z");
const carbide = "AthenaCharacter:cid_115_athena_commando_m_carbideblue";

function withSession(name, run) {
  return inBuild(v40, () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build40-"));
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
const heldQuest = (tracker, questId) => itemsOf(tracker, "Quest").find(([, item]) => item.templateId.toLowerCase() === `quest:${questId}`);

test("4.0 is known by its version, plays on its own data and is Season 4", () => {
  assert.equal(versionOf(v40), "4.0");
  assert.equal(dataBuild(v40), v40);
  assert.ok(buildChoices().includes(v40));
  assert.equal(allowedBuildList(["4.0"]).join(), v40);
  const season = inBuild(v40, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.numBookLevels, season.storefront, season.battlePassLevelOfferId],
    [4, 100, "BRSeason4", "E9527AF46F4B4A9CAE98D91F2AA53CB6"]);
  assert.deepEqual(season.challengeSchedulesAlwaysShown, ["season4_challenge_schedule", "season4_starterchallenge_schedule"]);
  assert.equal(buildOfSeason(4), v40);
  assert.equal(buildOfSeason(3), v36, "Season 3's newest data stays 3.6's");
  assert.equal(seasonName(4), "Season 4 (4.0)");
});

test("4.0's data: Season 4's cosmetics, its sprays, Carbide's styles and their tokens; no test cosmetics", () => {
  const cosmetics = inBuild(v40, athenaCosmetics);
  assert.equal(cosmetics[carbide].name, "Carbide");
  assert.equal(cosmetics["AthenaCharacter:cid_116_athena_commando_m_carbideblack"].name, "Omega");
  assert.equal(cosmetics["AthenaDance:spid_002_xmark"].class, "AthenaSprayItemDefinition");
  assert.equal(cosmetics["AthenaGlider:umbrella_season_04"].name, "Wet Paint");
  assert.ok(!cosmetics["AthenaDance:spid_000_testspray"] && !cosmetics["AthenaPickaxe:dev_test_pickaxe"]);
  assert.ok(!cosmetics["AthenaSkyDiveContrail:trails_id_008_ridethelightning"], "4.0's paks drop Ride the Lightning");
  assert.deepEqual(cosmetics[carbide].variants, [{ channel: "Progressive", default: "Stage0",
    options: ["Stage0", "Stage1", "Stage2", "Stage3", "Stage4", "Stage5"], unlocked: ["Stage0"] }]);
  assert.deepEqual(inBuild(v40, athenaVariantTokens)["CosmeticVariantToken:vtid_002_carbideblue_stage1"],
    { channel: "Progressive", cosmetic: carbide, giftBox: true, variant: "Stage1" });
  // Every Battle Pass cosmetic is one 4.0's data has.
  const season = inBuild(v40, athenaSeason);
  for (const { rewards } of [...season.bookFreeRewards, ...season.bookPaidRewards]) {
    for (const { templateId } of rewards.filter(({ templateId }) => /^Athena/.test(templateId))) assert.ok(cosmetics[templateId], templateId);
  }
  assert.equal(inBuild(v40, () => getItem("AccountResource:eventcurrency_scaling")).name, "Gold");
  assert.equal(inBuild(v40, () => getItem("AccountResource:eventcurrency_scaling")).maxStackSize, 5000);
});

test("4.0's world has every primary mission's tags from its own paks (a full install: no earlier build needed)", () => {
  const world = (build) => buildGameData(build, "world", {});
  for (const [mission, entry] of Object.entries(world(v36).primaryMissions)) assert.deepEqual(world(v40).primaryMissions[mission], entry, mission);
  assert.ok(world(v40).primaryMissions["/Game/Missions/Primary/Gate/Gate_Single"].tags.length > 0);
});

test("4.0's event flags: Blockbuster Part 1, active Mini-Bosses, passive storms and the Season 4 lobby; Into the Storm is over", () => {
  assert.deepEqual(activeEventFlags(v40), [blockbuster2018Phase1, activeMiniBosses, passiveStorms, lobbySeason4]);
  assert.equal(lobbySeason4, "EventFlag.LobbySeason4");
  assert.ok(!activeEventFlags(v36).includes(lobbySeason4));
  assert.equal(inBuild(v40, () => isEventActive(blockbuster2018)), true);
  assert.equal(inBuild(v40, () => isEventActive(storm2018)), false);
  assert.equal(inBuild(v40, () => hasEventEnded(storm2018)), true);
  assert.equal(inBuild(v36, () => isEventActive(blockbuster2018)), false);
  assert.ok(!activeEventFlags(v40).some((flag) => /Meteor|Comet|Crater/i.test(flag)), "no flag drives Season 4's map");
});

test("4.0's Blockbuster: its quests, llama, Mini-Boss tickets, Event Store and book pages", () => {
  assert.deepEqual(inBuild(v40, blockbusterEventQuests), blockbusterQuests);
  assert.ok(inBuild(v40, eventQuests).includes("blockbusterquest_2018_reactive_cometshards"));
  assert.ok(!inBuild(v40, eventQuests).some((questId) => questId.startsWith("stormquest_2018")));
  const line = inBuild(v40, () => buildGameData(v40, "quests", {}))["blockbusterquest_2018_reactive_raysignal"];
  assert.deepEqual(line.selectableRewards.map(([reward]) => reward.templateId), ["CardPack:cardpack_sniper_crossbow_military_sr",
    "CardPack:cardpack_pistol_handcannon_de_military_sr", "CardPack:cardpack_assault_smg_silenced_military_sr"]);
  const llama = inBuild(v40, () => findOffer("core_event_blockbuster_llama"));
  assert.deepEqual([llama.templateId, llama.currencySubType, llama.price], [blockbusterLlama, blockbusterTickets, 500]);
  assert.equal(inBuild(v36, () => findOffer("core_event_blockbuster_llama")), undefined);
  assert.deepEqual([1, 2, 3, 4].map(miniBossTicketsFor), [50, 70, 90, 120]);
  const alerts = inBuild(v40, () => worldInfo(now)).missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts);
  const miniBosses = alerts.filter(({ categoryName }) => categoryName === "MiniBossCategory");
  assert.ok(miniBosses.length > 0);
  for (const alert of miniBosses) assert.ok(alert.missionAlertRewards.items.some(({ itemType, quantity }) => itemType === blockbusterTickets && quantity >= 50), alert.name);
  assert.ok(!alerts.some(({ categoryName }) => categoryName === "StormCategory" || categoryName === "Survival3DayCategory"));
  assert.equal(inBuild(v40, () => upgradeLlamaBlockbusterTickets({ currencyType: "MtxCurrency", templateId: "CardPack:cardpack_bronze" }, 2)), 200);
  assert.equal(inBuild(v40, hasEventStore), true);
  assert.equal(inBuild(v40, eventStoreInstanceNow), "Blockbuster2018.STWSpecialEventStoreFront");
  const store = inBuild(v40, () => eventStoreOffers(now)).STWSpecialEventStoreFront;
  assert.deepEqual(store.map(({ templateId, price }) => [templateId, price]), [["Hero:hid_commando_myth02_sr_t01", 2800]]);
  assert.ok(inBuild(v40, specialBookPages).includes("PageSpecial_Blockbuster2018_Heroes"));
});

test("4.0 turns Storm Tickets into Into the Storm (Neon) Llamas, one a 1,000 and one for what is left over", () => withSession("neonllamas", (session) => {
  assert.equal(stormConversion2018Storm.due(), true);
  assert.equal(stormConversion2018.due(), false, "the storms' return's conversion no longer runs past Into the Storm");
  assert.equal(inBuild(v36, () => stormConversion2018Storm.due()), false);
  grantItem(session, stormTickets, 2500);
  const granted = convertEventLeftovers(session);
  const llamas = Object.values(session.profile("profile0").profile.items).filter((item) => item.templateId.toLowerCase() === intoTheStormLlama.toLowerCase());
  assert.equal(llamas.reduce((sum, item) => sum + item.quantity, 0), 3);
  assert.ok(granted.length > 0);
  assert.ok(!Object.values(session.profile("profile0").profile.items).some((item) => item.templateId.toLowerCase() === stormTickets.toLowerCase()));
  assert.deepEqual(convertEventLeftovers(session), [], "once");
}));

test("4.0's lobby: 3.6's playlists, no new mode", () => {
  for (const ltm of ltms.filter((candidate) => hasLtm(candidate.id, v36))) assert.ok(hasLtm(ltm.id, v40), ltm.id);
  const none = { matchmakingModes: {} };
  assert.equal(ltmNewMode(v40, none), null);
  assert.equal(ltmOn("fiftyFiftyV2", v40, none), false);
  assert.deepEqual(ltmPlaylistOverrides(v40, { matchmakingModes: { blitz: true } }), ["Playlist_Blitz_Squad"]);
  assert.equal(ltmOfPlaylist(44, v40).id, "impactSolo");
});

test("4.0's shop is Season 4's, with only the cosmetics 4.0 has", () => {
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 4: "2026-11-06" } };
  const offers = inBuild(v40, () => itemShopOffers(now, config));
  assert.deepEqual(offers.BRWeeklyStorefront.map(({ templateId, price }) => [templateId, price]),
    [["AthenaCharacter:cid_108_athena_commando_m_fishhead", 2000], ["AthenaGlider:glider_id_027_satelite", 1200]]);
  const cosmetics = inBuild(v40, athenaCosmetics);
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season4.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 72);
  assert.deepEqual([history[0].date, history.at(-1).date], ["2018-05-01", "2018-07-11"]);
  for (const day of history) for (const [templateId] of [...day.featured, ...day.daily]) assert.ok(cosmetics[templateId], `${day.date} ${templateId}`);
});

test("4.0's Battle Pass: BRSeason4 at 950 and 2,800 V-Bucks, its tier offer, and its challenges", () => withSession("season4pass", (session) => {
  const offers = battlePassOffers();
  assert.deepEqual(offers.map(({ offerId, price, storefront }) => [offerId, price, storefront]), [["core_br_season4_battlepass", 950, "BRSeason4"],
    ["core_br_season4_battlebundle", 2800, "BRSeason4"], ["E9527AF46F4B4A9CAE98D91F2AA53CB6", 150, "BRSeason4"]]);
  assert.equal(offers[0].displayAssetPath, "/Game/Catalog/DisplayAssets/DA_BR_Season4_BattlePass.DA_BR_Season4_BattlePass");
  assert.match(offers[0].description, /^Season 4: May 1 - Jul 12/);
  assert.deepEqual(Object.keys(athenaChallengeSchedules()).sort(), ["season4_challenge_schedule", "season4_progressiveb_schedule", "season4_starterchallenge_schedule"]);
  buyBattlePass(session, seasonRewardFunctions());
  const tracker = session.profile("athena");
  assert.ok(tracker.profile.items[carbide], "tier 1 gives Carbide");
  assert.deepEqual(tracker.profile.items[carbide].attributes.variants, [{ channel: "Progressive", active: "Stage0", owned: ["Stage0"] }]);
  const bundles = itemsOf(tracker, "ChallengeBundle").map(([, item]) => item.templateId.toLowerCase());
  for (const bundle of ["questbundle_s4_cumulative", "questbundle_s4_progressivea", "questbundle_s4_week_001"]) assert.ok(bundles.includes(`challengebundle:${bundle}`), bundle);
}));

test("4.0's progressive challenges unlock Carbide's styles, and the locker equips them", () => withSession("carbide", (session) => {
  buyBattlePass(session, seasonRewardFunctions());
  const tracker = session.profile("athena");
  seasonRewardFunctions().addSeasonXp(session, 1_000_000);
  athenaQuestLogin(session);
  const [, stage1] = heldQuest(tracker, "quest_br_levelup_seasonlevel_progressivea_01");
  assert.notEqual(stage1.attributes.quest_state, "Active");
  const owned = tracker.profile.items[carbide].attributes.variants[0].owned;
  for (const stage of ["Stage0", "Stage1", "Stage2", "Stage3", "Stage4", "Stage5"]) assert.ok(owned.includes(stage), stage);
  equipCustomization(session, "Character", carbide, 0, [{ channel: "Progressive", active: "Stage3", owned: [] }]);
  assert.equal(tracker.profile.items[carbide].attributes.variants[0].active, "Stage3");
  assert.equal(tracker.profile.stats.attributes.favorite_character, carbide);
  equipCustomization(session, "Character", carbide, 0, [{ channel: "Progressive", active: "Stage9", owned: [] }]);
  assert.equal(tracker.profile.items[carbide].attributes.variants[0].active, "Stage3", "a style not owned stays off");
  assert.ok(itemsOf(tracker, "AthenaPickaxe").some(([id]) => id.toLowerCase() === "athenapickaxe:pickaxe_id_047_carbideblue"), "three stages give Carbide's pickaxe");
}));

test("4.0's weekly challenges: a week done gives the weekly token, which the cumulative challenges count", () => withSession("cumulative", (session) => {
  buyBattlePass(session, seasonRewardFunctions());
  const tracker = session.profile("athena");
  const week = athenaChallengeBundles().questbundle_s4_week_001;
  const updates = week.quests.flatMap(({ quest }) => getAthenaQuest(quest).objectives.filter((objective) => !objective.itemEvent)
    .map((objective) => ({ statName: objective.name, count: objective.count })));
  advanceAthenaObjectives(session, updates);
  const [, completeAll] = heldQuest(tracker, "quest_br_s4w1_cumulative_completeall");
  assert.equal(completeAll.attributes.quest_state, "Claimed");
  const [, token] = itemsOf(tracker, "Token").find(([, item]) => item.templateId.toLowerCase() === "token:athenabattlepass_s4_weeklychallenge_token");
  assert.equal(token.quantity, 1);
  const [, first] = heldQuest(tracker, "quest_br_s4_cumulative_collecttokens_01");
  assert.equal(first.attributes.quest_state, "Claimed");
  assert.equal(heldQuest(tracker, "quest_br_s4_cumulative_collecttokens_02")[1].attributes.quest_state, "Active");
  assert.ok(tracker.profile.items["AthenaLoadingScreen:lsid_009_s4cumulative1"], "its loading screen");
  assert.ok(heldQuest(tracker, "quest_br_s4_cumulative_quest1"), "and its hidden challenge");
}));

test("4.0: a challenge's Battle Stars past tier 100 are 100 season XP each", () => withSession("overflow", (session) => {
  buyBattlePass(session, seasonRewardFunctions());
  const tracker = session.profile("athena");
  tracker.setStat("book_level", 100);
  const before = { level: tracker.profile.stats.attributes.level ?? 1, xp: tracker.profile.stats.attributes.xp ?? 0 };
  advanceAthenaObjectives(session, [{ statName: "battlepass_damage_athena_player_sniper", count: 500 }]);
  const after = tracker.profile.stats.attributes;
  assert.equal(after.book_level, 100);
  assert.ok((after.level ?? 1) > before.level || (after.xp ?? 0) >= before.xp + 500, "5 stars, 500 season XP");
}));

test("4.0's locker favourites: SetItemFavoriteStatusBatch", () => {
  const items = { a: { attributes: { favorite: 0 } }, b: { attributes: { favorite: 1 } } };
  const set = [];
  setItemFavoriteStatusBatch({ req: { body: { itemIds: ["a", "b", "missing"], itemFavStatus: [true, false, true] } }, profile: { items },
    tracker: { setItemAttribute: (itemId, name, value) => set.push([itemId, name, value]) } });
  assert.deepEqual(set, [["a", "favorite", 1], ["b", "favorite", 0]]);
});

test("4.0 keeps 3.6's gates: common profiles, returns, replays' 4.20 loot RowUpdates; no Meteor Strike rows, no loot update", () => {
  assert.equal(inBuild(v40, () => usesCommonProfiles()), true);
  assert.equal(inBuild(v40, () => mtxProfileId()), "common_core");
  assert.equal(hasRefunds(v40), true);
  assert.deepEqual(inBuild(v40, () => contentUpdateStates(now)), []);
  assert.equal(inBuild(v40, () => lootHotfixSection(now, null, [], meteorStrikeRows(v40), v40)), "");
  assert.equal(meteorStrikePhase(v40), null);
});
