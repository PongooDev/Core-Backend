import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { activeEventFlags, configureEvents, frostnite, lobbySeason7, ltm14DaysOfFortnite } from "../src/events/events.js";
import { fourteenDaysCalendarEvent, fourteenDaysDay, fourteenDaysFlagsNow, fourteenDaysStates } from "../src/events/fourteendays.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { isForeignTemplate } from "../src/gamedata/templates.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { advanceAthenaObjectives, athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { plotsOf, settleCreativePlots } from "../src/profiles/creative.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { contentPage } from "../src/services/content/pages.js";
import { createSettingsStore } from "../src/settings/store.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 7.10 (Update v7.10, 18 December 2018; Season 7): CL-4667333, on its own data (gamedata/4667333). Battle Royale:
// the 14 Days of Fortnite (its challenges a day at a time, its modes on Epic's days), Krampus and the holiday cosmetics in
// the shop; Creative's Arctic islands and Blocks, its island favorites; Save the World's Frostnite flag.
const v710 = "4667333";
const v700 = "4629139";
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
const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-710-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
// Season 7's replay started `days` days before today (UTC), so that today is 6 December 2018 + days on it.
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);

test("7.10 is known, on its own data, Season 7's newest build", () => {
  assert.equal(versionOf(v710), "7.10");
  assert.equal(allowedBuildList(["7.10"]).join(), v710);
  assert.equal(dataBuild(v710), v710);
  assert.equal(dataBuild("4650000"), v700, "a build between 7.00 and 7.10 plays on 7.00's");
  assert.equal(dataBuild("4700000"), v710, "a later build Core doesn't know plays on 7.10's");
  assert.equal(releasedOn(v710), Date.UTC(2018, 11, 18));
  assert.equal(buildOfSeason(7), "4834550", "Season 7's newest is 7.30");
  assert.equal(seasonName(7), "Season 7 (7.00 – 7.30)");
  const season = inBuild(v710, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.battlePassLevelOfferId], [7, "BRSeason7", "64A3020B098841A7805EE257D68C554F"]);
});

test("7.10's data: eight overlays the same as 7.00's, the curve tables whole", () => {
  assert.ok(Object.keys(buildGameData(v710, "research", {}).stats ?? {}).length > 0);
  const dir = new URL("../gamedata/", import.meta.url);
  const read = (build, name) => fs.readFileSync(new URL(`${build}/${name}`, dir), "utf8").replace(/\r\n/g, "\n");
  const names = fs.readdirSync(new URL(v710, dir)).sort();
  assert.deepEqual(names, fs.readdirSync(new URL(v700, dir)).sort(), "the same files as 7.00's");
  assert.deepEqual(names.filter((name) => read(v710, name) === read(v700, name)), ["accountlevels.json", "dailyrewards.json", "expeditions.json",
    "homebasenodes.json", "inventory.json", "research.json", "squads.json", "transmog.json"]);
});

test("7.10's cosmetics: 74 new, none gone (Krampus, the Winter Bus, the 14 Days' rewards)", () => {
  const [c710, c700] = [inBuild(v710, athenaCosmetics), inBuild(v700, athenaCosmetics)];
  assert.equal(Object.keys(c710).filter((id) => !c700[id]).length, 74);
  assert.deepEqual(Object.keys(c700).filter((id) => !c710[id]), []);
  for (const [id, name] of [["AthenaCharacter:cid_314_athena_commando_m_krampus", "Krampus"], ["AthenaBattleBus:bbid_winterbus", "Winter Bus"],
    ["AthenaItemWrap:wrap_007_candycane", "Candy Cane"], ["AthenaGlider:glider_id_106_fortnitedj", "Equalizer"], ["AthenaBackpack:petcarrier_006_gingerbread", "Merry Munchkin"]]) {
    assert.equal(c710[id]?.name, name, id);
    assert.equal(c700[id], undefined, `${id} is 7.10's`);
  }
});

