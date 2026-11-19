import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { blockStates } from "../src/events/block.js";
import { s8CracksAt, s8FissureHours } from "../src/events/datedflags.js";
import { activeEventFlags, configureEvents, frostnite, lobbySeason7, lteFestivus, lteS7Overtime, ltm14DaysOfFortnite, ltmWinterDeimos,
  s8Burnt, s8Cracked, s8Cracks, s8Heat, s8Tremors } from "../src/events/events.js";
import { festivusStates, showtimeStates } from "../src/events/festivus.js";
import { eventDaysOf } from "../src/events/fourteendays.js";
import { iceStormMeltStates } from "../src/events/icestorm.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn } from "../src/events/ltms.js";
import { overtimeCalendarEvent, overtimeDay, overtimeFlagsNow, overtimeStates } from "../src/events/overtime.js";
import { earthquakesStates, s8HeatStates } from "../src/events/s8leadup.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { isForeignTemplate } from "../src/gamedata/templates.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { athenaQuestLogin, grantCosmetic, lockerCosmetics, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { createSettingsStore } from "../src/settings/store.js";
import { currencyOffers } from "../src/store/currency.js";
import { hasGifting } from "../src/store/gifting.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";

// Fortnite 7.40 (Update v7.40, 14 February 2019; Season 7's last): CL-5046157, on its own data (gamedata/5046157). Battle
// Royale: Share the Love's Overtime Challenges, the earthquakes before Season 8 and the Wailing Woods drying up, Love Shot,
// Sword Fight, Catch! and Driftin', the Block's Oily Oaks and Colossal Compound, Skully, Heartbreaker and the others in the
// shop, the Skully and Ice Queen style challenges.
const v740 = "5046157";
const v730 = "4834550";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-740-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
// Season 7's replay started `days` days before today (UTC), so that today is 6 December 2018 + days on it.
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);
const typesOf = (states) => states[0]?.events.map(({ eventType }) => eventType) ?? [];

test("7.40 is known, on its own data, Season 7's newest build", () => {
  assert.equal(versionOf(v740), "7.40");
  assert.equal(allowedBuildList(["7.40"]).join(), v740);
  assert.equal(dataBuild(v740), v740);
  assert.equal(dataBuild("4900000"), v730, "a build between 7.30 and 7.40 plays on 7.30's");
  assert.equal(dataBuild("5100000"), v740, "a later build Core doesn't know plays on 7.40's");
  assert.equal(releasedOn(v740), Date.UTC(2019, 1, 14));
  assert.equal(buildOfSeason(7), v740);
  assert.equal(seasonName(7), "Season 7 (7.00 – 7.40)");
  const season = inBuild(v740, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront], [7, "BRSeason7"]);
  // What 7.20 and 7.30 have for Season 7 holds on 7.40: the Cobalt Pack (Core-Backend #385) and gifting.
  assert.ok(inBuild(v740, () => currencyOffers("cobalt740", { stats: { attributes: {} } })).some(({ offerId }) => offerId === "core_starter_br_s7"));
  assert.equal(hasGifting(v740), true);
});

test("7.40's cosmetics: Skully, Heartbreaker, Lil Whip, the Fallen Love Ranger, the Share The Love sprays; two 7.30 emoticons gone", () => {
  const [c740, c730] = [inBuild(v740, athenaCosmetics), inBuild(v730, athenaCosmetics)];
  assert.equal(Object.keys(c740).filter((id) => !c730[id]).length, 34);
  assert.deepEqual(Object.keys(c730).filter((id) => !c740[id]).sort(), ["AthenaDance:emoji_bobwhat", "AthenaDance:emoji_marybobbins"]);
  for (const [id, name] of [["AthenaCharacter:cid_341_athena_commando_f_skullbrite", "Skully"], ["AthenaCharacter:cid_345_athena_commando_m_lovellama", "Heartbreaker"],
    ["AthenaCharacter:cid_343_athena_commando_m_cupiddark", "Fallen Love Ranger"], ["AthenaGlider:glider_id_122_valentines", "Heartspan"],
    ["AthenaItemWrap:wrap_013_valentines", "Valentine"], ["AthenaSkyDiveContrail:trails_id_014_vines", "Vines"]]) {
    assert.equal(c740[id]?.name, name, id);
  }
  // Jumpshot and Triple Threat: 7.40's DefaultGame.ini keeps 7.30's redirects, so an account's old id isn't hidden.
  assert.equal(inBuild(v740, () => isForeignTemplate("AthenaCharacter:cid_136_athena_commando_m_basketball")), false);
  assert.equal(inBuild(v740, lockerCosmetics).includes("AthenaCharacter:cid_136_athena_commando_m_streetbasketball"), false);
  assert.equal(inBuild(v740, lockerCosmetics).includes("AthenaCharacter:cid_341_athena_commando_f_skullbrite"), true);
});

