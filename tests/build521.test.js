import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { activeEventFlags, anniversary2018BR, birthday2018, configureEvents, groupMission, hordeFlag, isEventActive, lobbySeason5, passiveStorms,
  roadTrip2018Flag, tomatoRiftEvent, tomatoRiftTell } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { hasLtm, inOriginalWindow, ltmNewMode, ltmOfPlaylist, ltmPlaylistOverrides } from "../src/events/ltms.js";
import { eventQuestLine } from "../src/events/quests.js";
import { roadTrip2018, weeklyHordeQuests } from "../src/events/roadtrip2018.js";
import { tomatoRiftStates } from "../src/events/tomatorift.js";
import { athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { isPartyOnlyBucket, parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { eventStoreOffers, eventStorefront } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { hordeTheater } from "../src/world/horde.js";

// Fortnite 5.21, Season 5: CL-4288479 (++Fortnite+Release-5.21, Update v5.21, 15 August 2018), on its own data
// (gamedata/4288479). Core has no 5.20 (Update v5.20, 7 August), so 5.21 carries 5.20's changes too.
const v521 = "4288479";
const v510 = "4240749";
const v50 = "4214610";
const now = new Date("2026-11-09T12:00:00Z");
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};

test("5.21 is known by its version and plays on its own data", () => {
  assert.equal(versionOf(v521), "5.21");
  assert.equal(dataBuild(v521), v521);
  assert.ok(buildChoices().includes(v521));
  assert.equal(allowedBuildList(["5.21"]).join(), v521);
  assert.equal(dataBuild("4260000"), v510, "a build between 5.10 and 5.21 Core doesn't know plays on 5.10's");
  assert.equal(buildOfSeason(5), "4305896", "Season 5's newest data is 5.30's now (build530.test.js)");
  assert.equal(seasonName(5), "Season 5 (5.0 – 5.30)");
  const season = inBuild(v521, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.numBookLevels, season.storefront], [5, 100, "BRSeason5"]);
});

test("5.21's data: 30 new cosmetics, Ragnarok, Machinist Thora, Joel and Karolina, and the Weekly Horde Challenges", () => {
  const c521 = inBuild(v521, athenaCosmetics);
  const c510 = inBuild(v510, athenaCosmetics);
  assert.equal(Object.keys(c521).filter((id) => !c510[id]).length, 30);
  assert.ok(Object.keys(c510).every((id) => c521[id]), "5.21 drops none of 5.10's");
  assert.deepEqual(["AthenaCharacter:cid_185_athena_commando_m_durrburgerhero", "AthenaCharacter:cid_187_athena_commando_f_fuzzybearpanda",
    "AthenaCharacter:cid_191_athena_commando_m_sushichef", "AthenaDance:eid_llamabell"].map((id) => c521[id].name.trim()),
  ["Beef Boss", "P.A.N.D.A Team Leader", "Sushi Master", "Llama Bell"]);
  inBuild(v521, () => {
    assert.equal(getItem("Hero:hid_outlander_myth02_sr_t01").name, "Ragnarok");
    assert.equal(getItem("Hero:hid_constructor_011_f_v1_roadtrip_sr_t01").name, "Machinist Thora");
    assert.deepEqual(["Worker:worker_joel_ur_t01", "Worker:worker_karolina_ur_t01"].map((id) => getItem(id).name), ["Joel", "Karolina"]);
    // "A new side quest chain is now available after completing Plankerton: Storm Shield Defense 5" (Update v5.20).
    assert.ok(getQuest("outpostquest_t2_l5").hiddenRewards.some(({ templateId }) => templateId === "Quest:stonewoodquest_joelkarolina_savesurvivors"));
    assert.deepEqual(getQuest("hordequest_weekly2_twine1").rewards, [{ quantity: 1500, templateId: "AccountResource:eventcurrency_scaling" }]);
    assert.deepEqual(getQuest("hordequest_weekly2_twine1_repeatable").rewards, [{ quantity: 75, templateId: "AccountResource:eventcurrency_roadtrip" }]);
  });
  inBuild(v510, () => assert.equal(getItem("Hero:hid_outlander_myth02_sr_t01"), undefined, "5.10 has Ragnarok's higher tiers only"));
});

test("5.21's event flags: 5.10's less the Birthday; the Birthday's by the admin's switch", () => {
  assert.deepEqual(activeEventFlags(v521), [groupMission, passiveStorms, lobbySeason5, roadTrip2018Flag, hordeFlag]);
  assert.equal(isEventActive(birthday2018, v521), false, "the Birthday ended on 7 August, Update v5.20's day");
  assert.equal(isEventActive(roadTrip2018, v521), true);
  withConfig({ mode: "auto", season4Flags: { overrides: { [anniversary2018BR]: "on", [tomatoRiftEvent]: "on" } } }, () => {
    assert.ok(activeEventFlags(v521).includes(anniversary2018BR));
    assert.ok(activeEventFlags(v521).includes(tomatoRiftEvent));
    assert.ok(!activeEventFlags(v510).includes(tomatoRiftEvent), "5.10's paks have no Tomato Town rift");
  });
});

