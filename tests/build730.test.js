import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { blockStates } from "../src/events/block.js";
import { activeEventFlags, configureEvents, festivusCountdown, festivusLevel, festivusShow, frostnite, iceKingStormPast, iceStormSnowMelt, lobbySeason7,
  lteFestivus, ltm14DaysOfFortnite, ltmWinterDeimos } from "../src/events/events.js";
import { festivusStates, showtimeCalendarEvent, showtimeDay, showtimeFlagsNow, showtimeStates } from "../src/events/festivus.js";
import { eventDaysOf } from "../src/events/fourteendays.js";
import { iceKingStates, iceStormDay, iceStormMeltStates, iceStormStates } from "../src/events/icestorm.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, defaultReplacements } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { isForeignTemplate } from "../src/gamedata/templates.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { athenaQuestLogin, lockerCosmetics, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { createSettingsStore } from "../src/settings/store.js";
import { currencyOffers } from "../src/store/currency.js";
import { hasGifting } from "../src/store/gifting.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";

// Fortnite 7.30 (Update v7.30, 29 January 2019; Season 7): CL-4834550, on its own data (gamedata/4834550). Battle Royale:
// Showtime (the stage at Pleasant Park, Marshmello's concert in Party at Pleasant Park, the Showtime Challenges), the Ice
// Storm's snow melting, NFL Rumble and Wild West Duos, the Block's CoLLAMAsseum and Streat Festival, the Prisoner,
// Marshmello and the others in the shop.
const v730 = "4834550";
const v720 = "4727874";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-730-"));
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

test("7.30 is known, on its own data, Season 7's", () => {
  assert.equal(versionOf(v730), "7.30");
  assert.equal(allowedBuildList(["7.30"]).join(), v730);
  assert.equal(dataBuild(v730), v730);
  assert.equal(dataBuild("4800000"), v720, "a build between 7.20 and 7.30 plays on 7.20's");
  assert.equal(dataBuild("4900000"), v730, "a later build Core doesn't know, before 7.40, plays on 7.30's");
  assert.equal(releasedOn(v730), Date.UTC(2019, 0, 29));
  assert.equal(buildOfSeason(7), "5046157", "7.40 is Season 7's newest (tests/build740.test.js)");
  assert.equal(seasonName(7), "Season 7 (7.00 – 7.40)");
  const season = inBuild(v730, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront], [7, "BRSeason7"]);
  // What 7.20 has for Season 7 holds on 7.30: the Cobalt Pack (Core-Backend #385) and gifting.
  assert.ok(inBuild(v730, () => currencyOffers("cobalt730", { stats: { attributes: {} } })).some(({ offerId }) => offerId === "core_starter_br_s7"));
  assert.equal(hasGifting(v730), true);
});

test("7.30's cosmetics: Marshmello, the Prisoner, Firewalker, the Scrapyard pair; Jumpshot and Triple Threat under their new ids", () => {
  const [c730, c720] = [inBuild(v730, athenaCosmetics), inBuild(v720, athenaCosmetics)];
  assert.equal(Object.keys(c730).filter((id) => !c720[id]).length, 30);
  assert.deepEqual(Object.keys(c720).filter((id) => !c730[id]).sort(),
    ["AthenaCharacter:cid_136_athena_commando_m_basketball", "AthenaCharacter:cid_137_athena_commando_f_basketball"]);
  for (const [id, name] of [["AthenaCharacter:cid_333_athena_commando_m_squishy", "Marshmello"], ["AthenaCharacter:cid_332_athena_commando_m_prisoner", "The Prisoner"],
    ["AthenaCharacter:cid_136_athena_commando_m_streetbasketball", "Jumpshot"], ["AthenaPickaxe:pickaxe_id_154_squishy", "Marshy Smasher"]]) {
    assert.equal(c730[id]?.name, name, id);
  }
  // The Fourth Down set's Super Bowl LIII styles, unlocked for its owners as the update says.
  const jersey = c730["AthenaCharacter:cid_207_athena_commando_m_footballdudea"].variants.find(({ channel }) => channel === "JerseyColor");
  assert.ok(jersey.unlocked.includes("Color.033") && jersey.unlocked.includes("Color.034"));
  // The Prisoner: the season's weekly challenges' cumulative reward, its stages by quests.
  assert.deepEqual(inBuild(v730, () => getAthenaQuest("quest_br_s7_cumulative_complete_weeklychallenges_01")).hiddenRewards,
    [{ quantity: 1, templateId: "Quest:quest_br_season7_a" }]);
});

