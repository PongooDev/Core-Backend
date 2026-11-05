import { test } from "node:test";
import assert from "node:assert/strict";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { versionOf } from "../src/builds/detect.js";
import { specialBookPages } from "../src/collectionbook/pages.js";
import { contentUpdateStates, updatedLootTables } from "../src/events/contentupdates.js";
import { activeEventFlags, activeStorms, groupMission, hasEventEnded, isEventActive, passiveMiniBosses, passiveStorms, spring2018, spring2018Phase1,
  storm2018, storm2018Phase1, surviveTheStorm } from "../src/events/events.js";
import { eventQuestLine } from "../src/events/quests.js";
import { springEventQuests } from "../src/events/spring2018.js";
import { firecrackerConversion } from "../src/events/springgold.js";
import { intoTheStormQuests, stormEventQuests } from "../src/events/storm2018.js";
import { stormConversion2018 } from "../src/events/stormllamas.js";
import { eventTagOfPlaylist, hasLtm, ltmEventFlags, ltmForcedQueues, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltmQuests,
  lastSelectedPlaylistOf } from "../src/events/ltms.js";
import { athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket, playlistTeamsOf, showsMatchStart } from "../src/matchmaking/service.js";
import { challengeWeekCount } from "../src/profiles/challenges.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreEnds, eventStoreInstanceNow, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 3.5.1 (++Fortnite+Release-3.5-CL-4000805, UE 4.20, 11 April 2018): Season 3, on its own data
// (gamedata/4000805), sharing 3.0's Battle Pass, clock and leaderboards. Core has no 3.4.
const v351 = "4000805";
const v33 = "3942182";
const v30 = "3901517";
const now = new Date("2026-11-04T12:00:00Z");

test("3.5.1 is known by its version, plays on its own data and is Season 3's newest, with 3.0's pass", () => {
  assert.equal(versionOf(v351), "3.5.1");
  assert.equal(dataBuild(v351), v351);
  assert.equal(dataBuild("3950000"), v33, "a 3.4 would play on 3.3's data");
  assert.ok(buildChoices().includes(v351));
  assert.equal(allowedBuildList(["3.5.1"]).join(), v351);
  assert.deepEqual(inBuild(v351, athenaSeason), inBuild(v30, athenaSeason), "AthenaSeason3 is 3.0's");
  assert.equal(buildOfSeason(3), v351);
  assert.deepEqual(inBuild(v351, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]),
    inBuild(v30, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]));
});

test("3.5.1's cosmetics: 3.4's and 3.5's added, the locker's Random entries kept, the test gliders and debug pickaxe left out", () => {
  const now351 = inBuild(v351, athenaCosmetics);
  const before = inBuild(v33, athenaCosmetics);
  const added = Object.keys(now351).filter((id) => !before[id]);
  for (const [id, name] of [["AthenaCharacter:cid_102_athena_commando_m_raven", "Raven"], ["AthenaCharacter:cid_103_athena_commando_m_bunny", "Rabbit Raider"],
    ["AthenaCharacter:cid_108_athena_commando_m_fishhead", "Leviathan"], ["AthenaCharacter:cid_107_athena_commando_f_pajamaparty", "Tricera Ops"],
    ["AthenaBackpack:bid_036_raven", "Iron Cage"], ["AthenaGlider:glider_id_024_reaper", "Feathered Flyer"], ["AthenaDance:eid_rockpaperscissors", "Rock Paper Scissors"],
    ["AthenaCharacter:cid_random", "Random Character"]]) {
    assert.ok(added.includes(id), id);
    assert.equal(now351[id].name, name, id);
  }
  assert.equal(added.length, 46);
  for (const id of ["AthenaGlider:dynamicstestglider", "AthenaGlider:glider_proxytest", "AthenaGlider:glider_teststaticparts", "AthenaPickaxe:pickaxe_id_zzz_statdebugger"]) {
    assert.equal(now351[id], undefined, id);
  }
  assert.equal(now351["AthenaBattleBus:bbid_winterbus"], undefined, "3.5's paks drop the Winter Bus");
  assert.equal(before["AthenaGlider:glider_id_019_taxi"].rarity, "Sturdy");
  assert.equal(now351["AthenaGlider:glider_id_019_taxi"].rarity, "Ordinary");
});

