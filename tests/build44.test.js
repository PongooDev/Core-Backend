import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { contentUpdateStates, lootHotfixSection } from "../src/events/contentupdates.js";
import { activeEventFlags, activeMiniBosses, blockbuster2018, blockbuster2018Phase1, blockbuster2018Phase2, blockbuster2018Phase3, groupMission,
  isEventActive, lobbySeason4, passiveStorms } from "../src/events/events.js";
import { configureEvents } from "../src/events/events.js";
import { hasLtm, inOriginalWindow, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltms } from "../src/events/ltms.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { meteorStrikePhase, meteorStrikeRows } from "../src/events/meteorstrike.js";
import { athenaChallengeBundles, athenaCosmetics, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { brokenChallengeOf } from "../src/profiles/challenges.js";
import { mtxProfileId, usesCommonProfiles } from "../src/profiles/common.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { hasRefunds } from "../src/store/refunds.js";

// Fortnite 4.4: 4.4.0 (++Fortnite+Release-4.4 CL-4117433, 12 June 2018), 4.4.1 (++Fortnite+Release-4.4 CL-4127312, 14
// June) and 4.4.2 (++Fortnite+Release-4.4.x CL-4132537, 19 June), all on 4.4.2's data (gamedata/4132537).
const v440 = "4117433";
const v441 = "4127312";
const v442 = "4132537";
const v44 = [v440, v441, v442];
const v42 = "4072250";
const v40 = "4039451";
const now = new Date("2026-11-08T12:00:00Z");

test("4.4.0, 4.4.1 and 4.4.2 are known by their versions, play on 4.4.2's data and are Season 4's newest", () => {
  assert.deepEqual(v44.map(versionOf), ["4.4.0", "4.4.1", "4.4.2"]);
  for (const build of v44) {
    assert.equal(dataBuild(build), v442, `${build} plays on 4.4.2's data, not 4.2's`);
    assert.ok(buildChoices().includes(build));
  }
  assert.equal(dataBuild(v42), v42);
  assert.equal(dataBuild("4100000"), v42, "a 4.3 build Core doesn't know still plays on 4.2's");
  assert.equal(dataBuild("4140000"), v442);
  assert.equal(allowedBuildList(["4.4.0", "4.4.1", "4.4.2"]).join(), v44.join());
  assert.deepEqual(inBuild(v442, athenaSeason), inBuild(v40, athenaSeason), "4.4 keeps 4.0's AthenaSeason4");
  for (const build of v44) assert.deepEqual(inBuild(build, athenaCosmetics), inBuild(v442, athenaCosmetics));
  assert.equal(buildOfSeason(4), v442);
  assert.equal(seasonName(4), "Season 4 (4.0 – 4.4.2)");
});

test("4.4's data: 4.3's and 4.4's cosmetics, the revised weekly challenges, the Stink Bomb, Thermal Scope AR, Bouncer and Mushrooms", () => {
  const cosmetics44 = inBuild(v442, athenaCosmetics);
  const cosmetics42 = inBuild(v42, athenaCosmetics);
  const added = Object.keys(cosmetics44).filter((id) => !cosmetics42[id]);
  assert.equal(added.length, 56);
  assert.deepEqual(["AthenaCharacter:cid_136_athena_commando_m_basketball", "AthenaCharacter:cid_134_athena_commando_m_jailbird",
    "AthenaCharacter:cid_141_athena_commando_m_darkeagle", "AthenaCharacter:cid_143_athena_commando_f_darkninja", "AthenaCharacter:cid_144_athena_commando_m_soccerdudea"]
    .map((id) => cosmetics44[id].name), ["Jumpshot", "Scoundrel", "Omen", "Fate", "Super Striker"]);
  assert.equal(cosmetics44["AthenaLoadingScreen:lsid_015_s4cumulative7"].name, "The Visitor");
  // Week 7's goal challenge counts the pitches' own stats now.
  const week7 = inBuild(v442, athenaChallengeBundles).questbundle_s4_week_007.quests.map(({ quest }) => quest);
  assert.ok(week7.includes("quest_br_score_goals"));
  const loot = (build) => inBuild(build, athenaLootTables)["/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client"];
  const l44 = loot(v442);
  assert.ok(l44["WorldList.AthenaHighConsumables.11"].ItemDefinition.endsWith("Athena_GasGrenade"), "the Stink Bomb");
  assert.deepEqual([l44["WorldList.AthenaHighConsumables.11"].Weight, l44["WorldList.AthenaHighConsumables.11"].Count], [0.2, 3]);
  assert.ok(l44["WorldList.AthenaLoot.VendingMachine.Consumables.Epic.04"].ItemDefinition.endsWith("Athena_GasGrenade"), "in Vending Machines");
  assert.ok(l44["WorldList.AthenaLoot.Weapon.AssaultAuto.08"].ItemDefinition.includes("WID_Assault_Surgical_Thermal_Athena_VR_Ore_T03"), "the Thermal Scope AR");
  assert.ok(l44["WorldList.AthenaTraps.09"].ItemDefinition.includes("TID_Context_BouncePad_Athena"), "the Bouncer");
  assert.ok(l44["WorldList.ForagedItems.Swamp.01"].ItemDefinition.includes("Athena_Foraged_ShieldsSmall"), "Mushrooms");
  // Content Update v4.30: Supply Llamas' 500 materials down to 200.
  assert.deepEqual([loot(v42)["WorldList.AthenaLlama.Wood.01"].Count, l44["WorldList.AthenaLlama.Wood.01"].Count], [500, 200]);
  const world = (build) => buildGameData(build, "world", {});
  assert.deepEqual(world(v442).missionAlerts, world(v42).missionAlerts, "4.4's paks name no MissionAlerts: 4.2's (4.0's) rows");
});

test("4.4's shop is Season 4's with 4.3's and 4.4's cosmetics, which 4.2 doesn't sell", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season4.json", import.meta.url), "utf8")).days;
  const cosmetics44 = inBuild(v442, athenaCosmetics);
  const cosmetics42 = inBuild(v42, athenaCosmetics);
  for (const day of history) for (const [templateId] of [...day.featured, ...day.daily]) assert.ok(cosmetics44[templateId], `${day.date} ${templateId}`);
  const sold = new Set(history.flatMap((day) => [...day.featured, ...day.daily].map(([templateId]) => templateId)).filter((id) => !cosmetics42[id]));
  assert.equal(sold.size, 39);
  const june15 = history.find(({ date }) => date === "2018-06-15");
  assert.deepEqual(june15.featured.slice(0, 2), [["AthenaCharacter:cid_147_athena_commando_m_soccerduded", 1200, { tile: 1, banner: "PickYourStyle" }],
    ["AthenaCharacter:cid_144_athena_commando_m_soccerdudea", 1200, { tile: 1, banner: "PickYourStyle" }]]);
  // 9 June: Ventura joins Venturion's tile.
  const june9 = history.find(({ date }) => date === "2018-06-09");
  assert.deepEqual(june9.featured.find(([id]) => id === "AthenaCharacter:cid_133_athena_commando_f_deco")[2], { tile: 2, banner: "PickYourStyle" });
  assert.equal(june9.featured.find(([id]) => id === "AthenaCharacter:cid_129_athena_commando_m_deco")[2].tile, 2);
  // 17 June is the season's day 48: Omen on 4.4 only.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 4: "2026-09-22" } };
  const featured = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront.map(({ templateId }) => templateId);
  for (const build of v44) assert.ok(featured(build).includes("AthenaCharacter:cid_141_athena_commando_m_darkeagle"), build);
  assert.ok(!featured(v42).includes("AthenaCharacter:cid_141_athena_commando_m_darkeagle"));
});

