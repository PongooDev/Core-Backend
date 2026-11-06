import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { specialBookPages } from "../src/collectionbook/pages.js";
import { blockbusterEventQuests, blockbusterQuests } from "../src/events/blockbuster2018.js";
import { contentUpdateStates, lootHotfixSection } from "../src/events/contentupdates.js";
import { activeEventFlags, activeMiniBosses, blockbuster2018, blockbuster2018Phase1, hasEventEnded, isEventActive, lobbySeason4,
  passiveStorms, storm2018 } from "../src/events/events.js";
import { hasLtm, inOriginalWindow, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltms, ltmSchedule } from "../src/events/ltms.js";
import { meteorStrikePhase, meteorStrikeRows } from "../src/events/meteorstrike.js";
import { stormConversion2018Storm } from "../src/events/stormllamas.js";
import { athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { mtxProfileId, usesCommonProfiles } from "../src/profiles/common.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { defaultMatchmakingModes } from "../src/settings/store.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreInstanceNow, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { hasRefunds } from "../src/store/refunds.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 4.1 (++Fortnite+Release-4.1-CL-4053532, UE 4.20, 8 May 2018): its own data (gamedata/4053532), Season 4 as
// 4.0's, the Infinity Gauntlet LTM, the HackSAW in the Weekly Store and Blockbuster Part 1 running on.
const v41 = "4053532";
const v40 = "4039451";
const now = new Date("2026-11-06T12:00:00Z");
const hackSaw = "Schematic:sid_assault_lmg_military_sr_ore_t01";
const snap = "AthenaDance:eid_snap";

test("4.1 is known by its version, plays on its own data and is Season 4's newest", () => {
  assert.equal(versionOf(v41), "4.1");
  assert.equal(dataBuild(v41), v41);
  assert.equal(dataBuild(v40), v40);
  assert.ok(buildChoices().includes(v41));
  assert.equal(allowedBuildList(["4.1"]).join(), v41);
  const season = inBuild(v41, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.numBookLevels, season.storefront, season.battlePassLevelOfferId],
    [4, 100, "BRSeason4", "E9527AF46F4B4A9CAE98D91F2AA53CB6"]);
  assert.deepEqual(season, inBuild(v40, athenaSeason), "4.1 keeps 4.0's AthenaSeason4");
  assert.equal(buildOfSeason(4), v41);
  assert.equal(seasonName(4), "Season 4 (4.0 – 4.1)");
});

test("4.1's data: 4.0's and the Snap emote; the HackSAW is a store item; 4.0's mission alerts", () => {
  const cosmetics41 = inBuild(v41, athenaCosmetics);
  const cosmetics40 = inBuild(v40, athenaCosmetics);
  assert.deepEqual(Object.keys(cosmetics41).filter((id) => !cosmetics40[id]), [snap]);
  assert.equal(cosmetics41[snap].name, "Snap");
  const saw41 = inBuild(v41, () => getItem(hackSaw));
  const saw40 = inBuild(v40, () => getItem(hackSaw));
  assert.equal(saw40.recycleRecipe, "Recycle.Ranged.SR.T01");
  assert.equal(saw41.recycleRecipe, undefined);
  assert.equal(saw41.inventorySizeLimited, undefined);
  assert.equal(inBuild(v41, () => getItem("Hero:hid_ninja_myth02_sr_t01")).name, "The Cloaked Star");
  const world = (build) => buildGameData(build, "world", {});
  assert.deepEqual(world(v41).missionAlerts, world(v40).missionAlerts, "4.1's paks name no MissionAlerts: 4.0's rows");
  assert.deepEqual(world(v41).missionAlertSpreads, world(v40).missionAlertSpreads);
  assert.deepEqual(buildGameData(v41, "quests", {}), buildGameData(v40, "quests", {}));
  assert.ok(world(v41).missionGenerators["/Game/World/MissionGens/Athena/MissionGen_AthenaEvent33.MissionGen_AthenaEvent33_C"]);
});

test("4.1's event flags are 4.0's: Blockbuster Part 1, active Mini-Bosses, passive storms and the Season 4 lobby", () => {
  assert.deepEqual(activeEventFlags(v41), [blockbuster2018Phase1, activeMiniBosses, passiveStorms, lobbySeason4]);
  assert.deepEqual(activeEventFlags(v40), [blockbuster2018Phase1, activeMiniBosses, passiveStorms, lobbySeason4]);
  assert.ok(!activeEventFlags(v41).includes("EventFlag.Blockbuster2018Phase2"), "Part 2 is 30 May's");
  assert.equal(inBuild(v41, () => isEventActive(blockbuster2018)), true);
  assert.equal(inBuild(v41, () => isEventActive(storm2018)), false);
  assert.equal(inBuild(v41, () => hasEventEnded(storm2018)), true);
  assert.equal(inBuild(v41, () => hasEventEnded(blockbuster2018)), false);
});