test("the Overtime Challenges' data: the schedule's flag, four free ones with it, more on the 3rd, 6th and 9th day", () => {
  const schedule = inBuild(v740, athenaChallengeSchedules).season7_ot_schedule;
  assert.deepEqual([schedule.eventName, schedule.category], [lteS7Overtime, "S7_Overtime"]);
  const bundle = inBuild(v740, athenaChallengeBundles).questbundle_s7_overtime;
  assert.equal(bundle.quests.length, 20);
  assert.deepEqual(bundle.quests.filter(({ unlockType }) => unlockType === "DaysFromEventStart").map(({ unlockValue }) => unlockValue),
    [3, 3, 3, 6, 6, 6, 6, 9, 9, 9, 9]);
  assert.deepEqual(bundle.completionSteps, [{ count: 13, rewards: [{ giftBox: "GiftBox:gb_overtime", quantity: 1, templateId: "HomebaseBannerIcon:brs7overtime" }] }]);
  assert.equal(inBuild(v730, athenaChallengeSchedules).season7_ot_schedule, undefined, "7.30 has none");
});

test("the Overtime Challenges' flag: from 14 February to the season's end on 7.40 only; the switch and off", () => {
  withConfig(season7, () => {
    const types = (iso, build = v740) => typesOf(inBuild(build, () => overtimeStates(at(iso))));
    assert.deepEqual(types("2019-02-13T23:59:00Z"), []);
    assert.deepEqual(types("2019-02-14T00:00:00Z"), [lteS7Overtime, overtimeCalendarEvent]);
    assert.deepEqual(types("2019-02-27T23:00:00Z"), [lteS7Overtime, overtimeCalendarEvent]);
    assert.deepEqual(types("2019-02-20T12:00:00Z", v730), [], "7.30 has no Overtime");
    assert.equal(inBuild(v740, () => overtimeDay(at("2019-02-14T12:00:00Z"))), 0);
    assert.equal(inBuild(v740, () => overtimeDay(at("2019-02-23T12:00:00Z"))), 9);
    assert.equal(inBuild(v740, () => eventDaysOf(lteS7Overtime, at("2019-02-17T12:00:00Z"))), 3);
  });
  withConfig({ ...season7, season4Flags: { overrides: { [lteS7Overtime]: "on" } } }, () => {
    assert.ok(inBuild(v740, () => activeEventFlags()).includes(lteS7Overtime), "switched on, always served");
    assert.equal(inBuild(v740, () => overtimeDay(at("2019-01-01T12:00:00Z"))), Infinity);
  });
  withConfig({ ...season7, datedFlags: { overtime: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v740, () => overtimeFlagsNow(at("2019-02-20T12:00:00Z"))), []);
  });
  assert.deepEqual(season4Flag(lteS7Overtime).builds, [5046157, 5046157]);
});

test("a 7.40 player gets the Overtime Challenges while they run, the later ones on their days", () => {
  withConfig({ mode: "auto", seasonStarts: { 7: replayDaysAgo(73) } }, () => withSession(v740, "overtime740", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(overtimeDay(), 3, "Season 7's replay is on 17 February");
    const { items } = session.profile("athena").profile;
    assert.ok(Object.values(items).some((item) => item.templateId === "ChallengeBundleSchedule:season7_ot_schedule"), "the schedule");
    const bundle = Object.values(items).find((item) => item.templateId === "ChallengeBundle:questbundle_s7_overtime");
    assert.ok(bundle, "the bundle");
    assert.ok(Object.values(items).some((item) => item.templateId === "Quest:quest_br_ot_visit_waterfalls") === false, "the 6th day's isn't yet");
    assert.ok(Object.values(items).some((item) => item.templateId === "Quest:quest_br_visit_namedlocations"), "the 3rd day's");
  }));
});

