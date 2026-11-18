import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { blockStates } from "../src/events/block.js";
import { activeEventFlags, configureEvents, frostnite, lobbySeason7, ltm14DaysOfFortnite, ltmWinterDeimos } from "../src/events/events.js";
import { fourteenDaysDay, fourteenDaysStates } from "../src/events/fourteendays.js";
import { iceStormCalendarEvent, iceStormDay, iceStormFlagsNow, iceStormStates } from "../src/events/icestorm.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, defaultReplacements } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaDailyIds, athenaBattlePassDailyIds, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { isForeignTemplate } from "../src/gamedata/templates.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { plotsOf, settleCreativePlots } from "../src/profiles/creative.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { contentPage } from "../src/services/content/pages.js";
import { createSettingsStore } from "../src/settings/store.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";
import { tournamentPlaylists } from "../src/tournaments/store.js";

// Fortnite 7.20 (Update v7.20, 15 January 2019; Season 7): CL-4727874, on its own data (gamedata/4727874). Battle Royale:
// the Ice Storm (its modes in place of Solo, Duos and Squads, its challenges more each day), One Shot and Content Update
// v7.20's Sniper Shootout, the Block's Looming Llama and Omega Pyramid, The Ice Queen and the others in the shop, the
// dailies from 7.20's own daily quest class; Creative's Frosty Fortress.
const v720 = "4727874";
const v710 = "4667333";
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const season7 = { mode: "auto", seasonStarts: { 7: "2018-12-06" } };
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-720-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
// Season 7's replay started `days` days before today (UTC), so that today is 6 December 2018 + days on it.
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);

test("7.20 is known, on its own data, Season 7's newest build", () => {
  assert.equal(versionOf(v720), "7.20");
  assert.equal(allowedBuildList(["7.20"]).join(), v720);
  assert.equal(dataBuild(v720), v720);
  assert.equal(dataBuild("4700000"), v710, "a build between 7.10 and 7.20 plays on 7.10's");
  assert.equal(dataBuild("4800000"), v720, "a later build Core doesn't know plays on 7.20's");
  assert.equal(releasedOn(v720), Date.UTC(2019, 0, 15));
  assert.equal(buildOfSeason(7), v720);
  assert.equal(seasonName(7), "Season 7 (7.00 – 7.20)");
  const season = inBuild(v720, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.battlePassLevelOfferId], [7, "BRSeason7", "64A3020B098841A7805EE257D68C554F"]);
});

test("7.20's data: eight overlays the same as 7.10's, the curve tables whole", () => {
  assert.ok(Object.keys(buildGameData(v720, "research", {}).stats ?? {}).length > 0);
  const dir = new URL("../gamedata/", import.meta.url);
  const read = (build, name) => fs.readFileSync(new URL(`${build}/${name}`, dir), "utf8").replace(/\r\n/g, "\n");
  const names = fs.readdirSync(new URL(v720, dir)).sort();
  assert.deepEqual(names, fs.readdirSync(new URL(v710, dir)).sort(), "the same files as 7.10's");
  assert.deepEqual(names.filter((name) => read(v720, name) === read(v710, name)), ["accountlevels.json", "collectionbook.json", "dailyrewards.json",
    "expeditions.json", "inventory.json", "research.json", "squads.json", "transmog.json"]);
});

test("7.20's cosmetics: 39 new (Malcore, The Ice Queen, the Ice Storm's Winter's Thorn), the TBD Nautilus glider gone", () => {
  const [c720, c710] = [inBuild(v720, athenaCosmetics), inBuild(v710, athenaCosmetics)];
  assert.equal(Object.keys(c720).filter((id) => !c710[id]).length, 39);
  assert.deepEqual(Object.keys(c710).filter((id) => !c720[id]), ["AthenaGlider:glider_id_103_nautilus"]);
  for (const [id, name] of [["AthenaCharacter:cid_330_athena_commando_f_icequeen", "The Ice Queen"], ["AthenaCharacter:cid_318_athena_commando_m_demon", "Malcore"],
    ["AthenaGlider:glider_id_114_icequeen", "Winter's Thorn"], ["AthenaItemWrap:wrap_010_blueemissive", "Blue Metallic"]]) {
    assert.equal(c720[id]?.name, name, id);
    assert.equal(c710[id], undefined, `${id} is 7.20's`);
  }
});

