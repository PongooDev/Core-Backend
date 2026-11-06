import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { versionOf } from "../src/builds/detect.js";
import { specialBookPages } from "../src/collectionbook/pages.js";
import { contentUpdateStates, lootHotfixSection } from "../src/events/contentupdates.js";
import { activeEventFlags, activeStorms, configureEvents, hasEventEnded, isEventActive, passiveMiniBosses, spring2018, storm2018,
  storm2018Phase1, storm2018Phase2, surviveTheStorm } from "../src/events/events.js";
import { firecrackerConversion } from "../src/events/springgold.js";
import { intoTheStormQuests, stormEventQuests } from "../src/events/storm2018.js";
import { hasLtm, lastSelectedPlaylistOf, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltmSchedule, ltms } from "../src/events/ltms.js";
import { meteorStrikePhase, meteorStrikeRows, sanitizeMeteorStrike } from "../src/events/meteorstrike.js";
import { athenaCosmetics, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { mtxProfileId, usesCommonProfiles } from "../src/profiles/common.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreInstanceNow, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { bundledBackBlings, itemShopOffers } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 3.6 (++Fortnite+Release-3.6-CL-4019403, UE 4.20, 24 April 2018, Season 3's last update): its own data
// (gamedata/4019403), Into the Storm run on with the Noble Launcher, 3.5.2's playlists, and Season 3's finale ("Meteor
// Strike") set by the hotfix's AthenaGameData rows, not by event flags.
const v36 = "4019403";
const v352 = "4008490";
const v351 = "4000805";
const now = new Date("2026-11-04T12:00:00Z");
const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
const gameData = "/Game/Athena/Balance/DataTables/AthenaGameData.AthenaGameData";

test("3.6 is known by its version and plays on its own data, Season 3's newest", () => {
  assert.equal(versionOf(v36), "3.6");
  assert.equal(dataBuild(v36), v36);
  assert.ok(buildChoices().includes(v36));
  assert.equal(allowedBuildList(["3.6"]).join(), v36);
  assert.equal(inBuild(v36, athenaSeason).seasonNumber, 3);
  assert.deepEqual(inBuild(v36, athenaSeason).levels, inBuild(v351, athenaSeason).levels, "AthenaSeason3 is still 3.0's");
  assert.equal(buildOfSeason(3), v36);
});

test("3.6's data: its cosmetics, the Clinger, the LMG and Clinger in its tables, the energy cells' 100", () => {
  const cosmetics = inBuild(v36, athenaCosmetics);
  assert.equal(cosmetics["AthenaCharacter:cid_111_athena_commando_f_robo"].name, "Steelsight");
  assert.equal(cosmetics["AthenaCharacter:cid_112_athena_commando_m_brite"].name, "Brite Gunner");
  assert.equal(cosmetics["AthenaPickaxe:pickaxe_id_043_orbitingplanets"].name, "Global Axe");
  assert.equal(cosmetics["AthenaDance:eid_easternbloc"].name, "Squat Kick");
  assert.equal(cosmetics["AthenaDance:eid_tidy"].name, "Tidy");
  assert.equal(cosmetics["AthenaBackpack:bid_044_robo"].name, "Steelcast");
  assert.ok(!cosmetics["AthenaPickaxe:dev_test_pickaxe_statdebugger"], "the debug harvesting tool is left out");
  assert.ok(!inBuild(v352, athenaCosmetics)["AthenaCharacter:cid_111_athena_commando_f_robo"]);
  assert.equal(buildGameData(v36, "items", {})["Weapon:athena_stickygrenade"].name, "Clinger");
  const tables = inBuild(v36, athenaLootTables)[packages];
  assert.equal(tables["WorldList.AthenaLoot.Weapon.AssaultAuto.08"].Weight, 0.075);
  assert.equal(tables["WorldList.AthenaLoot.Weapon.AssaultAuto.09"].Weight, 0.0275);
  assert.equal(tables["WorldList.AthenaConsumables.14"].Weight, 0.25);
  assert.equal(tables["WorldList.AthenaHighConsumables.09"].Weight, 0.3, "Remote Explosives ~40% less in chests");
  const recipes = buildGameData(v36, "upgrades", {}).craftingRecipes;
  assert.equal(recipes["Ammo.EnergyCells"].results[0].quantity, 100);
});

test("3.6's world keeps its primary missions' tags, which its client paks no longer ship", () => {
  const world = (build) => buildGameData(build, "world", {});
  assert.deepEqual(world(v36).primaryMissions, world(v351).primaryMissions);
  assert.ok(world(v36).primaryMissions["/Game/Missions/Primary/Gate/Gate_Single"].tags.length > 0);
});

test("3.6 runs Into the Storm as 3.5.2 does: the same flags, quests, llama and theater", () => {
  assert.deepEqual(activeEventFlags(v36), [passiveMiniBosses, activeStorms, surviveTheStorm, storm2018Phase1, storm2018Phase2]);
  assert.deepEqual(activeEventFlags(v36), activeEventFlags(v352));
  assert.equal(inBuild(v36, () => isEventActive(storm2018)), true);
  assert.equal(inBuild(v36, () => hasEventEnded(spring2018)), true);
  assert.equal(inBuild(v36, () => hasEventEnded(storm2018)), false);
  assert.deepEqual(inBuild(v36, stormEventQuests), intoTheStormQuests);
  assert.equal(inBuild(v36, () => findOffer("core_event_intothestorm_llama")).templateId, "CardPack:cardpack_event_2018_storm");
  assert.equal(inBuild(v36, () => firecrackerConversion.due()), true);
  const info = inBuild(v36, () => worldInfo(now));
  assert.ok(info.theaters.some(({ displayName }) => displayName?.en === "Survive the Storm"));
  assert.ok(inBuild(v36, specialBookPages).includes("PageSpecial_StormZoneCyber_Heroes"));
});

test("3.6's Event Store adds the Noble Launcher to 3.5.2's", () => {
  assert.equal(inBuild(v36, hasEventStore), true);
  assert.equal(inBuild(v36, eventStoreInstanceNow), "Spring2018.STWSpecialEventStoreFront");
  const store = (build) => inBuild(build, () => eventStoreOffers(now)).STWSpecialEventStoreFront;
  const launcher = store(v36).find(({ templateId }) => templateId === "Schematic:sid_explosive_launcher_neonglow_sr_ore_t01");
  assert.ok(launcher);
  assert.deepEqual([launcher.price, launcher.eventLimit], [1680, 1]);
  assert.ok(store(v36).some(({ templateId }) => templateId === "Schematic:sid_assault_neonglow_lmg_sr_ore_t01"));
  assert.ok(!store(v352).some(({ templateId }) => /explosive_launcher_neonglow/.test(templateId)));
});

test("3.6's shop sells its cosmetics on the days Epic did, with their back blings", () => {
  // Season 3's day 1 is 2018-02-22: day 65 (index 64) is 27 April, Steelsight's first; index 66 is 29 April.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 3: "2026-10-04" } };
  const day = (index) => new Date(Date.parse("2026-10-04T12:00:00Z") + index * 86400000);
  const offers = (build, index, front = "BRWeeklyStorefront") => inBuild(build, () => itemShopOffers(day(index), config))[front];
  const steelsight = offers(v36, 64).find(({ templateId }) => templateId === "AthenaCharacter:cid_111_athena_commando_f_robo");
  assert.equal(steelsight.price, 1500);
  assert.deepEqual(steelsight.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_111_athena_commando_f_robo", "AthenaBackpack:bid_044_robo"]);
  const brite = offers(v36, 66).find(({ templateId }) => templateId === "AthenaCharacter:cid_112_athena_commando_m_brite");
  assert.deepEqual(brite.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_112_athena_commando_m_brite", "AthenaBackpack:bid_026_brite"]);
  assert.ok(offers(v36, 66).some(({ templateId }) => templateId === "AthenaPickaxe:pickaxe_id_043_orbitingplanets"));
  assert.ok(offers(v36, 65, "BRDailyStorefront").some(({ templateId }) => templateId === "AthenaDance:eid_easternbloc"));
  assert.ok(offers(v36, 67, "BRDailyStorefront").some(({ templateId }) => templateId === "AthenaDance:eid_tidy"));
  assert.ok(!offers(v352, 64).some(({ templateId }) => /robo/.test(templateId)), "3.5.2's data has no Steelsight");
  assert.equal(bundledBackBlings["AthenaCharacter:cid_112_athena_commando_m_brite"], "AthenaBackpack:bid_026_brite");
});

test("3.6's lobby: 3.5.2's playlists, no new mode (50v50 v2 by its switch)", () => {
  for (const ltm of ltms.filter((candidate) => hasLtm(candidate.id, v352))) assert.ok(hasLtm(ltm.id, v36), ltm.id);
  const none = { matchmakingModes: {} };
  assert.equal(ltmNewMode(v36, none), null);
  assert.equal(ltmNewMode(v352, none)?.id, "fiftyFiftyV2");
  assert.equal(ltmOn("fiftyFiftyV2", v36, none), false);
  assert.equal(ltmOn("fiftyFiftyV2", v36, { matchmakingModes: { fiftyFiftyV2: true } }), true);
  assert.equal(lastSelectedPlaylistOf(ltms.find(({ id }) => id === "fiftyFiftyV2"), v36), "Playlist_50v50");
  assert.deepEqual(ltmPlaylistOverrides(v36, { matchmakingModes: { blitz: true } }), ["Playlist_Blitz_Squad"]);
  assert.equal(ltmOfPlaylist(23, v36).id, "highExplosivesSolo");
  assert.ok(!ltmOfPlaylist(32, v36), "Playlist_Fortnite is left out");
  const listed = ltmSchedule({}, now).list;
  assert.equal(listed.find(({ id }) => id === "fiftyFiftyV2").builds, "3.5.1 to 4.0");
  assert.equal(listed.find(({ id }) => id === "fiftyFiftyV2").newIn, "3.5.1 and 3.5.2");
  assert.deepEqual(playlistTeamsOf(`${v36}:0:NA:50`, v36), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
  assert.equal(assignmentBucket(`${v36}:0:NA:2`, v36), `Fortnite:Fortnite:${v36}:0:NA:2`);
});

test("3.6 takes no loot update (its tables have the LMG in); 3.5.2's LMG is 4.20 RowUpdates at 3.6's weights", () => {
  assert.deepEqual(inBuild(v36, () => contentUpdateStates(now)), []);
  const v352Section = inBuild(v352, () => lootHotfixSection(now)).split("\r\n");
  assert.deepEqual(v352Section, ["[AssetHotfix]",
    `+DataTable=${packages};RowUpdate;WorldList.AthenaLoot.Weapon.AssaultAuto.08;Weight;0.075`,
    `+DataTable=${packages};RowUpdate;WorldList.AthenaLoot.Weapon.AssaultAuto.09;Weight;0.0275`,
    `+DataTable=${packages};RowUpdate;WorldList.AthenaLoot.VendingMachine.Weapons.Rare.Medium.05;Weight;1`,
    `+DataTable=${packages};RowUpdate;WorldList.AthenaLoot.VendingMachine.Weapons.Epic.Medium.03;Weight;1`, ""]);
  assert.ok(inBuild("3807424", () => lootHotfixSection(now, { mode: "all", overrides: {} })).includes("+DataTable=(\""), "4.19 keeps its form");
});

test("3.6's Meteor Strike: no event flag, the hotfix's AthenaGameData rows by the admin's phase", () => {
  try {
    configureEvents({ mode: "auto" });
    assert.equal(meteorStrikePhase(v36), "meteors");
    assert.equal(meteorStrikePhase(v352), null);
    assert.deepEqual(meteorStrikeRows(v36).map(({ row, value }) => [row, value]),
      [["Default.BroadcastEnabled", 1], ["Default.SkyboxAudioEnabled", 1], ["Default.MeteorSpawnLevel", 1]]);
    assert.ok(!activeEventFlags(v36).some((flag) => /Meteor|Comet|Broadcast/i.test(flag)));
    const section = inBuild(v36, () => lootHotfixSection(now, null, [], meteorStrikeRows(v36))).split("\r\n");
    assert.deepEqual(section, ["[AssetHotfix]", `+CurveTable=${gameData};RowUpdate;Default.BroadcastEnabled;0;1`,
      `+CurveTable=${gameData};RowUpdate;Default.SkyboxAudioEnabled;0;1`, `+CurveTable=${gameData};RowUpdate;Default.MeteorSpawnLevel;0;1`, ""]);
    configureEvents({ mode: "auto", meteorStrike: "impact" });
    assert.equal(meteorStrikeRows(v36).at(-1).value, 2);
    configureEvents({ mode: "auto", meteorStrike: "broadcast" });
    assert.deepEqual(meteorStrikeRows(v36).map(({ row }) => row), ["Default.BroadcastEnabled", "Default.SkyboxAudioEnabled"]);
    configureEvents({ mode: "auto", meteorStrike: "none" });
    assert.deepEqual(meteorStrikeRows(v36), []);
    configureEvents({ mode: "off", meteorStrike: "impact" });
    assert.deepEqual(meteorStrikeRows(v36), [], "the seasonal events off turn it off");
    assert.equal(sanitizeMeteorStrike("IMPACT"), "impact");
    assert.equal(sanitizeMeteorStrike("bogus"), "meteors");
  } finally {
    configureEvents(null);
  }
});

test("3.6 uses common_core and common_public, as 3.5.x", () => {
  assert.equal(inBuild(v36, () => usesCommonProfiles()), true);
  assert.equal(inBuild(v36, () => mtxProfileId()), "common_core");
});