test("4.4's event flags: Blockbuster Parts 1 to 3, group missions, active Mini-Bosses, passive storms and the Season 4 lobby", () => {
  for (const build of v44) {
    assert.deepEqual(activeEventFlags(build), [groupMission, blockbuster2018Phase1, blockbuster2018Phase2, blockbuster2018Phase3, activeMiniBosses, passiveStorms,
      lobbySeason4], build);
    assert.equal(inBuild(build, () => isEventActive(blockbuster2018)), true);
  }
  assert.ok(!activeEventFlags(v442).includes("EventFlag.Blockbuster2018Phase4"), "Part 4 is 4.5's");
  assert.ok(!activeEventFlags(v42).includes(blockbuster2018Phase2));
});

test("4.4's paks drop 4.2's LTMs but Playground: none of them is offered there", () => {
  const all = { matchmakingModes: Object.fromEntries(ltms.map(({ id }) => [id, true])) };
  const kept = ["playground"];
  for (const ltm of ltms.filter((candidate) => hasLtm(candidate.id, v42))) {
    for (const build of v44) assert.equal(hasLtm(ltm.id, build), kept.includes(ltm.id), `${ltm.id} on ${build}`);
  }
  for (const build of v44) {
    const offered = ltmPlaylistOverrides(build, all);
    for (const name of ["Playlist_Blitz_Squad", "Playlist_5x20", "Playlist_SolidGold_Squads", "Playlist_Carmine", "Playlist_Close_Squad", "Playlist_Comp_Solo"]) {
      assert.ok(!offered.includes(name), `${name} on ${build}`);
    }
    assert.ok(offered.includes("Playlist_Playground"));
  }
  assert.equal(ltmOn("playground", v442, { matchmakingModes: {} }), false, "by its switch");
});