test("7.20's dailies: its daily quest class's own rewards (500 XP, 5 Battle Stars, the daily token); no Battle Pass dailies", () => {
  const dailies = inBuild(v720, athenaDailyIds);
  assert.deepEqual([...dailies].sort(), [...inBuild(v710, athenaDailyIds)].sort(), "7.10's seventeen");
  for (const id of dailies) {
    const quest = inBuild(v720, () => getAthenaQuest(id));
    assert.deepEqual(quest.rewards, [{ quantity: 500, templateId: "AccountResource:athenaseasonalxp" }, { quantity: 5, templateId: "AccountResource:athenabattlestar" }], id);
    assert.deepEqual(quest.hiddenRewards, [{ quantity: 1, templateId: "Token:athena_dailychallenge_token" }], id);
  }
  // Update v7.20: "Completing the 'Play a match with a friend' Daily Challenge now correctly counts towards other quests that
  // require completing daily challenges": 7.10's had no token, 7.20's class gives it one.
  assert.equal(inBuild(v710, () => getAthenaQuest("athenadaily_friend")).hiddenRewards, undefined);
  assert.deepEqual(inBuild(v720, athenaBattlePassDailyIds), [], "Athena_BattlePass_* are gone from 7.20's paks");
  assert.equal(inBuild(v710, athenaBattlePassDailyIds).length > 0, true);
});

test("the Ice Storm Challenges' data: three with the schedule, two more a day for five days, Winter's Thorn for all", () => {
  const schedule = inBuild(v720, athenaChallengeSchedules).schedule_winterdeimos;
  assert.deepEqual([schedule.eventName, schedule.category, schedule.cleanUpOnBundleCompletion], [ltmWinterDeimos, "FNWD", true]);
  const bundle = inBuild(v720, athenaChallengeBundles).questbundle_winterdeimos;
  assert.equal(bundle.quests.length, 13);
  assert.deepEqual(bundle.quests.filter(({ grantWithBundle }) => grantWithBundle).map(({ quest }) => quest),
    ["quest_fnwd_completequests", "quest_fnwd_elim_ai_fiend", "quest_fnwd_dam_explosiveweapons_ai"]);
  assert.deepEqual(bundle.quests.slice(3).map(({ unlockValue }) => unlockValue), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual(inBuild(v720, () => getAthenaQuest("quest_fnwd_completequests")).rewards, [{ quantity: 1, templateId: "AthenaItemWrap:wrap_010_blueemissive" }]);
  assert.deepEqual(bundle.completionSteps, [{ count: -1, rewards: [{ giftBox: "GiftBox:gb_challengecomplete", quantity: 1, templateId: "AthenaGlider:glider_id_114_icequeen" }] }]);
  assert.equal(inBuild(v710, athenaChallengeSchedules).schedule_winterdeimos, undefined, "7.10 has none");
});

test("the Ice Storm's flag and calendar event: from the Ice Storm to 28 January on Season 7's replay, on 7.20 only; the switch and off", () => {
  withConfig(season7, () => {
    const types = (iso, build = v720) => inBuild(build, () => iceStormStates(at(iso)))[0]?.events.map(({ eventType }) => eventType) ?? [];
    assert.deepEqual(types("2019-01-19T18:59:00Z"), []);
    assert.deepEqual(types("2019-01-19T19:00:00Z"), [ltmWinterDeimos, iceStormCalendarEvent], "the Ice Storm, 11 AM PST");
    const first = inBuild(v720, () => iceStormStates(at("2019-01-22T12:00:00Z")))[0].events[0];
    assert.deepEqual([first.activeSince, first.activeUntil], ["2019-01-19T19:00:00.000Z", "2019-01-29T00:00:00.000Z"]);
    assert.deepEqual(types("2019-01-29T00:00:00Z"), []);
    assert.deepEqual(types("2019-01-22T12:00:00Z", v710), [], "7.10 has no Ice Storm");
    assert.equal(inBuild(v720, () => iceStormDay(at("2019-01-19T20:00:00Z"))), 0);
    assert.equal(inBuild(v720, () => iceStormDay(at("2019-01-22T20:00:00Z"))), 3);
    // The 14 Days of Fortnite's dates are 7.10's alone: 7.20's paks keep it, but it "has ended".
    assert.deepEqual(inBuild(v720, () => fourteenDaysStates(at("2018-12-25T12:00:00Z"))), []);
    assert.equal(inBuild(v720, () => fourteenDaysDay(at("2018-12-25T12:00:00Z"))), null);
  });
  withConfig({ ...season7, season4Flags: { overrides: { [ltmWinterDeimos]: "on", [ltm14DaysOfFortnite]: "on" } } }, () => {
    const flags = inBuild(v720, () => activeEventFlags());
    assert.ok(flags.includes(ltmWinterDeimos) && flags.includes(ltm14DaysOfFortnite), "switched on, always served");
    assert.equal(inBuild(v720, () => iceStormDay(at("2019-01-01T12:00:00Z"))), Infinity, "every day has come");
  });
  withConfig({ ...season7, datedFlags: { iceStorm: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v720, () => iceStormFlagsNow(at("2019-01-22T12:00:00Z"))), []);
  });
  assert.deepEqual(season4Flag(ltmWinterDeimos).builds, [4727874, 4727874]);
});

