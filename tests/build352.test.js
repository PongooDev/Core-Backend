import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { versionOf } from "../src/builds/detect.js";
import { specialBookPages } from "../src/collectionbook/pages.js";
import { contentUpdateStates, lootHotfixSection, updatedLootTables } from "../src/events/contentupdates.js";
import { activeEventFlags, activeStorms, hasEventEnded, isEventActive, passiveMiniBosses, spring2018, storm2018, storm2018Phase1, storm2018Phase2,
  surviveTheStorm } from "../src/events/events.js";
import { firecrackerConversion } from "../src/events/springgold.js";
import { intoTheStormQuests, stormEventQuests } from "../src/events/storm2018.js";
import { stormConversion2018 } from "../src/events/stormllamas.js";
import { hasLtm, lastSelectedPlaylistOf, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltmSchedule, ltms } from "../src/events/ltms.js";
import { athenaCosmetics, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { mtxProfileId, usesCommonProfiles } from "../src/profiles/common.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreInstanceNow, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 3.5.2 (++Fortnite+Release-3.5-CL-4008490, UE 4.20, Content Update v3.50, 19 April 2018): its paks give the
// extractor 3.5.1's data byte for byte, so it plays on gamedata/4000805, and runs all of 3.5.1 plus its update's
// Into the Storm: Encore, Mercury LMG and Battle Royale Light Machine Gun.
const v352 = "4008490";
const v351 = "4000805";
const now = new Date("2026-11-04T12:00:00Z");
const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";

test("3.5.2 is known by its version and plays on 3.5.1's data, Season 3's", () => {
  assert.equal(versionOf(v352), "3.5.2");
  assert.equal(dataBuild(v352), v351);
  assert.ok(buildChoices().includes(v352));
  assert.equal(allowedBuildList(["3.5.2"]).join(), v352);
  assert.deepEqual(inBuild(v352, athenaSeason), inBuild(v351, athenaSeason));
  assert.deepEqual(Object.keys(inBuild(v352, athenaCosmetics)), Object.keys(inBuild(v351, athenaCosmetics)));
  assert.equal(buildOfSeason(3), v351, "Season 3's newest data is still 3.5.1's");
});

test("3.5.2 runs Into the Storm with the Encore: 3.5.1's flags and Storm2018Phase2", () => {
  assert.deepEqual(activeEventFlags(v352), [passiveMiniBosses, activeStorms, surviveTheStorm, storm2018Phase1, storm2018Phase2]);
  assert.ok(!activeEventFlags(v351).includes(storm2018Phase2), "the Encore is 3.5.2's update");
  assert.equal(inBuild(v352, () => isEventActive(storm2018)), true);
  assert.equal(inBuild(v352, () => hasEventEnded(spring2018)), true);
  assert.equal(inBuild(v352, () => hasEventEnded(storm2018)), false);
  assert.deepEqual(inBuild(v352, stormEventQuests), intoTheStormQuests);
  const llama = inBuild(v352, () => findOffer("core_event_intothestorm_llama"));
  assert.equal(llama.templateId, "CardPack:cardpack_event_2018_storm");
  assert.equal(inBuild(v352, () => firecrackerConversion.due()), true);
  assert.equal(inBuild(v352, () => stormConversion2018.due()), false);
  const info = inBuild(v352, () => worldInfo(now));
  assert.ok(info.theaters.some(({ displayName }) => displayName?.en === "Survive the Storm"));
  assert.ok(inBuild(v352, specialBookPages).includes("PageSpecial_StormZoneCyber_Heroes"));
});

test("3.5.2's Event Store adds the Mercury LMG to Spring It On!'s, which 3.5.1's lacks", () => {
  assert.equal(inBuild(v352, hasEventStore), true);
  assert.equal(inBuild(v352, eventStoreInstanceNow), "Spring2018.STWSpecialEventStoreFront");
  const store = (build) => inBuild(build, () => eventStoreOffers(now)).STWSpecialEventStoreFront;
  const lmg = store(v352).find(({ templateId }) => templateId === "Schematic:sid_assault_neonglow_lmg_sr_ore_t01");
  assert.ok(lmg);
  assert.deepEqual([lmg.price, lmg.eventLimit], [1680, 1]);
  assert.ok(store(v352).some(({ templateId }) => templateId === "Hero:hid_commando_011_m_easter_sr_t01"));
  assert.ok(!store(v351).some(({ templateId }) => /neonglow_lmg/.test(templateId)));
});

test("3.5.2's lobby: 3.5.1's playlists, 50v50 v2 its new mode too", () => {
  for (const ltm of ltms.filter((candidate) => hasLtm(candidate.id, v351))) assert.ok(hasLtm(ltm.id, v352), ltm.id);
  const none = { matchmakingModes: {} };
  assert.equal(ltmNewMode(v352, none)?.id, "fiftyFiftyV2");
  assert.equal(ltmNewMode(v351, none)?.id, "fiftyFiftyV2");
  assert.equal(ltmOn("fiftyFiftyV2", v352, { matchmakingModes: { fiftyFiftyV2: false } }), true);
  assert.equal(lastSelectedPlaylistOf(ltmNewMode(v352, none), v352), "Playlist_50v50");
  assert.deepEqual(ltmPlaylistOverrides(v352, { matchmakingModes: { blitz: true } }), ["Playlist_Blitz_Squad", "Playlist_50v50"]);
  assert.equal(ltmOfPlaylist(23, v352).id, "highExplosivesSolo");
  const listed = ltmSchedule({}, now).list;
  assert.equal(listed.find(({ id }) => id === "fiftyFiftyV2").newIn, "3.5.1 and 3.5.2");
  assert.equal(listed.find(({ id }) => id === "fiftyFiftyV2").builds, "3.5.1 to 3.5.2");
  assert.deepEqual(playlistTeamsOf(`${v352}:0:NA:50`, v352), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
  assert.equal(assignmentBucket(`${v352}:0:NA:2`, v352), `Fortnite:Fortnite:${v352}:0:NA:2`);
});

test("3.5.2 serves the Light Machine Gun's loot hotfix, always; 3.5.1 and 3.3 get none", () => {
  assert.deepEqual(inBuild(v352, () => contentUpdateStates(now)).map(({ id, on, why }) => [id, on, why]), [["lightMachineGun", true, "shipped"]]);
  assert.deepEqual(inBuild(v351, () => contentUpdateStates(now)), []);
  assert.deepEqual(inBuild("3942182", () => contentUpdateStates(now)), []);
  const shipped = inBuild(v352, athenaLootTables)[packages];
  assert.equal(shipped["WorldList.AthenaLoot.Weapon.AssaultAuto.08"].Weight, 0);
  const rows = inBuild(v352, () => updatedLootTables(now))[packages];
  const weight = (name) => rows.find((row) => row.Name === name).Weight;
  assert.equal(weight("WorldList.AthenaLoot.Weapon.AssaultAuto.08"), 0.1);
  assert.equal(weight("WorldList.AthenaLoot.Weapon.AssaultAuto.09"), 0.0375);
  assert.equal(weight("WorldList.AthenaLoot.VendingMachine.Weapons.Rare.Medium.05"), 1);
  assert.equal(weight("WorldList.AthenaLoot.VendingMachine.Weapons.Epic.Medium.03"), 1);
  assert.equal(weight("WorldList.AthenaSupplyDrop.Weapon.Assault.03"), 0, "the notes keep it out of supply drops");
  const section = inBuild(v352, () => lootHotfixSection(now));
  assert.ok(section.startsWith("[AssetHotfix]\r\n+DataTable=(\"/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client\",\""));
  assert.equal(inBuild(v351, () => lootHotfixSection(now)), "");
});

test("3.5.2 uses common_core and common_public, as 3.5.1", () => {
  assert.equal(inBuild(v352, () => usesCommonProfiles()), true);
  assert.equal(inBuild(v352, () => mtxProfileId()), "common_core");
});
