import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { blockStates } from "../src/events/block.js";
import { activeEventFlags, blockSlab, configureEvents, ltmHighStakes } from "../src/events/events.js";
import { highStakes2019CalendarEvent, highStakes2019FlagsNow, highStakes2019States } from "../src/events/highstakes2019.js";
import { hasLtm, ltmFrontEndPlaylists, ltmOn } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";

// Fortnite 8.20 (Update v8.20, 27 March 2019; Season 8): CL-5625478, on its own data (gamedata/5625478). Season 8's
// Battle Pass as 8.00's; Season 8's High Stakes Challenges, the Block's 8.20 builds, and the LTMs of 8.01 to 8.20 its
// paks have (Slide, the Getaway, One Shot, Floor is Lava, Sniper Shootout, Going Green).
const v820 = "5625478";
const v800 = "5203069";
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const season8 = { mode: "auto", seasonStarts: { 8: "2019-02-28" } };
const typesOf = (states) => states[0]?.events.map(({ eventType }) => eventType) ?? [];
// Season 8's replay started `days` days before today (UTC), so that today is 28 February 2019 + days on it.
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-820-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

test("8.20 is known, on its own data", () => {
  assert.equal(versionOf(v820), "8.20");
  assert.equal(allowedBuildList(["8.20"]).join(), v820);
  assert.equal(dataBuild(v820), v820);
  assert.equal(dataBuild("5400000"), v800, "a build between 8.00 and 8.20 plays on 8.00's");
  assert.equal(dataBuild("5700000"), v820, "a later build Core doesn't know plays on 8.20's");
  assert.equal(releasedOn(v820), Date.UTC(2019, 2, 27));
  assert.equal(buildOfSeason(8), "6005771", "8.40 is Season 8's newest (tests/build840.test.js)");
  assert.equal(seasonName(8), "Season 8 (8.00 – 8.40)");
  const season = inBuild(v820, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [8, "BRSeason8", 100]);
  assert.deepEqual(inBuild(v820, () => battlePassOffers()).map(({ offerId, price }) => [offerId, price]),
    [["core_br_season8_battlepass", 950], ["core_br_season8_battlebundle", 2800], ["E07E41D52D4A425F8DC6592496B75301", 150]]);
});

test("8.20's cosmetics: 78 more than 8.00 (Kuno, Kenji, Psion, Marino, the pirates...), three of 8.00's keyed ones gone", () => {
  const [c820, c800] = [inBuild(v820, athenaCosmetics), inBuild(v800, athenaCosmetics)];
  assert.equal(Object.keys(c820).length, 1585);
  assert.equal(Object.keys(c820).filter((id) => !c800[id]).length, 78);
  // In 8.00's pakchunk1001, which the keychain opens; 8.20 moved them to a pak it has no key for.
  assert.deepEqual(Object.keys(c800).filter((id) => !c820[id]).sort(),
    ["AthenaGlider:glider_id_117_warpaint", "AthenaPickaxe:pickaxe_id_153_roseleader", "AthenaSkyDiveContrail:trails_id_006_starsandstripes"]);
  for (const [id, name] of [["AthenaCharacter:cid_362_athena_commando_f_bandageninja", "Kuno"],
    ["AthenaCharacter:cid_361_athena_commando_m_bandageninja", "Kenji"], ["AthenaCharacter:cid_364_athena_commando_f_sciops", "Psion"],
    ["AthenaCharacter:cid_366_athena_commando_m_tropical", "Marino"], ["AthenaGlider:glider_id_133_bandageninja", "Falcon"]])
    assert.equal(c820[id]?.name, name, id);
});