test("a 7.20 player gets the Ice Storm Challenges while they run, two more for each day they have run", () => {
  withConfig({ mode: "auto", seasonStarts: { 7: replayDaysAgo(46) } }, () => withSession(v720, "icestorm720", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const day = iceStormDay();
    assert.ok(day >= 1 && day <= 2, `Season 7's replay is on 21 January: day ${day}`);
    const { items } = session.profile("athena").profile;
    const bundle = Object.values(items).find((item) => item.templateId === "ChallengeBundle:questbundle_winterdeimos");
    assert.ok(bundle, "the bundle");
    assert.equal(bundle.attributes.grantedquestinstanceids.length, 3 + 2 * day);
    assert.ok(Object.values(items).some((item) => item.templateId === "Quest:quest_fnwd_elim_ai_brute"), "day 1's");
    assert.equal(Object.values(items).some((item) => item.templateId === "Quest:quest_fnwd_dam_ai"), false, "day 5's not yet");
  }));
  withConfig({ mode: "auto", seasonStarts: { 7: replayDaysAgo(46) } }, () => withSession(v710, "icestorm710", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(Object.values(session.profile("athena").profile.items).some((item) => String(item.templateId).includes("winterdeimos")), false,
      "7.10 has no Ice Storm");
  }));
});

test("7.20's event flags: 7.10's own and Frostnite; its paks' only new flag is the Ice Storm Challenges'", () => {
  const flags = activeEventFlags(v720);
  for (const flag of [lobbySeason7, "EventFlag.ActiveStorms", "EventFlag.PassiveMiniBosses", frostnite]) assert.ok(flags.includes(flag), flag);
  assert.equal(flags.includes(ltm14DaysOfFortnite), false, "the 14 Days have ended");
  assert.deepEqual(season4Flag(frostnite).builds, [4667333, 4727874]);
  assert.deepEqual(season4Flag("EventFlag.Fortnitemares").builds[1], 4629139);
  assert.deepEqual(season4Flag("EventFlag.WinterBattleBus").builds, [4629139, 4629139]);
  assert.equal(season4Flag("EventFlag.SupplyDropGift").builds[1], 4727874);
});