test("3.5.1's loot and weapons: the Port-a-Fort and Guided Missile in, the shotguns' new rarity, Vending Machines", () => {
  assert.equal(inBuild(v351, () => getItem("Weapon:athena_towergrenade")).name, "Port-a-Fort");
  assert.equal(inBuild(v351, () => getItem("Weapon:wid_rc_rocket_athena_sr_t03")).name, "Guided Missile");
  assert.equal(inBuild(v33, () => getItem("Weapon:wid_rc_rocket_athena_sr_t03")), undefined);
  // "Tactical Shotguns are now Common/Uncommon/Rare (was Uncommon/Rare/Epic)."
  assert.equal(inBuild(v351, () => getItem("Weapon:wid_shotgun_semiauto_athena_vr_ore_t03")).rarity, "Sturdy");
  assert.equal(inBuild(v33, () => getItem("Weapon:wid_shotgun_semiauto_athena_vr_ore_t03")).rarity, "Quality");
  // Its overlay is the notes' loot, served as it ships.
  assert.deepEqual(inBuild(v351, () => contentUpdateStates(now, { mode: "season" })), []);
  assert.deepEqual(inBuild(v351, () => updatedLootTables(now)), {});
  const { loot } = buildGameData(v351, "athena", {});
  const packages = loot["/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client"];
  const tiers = loot["/Game/Items/Datatables/AthenaLootTierData_Client.AthenaLootTierData_Client"];
  assert.ok(Object.values(packages).some((row) => /Athena_TowerGrenade/.test(row.ItemDefinition) && row.Weight > 0));
  assert.ok(Object.keys(tiers).some((row) => /^Loot_AthenaVending_/.test(row)));
});

test("3.5.1's weekly challenges are 3.3's ten weeks, with week 7's gnomes and week 10's skydiving rings", () => {
  assert.equal(inBuild(v351, challengeWeekCount), 10);
  const { challengeBundles } = buildGameData(v351, "athena", {});
  assert.ok(challengeBundles.s3_week7_questbundle.quests.some(({ quest }) => quest === "quest_br_interact_gnicegnomes"));
  assert.ok(challengeBundles.s3_week10_questbundle.quests.some(({ quest }) => quest === "quest_br_skydive_rings"));
});

// The shop's replay: Season 3's day 1 is 2018-02-22, so day 44 (index 43) is 6 April 2018, Raven's first day.
test("Season 3's shop on 3.5.1 sells 3.4's and 3.5's cosmetics on Epic's days, with their back blings; 3.3's shop is as it was", () => {
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 3: "2026-10-04" } };
  const day = (index) => new Date(Date.parse("2026-10-04T12:00:00Z") + index * 86400000);
  const offers = (build, index) => inBuild(build, () => itemShopOffers(day(index), config)).BRWeeklyStorefront;
  const raven = offers(v351, 43).find(({ templateId }) => templateId === "AthenaCharacter:cid_102_athena_commando_m_raven");
  assert.equal(raven.price, 2000);
  assert.deepEqual(raven.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_102_athena_commando_m_raven", "AthenaBackpack:bid_036_raven"]);
  assert.ok(!offers(v33, 43).some(({ templateId }) => /raven/.test(templateId)));
  // 1 April 2018 (index 38): Bunny Brawler and Rabbit Raider share a "Pick your Style!" tile.
  const bunnies = offers(v351, 38).filter(({ templateId }) => /_bunny$/.test(templateId));
  assert.equal(bunnies.length, 2);
  assert.ok(bunnies.every((offer) => offer.banner === "PickYourStyle" && offer.category === bunnies[0].category));
  assert.deepEqual(offers(v33, 38), [], "3.3 has none of that day's featured items");
});

test("3.5.1 ends Spring It On! and runs Into the Storm: Opening Act, Survive the Storm and the active Mutant Storms", () => {
  assert.deepEqual(activeEventFlags(v351), [passiveMiniBosses, activeStorms, surviveTheStorm, storm2018Phase1]);
  for (const flag of [spring2018Phase1, passiveStorms, groupMission]) assert.ok(!activeEventFlags(v351).includes(flag), flag);
  assert.ok(!activeEventFlags(v33).includes(storm2018Phase1));
  assert.deepEqual(activeEventFlags("3950000"), []);
  assert.equal(inBuild(v351, () => isEventActive(storm2018)), true);
  assert.equal(inBuild(v351, () => hasEventEnded(spring2018)), true);
  assert.equal(inBuild(v33, () => hasEventEnded(spring2018)), false);
});