test("Season 8's High Stakes Challenges' data: Schedule_LTM_Heist_V2 names its flag as CalendarEventTag", () => {
  const schedule = inBuild(v820, athenaChallengeSchedules).schedule_ltm_heist_v2;
  assert.deepEqual([schedule.eventName, schedule.cleanUpOnBundleCompletion], [ltmHighStakes, true]);
  const bundle = inBuild(v820, athenaChallengeBundles).questbundle_ltm_heist_v2;
  assert.ok(bundle.quests.some(({ quest }) => quest === "quest_br_heist_win"));
  assert.equal(inBuild(v800, athenaChallengeSchedules).schedule_ltm_heist_v2, undefined, "8.00 has no such schedule");
});

test("the High Stakes Challenges' flag: 14 to 19 March 2019 on 8.20 only; the switch and off", () => {
  withConfig(season8, () => {
    const types = (iso, build = v820) => typesOf(inBuild(build, () => highStakes2019States(at(iso))));
    assert.deepEqual(types("2019-03-13T23:59:00Z"), []);
    assert.deepEqual(types("2019-03-14T00:00:00Z"), [ltmHighStakes, highStakes2019CalendarEvent]);
    assert.deepEqual(types("2019-03-19T23:00:00Z"), [ltmHighStakes, highStakes2019CalendarEvent]);
    assert.deepEqual(types("2019-03-20T00:00:00Z"), []);
    assert.deepEqual(types("2019-03-15T12:00:00Z", v800), [], "8.00 has no High Stakes");
  });
  withConfig({ ...season8, season4Flags: { overrides: { [ltmHighStakes]: "on" } } }, () => {
    assert.ok(inBuild(v820, () => activeEventFlags()).includes(ltmHighStakes), "switched on, always served");
  });
  withConfig({ ...season8, datedFlags: { highStakes2019: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v820, () => highStakes2019FlagsNow(at("2019-03-15T12:00:00Z"))), []);
  });
  assert.deepEqual(season4Flag(ltmHighStakes).builds, [5625478, 6005771]);
});

test("an 8.20 player gets the High Stakes Challenges while they run", () => {
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(15) } }, () => withSession(v820, "highstakes820", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const { items } = session.profile("athena").profile;
    assert.ok(Object.values(items).some((item) => item.templateId === "ChallengeBundleSchedule:schedule_ltm_heist_v2"), "the schedule");
    assert.ok(Object.values(items).some((item) => item.templateId === "Quest:quest_br_heist_win"), "its quests");
  }));
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(30) } }, () => withSession(v820, "nohighstakes820", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const { items } = session.profile("athena").profile;
    assert.equal(Object.values(items).some((item) => item.templateId === "ChallengeBundleSchedule:schedule_ltm_heist_v2"), false, "not after it");
  }));
});

test("8.20's Block: Tropical Treetops, Mysterious Mansion on 2 April, Tropical Treetops again; 8.00 keeps its own", () => {
  withConfig(season8, () => {
    const types = (iso, build = v820) => typesOf(inBuild(build, () => blockStates(at(iso))));
    assert.deepEqual(types("2019-03-01T12:00:00Z"), [blockSlab(1)]);
    assert.deepEqual(types("2019-04-02T12:00:00Z"), [blockSlab(2)]);
    assert.deepEqual(types("2019-04-05T12:00:00Z"), [blockSlab(1)]);
    // 8.00: Cryptic Castle, then Turtle Temple from 6 March to the season's end.
    assert.deepEqual(types("2019-03-01T12:00:00Z", v800), [blockSlab(1)]);
    assert.deepEqual(types("2019-04-02T12:00:00Z", v800), [blockSlab(2)]);
  });
});