test("4.1's Save the World: Blockbuster's quests, llama, Mini-Bosses, Event Store, and the HackSAW in the Weekly Store", () => {
  assert.deepEqual(inBuild(v41, blockbusterEventQuests), blockbusterQuests);
  assert.ok(inBuild(v41, () => findOffer("core_event_blockbuster_llama")));
  const alerts = inBuild(v41, () => worldInfo(now)).missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts);
  assert.ok(alerts.some(({ categoryName }) => categoryName === "MiniBossCategory"));
  assert.ok(inBuild(v41, () => worldInfo(now)).theaters.length > 0);
  assert.equal(inBuild(v41, hasEventStore), true);
  assert.equal(inBuild(v41, eventStoreInstanceNow), "Blockbuster2018.STWSpecialEventStoreFront");
  const offers41 = inBuild(v41, () => eventStoreOffers(now));
  assert.deepEqual(offers41.STWSpecialEventStoreFront.map(({ templateId }) => templateId), ["Hero:hid_commando_myth02_sr_t01"]);
  const saw = offers41.STWRotationalEventStorefront.find(({ templateId }) => templateId === hackSaw);
  assert.deepEqual([saw.price, saw.eventLimit, saw.currencySubType], [1680, 1, "AccountResource:eventcurrency_scaling"]);
  const weekly40 = inBuild(v40, () => eventStoreOffers(now)).STWRotationalEventStorefront;
  assert.ok(!weekly40.some(({ templateId }) => templateId === hackSaw), "4.0's week keeps the DragonFire");
  assert.ok(weekly40.some(({ templateId }) => templateId === "Schematic:sid_shotgun_dragon_drum_sr_ore_t01"));
  assert.ok(inBuild(v41, specialBookPages).includes("PageSpecial_Blockbuster2018_Heroes"));
  assert.equal(inBuild(v41, () => stormConversion2018Storm.due()), true);
});

test("4.1's new mode is the Infinity Gauntlet (Playlist_Carmine, solo); 4.0's playlists run on, 4.0 has no new mode", () => {
  const none = { matchmakingModes: {} };
  for (const ltm of ltms.filter((candidate) => hasLtm(candidate.id, v40))) assert.ok(hasLtm(ltm.id, v41), ltm.id);
  assert.equal(ltmNewMode(v41, none).id, "infinityGauntlet");
  assert.equal(ltmNewMode(v40, none), null);
  assert.equal(hasLtm("infinityGauntlet", v40), false);
  assert.equal(ltmOn("infinityGauntlet", v41, { matchmakingModes: { infinityGauntlet: false } }), true);
  assert.equal(ltmOfPlaylist(33, v41).id, "infinityGauntlet");
  assert.deepEqual(playlistTeamsOf(`${v41}:0:NA:33`, v41), { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 });
  assert.ok(ltmPlaylistOverrides(v41, none).includes("Playlist_Carmine"));
  assert.ok(!ltmPlaylistOverrides(v40, { matchmakingModes: { infinityGauntlet: true } }).includes("Playlist_Carmine"));
  assert.deepEqual(ltmPlaylistOverrides(v41, { matchmakingModes: { blitz: true } }), ["Playlist_Blitz_Squad", "Playlist_Carmine"]);
  assert.equal(defaultMatchmakingModes.infinityGauntlet, false);
  const entry = ltmSchedule({ matchmakingModes: {} }, now).list.find(({ id }) => id === "infinityGauntlet");
  assert.deepEqual([entry.builds, entry.newIn, entry.original.start, entry.original.end], ["4.1", "4.1", "2018-05-08", "2018-05-15"]);
  assert.equal(inOriginalWindow("infinityGauntlet", v40, now), false);
});

test("4.1's shop is Season 4's: the Snap emote on 21 May and 20 June, only on 4.1", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season4.json", import.meta.url), "utf8")).days;
  const withSnap = history.filter((day) => day.daily.some(([templateId]) => templateId === snap));
  assert.deepEqual(withSnap.map(({ date, daily }) => [date, daily.at(-1)]), [["2018-05-21", [snap, 200]], ["2018-06-20", [snap, 200]]]);
  const cosmetics = inBuild(v41, athenaCosmetics);
  for (const day of history) for (const [templateId] of [...day.featured, ...day.daily]) assert.ok(cosmetics[templateId], `${day.date} ${templateId}`);
  // 21 May is the season's day 21.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 4: "2026-10-17" } };
  const daily = (build) => inBuild(build, () => itemShopOffers(now, config)).BRDailyStorefront.map(({ templateId }) => templateId);
  assert.ok(daily(v41).includes(snap));
  assert.ok(!daily(v40).includes(snap));
  assert.deepEqual(daily(v41).filter((templateId) => templateId !== snap), daily(v40));
});

test("4.1 keeps 4.0's gates: common profiles, returns, no content update or curve RowUpdate", () => {
  assert.equal(inBuild(v41, () => usesCommonProfiles()), true);
  assert.equal(inBuild(v41, () => mtxProfileId()), "common_core");
  assert.equal(hasRefunds(v41), true);
  assert.deepEqual(inBuild(v41, () => contentUpdateStates(now)), []);
  assert.equal(meteorStrikePhase(v41), null);
  assert.deepEqual(meteorStrikeRows(v41), []);
  assert.equal(inBuild(v41, () => lootHotfixSection(now, null, [], meteorStrikeRows(v41), v41)), "");
});