test("7.30 redirects Jumpshot's and Triple Threat's old ids: an account's outfit isn't hidden, the full locker gives no second one", () => {
  const [jumpshot, newJumpshot] = ["AthenaCharacter:cid_136_athena_commando_m_basketball", "AthenaCharacter:cid_136_athena_commando_m_streetbasketball"];
  assert.equal(inBuild(v730, () => isForeignTemplate(jumpshot)), false, "7.30's DefaultGame.ini redirects it");
  assert.equal(inBuild(v720, () => isForeignTemplate(jumpshot)), false);
  assert.equal(inBuild(v720, () => isForeignTemplate(newJumpshot)), true, "7.20 has no such id");
  assert.equal(inBuild(v730, lockerCosmetics).includes(newJumpshot), false);
  assert.equal(inBuild(v730, lockerCosmetics).includes("AthenaCharacter:cid_333_athena_commando_m_squishy"), true);
});

test("the Showtime Challenges' data: a poster with the schedule, the venue and Keep It Mello a day later, the banner for all", () => {
  const schedule = inBuild(v730, athenaChallengeSchedules).schedule_festivus;
  assert.deepEqual([schedule.eventName, schedule.category, schedule.cleanUpOnBundleCompletion], [lteFestivus, "Festivus", true]);
  const bundle = inBuild(v730, athenaChallengeBundles).questbundle_festivus;
  assert.deepEqual(bundle.quests.map(({ quest, grantWithBundle, unlockValue }) => [quest, grantWithBundle, unlockValue ?? 0]),
    [["quest_br_festivus_interact_poster", true, 0], ["quest_br_festivus_visit_stage", false, 1], ["quest_br_festivus_dance_three_locations", false, 1]]);
  assert.equal(inBuild(v720, athenaChallengeSchedules).schedule_festivus, undefined, "7.20 has none");
});

test("the Showtime Challenges' flag: 30 January to 2 February on Season 7's replay, on 7.30 only; the switch and off", () => {
  withConfig(season7, () => {
    const types = (iso, build = v730) => typesOf(inBuild(build, () => showtimeStates(at(iso))));
    assert.deepEqual(types("2019-01-29T23:59:00Z"), []);
    assert.deepEqual(types("2019-01-30T00:00:00Z"), [lteFestivus, showtimeCalendarEvent]);
    assert.deepEqual(types("2019-02-03T00:00:00Z"), []);
    assert.deepEqual(types("2019-01-31T12:00:00Z", v720), [], "7.20 has no Showtime");
    assert.equal(inBuild(v730, () => showtimeDay(at("2019-01-30T12:00:00Z"))), 0);
    assert.equal(inBuild(v730, () => showtimeDay(at("2019-01-31T12:00:00Z"))), 1);
    assert.equal(inBuild(v730, () => eventDaysOf(lteFestivus, at("2019-01-31T12:00:00Z"))), 1);
    // The Ice Storm Challenges' dates are 7.20's alone now: 7.30's paks keep them, by the switch only.
    assert.deepEqual(inBuild(v730, () => iceStormStates(at("2019-01-22T12:00:00Z"))), []);
    assert.deepEqual(typesOf(inBuild(v720, () => iceStormStates(at("2019-01-22T12:00:00Z")))).includes(ltmWinterDeimos), true, "7.20's as they were");
  });
  withConfig({ ...season7, season4Flags: { overrides: { [lteFestivus]: "on", [ltmWinterDeimos]: "on" } } }, () => {
    const flags = inBuild(v730, () => activeEventFlags());
    assert.ok(flags.includes(lteFestivus) && flags.includes(ltmWinterDeimos), "switched on, always served");
    assert.equal(inBuild(v730, () => showtimeDay(at("2019-01-01T12:00:00Z"))), Infinity);
    assert.equal(inBuild(v730, () => iceStormDay(at("2019-01-01T12:00:00Z"))), Infinity);
  });
  withConfig({ ...season7, datedFlags: { showtime: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v730, () => showtimeFlagsNow(at("2019-01-31T12:00:00Z"))), []);
  });
  assert.deepEqual(season4Flag(lteFestivus).builds, [4834550, 5046157], "7.40: by the switch only");
  assert.deepEqual(season4Flag(ltmWinterDeimos).builds, [4727874, 5046157]);
});