test("the earthquakes: 7.30's tremors, 7.40's cracks crack by crack from 12 February and every crack after the 27th", () => {
  withConfig(season7, () => {
    const types = (iso, build = v740) => typesOf(inBuild(build, () => earthquakesStates(at(iso)))).sort();
    assert.deepEqual(types("2019-02-04T12:00:00Z"), []);
    assert.deepEqual(types("2019-02-06T12:00:00Z"), [s8Tremors], "Content Update v7.30's rumbling");
    assert.deepEqual(types("2019-02-06T12:00:00Z", v730), [s8Tremors], "7.30's BP_S8LeadupEvents watches EQ too");
    assert.deepEqual(types("2019-02-14T12:00:00Z"), [s8Cracks, s8Tremors].sort());
    assert.deepEqual(types("2019-02-14T12:00:00Z", v730), [s8Tremors], "7.30 reads no cracks");
    assert.deepEqual(types("2019-02-27T23:00:00Z"), [s8Cracked, s8Cracks, s8Tremors].sort(), "after the 26th crack");
    const cracks = inBuild(v740, () => earthquakesStates(at("2019-02-20T12:00:00Z")))[0].events.find(({ eventType }) => eventType === s8Cracks);
    assert.equal(cracks.activeSince, "2019-02-12T09:00:00.000Z");
    assert.deepEqual(types("2019-02-06T12:00:00Z", "4727874"), [], "7.20 has none");
  });
  // The first crack at 12:30 PM ET on 14 February and the 26th through Tilted Towers on the 27th.
  assert.equal(new Date(s8CracksAt + s8FissureHours[1] * 3600000).toISOString(), "2019-02-14T17:30:00.000Z");
  assert.equal(new Date(s8CracksAt + s8FissureHours[26] * 3600000).toISOString(), "2019-02-27T20:18:00.000Z");
  withConfig({ ...season7, datedFlags: { earthquakes: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v740, () => earthquakesStates(at("2019-02-20T12:00:00Z"))), [{ validFrom: -Infinity, events: [] }]);
  });
});

test("the Wailing Woods' heat on 7.40: drying from 24 February, burnt from the 27th; nothing on 7.30", () => {
  withConfig(season7, () => {
    const types = (iso, build = v740) => typesOf(inBuild(build, () => s8HeatStates(at(iso))));
    assert.deepEqual(types("2019-02-23T23:59:00Z"), []);
    assert.deepEqual(types("2019-02-25T12:00:00Z"), [s8Heat]);
    assert.deepEqual(types("2019-02-27T12:00:00Z"), [s8Burnt]);
    assert.deepEqual(types("2019-02-25T12:00:00Z", v730), []);
  });
});

test("7.30's own events stay 7.30's: no Showtime, snow melt or Showtime Challenges' dates on 7.40", () => {
  withConfig(season7, () => {
    assert.deepEqual(inBuild(v740, () => festivusStates(at("2019-02-02T19:05:00Z"))), []);
    assert.deepEqual(inBuild(v740, () => iceStormMeltStates(at("2019-01-30T12:00:00Z"))), []);
    assert.deepEqual(inBuild(v740, () => showtimeStates(at("2019-01-31T12:00:00Z"))), []);
  });
});

test("7.40's event flags: 7.30's own and Frostnite; its paks' only new flag is the Overtime Challenges'", () => {
  const flags = activeEventFlags(v740);
  for (const flag of [lobbySeason7, "EventFlag.ActiveStorms", "EventFlag.PassiveMiniBosses", frostnite]) assert.ok(flags.includes(flag), flag);
  for (const flag of [ltm14DaysOfFortnite, ltmWinterDeimos, lteFestivus, lteS7Overtime]) assert.equal(flags.includes(flag), false, flag);
  assert.deepEqual(season4Flag(frostnite).builds, [4667333, 5046157]);
  assert.deepEqual(season4Flag(lteFestivus).builds, [4834550, 5046157]);
  assert.equal(season4Flag("EventFlag.SupplyDropGift").builds[1], 5046157);
});

