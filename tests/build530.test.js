import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { cubeStates } from "../src/events/cube.js";
import { activeEventFlags, birthdayBattleBus, configureEvents, cubeLake, cubeLightning, cubeMoveTo, cubeMoveToLake, cubeRune, cubeStartMove,
  cubeTurnOn, groupMission, hordeFlag, isEventActive, lobbySeason5, passiveStorms, riftCorrupt, roadTrip2018Flag, tomatoRiftEvent } from "../src/events/events.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, playlistIdOfName } from "../src/events/ltms.js";
import { eventQuestLine } from "../src/events/quests.js";
import { roadTrip2018, roadTripEventQuests, weeklyHordeQuests, weeklyHordeWeek } from "../src/events/roadtrip2018.js";
import { athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getNode } from "../src/gamedata/homebase.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { createSettingsStore } from "../src/settings/store.js";
import os from "node:os";
import path from "node:path";
import { eventStoreOffers, eventStorefront, weeklyStorefront } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { hordeId, hordeTheater, hordeWeeklyId, hordeWeeklyTheater } from "../src/world/horde.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 5.30, Season 5: CL-4305896 (++Fortnite+Release-5.30, Update v5.30, 23 August 2018), on its own data
// (gamedata/4305896). Content Update v5.30's (28 August) items are in its paks already.
const v530 = "4305896";
const v521 = "4288479";
const v45 = "4166199";
// Season 5's replay from its real first day, so the replay's dates are Epic's.
const replay = { mode: "auto", seasonStarts: { 5: "2018-07-12" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const at = (iso) => new Date(iso);

test("5.30 is known by its version, plays on its own data and is Season 5's newest", () => {
  assert.equal(versionOf(v530), "5.30");
  assert.equal(dataBuild(v530), v530);
  assert.ok(buildChoices().includes(v530));
  assert.equal(allowedBuildList(["5.30"]).join(), v530);
  assert.equal(dataBuild("4300000"), v521, "a build between 5.21 and 5.30 Core doesn't know plays on 5.21's");
  assert.equal(buildOfSeason(5), v530);
  assert.equal(seasonName(5), "Season 5 (5.0 – 5.30)");
  const season = inBuild(v530, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.numBookLevels, season.storefront], [5, 100, "BRSeason5"]);
});

test("5.30's data: 47 new cosmetics, the Rift-To-Go, the Shockwave Grenade, Bladestorm Enforcer, Redline Ramirez, Horde weeks 3 and 4", () => {
  const c530 = inBuild(v530, athenaCosmetics);
  const c521 = inBuild(v521, athenaCosmetics);
  assert.equal(Object.keys(c530).filter((id) => !c521[id]).length, 47);
  assert.ok(Object.keys(c521).every((id) => c530[id]), "5.30 drops none of 5.21's");
  assert.deepEqual(["AthenaCharacter:cid_198_athena_commando_m_bluesamurai", "AthenaCharacter:cid_194_athena_commando_f_ravenquill",
    "AthenaCharacter:cid_203_athena_commando_m_cloakedstar", "AthenaDance:eid_praisethetomato"].map((id) => c530[id].name.trim()),
  ["Musha", "Ravage", "Cloaked Star", "Praise The Tomato"]);
  inBuild(v530, () => {
    assert.equal(getItem("Weapon:athena_rift_item").name, "Rift-To-Go");
    assert.equal(getItem("Weapon:athena_shockgrenade").name, "Shockwave Grenade");
    assert.equal(getItem("Hero:hid_ninja_myth03_sr_t01").name, "Bladestorm Enforcer");
    assert.equal(getItem("Hero:hid_commando_011_f_v1_roadtrip_sr_t01").name, "Redline Ramirez");
    // "Victorious teams will be able to choose from two legendary Flintlock weapons"; "Win a Legendary Redline Ramirez".
    assert.equal(getQuest("hordequest_weekly3_stonewood1").selectableRewards.length, 2);
    assert.deepEqual(getQuest("hordequest_weekly4_twine1").rewards, [{ quantity: 1, templateId: "Hero:hid_commando_011_f_v1_roadtrip_sr_t01" }]);
    // The skill tree's costs name their item by primary asset id in 5.30's paks (the extractor's FItemAndCount).
    assert.deepEqual(getNode("T1_Main_8D2C3C4D0").cost, [{ quantity: 1, templateId: "Token:homebasepoints" }]);
  });
  inBuild(v521, () => assert.equal(getItem("Hero:hid_ninja_myth03_sr_t01"), undefined));
});

test("5.30's event flags: 5.21's less the Birthday's and the Tomato Town rift's; the bus by the admin's switch", () => {
  assert.deepEqual(activeEventFlags(v530), [groupMission, passiveStorms, lobbySeason5, roadTrip2018Flag, hordeFlag]);
  assert.equal(isEventActive(roadTrip2018, v530), true);
  withConfig({ mode: "auto", season4Flags: { overrides: { [birthdayBattleBus]: "on", [tomatoRiftEvent]: "on", [cubeLake]: "on" } } }, () => {
    assert.ok(activeEventFlags(v530).includes(birthdayBattleBus));
    assert.ok(activeEventFlags(v530).includes(cubeLake));
    assert.ok(!activeEventFlags(v530).includes(tomatoRiftEvent), "5.30's paks have no Tomato Town rift");
    assert.ok(!activeEventFlags(v521).includes(cubeLake), "5.21's paks have no cube");
  });
});

test("5.30's Cube on Season 5's replay: the purple crack, the lightning, Kevin, its rolls and runes, Loot Lake", () => {
  withConfig(replay, () => {
    const now = (iso) => inBuild(v530, () => cubeStates(at(iso)))[0].events;
    const types = (iso) => now(iso).map(({ eventType }) => eventType).sort();
    assert.deepEqual(types("2018-08-20T12:00:00Z"), [], "before Update v5.30");
    assert.deepEqual(types("2018-08-23T12:00:00Z"), [riftCorrupt]);
    assert.deepEqual(types("2018-08-24T12:00:00Z"), [cubeLightning, riftCorrupt].sort());
    // Kevin rolls toward its first rune from the Crack Closure: the leg's window is what CUBE's CalculateNextMove reads.
    assert.deepEqual(now("2018-08-26T00:00:00Z").filter(({ eventType }) => eventType !== cubeTurnOn), [
      { eventType: cubeMoveTo(1), activeSince: "2018-08-24T21:00:00.000Z", activeUntil: "2018-08-28T21:00:00.000Z" },
      { eventType: cubeStartMove, activeSince: "2018-08-24T21:00:00.000Z", activeUntil: "2018-08-28T21:00:00.000Z" }]);
    assert.deepEqual(types("2018-08-29T00:00:00Z"), [cubeRune(1), cubeTurnOn].sort());
    assert.deepEqual(types("2018-09-15T00:00:00Z"), [cubeMoveTo(7), cubeStartMove, cubeTurnOn].sort());
    assert.deepEqual(types("2018-09-18T00:00:00Z"), [cubeMoveToLake, cubeStartMove, cubeTurnOn].sort());
    assert.deepEqual(types("2018-09-20T00:00:00Z"), [cubeLake, cubeTurnOn].sort());
    const parts = inBuild(v530, () => cubeStates(at("2018-08-26T00:00:00Z")));
    assert.equal(parts[1].validFrom, Date.parse("2018-08-28T21:00:00Z"), "the next part: rune 1");
    assert.deepEqual(parts[1].events.map(({ eventType }) => eventType).sort(), [cubeRune(1), cubeTurnOn].sort());
    assert.deepEqual(inBuild(v521, () => cubeStates(at("2018-08-26T00:00:00Z"))), [], "5.21 has no cube");
  });
  withConfig({ ...replay, season4Flags: { overrides: { [cubeTurnOn]: "off" } } }, () => {
    assert.ok(!inBuild(v530, () => cubeStates(at("2018-08-26T00:00:00Z")))[0].events.some(({ eventType }) => eventType === cubeTurnOn),
      "switched off, never served");
  });
});

test("5.30's modes: Score Royale new (Solo 101, Duos 102, Squads 103), Solid Gold and 50v50 Solid Gold from 28 August", () => {
  const none = { matchmakingModes: {} };
  assert.equal(ltmNewMode(v530, none).id, "scoreRoyaleSolo");
  assert.deepEqual(ltmPlaylistOverrides(v530, none), ["Playlist_50v50", "Playlist_Playground", "Playlist_Score_Solo", "Playlist_Score_Duos", "Playlist_Score_Squads"],
    "Season 5's 50v50 and Playground v2 on by default (#314)");
  assert.deepEqual([101, 102, 103, 27, 26, 34, 1993, 35, 50, 53].map((id) => ltmOfPlaylist(id, v530)?.id),
    ["scoreRoyaleSolo", "scoreRoyaleDuos", "scoreRoyaleSquads", "solidGoldSeason5", "solidGoldSeason5Solo", "solidGoldSeason5Duos",
      "fiftyFiftySolidGold", "playgroundV2", "fiftyFiftySeason5", "soaring50s"]);
  assert.deepEqual([101, 102, 103].map((id) => playlistTeamsOf(`${v530}:0:NA:${id}`, v530)),
    [1, 2, 4].map((size) => ({ maxTeamCount: 100, maxTeamSize: size, maxSquadSize: size })));
  assert.deepEqual(playlistTeamsOf(`${v530}:0:NA:1993`, v530), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v45}:0:NA:103`, v45), { maxTeamCount: 8, maxTeamSize: 12, maxSquadSize: 4 }, "4.5's 103 is Final Fight's");
  // 4.4+ clients' buckets name the playlist, lowercased.
  for (const [name, id] of [["playlist_score_solo", 101], ["playlist_score_duos", 102], ["playlist_score_squads", 103],
    ["playlist_solidgold_squads", 27], ["playlist_50v50sau", 1993]]) {
    assert.equal(playlistIdOfName(name, v530), id, name);
    assert.equal(parseBucket(`${v530}:0:NAE:${name}`, v530).playlistId, id, name);
  }
  assert.equal(hasLtm("sniperShootoutV4", v530), false, "Sniper Shootout's playlists are gone");
  assert.equal(hasLtm("steadyStormSolo", v530), false);
  assert.equal(hasLtm("scoreRoyaleSolo", v521), false);
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    assert.equal(inOriginalWindow("scoreRoyaleSquads", v530, at("2018-08-25T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("scoreRoyaleSquads", v530, at("2018-08-29T12:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("solidGoldSeason5", v530, at("2018-08-29T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("fiftyFiftySolidGold", v530, at("2018-09-07T12:00:00Z"), dated), false);
    assert.deepEqual(ltmPlaylistOverrides(v530, dated, at("2018-08-30T12:00:00Z")),
      ["Playlist_Playground", "Playlist_Score_Solo", "Playlist_Score_Duos", "Playlist_Score_Squads", "Playlist_SolidGold_Squads", "Playlist_50v50SAU"]);
  });
});

test("5.30's Weekly Horde Challenges 3 and 4: their quests at quest login and a theater of their own, tagged as the stats count", () => {
  withConfig(replay, () => inBuild(v530, () => {
    const week3 = at("2018-08-25T12:00:00Z");
    const week4 = at("2018-08-31T12:00:00Z");
    assert.equal(weeklyHordeWeek(week3), 3);
    assert.equal(weeklyHordeWeek(week4), 4);
    assert.ok(weeklyHordeQuests(3).every((questId) => roadTripEventQuests(week3).includes(questId)));
    assert.ok(!weeklyHordeQuests(4).some((questId) => roadTripEventQuests(week3).includes(questId)));
    assert.ok(weeklyHordeQuests(4).every((questId) => roadTripEventQuests(week4).includes(questId)));
    assert.ok(eventQuestLine(roadTrip2018).has("hordequest_weekly4_twine1_repeatable"));
    // The nine zones' quests count Stat.Theater.Horde, the weeks' Stat.Theater.Weekly.Horde.WeekA and WeekB.
    const horde = hordeTheater(week3);
    assert.deepEqual(horde.data.runtimeInfo.theaterTags.gameplayTags, [{ tagName: "Stat.Theater.Horde" }]);
    assert.equal(horde.data.regions.length, 10, "the fort and the nine zones, no weekly zone");
    const weekly = hordeWeeklyTheater(week3);
    assert.equal(weekly.data.uniqueId, hordeWeeklyId);
    assert.deepEqual(weekly.data.runtimeInfo.theaterTags.gameplayTags, [{ tagName: "Stat.Theater.Weekly.Horde.WeekA" }]);
    assert.deepEqual(weekly.fixedMissions.map(({ missionDifficultyInfo }) => missionDifficultyInfo.rowName),
      ["Theater_Horde_Stonewood_Weekly", "Theater_Horde_Plankerton_Weekly", "Theater_Horde_Uncanny_Weekly", "Theater_Horde_Final_Weekly"]);
    assert.ok(weekly.data.tiles.every(({ zoneTheme }) => zoneTheme.includes("EnduranceMode")));
    const weekly4 = hordeWeeklyTheater(week4);
    assert.deepEqual(weekly4.data.runtimeInfo.theaterTags.gameplayTags, [{ tagName: "Stat.Theater.Weekly.Horde.WeekB" }]);
    assert.ok(weekly4.data.tiles.every(({ zoneTheme }) => zoneTheme.includes("Untrappable")));
    const info = worldInfo(week3);
    assert.ok(info.theaters.some(({ uniqueId }) => uniqueId === hordeId));
    assert.ok(info.theaters.some(({ uniqueId }) => uniqueId === hordeWeeklyId));
  }));
  inBuild(v521, () => {
    assert.equal(hordeWeeklyTheater(), null, "5.21 counts its week by the mission: its zones stay in the Horde theater");
    assert.equal(hordeTheater().data.regions.length, 14);
  });
});

test("5.30's stores: the Bundlebuss in the Weekly Store, Bladestorm Enforcer in the Event Store", () => {
  const offers = (build) => inBuild(build, () => eventStoreOffers(at("2018-08-25T12:00:00Z")));
  const ids = (list) => list.map(({ templateId }) => templateId);
  const on530 = offers(v530);
  assert.equal(on530[weeklyStorefront][0].templateId, "Schematic:sid_assault_flintlock_sr_ore_t01");
  assert.ok(ids(on530[eventStorefront]).includes("Hero:hid_ninja_myth03_sr_t01"));
  assert.ok(!ids(on530[eventStorefront]).includes("Schematic:sid_assault_flintlock_sr_ore_t01"), "it left the event items");
  const on521 = offers(v521);
  assert.ok(ids(on521[eventStorefront]).includes("Schematic:sid_assault_flintlock_sr_ore_t01"));
  assert.ok(!ids(on521[eventStorefront]).includes("Hero:hid_ninja_myth03_sr_t01"));
});

test("5.30's shop: Season 5's history sells 5.30's cosmetics on 5.30 with their back blings, and not on 5.21", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season5.json", import.meta.url), "utf8")).days;
  const c530 = inBuild(v530, athenaCosmetics);
  const c521 = inBuild(v521, athenaCosmetics);
  const sold = new Set(history.flatMap((day) => [...day.featured, ...day.daily].map(([id]) => id)));
  assert.ok([...sold].every((id) => c530[id]), "only 5.30's cosmetics");
  assert.equal([...sold].filter((id) => !c521[id]).length, 23);
  assert.equal(history.find((day) => [...day.featured, ...day.daily].some(([id]) => id === "AthenaCharacter:cid_198_athena_commando_m_bluesamurai")).date, "2018-08-24");
  // 24 August 2018 is the season's day 44: with the season from 27 September 2026, 9 November 2026.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 5: "2026-09-27" } };
  const now = at("2026-11-09T12:00:00Z");
  const featured = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront;
  const musha = featured(v530).find(({ templateId }) => templateId === "AthenaCharacter:cid_198_athena_commando_m_bluesamurai");
  assert.ok(musha);
  assert.deepEqual(musha.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_198_athena_commando_m_bluesamurai", "AthenaBackpack:bid_098_bluesamuraimale"]);
  assert.ok(!featured(v521).some(({ templateId }) => !c521[templateId]), "5.21 sells none of them");
});

// Core-Backend #314: Season 5's shipped DefaultGame.ini enables Playlist_50v50 and Playlist_Playground in the lobby
// (FrontEndPlaylistData), so both are on by default, and the lobby's list is the backend's: what it offers, the ticket takes.
test("5.0 to 5.30's lobby lists the playlists the matchmaking ticket takes; Playground v2 and Season 5's 50v50 are on by default (#314)", () => {
  const v510 = "4240749";
  const v50 = "4214610";
  const defaults = createSettingsStore(null).get();
  for (const build of [v510, v521, v530]) {
    assert.equal(ltmOn("playgroundV2", build, defaults), true, build);
    assert.equal(ltmOn("fiftyFiftySeason5", build, defaults), true, build);
    const listed = Object.fromEntries(ltmFrontEndPlaylists(build, defaults).map(({ name, enabled }) => [name, enabled]));
    assert.equal(listed.Playlist_Playground, true, build);
    assert.equal(listed.Playlist_50v50, true, build);
  }
  // Switched off, it is off in the lobby too, and Playground on 5.0 (Season 4's) is by its switch.
  const off = { matchmakingModes: { ...defaults.matchmakingModes, playgroundV2: false } };
  assert.equal(ltmFrontEndPlaylists(v530, off).find(({ name }) => name === "Playlist_Playground").enabled, false);
  assert.equal(ltmFrontEndPlaylists(v50, defaults).find(({ name }) => name === "Playlist_Playground").enabled, false);
  assert.deepEqual(ltmFrontEndPlaylists(v45, defaults), [], "4.5's lobby has no FrontEndPlaylistData");
  const scoreRoyale = ltmFrontEndPlaylists(v530, defaults).filter(({ name }) => name.startsWith("Playlist_Score_"));
  assert.deepEqual(scoreRoyale.map(({ enabled }) => enabled), [true, true, true], "5.30's new mode is listed");
  // A settings file from before #314 had them off by default: turned on once; one saved after keeps the admin's choice.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-314-"));
  try {
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ matchmakingModes: { playgroundV2: false, fiftyFiftySeason5: false } }));
    const migrated = createSettingsStore(dataDir).get();
    assert.deepEqual([migrated.matchmakingModes.playgroundV2, migrated.matchmakingModes.fiftyFiftySeason5], [true, true]);
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ matchmakingModesRevision: 1, matchmakingModes: { playgroundV2: false } }));
    const kept = createSettingsStore(dataDir).get();
    assert.deepEqual([kept.matchmakingModes.playgroundV2, kept.matchmakingModes.fiftyFiftySeason5], [false, true]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