test("5.21's Tomato Town rift: formed, then the stone tomato head from 19 August on Season 5's replay", () => {
  // Season 5's replay from 25 October: 9 November is its day 16, 27 July 2018; 19 August is day 39, 2 December.
  withConfig({ mode: "auto", seasonStarts: { 5: "2026-10-25" } }, () => {
    const parts = inBuild(v521, () => tomatoRiftStates(now));
    assert.deepEqual(parts[0].events, [{ eventType: tomatoRiftTell, activeSince: "2026-10-25T00:00:00.000Z", activeUntil: "2026-12-02T00:00:00.000Z" }]);
    assert.equal(parts[1].validFrom, Date.parse("2026-12-02T00:00:00.000Z"));
    assert.deepEqual(parts[1].events, [{ eventType: tomatoRiftEvent, activeSince: "2026-12-02T00:00:00.000Z", activeUntil: "2027-01-10T00:00:00.000Z" }]);
    assert.equal(parts[2].events[0].eventType, tomatoRiftTell, "the next lap starts over");
    const later = inBuild(v521, () => tomatoRiftStates(new Date("2026-12-05T00:00:00Z")));
    assert.equal(later[0].events[0].eventType, tomatoRiftEvent);
    assert.deepEqual(inBuild(v510, () => tomatoRiftStates(now)), [], "5.10 has no Tomato Town rift");
  });
  withConfig({ mode: "auto", seasonStarts: { 5: "2026-10-25" }, season4Flags: { overrides: { [tomatoRiftTell]: "off" } } }, () => {
    assert.deepEqual(inBuild(v521, () => tomatoRiftStates(now))[0].events, [], "switched off, never served");
  });
});