test("the 14 Days of Fortnite's challenges: one with the schedule, one more each day, each in its gift box", () => {
  const schedule = inBuild(v710, athenaChallengeSchedules).schedule_14daysoffortnite;
  assert.deepEqual([schedule.eventName, schedule.category, schedule.cleanUpOnBundleCompletion], [ltm14DaysOfFortnite, "14DoF", true]);
  const bundle = inBuild(v710, athenaChallengeBundles).questbundle_14daysoffortnite;
  assert.equal(bundle.quests.length, 14);
  assert.deepEqual(bundle.quests[0], { giftBox: "GiftBox:gb_14daysoffortnite", grantWithBundle: true, quest: "quest_br_fdf_play_creative_mode" });
  assert.deepEqual(bundle.quests.slice(1).map(({ unlockType, unlockValue }) => `${unlockType}:${unlockValue}`),
    Array.from({ length: 13 }, (_, i) => `DaysFromEventStart:${i + 1}`));
  assert.deepEqual(bundle.completionSteps, [{ count: -1, rewards: [{ quantity: 1, templateId: "HomebaseBannerIcon:br14daysribbon" }] }]);
  assert.equal(inBuild(v700, athenaChallengeSchedules).schedule_14daysoffortnite, undefined, "7.00 has none");
});

test("the 14 Days' flag and calendar event: its dates on Season 7's replay, on 7.10 only; the admin's switch and off", () => {
  withConfig(season7, () => {
    const types = (iso, build = v710) => inBuild(build, () => fourteenDaysStates(at(iso)))[0]?.events.map(({ eventType }) => eventType) ?? [];
    assert.deepEqual(types("2018-12-19T13:00:00Z"), []);
    assert.deepEqual(types("2018-12-19T14:00:00Z"), [ltm14DaysOfFortnite, fourteenDaysCalendarEvent], "Update v7.10's 9 AM ET");
    const first = inBuild(v710, () => fourteenDaysStates(at("2018-12-25T12:00:00Z")))[0].events[0];
    assert.deepEqual([first.activeSince, first.activeUntil], ["2018-12-19T14:00:00.000Z", "2019-01-02T14:00:00.000Z"]);
    assert.deepEqual(types("2019-01-04T12:00:00Z"), [], "between the end and the extension");
    assert.deepEqual(types("2019-01-10T12:00:00Z"), [ltm14DaysOfFortnite, fourteenDaysCalendarEvent], "the extension week");
    assert.deepEqual(types("2018-12-25T12:00:00Z", v700), [], "7.00 has no 14 Days");
    assert.equal(inBuild(v710, () => fourteenDaysDay(at("2018-12-19T13:00:00Z"))), null);
    assert.equal(inBuild(v710, () => fourteenDaysDay(at("2018-12-19T15:00:00Z"))), 0);
    assert.equal(inBuild(v710, () => fourteenDaysDay(at("2018-12-25T15:00:00Z"))), 6);
  });
  withConfig({ ...season7, season4Flags: { overrides: { [ltm14DaysOfFortnite]: "on" } } }, () => {
    assert.ok(inBuild(v710, () => activeEventFlags()).includes(ltm14DaysOfFortnite), "switched on, always served");
    assert.equal(inBuild(v710, () => fourteenDaysDay(at("2018-12-10T12:00:00Z"))), Infinity, "every day has come");
  });
  withConfig({ ...season7, datedFlags: { fourteenDays: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v710, () => fourteenDaysFlagsNow(at("2018-12-25T12:00:00Z"))), []);
  });
  assert.deepEqual(season4Flag(ltm14DaysOfFortnite).builds, [4667333, 4834550], "7.20 and 7.30: by the switch only");
});