test("a 7.30 player gets the Showtime Challenges while they run, the venue's two from the second day", () => {
  withConfig({ mode: "auto", seasonStarts: { 7: replayDaysAgo(56) } }, () => withSession(v730, "showtime730", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(showtimeDay(), 1, "Season 7's replay is on 31 January");
    const { items } = session.profile("athena").profile;
    const bundle = Object.values(items).find((item) => item.templateId === "ChallengeBundle:questbundle_festivus");
    assert.ok(bundle, "the bundle");
    assert.equal(bundle.attributes.grantedquestinstanceids.length, 3);
    assert.ok(Object.values(items).some((item) => item.templateId === "Quest:quest_br_festivus_visit_stage"));
  }));
});

test("Showtime on 7.30: the stage from 29 January, the countdown, the show and the encore; nothing on 7.20, off leaves the park", () => {
  withConfig(season7, () => {
    const types = (iso, build = v730) => typesOf(inBuild(build, () => festivusStates(at(iso)))).sort();
    assert.deepEqual(types("2019-01-28T12:00:00Z"), []);
    assert.deepEqual(types("2019-01-30T12:00:00Z"), [festivusCountdown, festivusLevel].sort());
    const countdown = inBuild(v730, () => festivusStates(at("2019-02-02T18:00:00Z")))[0].events.find(({ eventType }) => eventType === festivusCountdown);
    assert.equal(countdown.activeUntil, "2019-02-02T19:00:00.000Z", "the countdown ends at the show, 11 AM PST");
    assert.deepEqual(types("2019-02-02T19:05:00Z"), [festivusShow, festivusLevel].sort());
    assert.deepEqual(types("2019-02-02T22:00:00Z"), [festivusCountdown, festivusLevel].sort(), "the countdown to the encore");
    assert.deepEqual(types("2019-02-03T07:05:00Z"), [festivusShow, festivusLevel].sort(), "the encore, 11 PM PST");
    assert.deepEqual(types("2019-02-03T08:00:00Z"), [], "the stage is gone");
    assert.deepEqual(types("2019-02-02T19:05:00Z", v720), []);
  });
  withConfig({ ...season7, datedFlags: { festivus: { mode: "off" } } }, () => {
    assert.deepEqual(typesOf(inBuild(v730, () => festivusStates(at("2019-02-02T19:05:00Z")))), []);
  });
});

test("7.30's snow: the Ice Storm's until Update v7.30's day, melting to 1 February; no Ice King on 7.30", () => {
  withConfig(season7, () => {
    const types = (iso, build = v730) => typesOf(inBuild(build, () => iceStormMeltStates(at(iso))));
    assert.deepEqual(types("2018-12-10T12:00:00Z"), [iceKingStormPast], "7.30 shipped under the storm's snow");
    assert.deepEqual(types("2019-01-30T12:00:00Z"), [iceStormSnowMelt]);
    const melt = inBuild(v730, () => iceStormMeltStates(at("2019-01-30T12:00:00Z")))[0].events[0];
    assert.deepEqual([melt.activeSince, melt.activeUntil], ["2019-01-29T00:00:00.000Z", "2019-02-01T00:00:00.000Z"]);
    assert.deepEqual(types("2019-02-01T00:00:00Z"), [], "Season 7's own snow");
    assert.deepEqual(types("2019-01-30T12:00:00Z", v720), [], "7.20's snow is the Ice King's");
    assert.deepEqual(inBuild(v730, () => iceKingStates(at("2019-01-19T19:05:00Z"))), []);
  });
});

test("7.30's event flags: 7.20's own and Frostnite; its paks' only new flag is the Showtime Challenges'", () => {
  const flags = activeEventFlags(v730);
  for (const flag of [lobbySeason7, "EventFlag.ActiveStorms", "EventFlag.PassiveMiniBosses", frostnite]) assert.ok(flags.includes(flag), flag);
  for (const flag of [ltm14DaysOfFortnite, ltmWinterDeimos, lteFestivus]) assert.equal(flags.includes(flag), false, flag);
  assert.deepEqual(season4Flag(frostnite).builds, [4667333, 5046157]);
  assert.equal(season4Flag("EventFlag.SupplyDropGift").builds[1], 5046157);
});