test("Season 8's LTMs on 8.20: 8.00's, and Slide, the Getaway, One Shot, Floor is Lava, Sniper Shootout on their days", () => {
  const dated = { ltmOriginalDates: true };
  withConfig(season8, () => {
    for (const id of ["fiftyFiftySeason8", "playgroundV2", "creative"]) assert.equal(ltmOn(id, v820, {}, at("2019-03-28T12:00:00Z")), true, id);
    assert.equal(ltmOn("floorIsLavaSquads", v820, {}, at("2019-03-28T12:00:00Z")), false, "off by default, as 8.20's lobby ships it");
    const days = [["slideSeason8Duos", "2019-03-07"], ["getawaySeason8Squads", "2019-03-15"], ["goingGreenSquads", "2019-03-17"],
      ["oneShotSeason8Squads", "2019-03-21"], ["floorIsLavaSquads", "2019-03-28"], ["sniperShootoutSeason8Duos", "2019-04-03"],
      ["sniperShootoutSeason8Squads", "2019-04-03"], ["getawaySeason8Squads", "2019-04-14"], ["teamRumbleSeason8", "2019-04-12"]];
    for (const [id, day] of days) assert.equal(ltmOn(id, v820, dated, at(`${day}T12:00:00Z`)), true, `${id} ${day}`);
    assert.equal(ltmOn("floorIsLavaSquads", v820, dated, at("2019-04-11T12:00:00Z")), false);
    assert.equal(ltmOn("getawaySeason8Squads", v820, dated, at("2019-03-25T12:00:00Z")), false);
    // One Shot's 8.11 window is 8.20's: 8.00 only has Buccaneer's Bounty's day.
    assert.equal(ltmOn("oneShotSeason8Squads", v800, dated, at("2019-03-21T12:00:00Z")), false);
    assert.equal(ltmOn("oneShotSeason8Squads", v800, dated, at("2019-04-11T12:00:00Z")), true);
    // 8.20's new playlists aren't 8.00's; 8.00's Season 8 entries run on 8.20 too.
    for (const id of ["floorIsLavaSquads", "getawaySeason8Squads", "goingGreenSquads", "slideSeason8Duos"])
      assert.deepEqual([hasLtm(id, v820), hasLtm(id, v800)], [true, false], id);
    for (const id of ["fiftyFiftySeason8", "closeEncountersSeason8Squads", "teamRumbleSeason8", "classicSeason8Squads"])
      assert.deepEqual([hasLtm(id, v820), hasLtm(id, v800)], [true, true], id);
    const frontEnd = ltmFrontEndPlaylists(v820, {}).map(({ name }) => name);
    for (const name of ["Playlist_50v50", "Playlist_Playground", "Playlist_PlaygroundV2", "Playlist_Fill_Squads", "Playlist_Bling_Squads"])
      assert.ok(frontEnd.includes(name), name);
    assert.equal(ltmFrontEndPlaylists(v800, {}).some(({ name }) => name === "Playlist_Fill_Squads"), false);
  });
});

test("8.20's lobby has the Season 8 background flag", () => {
  assert.ok(activeEventFlags(v820).includes("EventFlag.LobbySeason8"));
  assert.ok(activeEventFlags(v800).includes("EventFlag.LobbySeason8"));
});

test("Season 8's shop history serves 8.20 its own 8.10 and 8.20 items, and 8.00 only its own", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 8: "2019-02-28" } };
  configureItemShop(() => shopConfig);
  try {
    const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season8.json", import.meta.url), "utf8")).days;
    const day = history.find(({ featured, daily }) => [...featured, ...daily].some(([id]) => id === "AthenaCharacter:cid_366_athena_commando_m_tropical"));
    assert.ok(day, "Marino is in the history");
    const ids = (build) => inBuild(build, () => {
      const offers = itemShopOffers(at(`${day.date}T12:00:00Z`), shopConfig);
      return [...offers.BRWeeklyStorefront, ...offers.BRDailyStorefront].map(({ templateId }) => templateId);
    });
    assert.ok(ids(v820).includes("AthenaCharacter:cid_366_athena_commando_m_tropical"));
    assert.equal(ids(v800).includes("AthenaCharacter:cid_366_athena_commando_m_tropical"), false);
    const c800 = inBuild(v800, athenaCosmetics);
    assert.ok(ids(v800).every((id) => c800[id]));
  } finally {
    configureItemShop(null);
  }
});