test("5.21's modes: Soaring 50's new, Steady Storm from 7 August, Sniper Shootout v4, Playground v2 and 50v50 run on", () => {
  const none = { matchmakingModes: {} };
  assert.equal(ltmNewMode(v521, none).id, "soaring50s");
  assert.deepEqual([35, 50, 53, 41, 39, 40, 160, 161, 162].map((id) => ltmOfPlaylist(id, v521)?.id),
    ["playgroundV2", "fiftyFiftySeason5", "soaring50s", "sniperShootoutV4", "sniperShootoutV4Solo", "sniperShootoutV4Duos", "steadyStormSolo",
      "steadyStormDuos", "steadyStormSquads"]);
  assert.deepEqual(playlistTeamsOf(`${v521}:0:NA:53`, v521), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
  assert.deepEqual([160, 161, 162].map((id) => playlistTeamsOf(`${v521}:0:NA:${id}`, v521).maxTeamSize), [1, 2, 4]);
  assert.deepEqual(playlistTeamsOf(`${v521}:0:NA:35`, v521), { maxTeamCount: 4, maxTeamSize: 4, maxSquadSize: 4 });
  assert.equal(hasLtm("flyExplosives", v521), false, "Fly Explosives' playlists are gone");
  assert.equal(hasLtm("soaring50s", v510), false);
  withConfig({ mode: "auto", seasonStarts: { 5: "2018-07-12" } }, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    assert.equal(inOriginalWindow("steadyStormSolo", v521, new Date("2018-08-08T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("steadyStormSolo", v521, new Date("2018-08-16T12:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("soaring50s", v521, new Date("2018-08-16T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("sniperShootoutV4", v521, new Date("2018-08-22T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("soaring50s", v521, new Date("2018-08-24T12:00:00Z"), dated), false);
  });
});

// PongooDev/CoreV2#357, #359, #360: the lobby offers each by its switch (Matchmaking's Battle Royale game modes) or, with
// Original dates on, in its window on Season 5's replay; Soaring 50's always on 5.21. 4.4+ clients' buckets name the
// playlist (playlist_soaring_50s), which resolves to its id on both builds.
test("Playground v2, Soaring 50's and Sniper Shootout v4 reach the lobby and their buckets resolve (CoreV2 #357, #359, #360)", () => {
  assert.deepEqual(ltmPlaylistOverrides(v521, { matchmakingModes: {} }), ["Playlist_Soaring_50s"]);
  assert.deepEqual(ltmPlaylistOverrides(v521, { matchmakingModes: { playgroundV2: true, sniperShootoutV4: true, sniperShootoutV4Solo: true, sniperShootoutV4Duos: true } }),
    ["Playlist_Playground", "Playlist_Soaring_50s", "Playlist_Snipers", "Playlist_Snipers_Solo", "Playlist_Snipers_Duos"]);
  assert.deepEqual(ltmPlaylistOverrides(v510, { matchmakingModes: { playgroundV2: true } }), ["Playlist_Playground", "Playlist_FlyExplosives_Squads"]);
  for (const [name, id, builds] of [["playlist_soaring_50s", 53, [v521]], ["playlist_snipers", 41, [v521]], ["playlist_snipers_solo", 39, [v521]],
    ["playlist_snipers_duos", 40, [v521]], ["playlist_playground", 35, [v510, v521]]]) {
    for (const build of builds) assert.equal(parseBucket(`${build}:0:NAE:${name}`, build).playlistId, id, `${name} on ${build}`);
  }
  assert.equal(isPartyOnlyBucket(`${v510}:0:NAE:playlist_playground`, v510), true, "a Playground match is its party's alone");
  assert.equal(isPartyOnlyBucket(`${v521}:0:NAE:playlist_soaring_50s`, v521), false);
  withConfig({ mode: "auto", seasonStarts: { 5: "2018-07-12" } }, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    assert.deepEqual(ltmPlaylistOverrides(v521, dated, new Date("2018-08-21T12:00:00Z")),
      ["Playlist_Playground", "Playlist_Soaring_50s", "Playlist_Snipers", "Playlist_Snipers_Solo", "Playlist_Snipers_Duos"]);
  });
});

test("5.21's Weekly Horde Challenge: week 2's quests at quest login and its four missions in the horde theater", () => {
  inBuild(v521, () => {
    const quests = eventQuests();
    assert.ok(weeklyHordeQuests(2).every((questId) => quests.includes(questId)));
    assert.ok(!weeklyHordeQuests(1).some((questId) => quests.includes(questId)), "week 1 was 5.20's");
    assert.ok(eventQuestLine(roadTrip2018).has("hordequest_weekly2_stonewood1_repeatable"));
    const theater = hordeTheater();
    const weekly = theater.fixedMissions.filter(({ missionGenerator }) => /WeeklyHordeChallenge_02/.test(missionGenerator));
    assert.deepEqual(weekly.map(({ missionDifficultyInfo }) => missionDifficultyInfo.rowName),
      ["Theater_Horde_Stonewood_Weekly", "Theater_Horde_Plankerton_Weekly", "Theater_Horde_Uncanny_Weekly", "Theater_Horde_Final_Weekly"]);
    assert.equal(theater.data.regions.length, 14);
    assert.ok(theater.data.tiles[weekly[0].tileIndex].zoneTheme.includes("RangeImmune"));
  });
  inBuild(v510, () => {
    assert.ok(!eventQuests().some((questId) => /weekly/.test(questId)));
    assert.equal(hordeTheater().data.regions.length, 10, "5.10 has no weekly challenge");
  });
});

test("5.21's Event Store: Ragnarok for 3,200 Gold and Machinist Thora for 2,800; 5.10 has neither", () => {
  const heroes = (build) => inBuild(build, () => eventStoreOffers(now)[eventStorefront]).filter(({ templateId }) => templateId.startsWith("Hero:"));
  const on521 = heroes(v521);
  assert.deepEqual(on521.map(({ templateId }) => templateId), ["Hero:hid_commando_gunheadshot_m_v1_roadtrip_sr_t01", "Hero:hid_outlander_myth02_sr_t01",
    "Hero:hid_constructor_011_f_v1_roadtrip_sr_t01"]);
  assert.deepEqual(heroes(v510).map(({ templateId }) => templateId), ["Hero:hid_commando_gunheadshot_m_v1_roadtrip_sr_t01"]);
});

test("5.21's shop: Season 5's history sells 5.20's and 5.21's cosmetics on 5.21 with their back blings, and not on 5.10", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season5.json", import.meta.url), "utf8")).days;
  const c521 = inBuild(v521, athenaCosmetics);
  const c510 = inBuild(v510, athenaCosmetics);
  // The history keeps 5.30's cosmetics too (build530.test.js); 5.21 sells those its data has.
  const sold = new Set(history.flatMap((day) => [...day.featured, ...day.daily].map(([id]) => id)).filter((id) => c521[id]));
  assert.equal([...sold].filter((id) => !c510[id]).length, 21);
  assert.equal(history.find((day) => [...day.featured, ...day.daily].some(([id]) => id === "AthenaCharacter:cid_185_athena_commando_m_durrburgerhero")).date, "2018-08-10");
  // 9 November is the season's day 30, 10 August 2018: Beef Boss.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 5: "2026-10-11" } };
  const featured = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront;
  const beef = featured(v521).find(({ templateId }) => templateId === "AthenaCharacter:cid_185_athena_commando_m_durrburgerhero");
  assert.ok(beef);
  assert.deepEqual(beef.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_185_athena_commando_m_durrburgerhero", "AthenaBackpack:bid_091_durrrburgerhero"]);
  assert.ok(!featured(v510).some(({ templateId }) => !c510[templateId]), "5.10 sells none of them");
});