test("7.30's modes: Party at Pleasant Park, NFL Rumble and Wild West Duos on by default, on their dates; 7.20's own stay 7.20's", () => {
  const defaults = createSettingsStore(null).get();
  for (const id of ["partyAtPleasantPark", "nflRumble", "wildWestDuos730", "fiftyFiftySeason7", "playgroundV2", "creative", "teamRumble"]) {
    assert.equal(ltmOn(id, v730, defaults), true, id);
  }
  for (const id of ["iceStormSolo", "oneShotSquads720", "sniperShootoutDuos720", "iceStormShowSolo"]) assert.equal(hasLtm(id, v730), false, `${id} is 7.20's`);
  for (const id of ["partyAtPleasantPark", "nflRumble", "wildWestDuos730"]) assert.equal(hasLtm(id, v720), false, `${id} is 7.30's`);
  for (const id of ["unvaultedSolo", "siphonDuos", "closeEncountersSeason7Solo", "scavengerSolo", "showdownSolo"]) assert.equal(hasLtm(id, v730), true, id);
  assert.equal(ltmOfPlaylist(285, v730).id, "nflRumble");
  assert.equal(ltmOfPlaylist(325, v730).id, "partyAtPleasantPark");
  assert.deepEqual(defaultReplacements(v730, defaults), {}, "Solo, Duos and Squads as they are");
  assert.deepEqual(playlistTeamsOf(`${v730}:0:NAE:playlist_omaha`, v730), { maxTeamCount: 2, maxTeamSize: 20, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v730}:0:NAE:playlist_music_highest`, v730), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
  withConfig(season7, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("partyAtPleasantPark", v730, at("2019-02-01T23:59:00Z"), dated), false);
    assert.equal(inOriginalWindow("partyAtPleasantPark", v730, at("2019-02-02T19:05:00Z"), dated), true, "the show");
    assert.equal(inOriginalWindow("partyAtPleasantPark", v730, at("2019-02-03T07:05:00Z"), dated), true, "the encore");
    assert.equal(inOriginalWindow("partyAtPleasantPark", v730, at("2019-02-03T08:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("nflRumble", v730, at("2019-02-03T12:00:00Z"), dated), true, "Super Bowl LIII's day");
    assert.equal(inOriginalWindow("nflRumble", v730, at("2019-02-05T00:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("wildWestDuos730", v730, at("2019-02-05T12:00:00Z"), dated), true, "Content Update v7.30's");
  });
  const lobby = ltmFrontEndPlaylists(v730, defaults);
  for (const name of ["Playlist_Omaha", "Playlist_Music_Highest", "Playlist_PlaygroundV2"]) assert.equal(lobby.find((own) => own.name === name)?.enabled, true, name);
  assert.equal(lobby.some((own) => own.name === "Playlist_Deimos_Solo_Winter"), false, "the Ice Storm's are 7.20's");
});

test("7.30's Block: CoLLAMAsseum from the replay's first day, Streat Festival from 5 February; 7.20's two on 7.20 only", () => {
  withConfig(season7, () => {
    const types = (iso, build = v730) => typesOf(inBuild(build, () => blockStates(at(iso))));
    assert.deepEqual(types("2018-12-10T12:00:00Z"), ["slab1"]);
    assert.deepEqual(types("2019-02-04T23:59:00Z"), ["slab1"]);
    assert.deepEqual(types("2019-02-05T00:00:00Z"), ["slab2"], "Content Update v7.30's Streat Festival");
    assert.deepEqual(types("2019-02-20T12:00:00Z"), ["slab2"], "on to the season's end");
    assert.deepEqual(types("2019-02-05T00:00:00Z", v720), ["slab2"], "7.20's Omega Pyramid as it was");
    assert.deepEqual(types("2019-01-15T00:00:00Z", v720), ["slab1"]);
  });
});

test("7.30's shop: Marshmello and the others on their days, Kitbash with Trash Lid; 7.20 sells none of them", (t) => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 7: "2018-12-06" } };
  configureItemShop(() => shopConfig);
  t.after(() => configureItemShop(null));
  const offers = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig));
  const all = (shop) => [...shop.BRWeeklyStorefront, ...shop.BRDailyStorefront];
  const marshmello = all(offers(v730, "2019-02-01T12:00:00Z")).find(({ templateId }) => templateId === "AthenaCharacter:cid_333_athena_commando_m_squishy");
  assert.ok(marshmello, "Marshmello on 1 February");
  assert.equal(marshmello.price, 1500);
  const kitbash = all(offers(v730, "2019-02-10T12:00:00Z")).find(({ templateId }) => templateId === "AthenaCharacter:cid_334_athena_commando_m_scrapyard");
  assert.deepEqual(kitbash.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_334_athena_commando_m_scrapyard", "AthenaBackpack:bid_205_scrapyardmale"]);
  const c720 = inBuild(v720, athenaCosmetics);
  assert.ok(all(offers(v720, "2019-02-01T12:00:00Z")).every(({ templateId }) => c720[templateId]));
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season7.json", import.meta.url), "utf8")).days;
  const c730 = inBuild(v730, athenaCosmetics);
  assert.equal(history.flatMap((day) => [...day.featured, ...day.daily]).filter(([id]) => !c720[id] && c730[id]).length, 28, "28 sales of 7.30's own");
});