test("a 7.10 player gets the 14 Days' schedule while it runs, and a challenge for each day it has run", () => {
  withConfig({ mode: "auto", seasonStarts: { 7: replayDaysAgo(17) } }, () => withSession(v710, "fourteen710", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const day = fourteenDaysDay();
    assert.ok(day >= 3 && day <= 4, `Season 7's replay is on 23 December: day ${day}`);
    const { items } = session.profile("athena").profile;
    const bundle = Object.values(items).find((item) => item.templateId === "ChallengeBundle:questbundle_14daysoffortnite");
    assert.ok(bundle, "the bundle");
    assert.equal(bundle.attributes.grantedquestinstanceids.length, day + 1);
    assert.ok(Object.values(items).some((item) => item.templateId === "Quest:quest_br_fdf_play_match_friends"), "day 2's");
    assert.equal(Object.values(items).some((item) => item.templateId === "Quest:quest_br_fdf_interact_chests_search"), false, "day 14's not yet");
    // Day 2's done (two giant candy canes visited): its loading screen and present token, shown in the 14 Days' gift box.
    advanceAthenaObjectives(session, [{ statName: "fdf_visit_athena_giant_candy_cane_01", count: 1 }, { statName: "fdf_visit_athena_giant_candy_cane_02", count: 1 }]);
    const athena = session.profile("athena").profile.items;
    assert.ok(Object.values(athena).some((item) => item.templateId.toLowerCase() === "athenaloadingscreen:lsid_072_winterlauncher"), "Festive Firefight");
    const boxes = Object.values(session.profile("profile0").profile.items).filter((item) => item.templateId.toLowerCase() === "giftbox:gb_14daysoffortnite");
    assert.equal(boxes.length, 1);
    assert.ok(boxes[0].attributes.lootList.some(({ itemType }) => String(itemType).toLowerCase() === "athenaloadingscreen:lsid_072_winterlauncher"));
  }));
  withConfig({ mode: "auto", seasonStarts: { 7: replayDaysAgo(17) } }, () => withSession(v700, "fourteen700", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(Object.values(session.profile("athena").profile.items).some((item) => String(item.templateId).includes("14daysoffortnite")), false,
      "7.00 has no 14 Days");
  }));
});

test("7.10's event flags: 7.00's own, Frostnite; Fortnitemares' and the Winter bus's switches stop at 7.00", () => {
  const flags = activeEventFlags(v710);
  for (const flag of [lobbySeason7, "EventFlag.ActiveStorms", "EventFlag.PassiveMiniBosses", frostnite]) assert.ok(flags.includes(flag), flag);
  assert.equal(activeEventFlags(v700).includes(frostnite), false);
  assert.deepEqual(season4Flag(frostnite).builds, [4667333, 4834550]);
  assert.deepEqual(season4Flag("EventFlag.Fortnitemares").builds[1], 4629139);
  assert.deepEqual(season4Flag("EventFlag.WinterBattleBus").builds, [4629139, 4629139]);
  assert.equal(season4Flag("EventFlag.ActiveStorms").builds[1], 4834550);
});