test("Into the Storm's quests are granted on 3.5.1 only and lead to the Neon weapons and the Cyberpunk heroes; Spring It On!'s go", () => {
  const started = (build) => inBuild(build, stormEventQuests);
  assert.deepEqual(started(v351), intoTheStormQuests);
  assert.deepEqual(started(v33), []);
  assert.deepEqual(inBuild(v351, springEventQuests), []);
  const line = inBuild(v351, () => [...eventQuestLine("Storm2018")]);
  for (const id of ["stormquest_2018_reactive_servicecars", "stormquest_2018_reactive_skyatlases", "stormquest_2018_reactive_telescopes",
    "stormquest_2018_landmark_lars", "stormquest_2018_landmark_observe"]) assert.ok(line.includes(id), id);
  const atlases = inBuild(v351, () => getQuest("stormquest_2018_reactive_skyatlases"));
  assert.deepEqual(atlases.selectableRewards.map(([reward]) => reward.templateId),
    ["CardPack:cardpack_pistol_neonglow_sr", "CardPack:cardpack_shotgun_neonglow_sr", "CardPack:cardpack_assault_neonglow_sr"]);
  assert.equal(inBuild(v351, () => getQuest("stormquest_2018_landmark_observe")).selectableRewards.length, 4);
});

test("3.5.1's llama store sells the Into the Storm Llama for Storm Tickets, not the Spring Llama", () => {
  const llama = inBuild(v351, () => findOffer("core_event_intothestorm_llama"));
  assert.deepEqual([llama.templateId, llama.currencySubType, llama.price], ["CardPack:cardpack_event_2018_storm", "AccountResource:eventcurrency_stormzone", 1000]);
  assert.equal(inBuild(v351, () => findOffer("core_event_spring_llama")), undefined);
  assert.equal(inBuild(v33, () => findOffer("core_event_intothestorm_llama")), undefined);
});

test("3.5.1's leftovers: Firecracker Tickets become Spring Llamas, Storm Tickets stay Into the Storm's", () => {
  assert.equal(inBuild(v351, () => firecrackerConversion.due()), true);
  assert.equal(inBuild(v33, () => firecrackerConversion.due()), false, "Spring It On! still runs on 3.3");
  assert.deepEqual(inBuild(v351, () => firecrackerConversion.options()).llama, "CardPack:cardpack_event_2018_spring");
  assert.equal(inBuild(v351, () => stormConversion2018.due()), false, "Into the Storm's Storm Tickets buy its own llama");
  assert.equal(inBuild("3889387", () => stormConversion2018.due()), true, "2.5 still converts the storms' return");
});

test("3.5.1's Event Store stays Spring It On!'s, with Wukong and Rabbit Raider Jonesy", () => {
  assert.equal(inBuild(v351, hasEventStore), true);
  assert.equal(inBuild(v351, eventStoreInstanceNow), "Spring2018.STWSpecialEventStoreFront");
  const store = inBuild(v351, () => eventStoreOffers(now)).STWSpecialEventStoreFront.map(({ templateId }) => templateId);
  assert.ok(store.includes("Hero:hid_commando_014_wukong_sr_t01"));
  assert.ok(store.includes("Hero:hid_commando_011_m_easter_sr_t01"));
  assert.ok(!inBuild(v33, () => eventStoreOffers(now)).STWSpecialEventStoreFront.some(({ templateId }) => /easter/.test(templateId)));
  assert.ok(inBuild(v351, () => eventStoreEnds(now)).stwEventStoreEnd);
});

test("3.5.1's world: the Survive the Storm theater, Storm Ticket storms and survivals, no group mission alerts", () => {
  const info = inBuild(v351, () => worldInfo(now));
  const survival = info.theaters.find(({ displayName }) => displayName?.en === "Survive the Storm");
  assert.ok(survival, "the Survive the Storm theater is back");
  assert.equal(survival.runtimeInfo.worldMapPinClass, "/Game/Environments/WorldMap/Blueprints/WM_Pin_Round.WM_Pin_Round_C");
  const alerts = info.missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts);
  const rewardsOf = (category) => alerts.filter(({ categoryName }) => categoryName === category)
    .flatMap(({ missionAlertRewards }) => missionAlertRewards.items.map(({ itemType }) => itemType));
  assert.ok(rewardsOf("StormCategory").includes("AccountResource:eventcurrency_stormzone"));
  assert.ok(rewardsOf("Survival3DayCategory").includes("AccountResource:eventcurrency_stormzone"));
  assert.ok(!alerts.some(({ categoryName }) => categoryName === "GroupMissionCategory" || categoryName === "StormLowCategory"));
  assert.ok(!inBuild(v33, () => worldInfo(now)).theaters.some(({ displayName }) => displayName?.en === "Survive the Storm"));
});