test("7.40's modes: Love Shot, Sword Fight, Catch! and Driftin' on by default, on their dates; 7.30's own stay 7.30's", () => {
  const defaults = createSettingsStore(null).get();
  for (const id of ["loveShotDuos", "swordFightSquads", "catchSolo", "catchDuos", "catchSquads", "driftin", "fiftyFiftySeason7", "playgroundV2", "creative", "teamRumble"]) {
    assert.equal(ltmOn(id, v740, defaults), true, id);
  }
  for (const id of ["loveShotSolo", "loveShotSquads", "swordFightSolo", "swordFightDuos", "driftin40", "driftin20s"]) assert.equal(ltmOn(id, v740, defaults), false, `${id}: its switch`);
  for (const id of ["partyAtPleasantPark", "nflRumble", "wildWestDuos730"]) assert.equal(hasLtm(id, v740), false, `${id} is 7.30's`);
  for (const id of ["loveShotDuos", "driftin"]) assert.equal(hasLtm(id, v730), false, `${id} is 7.40's`);
  for (const id of ["unvaultedSolo", "siphonDuos", "closeEncountersSeason7Solo", "scavengerSolo", "showdownSolo"]) assert.equal(hasLtm(id, v740), true, id);
  assert.equal(ltmOfPlaylist(326, v740).id, "driftin");
  assert.equal(ltmOfPlaylist(346, v740).id, "loveShotDuos");
  assert.deepEqual(playlistTeamsOf(`${v740}:0:NAE:playlist_hover_64`, v740), { maxTeamCount: 2, maxTeamSize: 32, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v740}:0:NAE:playlist_love_duos`, v740), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
  assert.deepEqual(playlistTeamsOf(`${v740}:0:NAE:playlist_omaha`, v740), { maxTeamCount: 2, maxTeamSize: 20, maxSquadSize: 4 }, "7.30's teams hold");
  withConfig(season7, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("loveShotDuos", v740, at("2019-02-13T23:59:00Z"), dated), false);
    assert.equal(inOriginalWindow("loveShotDuos", v740, at("2019-02-14T12:00:00Z"), dated), true, "Valentine's Day");
    assert.equal(inOriginalWindow("swordFightSquads", v740, at("2019-02-15T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("catchDuos", v740, at("2019-02-19T12:00:00Z"), dated), true, "Content Update v7.40's");
    assert.equal(inOriginalWindow("catchDuos", v740, at("2019-02-21T00:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("driftin", v740, at("2019-02-25T12:00:00Z"), dated), true, "to the season's end");
  });
  const lobby = ltmFrontEndPlaylists(v740, defaults);
  for (const name of ["Playlist_Love_Duos", "Playlist_Hover_64", "Playlist_PlaygroundV2"]) assert.equal(lobby.find((own) => own.name === name)?.enabled, true, name);
  assert.equal(lobby.some((own) => own.name === "Playlist_Music_Highest"), false, "Party at Pleasant Park is 7.30's");
});

test("7.40's Block: Oily Oaks from the replay's first day, Colossal Compound from 19 February; 7.30's two on 7.30 only", () => {
  withConfig(season7, () => {
    const types = (iso, build = v740) => typesOf(inBuild(build, () => blockStates(at(iso))));
    assert.deepEqual(types("2018-12-10T12:00:00Z"), ["slab1"]);
    assert.deepEqual(types("2019-02-18T23:59:00Z"), ["slab1"]);
    assert.deepEqual(types("2019-02-19T00:00:00Z"), ["slab2"], "Content Update v7.40's Colossal Compound");
    assert.deepEqual(types("2019-02-05T00:00:00Z", v730), ["slab2"], "7.30's Streat Festival as it was");
  });
});

test("7.40's shop: Skully and Heartbreaker from Update v7.40's shop, Lil Whip with Sno Cone; 7.30 sells none of them", (t) => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 7: "2018-12-06" } };
  configureItemShop(() => shopConfig);
  t.after(() => configureItemShop(null));
  const offers = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig));
  const all = (shop) => [...shop.BRWeeklyStorefront, ...shop.BRDailyStorefront];
  const skully = all(offers(v740, "2019-02-14T12:00:00Z")).find(({ templateId }) => templateId === "AthenaCharacter:cid_341_athena_commando_f_skullbrite");
  assert.ok(skully, "Skully on 14 February");
  assert.equal(skully.price, 1200);
  assert.deepEqual(skully.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_341_athena_commando_f_skullbrite", "AthenaBackpack:bid_211_skullbrite"]);
  const lilWhip = all(offers(v740, "2019-02-17T12:00:00Z")).find(({ templateId }) => templateId === "AthenaCharacter:cid_344_athena_commando_m_icecream");
  assert.deepEqual(lilWhip.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_344_athena_commando_m_icecream", "AthenaBackpack:bid_213_icecream"]);
  const c730 = inBuild(v730, athenaCosmetics);
  assert.ok(all(offers(v730, "2019-02-14T12:00:00Z")).every(({ templateId }) => c730[templateId]));
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season7.json", import.meta.url), "utf8")).days;
  const c740 = inBuild(v740, athenaCosmetics);
  assert.equal(history.flatMap((day) => [...day.featured, ...day.daily]).filter(([id]) => !c730[id] && c740[id]).length, 26, "26 sales of 7.40's own");
});

test("Skully's owners get its style challenges on 7.40, The Ice Queen's theirs", () => {
  withConfig(season7, () => withSession(v740, "styles740", (session) => {
    setUpAthena(session);
    grantCosmetic(session, "AthenaCharacter:cid_341_athena_commando_f_skullbrite");
    grantCosmetic(session, "AthenaCharacter:cid_330_athena_commando_f_icequeen");
    athenaQuestLogin(session);
    const ids = Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);
    assert.ok(ids.includes("ChallengeBundleSchedule:bundleschedule_styles_skullbrite"));
    assert.ok(ids.includes("ChallengeBundleSchedule:bundleschedule_styles_icequeen"));
    assert.ok(ids.includes("Quest:quest_br_styles_skullbrite_play_matches_01"));
    assert.equal(ids.includes("ChallengeBundleSchedule:bundleschedule_styles_cupiddark"), false, "no Fallen Love Ranger");
  }));
});