test("7.20's modes: One Shot and Sniper Shootout on by default, the Ice Storm's (in place of Solo, Duos and Squads) from the Ice Storm, each on its dates", () => {
  const defaults = createSettingsStore(null).get();
  for (const id of ["oneShotSquads720", "sniperShootoutSolo720", "sniperShootoutDuos720", "sniperShootoutSquads720",
    "fiftyFiftySeason7", "playgroundV2", "creative", "teamRumble"]) assert.equal(ltmOn(id, v720, defaults), true, id);
  // Core-Backend #354: the Ice King's event waits before the storm by default, and Solo, Duos and Squads with it.
  for (const id of ["iceStormSolo", "iceStormDuos", "iceStormSquads"]) assert.equal(ltmOn(id, v720, defaults), false, `${id} waits for the Ice Storm`);
  for (const id of ["teamsOf33", "oneShotSquads", "holidayDisco", "sniperShootoutSeason7Solo"]) assert.equal(hasLtm(id, v720), false, `${id} isn't 7.20's`);
  for (const id of ["iceStormSolo", "oneShotSquads720", "sniperShootoutDuos720"]) assert.equal(hasLtm(id, v710), false, `${id} is 7.20's`);
  assert.equal(ltmOfPlaylist(282, v720).id, "iceStormSolo");
  assert.equal(ltmOfPlaylist(252, v720).id, "oneShotSquads720");
  assert.equal(ltmOfPlaylist(252, v710).id, "oneShotSquads", "7.10's One Shot as it was");
  assert.equal(ltmOfPlaylist(40, v720).id, "sniperShootoutDuos720");
  assert.deepEqual(defaultReplacements(v720, defaults), {}, "Solo, Duos and Squads until the Ice Storm");
  withConfig({ ...season7, datedFlags: { iceKing: { mode: "custom", schedule: [{ step: "after", startAt: "2020-01-01T00:00:00.000Z", endAt: null }] } } }, () => {
    assert.deepEqual(Object.keys(defaultReplacements(v720, defaults)).sort(), ["Playlist_DefaultDuo", "Playlist_DefaultSolo", "Playlist_DefaultSquad"]);
  });
  assert.deepEqual(defaultReplacements(v710, defaults), {});
  assert.deepEqual(playlistTeamsOf(`${v720}:0:NAE:playlist_deimos_squad_winter`, v720), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v720}:0:NAE:playlist_deimos_duo_winter`, v720), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
  withConfig(season7, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("oneShotSquads720", v720, at("2019-01-15T12:00:00Z"), dated), true, "Update v7.20's mode");
    assert.equal(inOriginalWindow("oneShotSquads720", v720, at("2019-01-22T00:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("sniperShootoutDuos720", v720, at("2019-01-22T12:00:00Z"), dated), true, "Content Update v7.20's");
    assert.equal(inOriginalWindow("sniperShootoutDuos720", v720, at("2019-01-29T00:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("iceStormSquads", v720, at("2019-01-19T18:59:00Z"), dated), false);
    assert.equal(inOriginalWindow("iceStormSquads", v720, at("2019-01-19T19:00:00Z"), dated), true, "from the Ice Storm");
    assert.equal(inOriginalWindow("iceStormSquads", v720, at("2019-01-29T00:00:00Z"), dated), false, "Update v7.30 vaulted the Ice Legion");
    assert.deepEqual(defaultReplacements(v720, dated, at("2019-01-17T12:00:00Z")), {}, "Solo, Duos and Squads before the Ice Storm");
  });
  const lobby = ltmFrontEndPlaylists(v720, defaults);
  for (const name of ["Playlist_Low_Squads", "Playlist_Snipers_Duos", "Playlist_PlaygroundV2"]) {
    assert.equal(lobby.find((own) => own.name === name)?.enabled, true, name);
  }
  assert.equal(lobby.find((own) => own.name === "Playlist_Deimos_Solo_Winter")?.enabled, false, "the Ice Storm's waits for the storm");
  assert.equal(lobby.some((own) => own.name === "Playlist_33"), false, "the 14 Days' modes are 7.10's");
  assert.deepEqual(tournamentPlaylists.slice(-3).map(({ id, playlistId, inGame }) => [id, playlistId, inGame]),
    [["iceStormShowSolo", 58288, true], ["iceStormShowDuos", 58289, true], ["iceStormShowSquads", 58290, true]]);
});

test("7.20's tiles: the Ice Storm's on its page only; 7.10's page is as it was", () => {
  const byName = (build) => Object.fromEntries(contentPage(undefined, undefined, build).playlistinformation.playlist_info.playlists
    .map(({ playlist_name: name, image }) => [name, image]));
  const [p720, p710] = [byName(v720), byName(v710)];
  assert.match(p720.Playlist_Deimos_Solo_Winter, /BR07_ModeTile_WinterDeimos_Solo-1024x512-5c759fe60ec85988f35c729b5fb6a7993d8dbb58\.jpg$/);
  assert.match(p720.Playlist_Deimos_Duo_Winter, /BR07_ModeTile_WinterDeimos_Duos_-1024x512-84315aac8d1fcfb840deba46c4dafda8e9005b2a\.jpg$/);
  assert.match(p720.Playlist_Deimos_Squad_Winter, /BR07_ModeTile_WinterDeimos_Squads-1024x512-cf4323aa9c2cfd027484cf4da14544128e3d4c7e\.jpg$/);
  assert.match(p720.Playlist_Low_Squads, /BR_LTM_OneShot-/);
  for (const name of ["Playlist_Deimos_Solo_Winter", "Playlist_Deimos_Duo_Winter", "Playlist_Deimos_Squad_Winter"]) assert.equal(p710[name], undefined, `${name} isn't on 7.10's page`);
});

test("7.20's Block: Looming Llama from the replay's first day, Omega Pyramid from 22 January; 7.10's four on 7.10 only", () => {
  withConfig(season7, () => {
    const types = (iso, build = v720) => inBuild(build, () => blockStates(at(iso)))[0]?.events.map(({ eventType }) => eventType) ?? [];
    assert.deepEqual(types("2018-12-10T12:00:00Z"), ["slab1"]);
    assert.deepEqual(types("2019-01-21T23:59:00Z"), ["slab1"]);
    assert.deepEqual(types("2019-01-22T00:00:00Z"), ["slab2"], "Content Update v7.20's Omega Pyramid");
    assert.deepEqual(types("2019-02-20T12:00:00Z"), ["slab2"], "on to the season's end");
    assert.deepEqual(types("2019-01-22T00:00:00Z", v710), ["slab4"], "7.10's DM Arena as it was");
  });
});

test("7.20's shop: The Ice Queen and the others on their days, with their back blings; 7.10 sells none of them", (t) => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 7: "2018-12-06" } };
  configureItemShop(() => shopConfig);
  t.after(() => configureItemShop(null));
  const offers = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig));
  const all = (shop) => [...shop.BRWeeklyStorefront, ...shop.BRDailyStorefront];
  const iceQueen = all(offers(v720, "2019-01-20T12:00:00Z")).find(({ templateId }) => templateId === "AthenaCharacter:cid_330_athena_commando_f_icequeen");
  assert.ok(iceQueen, "The Ice Queen on 20 January");
  assert.equal(iceQueen.price, 2000);
  assert.deepEqual(iceQueen.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_330_athena_commando_f_icequeen", "AthenaBackpack:bid_199_icequeen"]);
  const c710 = inBuild(v710, athenaCosmetics);
  assert.ok(all(offers(v710, "2019-01-20T12:00:00Z")).every(({ templateId }) => c710[templateId]));
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season7.json", import.meta.url), "utf8")).days;
  const c720 = inBuild(v720, athenaCosmetics);
  assert.equal(history.flatMap((day) => [...day.featured, ...day.daily]).filter(([id]) => !c710[id] && c720[id]).length, 53, "53 sales of 7.20's own");
  assert.equal(history.some((day) => [...day.featured, ...day.daily].some(([id]) => id === "AthenaPickaxe:pickaxe_id_131_nautilus")), false,
    "the Krakenaxe is left out: 7.10's data names it TBD");
});

test("7.20's Creative: a Frosty Fortress beside 7.10's islands; 7.10 none", () => {
  const plots = (build, name) => withConfig({ mode: "auto", seasonStarts: { 7: "2018-12-06" } }, () => withSession(build, name, (session) => {
    settleCreativePlots(session, at("2019-01-20T12:00:00Z"));
    return plotsOf(session.profile("creative").profile).map(([, item]) => `${item.templateId}#${item.attributes.islandIndex}`).sort();
  }));
  assert.deepEqual(plots(v720, "plots720"), ["CreativePlot:arctic_competitive_medium1#1", ...[1, 2, 3, 4].map((i) => `CreativePlot:arctic_medium#${i}`),
    ...[1, 2, 3, 4].map((i) => `CreativePlot:temperate_medium#${i}`), "CreativePlot:theblock_season7#1", "CreativePlot:theblock_season7#2"]);
  assert.equal(plots(v710, "plots710").some((plot) => plot.startsWith("CreativePlot:arctic_competitive_medium1")), false);
  assert.equal(inBuild(v710, () => isForeignTemplate("CreativePlot:arctic_competitive_medium1")), true);
  assert.equal(inBuild(v720, () => isForeignTemplate("CreativePlot:arctic_competitive_medium1")), false);
});