test("3.5.1's book: the Neon weapons and Cyberpunk heroes pages are given where the data has them", () => {
  const pages = inBuild(v351, specialBookPages);
  for (const page of ["PageSpecial_StormZoneCyber_Heroes", "PageSpecial_StormZoneCyber_Ranged", "PageSpecial_StormZoneCyber_Melee_Crystal"]) assert.ok(pages.includes(page), page);
  assert.ok(!inBuild(v33, specialBookPages).some((page) => /StormZoneCyber/.test(page)));
});

test("3.5.1's LTMs: its playlist assets, 50v50 v2 its new mode, by PlaylistOverrides and not the event queues", () => {
  for (const id of ["blitz", "blitzSolo", "blitzDuo", "fiveByTwenty", "skySupply", "solidGold", "fiftyFiftyV2", "highExplosivesSolo", "highExplosivesSquads",
    "sniperShootoutSolo", "sniperShootoutDuos", "sniperShootoutSquads", "skySupplyDuos", "skySupplySquads", "solidGoldSolo", "impactSolo", "impactDuos", "impactSquads"]) {
    assert.ok(hasLtm(id, v351), id);
  }
  for (const id of ["sneakySilencers", "highExplosives", "speedyStorm", "takeToTheSkies", "lotsaLoot", "sniperShootout", "highJump", "useItOrLoseIt", "steadyStorm", "shotguns"]) {
    assert.ok(!hasLtm(id, v351), id);
    assert.ok(hasLtm(id, v33), id);
  }
  assert.ok(!hasLtm("fiftyFiftyV2", v33));
  const none = { matchmakingModes: {} };
  assert.equal(ltmNewMode(v351, none)?.id, "fiftyFiftyV2");
  assert.equal(ltmOn("fiftyFiftyV2", v351, { matchmakingModes: { fiftyFiftyV2: false } }), true, "on whatever its switch");
  assert.equal(lastSelectedPlaylistOf(ltmNewMode(v351, none), v351), "Playlist_50v50");
  assert.deepEqual(ltmPlaylistOverrides(v351, none), ["Playlist_50v50"]);
  assert.deepEqual(ltmPlaylistOverrides(v351, { matchmakingModes: { blitz: true, solidGoldSolo: true } }), ["Playlist_Blitz_Squad", "Playlist_50v50", "Playlist_SolidGold_Solo"]);
  assert.deepEqual(ltmPlaylistOverrides(v33, { matchmakingModes: { blitz: true } }), []);
  assert.deepEqual(ltmForcedQueues(v351, { matchmakingModes: { fiveByTwenty: true } }), []);
  assert.deepEqual(ltmEventFlags(v351, { matchmakingModes: { blitz: true } }), []);
  // Two ids changed modes: 23 is High Jump to 3.3, High Explosives v2 (Solo) on 3.5.1; 26 Steady Storm, then Solid Gold v2 (Solo).
  assert.equal(ltmOfPlaylist(23, v351).id, "highExplosivesSolo");
  assert.equal(ltmOfPlaylist(23, v33).id, "highJump");
  assert.equal(ltmOfPlaylist(26, v351).id, "solidGoldSolo");
  // A 3.5.1 playlist's matches count Athena.Playlist.Event.<PlaylistId>, Blitz Squads' Event.8.
  assert.deepEqual([19, 36, 37, 26, 50].map((id) => eventTagOfPlaylist(id, v351)), [8, 36, 37, 26, 50]);
  assert.deepEqual([19, 36, 37].map((id) => eventTagOfPlaylist(id, v33)), [8, 8, 8]);
  // With nothing turned on, only 50v50 v2 runs there, and it counts no event quest (its own counts Athena.Playlist.FiftyFifty).
  assert.deepEqual(ltmQuests({ running: true }, v351), []);
});

test("3.5.1's playlist teams are its assets': 50v50 v2's two sides of 50, High Explosives v2 solo on 23", () => {
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:50`, v351), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:24`, v351), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:41`, v351), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:22`, v351), { maxTeamCount: 5, maxTeamSize: 20, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:2`, v351), { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 });
  assert.equal(playlistTeamsOf(`${v33}:0:NA:50`, v33), null);
});

test("3.5.1 takes AssignMatch's six fields and no match start countdown", () => {
  assert.equal(assignmentBucket(`${v351}:0:NA:2`, v351), `Fortnite:Fortnite:${v351}:0:NA:2`);
  assert.ok(!showsMatchStart(v351));
});