test("7.10's modes: the 14 Days of Fortnite's on by default, each on its day from 14:00 UTC with Original dates", () => {
  const defaults = createSettingsStore(null).get();
  const fourteen = ["teamsOf33", "unvaultedSquads710", "siphonSolo710", "teamTerror710", "barebonesSquads", "slideSolo", "holidayDisco",
    "sniperShootoutDuos710", "closeEncountersSeason7Squads", "teamRumble", "solidGoldSquads710", "scoreRoyaleDuos710", "foodFight16", "groundGameSquads",
    "sneakySilencersSolo710", "closeEncounters50s", "wildWestSquads710", "steadyStormSolo710", "highExplosives50s", "highExplosivesSquads710", "oneShotSquads"];
  for (const id of fourteen) assert.equal(ltmOn(id, v710, defaults), true, id);
  for (const id of ["teamsOf33", "barebonesSquads", "foodFight16", "closeEncounters50s", "highExplosives50s", "oneShotSquads", "holidayDisco"]) {
    assert.equal(hasLtm(id, v700), false, `${id} is 7.10's`);
  }
  for (const id of ["fiftyFiftySeason7", "playgroundV2", "creative", "unvaultedSolo", "siphonDuos", "soaringSeason7Solo"]) assert.equal(hasLtm(id, v710), true, id);
  assert.equal(ltmOn("unvaultedSquads", v700, defaults), false, "7.00's switch is as it was");
  assert.equal(ltmOfPlaylist(151, v710).id, "teamsOf33");
  assert.equal(ltmOfPlaylist(232, v710).id, "holidayDisco");
  assert.equal(ltmOfPlaylist(232, v700).id, "discoDomination32Alt630", "7.00's Disco Domination (Alt) as it was");
  assert.equal(playlistIdOfName("playlist_close_50", v710), 4750);
  assert.deepEqual(playlistTeamsOf(`${v710}:0:NAE:playlist_33`, v710), { maxTeamCount: 3, maxTeamSize: 33, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v710}:0:NAE:playlist_barrier_16`, v710), { maxTeamCount: 2, maxTeamSize: 16, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v710}:0:NAE:playlist_low_squads`, v710), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  withConfig(season7, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("teamsOf33", v710, at("2018-12-19T13:59:00Z"), dated), false);
    assert.equal(inOriginalWindow("teamsOf33", v710, at("2018-12-19T14:00:00Z"), dated), true, "day 1, 9 AM ET");
    assert.equal(inOriginalWindow("teamsOf33", v710, at("2018-12-21T13:59:00Z"), dated), true, "large modes run two days");
    assert.equal(inOriginalWindow("teamsOf33", v710, at("2018-12-21T14:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("slideSolo", v710, at("2018-12-22T20:00:00Z"), dated), true, "day 4");
    assert.equal(inOriginalWindow("slideSolo", v710, at("2018-12-23T14:00:00Z"), dated), false, "small modes run a day");
    assert.equal(inOriginalWindow("oneShotSquads", v710, at("2019-01-01T20:00:00Z"), dated), true, "day 14");
    assert.equal(inOriginalWindow("teamRumble", v710, at("2018-12-26T12:00:00Z"), dated), true, "days 7 and 8");
    assert.equal(inOriginalWindow("closeEncountersSeason7Squads", v710, at("2018-12-24T20:00:00Z"), dated), true, "day 6");
    assert.equal(inOriginalWindow("closeEncountersSeason7Squads", v710, at("2018-12-15T12:00:00Z"), dated), false, "7.01's week was 7.00's");
  });
  const lobby = ltmFrontEndPlaylists(v710, defaults);
  for (const name of ["Playlist_33", "Playlist_Close_50", "Playlist_50v50HE", "Playlist_Barrier_16", "Playlist_Low_Squads", "Playlist_PlaygroundV2"]) {
    assert.equal(lobby.find((own) => own.name === name)?.enabled, true, name);
  }
  assert.equal(ltmFrontEndPlaylists(v700, defaults).some((own) => own.name === "Playlist_33"), false);
});

test("7.10's tiles: the 14 Days' on its page only; 7.00's page is as it was", () => {
  const byName = (build) => Object.fromEntries(contentPage(undefined, undefined, build).playlistinformation.playlist_info.playlists
    .map(({ playlist_name: name, image }) => [name, image]));
  const [p710, p700] = [byName(v710), byName(v700)];
  assert.match(p710.Playlist_33, /BR07_14-DoF_Social-1024x512-5fa7dd4752d1f0cc1a101f09cb170d0f5b2a31cf\.jpg$/);
  assert.match(p710.Playlist_Hard_Squads, /BR_LTM_Barebones-1024x512-4a29337febb04e9043d57c9e61afe849f8a9e9c7\.jpg$/);
  assert.match(p710.Playlist_Barrier_16, /BR_LTM_FoodFight16-/);
  assert.match(p710.Playlist_Disco_32_Alt, /BR_LTM_HolidayDisco-1024x512-684bd4b41613e59d895a477389515a8b4878da6a\.jpg$/);
  assert.match(p710.Playlist_WW_Squads, /BR_LTM_WildWest-1024x512-42779242a5a73d654332d9d0afe0983f9d8401d0\.jpg$/);
  assert.match(p700.Playlist_Disco_32_Alt, /BR06_LobbyTile_LTM_DiscoDomination-/, "7.00 keeps 6.30's tile");
  for (const name of ["Playlist_33", "Playlist_Hard_Squads", "Playlist_Close_50", "Playlist_50v50HE"]) assert.equal(p700[name], undefined, `${name} isn't on 7.00's page`);
});

test("7.10's shop: Krampus and the holiday cosmetics on their days, with their back blings; 7.00 sells none of them", (t) => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 7: "2018-12-06" } };
  configureItemShop(() => shopConfig);
  t.after(() => configureItemShop(null));
  const offers = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig));
  const all = (shop) => [...shop.BRWeeklyStorefront, ...shop.BRDailyStorefront];
  const krampusDay = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season7.json", import.meta.url), "utf8")).days
    .find((day) => day.featured.some(([id]) => id === "AthenaCharacter:cid_314_athena_commando_m_krampus")).date;
  const krampus = all(offers(v710, `${krampusDay}T12:00:00Z`)).find(({ templateId }) => templateId === "AthenaCharacter:cid_314_athena_commando_m_krampus");
  assert.ok(krampus, `Krampus on ${krampusDay}`);
  assert.deepEqual(krampus.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_314_athena_commando_m_krampus", "AthenaBackpack:bid_194_krampus"]);
  const c700 = inBuild(v700, athenaCosmetics);
  assert.ok(all(offers(v700, `${krampusDay}T12:00:00Z`)).every(({ templateId }) => c700[templateId]));
});