test("4.4 keeps 4.2's gates: common profiles, returns, no content update or curve RowUpdate", () => {
  for (const build of v44) {
    assert.equal(inBuild(build, () => usesCommonProfiles()), true);
    assert.equal(inBuild(build, () => mtxProfileId()), "common_core");
    assert.equal(hasRefunds(build), true);
    assert.deepEqual(inBuild(build, () => contentUpdateStates(now)), []);
    assert.equal(meteorStrikePhase(build), null);
    assert.deepEqual(meteorStrikeRows(build), []);
    assert.equal(inBuild(build, () => lootHotfixSection(now, null, [], meteorStrikeRows(build), build)), "");
  }
});

test("no broken challenge is listed for 4.4: its goal and Minigun/LMG challenges count", () => {
  for (const quest of ["quest_br_score_goals", "quest_br_eliminate_weapon_minigunlmg", "quest_br_watch_replay", "quest_br_visit_scavengerhunt_stormcircles"]) {
    for (const build of v44) assert.equal(brokenChallengeOf(quest, build), undefined, `${quest} on ${build}`);
  }
  assert.ok(brokenChallengeOf("quest_br_score_goals", v42), "4.2's stays listed");
});

// PongooDev/CoreV2#328: Update v4.40's 50v50 v3, 4.4's Playlist_50v50.
test("50v50 v3 is 4.4's Playlist_50v50: 4.4.0's new mode, two teams of 50, by its switch or 50v50's window on 4.4.1 and 4.4.2 (#328)", () => {
  const none = { matchmakingModes: {} };
  for (const build of v44) {
    assert.equal(hasLtm("fiftyFiftyV3", build), true, build);
    assert.equal(ltmOfPlaylist(50, build).id, "fiftyFiftyV3");
    assert.deepEqual(playlistTeamsOf(`${build}:0:NA:50`, build), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
    assert.ok(ltmPlaylistOverrides(build, { matchmakingModes: { fiftyFiftyV3: true } }).includes("Playlist_50v50"));
  }
  assert.equal(ltmNewMode(v440, none).id, "fiftyFiftyV3");
  assert.equal(ltmOn("fiftyFiftyV3", v440, none), true, "on 4.4.0 whatever its switch");
  assert.equal(ltmOn("fiftyFiftyV3", v441, none), false);
  assert.equal(ltmOn("fiftyFiftyV3", v442, { matchmakingModes: { fiftyFiftyV3: true } }), true);
  assert.equal(hasLtm("fiftyFiftyV3", v42), false);
  assert.equal(ltmOfPlaylist(50, v42).id, "fiftyFiftyV2");
  configureEvents({ mode: "auto", seasonStarts: { 4: "2018-05-01" } });
  try {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    const at = (date) => new Date(`${date}T12:00:00Z`);
    assert.equal(inOriginalWindow("fiftyFiftyV3", v442, at("2018-06-11"), dated), true);
    assert.equal(inOriginalWindow("fiftyFiftyV3", v442, at("2018-06-12"), dated), false);
    assert.equal(inOriginalWindow("fiftyFiftyV2", v442, at("2018-06-01"), dated), false, "v2 isn't 4.4's");
    assert.equal(inOriginalWindow("fiftyFiftyV2", v42, at("2018-06-01"), dated), true);
  } finally {
    configureEvents(null);
  }
});

// PongooDev/CoreV2#327: Update v4.40's Sniper Shootout v3, 4.4's Playlist_Snipers, _Solo and _Duos.
test("Sniper Shootout v3 is 4.4's Snipers playlists: Solo, Duos and Squads, by its switch or 5 to 11 June (#327)", () => {
  const playlists = { sniperShootoutV3Solo: [39, "Playlist_Snipers_Solo", 1], sniperShootoutV3Duos: [40, "Playlist_Snipers_Duos", 2], sniperShootoutV3: [41, "Playlist_Snipers", 4] };
  for (const [id, [playlistId, name, size]] of Object.entries(playlists)) {
    for (const build of v44) {
      assert.equal(hasLtm(id, build), true, `${id} ${build}`);
      assert.equal(ltmOfPlaylist(playlistId, build).id, id);
      assert.deepEqual(playlistTeamsOf(`${build}:0:NA:${playlistId}`, build), { maxTeamCount: 100, maxTeamSize: size, maxSquadSize: size }, id);
      assert.ok(ltmPlaylistOverrides(build, { matchmakingModes: { [id]: true } }).includes(name), id);
      assert.equal(ltmOn(id, build, { matchmakingModes: {} }), false, "by its switch");
    }
    assert.equal(hasLtm(id, v42), false, id);
  }
  assert.equal(ltmOfPlaylist(39, v42).id, "sniperShootoutSolo", "v2 on 4.2");
  configureEvents({ mode: "auto", seasonStarts: { 4: "2018-05-01" } });
  try {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    const at = (date) => new Date(`${date}T12:00:00Z`);
    for (const build of v44) {
      assert.equal(ltmOn("sniperShootoutV3Duos", build, dated, at("2018-06-05")), true, build);
      assert.equal(ltmOn("sniperShootoutV3Duos", build, dated, at("2018-06-12")), false, build);
    }
  } finally {
    configureEvents(null);
  }
});
