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
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { meteorStrikePhase, meteorStrikeRows } from "../src/events/meteorstrike.js";
import { stormTickets } from "../src/events/mutantstorms.js";
import { intoTheStormLlama } from "../src/events/storm2018.js";
import { stormConversion2018, stormConversion2018Storm } from "../src/events/stormllamas.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason, athenaVariantTokens, getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { advanceAthenaObjectives, athenaQuestLogin, equipCustomization, refreshAthenaDailies, seasonRewardFunctions } from "../src/profiles/athena.js";
import { challengeWeekCount, weekPlan } from "../src/profiles/challenges.js";
import { mtxProfileId, usesCommonProfiles } from "../src/profiles/common.js";
import { grantItem } from "../src/profiles/items.js";
import { addBookXp, buildOfSeason, buyBattlePass, takeUpSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { setItemFavoriteStatusBatch } from "../src/services/mcp/commands/SetItemFavoriteStatus.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreInstanceNow, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { hasRefunds } from "../src/store/refunds.js";
import { worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

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
  assert.equal(buildOfSeason(4), "4166199", "Season 4's newest data is 4.5's (build45.test.js)");
  assert.equal(buildOfSeason(3), v36, "Season 3's newest data stays 3.6's");
  assert.equal(seasonName(4), "Season 4 (4.0 – 4.5)");
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

// Blockbuster's Event Store (#265): the four heroes, a legendary Survivor and the Military weapons, all in 4.0's data.
const blockbusterStoreIds = ["Hero:hid_commando_myth02_sr_t01", "Hero:hid_ninja_myth02_sr_t01", "Hero:hid_constructor_016_m_v1_blockbuster_sr_t01",
  "Hero:hid_outlander_zoneharvest_blockbuster_sr_t01", "Worker:workerbasic_sr_t01",
  ...["assault_military_auto", "assault_military_surgical", "assault_smg_silenced_military", "assault_lmg_military", "pistol_silenced_military",
    "shotgun_military", "sniper_military", "sniper_crossbow_military", "piercing_spear_military", "explosive_launcher_military"]
    .map((name) => `Schematic:sid_${name}_sr_ore_t01`)];
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
  assert.deepEqual(store.map(({ templateId }) => templateId), blockbusterStoreIds);
  assert.deepEqual(store.map(({ templateId, price }) => [templateId, price]).slice(0, 2), [["Hero:hid_commando_myth02_sr_t01", 2800], ["Hero:hid_ninja_myth02_sr_t01", 2800]]);
  assert.ok(store.every(({ eventLimit, currencySubType }) => eventLimit === 1 && currencySubType === "AccountResource:eventcurrency_scaling"));
  assert.ok(store.some(({ templateId }) => templateId === "Schematic:sid_assault_lmg_military_sr_ore_t01"), "the HackSAW is an event item on 4.0");
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

// Core-Backend #262, 4.0's notes: "Gold no longer resets each season. Seasonal Gold has been renamed to Gold as a result.
// Gold caps at 5000. Gold above this cap will not be lost, but you will stop earning Gold until you have spent enough to
// drop below the cap."
test("4.0 keeps the account's Gold: no later Spring It On! conversion takes it, and Gold over the cap isn't lost", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build40-gold-"));
  const store = createProfileStore(dataDir);
  const gold = "AccountResource:eventcurrency_scaling";
  const held = (session) => Object.values(session.profile("profile0").profile.items)
    .filter((item) => item.templateId.toLowerCase() === gold.toLowerCase()).reduce((sum, item) => sum + item.quantity, 0);
  try {
    // 3.6 has no cap: 8,000 Spring It On! Gold, past an account's Spring It On! conversion.
    inBuild(v36, () => {
      const session = openSession(store, "gold40");
      session.profile("profile0").profile.coreMigrations.push("eventLeftovers.SeasonalGold2018");
      grantItem(session, gold, 8000);
      session.commit();
    });
    inBuild(v40, () => {
      assert.equal(getItem(gold).maxStackSize, 5000);
      const session = openSession(store, "gold40");
      assert.equal(held(session), 8000);
      grantItem(session, gold, 50);
      assert.equal(held(session), 8000, "over the cap: kept, and no more earned");
      session.commit();
    });
    // An account that first loads on 4.0 and later meets Spring It On! on 3.3 keeps its Gold.
    inBuild(v40, () => {
      const session = openSession(store, "fresh40");
      grantItem(session, gold, 1200);
      convertEventLeftovers(session);
      session.commit();
    });
    inBuild("3942182", () => {
      const session = openSession(store, "fresh40");
      assert.deepEqual(convertEventLeftovers(session), []);
      assert.equal(held(session), 1200);
    });
    // One that never reached 4.0 still converts on 3.3, as Spring It On!'s notes say.
    inBuild("3942182", () => {
      const session = openSession(store, "never40");
      grantItem(session, gold, 1200);
      convertEventLeftovers(session);
      assert.equal(held(session), 0);
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("4.0's lobby: 3.6's playlists, no new mode", () => {
  for (const ltm of ltms.filter((candidate) => hasLtm(candidate.id, v36))) assert.ok(hasLtm(ltm.id, v40), ltm.id);
  const none = { matchmakingModes: {} };
  assert.equal(ltmNewMode(v40, none), null);
  assert.equal(ltmOn("fiftyFiftyV2", v40, none), false);
  assert.deepEqual(ltmPlaylistOverrides(v40, { matchmakingModes: { blitz: true } }), ["Playlist_Blitz_Squad"]);
  assert.equal(ltmOfPlaylist(44, v40).id, "impactSolo");
});

// Core-Backend #257: the LTMs found working on 3.5.1 and later, each by its own switch, with its playlist asset's
// PlaylistName and teams (3.5.1's, 3.6's and 4.0's Athena/Playlists, FModel).
const issue257 = [
  ["solidGold", "Playlist_SolidGold_Squads", 27, [100, 4, 4]],
  ["solidGoldSolo", "Playlist_SolidGold_Solo", 26, [100, 1, 1]],
  ["sniperShootoutSolo", "Playlist_Snipers_Solo", 39, [100, 1, 1]],
  ["sniperShootoutDuos", "Playlist_Snipers_Duos", 40, [100, 2, 2]],
  ["sniperShootoutSquads", "Playlist_Snipers", 41, [100, 4, 4]],
  ["highExplosivesSquads", "Playlist_HighExplosives_Squads", 24, [100, 4, 4]],
  ["highExplosivesSolo", "Playlist_HighExplosives_Solo", 23, [100, 1, 1]],
  ["blitz", "Playlist_Blitz_Squad", 19, [100, 4, 4]],
  ["blitzSolo", "Playlist_Blitz_Solo", 36, [100, 1, 1]],
  ["blitzDuo", "Playlist_Blitz_Duos", 37, [100, 2, 2]],
  ["fiveByTwenty", "Playlist_5x20", 22, [5, 20, 4]],
  ["fiftyFiftyV2", "Playlist_50v50", 50, [2, 50, 4]]
];
test("#257: 3.5.1's to 4.0's LTMs, each on by its switch, in the lobby by its playlist and matched in its teams", () => {
  for (const build of ["4000805", "4008490", v36, v40]) {
    for (const [id, playlistName, playlistId, [maxTeamCount, maxTeamSize, maxSquadSize]] of issue257) {
      assert.ok(hasLtm(id, build), `${id} on ${build}`);
      assert.equal(ltmOfPlaylist(playlistId, build).id, id, `${playlistId} on ${build}`);
      assert.deepEqual(playlistTeamsOf(`${build}:0:NA:${playlistId}`, build), { maxTeamCount, maxTeamSize, maxSquadSize }, `${id} on ${build}`);
      const on = ltmPlaylistOverrides(build, { matchmakingModes: { [id]: true } });
      assert.ok(on.includes(playlistName), `${id} on ${build}`);
      // Off by its switch, but where it is the build's new mode (50v50 v2 on 3.5.1 and 3.5.2).
      const off = ltmPlaylistOverrides(build, { matchmakingModes: { [id]: false } });
      assert.equal(off.includes(playlistName), ltmNewMode(build, { matchmakingModes: {} })?.id === id, `${id} on ${build}`);
    }
  }
  // None of them before 3.5.1's playlist assets: 3.3 has no PlaylistOverrides, and its v2 modes don't exist.
  assert.deepEqual(ltmPlaylistOverrides("3942182", { matchmakingModes: Object.fromEntries(issue257.map(([id]) => [id, true])) }), []);
  assert.ok(!hasLtm("sniperShootoutSolo", "3942182"));
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
  // Every item is 4.0's but 4.1's Snap emote (build41.test.js) and 4.2's and 4.4's cosmetics (build42.test.js,
  // build44.test.js), which 4.0's shop leaves out.
  const cosmetics41 = inBuild("4053532", athenaCosmetics);
  const cosmetics42 = inBuild("4166199", athenaCosmetics);
  for (const day of history) {
    for (const [templateId] of [...day.featured, ...day.daily]) {
      assert.ok(cosmetics[templateId] || (templateId === "AthenaDance:eid_snap" && cosmetics41[templateId]) || (!cosmetics41[templateId] && cosmetics42[templateId]),
        `${day.date} ${templateId}`);
    }
  }
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

// Core-Backend #266: 4.0's and 4.1's quest log (QuestsModal's QuestScreen) lists every quest the athena profile holds
// that isn't bHidden, under its FortQuestItemDefinition Category, so the starter and weekly challenges Epic filed under
// BRDailyChallenges show as "Battle Royale Daily Challenges" beside the three dailies. The dailies stay three.
test("#266: Season 4's weeks are 10, Week 1 with the cumulative and Carbide challenges; dailies stay three", () => withSession("weeks266", (session) => {
  assert.equal(challengeWeekCount(), 10);
  const plan = weekPlan(now, { challengeUnlock: { season4: { mode: "manual", manualWeeks: 1 } } });
  assert.deepEqual(plan.weeks[0].bundles, ["questbundle_s4_cumulative", "questbundle_s4_progressivea", "questbundle_s4_week_001"]);
  assert.deepEqual(plan.weeks.filter((week) => week.unlocked).map((week) => week.bundle), ["questbundle_s4_week_001"]);
  assert.equal(plan.weeks[9].bundle, "questbundle_s4_week_010");
  const original = weekPlan(now, {});
  assert.equal(Date.parse(original.weeks[1].unlocksAt) - Date.parse(original.begin), 7 * 86_400_000, "Week 2 is 7 days on");

  buyBattlePass(session, seasonRewardFunctions());
  const tracker = session.profile("athena");
  for (let day = 0; day < 10; day++) refreshAthenaDailies(session, new Date(now.getTime() + day * 86_400_000));
  const dailies = itemsOf(tracker, "Quest").filter(([, item]) => getAthenaQuest(item.templateId.split(":")[1])?.type === "AthenaDailyQuest");
  assert.equal(dailies.length, 3);
}));

// Core-Backend #268: the tiers reached between two visits to the lobby come in one GiftBox:GB_BattlePass, one screen.
test("#268: two tiers reached apart in a match share one Battle Pass gift box until the client takes it", () => withSession("onebox", (session) => {
  buyBattlePass(session, seasonRewardFunctions());
  const account = session.profile("profile0");
  const boxes = () => itemsOf(account, "GiftBox").filter(([, item]) => item.templateId.toLowerCase() === "giftbox:gb_battlepass");
  for (const [id] of boxes()) account.removeItem(id);
  const athena = session.profile("athena").profile.stats.attributes;
  const tier = athena.book_level;
  addBookXp(session, 10, seasonRewardFunctions());
  assert.equal(athena.book_level, tier + 1);
  const [[firstId, first]] = boxes();
  const firstLoot = first.attributes.lootList.length;
  assert.ok(firstLoot > 0);
  addBookXp(session, 10, seasonRewardFunctions());
  assert.equal(athena.book_level, tier + 2);
  assert.equal(boxes().length, 1, "one screen for both tiers");
  assert.equal(boxes()[0][0], firstId);
  assert.ok(boxes()[0][1].attributes.lootList.length > firstLoot, "the second tier's rewards join the first's");

  account.removeItem(firstId);
  addBookXp(session, 10, seasonRewardFunctions());
  assert.equal(boxes().length, 1);
  assert.notEqual(boxes()[0][0], firstId, "a tier after the box was taken gets a box of its own");
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

// 4.0's FEATURED ITEMS countdown is GetWeeklyStoreEndDate (0x29681C0: the client-events state's WeeklyStoreEnd, +0x170,
// as 3.6's 0x28ED810 reads it), so it counts to the calendar's weeklyStoreEnd. It showed 72 days: the settings kept no
// start for Season 4, so its replay started again on every day it was asked about, every day was its first, the featured
// pair never changed and the countdown ran to the end of the cycle.
test("4.0's featured countdown counts to the next featured change, and Season 4's start is kept", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build40-shop-"));
  const backend = await startBackend({ dataDir });
  const dayMs = 86400000;
  try {
    const { token } = await userLogin(backend.port, "featured40");
    const timeline = async (changelist, branch) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-${branch}-CL-${changelist}`, Authorization: `bearer ${token}` } })).body;
    const body = await timeline(v40, "4.0");
    const { state } = body.channels["client-events"].states[0];
    const today = Math.floor(Date.parse(body.currentTime) / dayMs) * dayMs;
    // Day 1 is today, 1 May 2018's shop; its featured pair changes tomorrow, 2 May's, and the season runs its 72 days.
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")).events.seasonStarts[4], new Date(today).toISOString().slice(0, 10));
    assert.equal(state.weeklyStoreEnd, new Date(today + dayMs).toISOString());
    assert.equal(state.seasonEnd, new Date(today + 72 * dayMs).toISOString());
    inBuild(v40, () => {
      assert.equal(itemShopOffers(new Date(today + dayMs)).BRWeeklyStorefront[0].templateId, "AthenaCharacter:cid_093_athena_commando_m_dinosaur");
      assert.equal(seasonEnd(new Date(today + 10 * dayMs)).toISOString(), state.seasonEnd);
    });
    // 3.6 keeps Season 3's: tomorrow too, with its own 68 days.
    const s3 = (await timeline(v36, "3.6")).channels["client-events"].states[0].state;
    assert.equal(s3.weeklyStoreEnd, new Date(today + dayMs).toISOString());
    assert.equal(s3.seasonEnd, new Date(today + 68 * dayMs).toISOString());
  } finally {
    await backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