test("7.10's Creative: four Arctic islands and two Blocks beside the four islands; 7.00 four", () => {
  const plots = (build, name) => withConfig({ mode: "auto", seasonStarts: { 7: "2018-12-06" } }, () => withSession(build, name, (session) => {
    settleCreativePlots(session, at("2018-12-20T12:00:00Z"));
    return plotsOf(session.profile("creative").profile).map(([, item]) => `${item.templateId}#${item.attributes.islandIndex}`).sort();
  }));
  assert.deepEqual(plots(v700, "plots700"), [1, 2, 3, 4].map((i) => `CreativePlot:temperate_medium#${i}`));
  assert.deepEqual(plots(v710, "plots710"), [...[1, 2, 3, 4].map((i) => `CreativePlot:arctic_medium#${i}`),
    ...[1, 2, 3, 4].map((i) => `CreativePlot:temperate_medium#${i}`), "CreativePlot:theblock_season7#1", "CreativePlot:theblock_season7#2"]);
  // An account given them on 7.10 keeps them, and a 7.00 client isn't sent them.
  assert.equal(inBuild(v700, () => isForeignTemplate("CreativePlot:arctic_medium")), true);
  assert.equal(inBuild(v700, () => isForeignTemplate("CreativePlot:temperate_medium")), false);
  assert.equal(inBuild(v710, () => isForeignTemplate("CreativePlot:theblock_season7")), false);
});

test("a 7.10 client's island favorites: an empty list, no code to add, nothing to take off", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Favorites710");
    const ask = (method, suffix = "") => send({ host: "127.0.0.1", port: backend.port, method,
      path: `/fortnite/api/game/v2/creative/favorites/${player.accountId}${suffix}`,
      headers: { "User-Agent": agentOf(v710, "7.10"), Authorization: `bearer ${player.token}` } });
    const list = await ask("GET", "?limit=20");
    assert.deepEqual([list.status, list.body], [200, { results: [], hasMore: false }]);
    const add = await ask("PUT", "/1234-5678-9012");
    assert.deepEqual([add.status, add.body.errorCode], [404, "errors.com.epicgames.links.no_active_version"]);
    assert.equal((await ask("DELETE", "/1234-5678-9012")).status, 204);
    const other = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/game/v2/creative/favorites/someoneelse",
      headers: { "User-Agent": agentOf(v710, "7.10"), Authorization: `bearer ${player.token}` } });
    assert.equal(other.status, 403);
  } finally {
    await backend.close();
  }
});
