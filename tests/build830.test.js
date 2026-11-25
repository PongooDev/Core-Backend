import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventCard } from "../src/admin/eventschedules.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { blockStates } from "../src/events/block.js";
import { buccaneersBountyCalendarEvent, buccaneersBountyDay, buccaneersBountyFlagsNow, buccaneersBountyStates } from "../src/events/buccaneersbounty.js";
import { activeEventFlags, blockSlab, configureEvents, lteBootyBay, ltmHighStakes } from "../src/events/events.js";
import { highStakes2019States } from "../src/events/highstakes2019.js";
import { hasLtm, ltmFrontEndPlaylists, ltmOn } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { siphonOn, siphonRows } from "../src/events/siphon.js";
import { spring2019Flag, spring2019Phase1, spring2019Phase2 } from "../src/events/spring2019.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { isForeignTemplate } from "../src/gamedata/templates.js";
import { athenaQuestLogin, grantCosmetic, setUpAthena } from "../src/profiles/athena.js";
import { isStylesCategory, styleSchedules } from "../src/profiles/challenges.js";
import { plotsOf, settleCreativePlots } from "../src/profiles/creative.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";

// Fortnite 8.30 (Update v8.30, 10 April 2019; Season 8): CL-5793395, on its own data (gamedata/5793395). 8.20's events
// and modes on the same days, and its own: the Buccaneer's Bounty Challenges, the Block's Llama Sphinx and Cordial
// Courtyard, the Inferno Challenges, and the siphon revert its paks ship.
const v830 = "5793395";
const v820 = "5625478";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-830-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const templatesOf = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);

test("8.30 is known, on its own data", () => {
  assert.equal(versionOf(v830), "8.30");
  assert.equal(allowedBuildList(["8.30"]).join(), v830);
  assert.equal(dataBuild(v830), v830);
  assert.equal(dataBuild("5700000"), v820, "a build between 8.20 and 8.30 plays on 8.20's");
  assert.equal(dataBuild("5800000"), v830, "a build between 8.30 and 8.40 plays on 8.30's");
  assert.equal(releasedOn(v830), Date.UTC(2019, 3, 10));
  assert.equal(buildOfSeason(8), "6165369", "8.51 is Season 8's newest (tests/build851.test.js)");
  assert.equal(seasonName(8), "Season 8 (8.00 – 8.51)");
  const season = inBuild(v830, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [8, "BRSeason8", 100]);
});

test("8.30's cosmetics: 26 more than 8.20 (Inferno, Ruin, Birdie, Stealth Reflex, Boobytrapped...), one loading screen gone", () => {
  const [c830, c820] = [inBuild(v830, athenaCosmetics), inBuild(v820, athenaCosmetics)];
  assert.equal(Object.keys(c830).length, 1610);
  assert.equal(Object.keys(c830).filter((id) => !c820[id]).length, 26);
  assert.deepEqual(Object.keys(c820).filter((id) => !c830[id]), ["AthenaLoadingScreen:lsid_fiercecloudpuff"]);
  for (const [id, name] of [["AthenaCharacter:cid_370_athena_commando_m_evilsuit", "Inferno"],
    ["AthenaCharacter:cid_378_athena_commando_m_furnaceface", "Ruin"], ["AthenaCharacter:cid_387_athena_commando_f_golf", "Birdie"],
    ["AthenaCharacter:cid_386_athena_commando_m_streetopsstealth", "Stealth Reflex"], ["AthenaDance:eid_pirategold", "Boobytrapped"],
    ["AthenaGlider:glider_id_132_pirate01octopus", "Plunder"]])
    assert.equal(c830[id]?.name, name, id);
});

test("the Buccaneer's Bounty Challenges' data: Schedule_PirateParty, one challenge a day after the first", () => inBuild(v830, () => {
  const schedule = athenaChallengeSchedules().schedule_pirateparty;
  assert.deepEqual([schedule.eventName, schedule.cleanUpOnBundleCompletion], [lteBootyBay, true]);
  const bundle = athenaChallengeBundles().questbundle_pirateparty;
  assert.deepEqual(bundle.quests.map(({ quest, grantWithBundle, unlockValue }) => [quest, grantWithBundle, unlockValue ?? 0]), [
    ["quest_br_pp_visit_piratecamps", true, 0], ["quest_br_pp_buriedtreasure", false, 1],
    ["quest_br_pp_top10_squads_withfriend", false, 2], ["quest_br_pp_use_cannon", false, 3]]);
  assert.equal(bundle.completionSteps[0].rewards[0].templateId, "AthenaDance:eid_pirategold");
  assert.equal(inBuild(v820, athenaChallengeSchedules).schedule_pirateparty, undefined, "8.20 has no such schedule");
}));

test("the Buccaneer's Bounty Challenges' flag: 10 to 16 April 2019 on 8.30 only; its days; the switch and off", () => {
  withConfig(season8, () => {
    const types = (iso, build = v830) => typesOf(inBuild(build, () => buccaneersBountyStates(at(iso))));
    assert.deepEqual(types("2019-04-09T23:59:00Z"), []);
    assert.deepEqual(types("2019-04-10T00:00:00Z"), [lteBootyBay, buccaneersBountyCalendarEvent]);
    assert.deepEqual(types("2019-04-16T23:00:00Z"), [lteBootyBay, buccaneersBountyCalendarEvent]);
    assert.deepEqual(types("2019-04-17T00:00:00Z"), []);
    assert.deepEqual(types("2019-04-12T12:00:00Z", v820), [], "8.20 has no Buccaneer's Bounty Challenges");
    assert.equal(inBuild(v830, () => buccaneersBountyDay(at("2019-04-12T12:00:00Z"))), 2);
    assert.equal(inBuild(v830, () => buccaneersBountyDay(at("2019-04-09T12:00:00Z"))), null);
    // 8.20's High Stakes runs on 8.30 too.
    assert.deepEqual(typesOf(inBuild(v830, () => highStakes2019States(at("2019-03-15T12:00:00Z")))), [ltmHighStakes, "CalendarEvent_Season8_HighStakes"]);
  });
  withConfig({ ...season8, season4Flags: { overrides: { [lteBootyBay]: "on" } } }, () => {
    assert.ok(inBuild(v830, () => activeEventFlags()).includes(lteBootyBay), "switched on, always served");
  });
  withConfig({ ...season8, datedFlags: { buccaneersBounty: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v830, () => buccaneersBountyFlagsNow(at("2019-04-12T12:00:00Z"))), []);
  });
  assert.deepEqual(season4Flag(lteBootyBay).builds, [5793395, 6165369]);
  assert.deepEqual(season4Flag(ltmHighStakes).builds, [5625478, 6165369]);
  assert.deepEqual(eventCard("buccaneersBounty").ranges, [[5793395, 6165369]]);
});

test("an 8.30 player gets the Buccaneer's Bounty Challenges while they run, a challenge more each day", () => {
  // The replay's day 43 is 11 April 2019: the event's second day, so the first two challenges.
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(42) } }, () => withSession(v830, "bounty830", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:schedule_pirateparty"), "the schedule");
    assert.ok(templates.includes("Quest:quest_br_pp_visit_piratecamps"), "the first challenge");
    assert.ok(templates.includes("Quest:quest_br_pp_buriedtreasure"), "the second day's");
    assert.equal(templates.includes("Quest:quest_br_pp_use_cannon"), false, "not the fourth day's yet");
  }));
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(20) } }, () => withSession(v830, "nobounty830", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(templatesOf(session).includes("ChallengeBundleSchedule:schedule_pirateparty"), false, "not before it");
  }));
});

test("8.30's Block: Llama Sphinx, then Cordial Courtyard from 17 April; 8.20 keeps its own", () => {
  withConfig(season8, () => {
    const types = (iso, build = v830) => typesOf(inBuild(build, () => blockStates(at(iso))));
    assert.deepEqual(types("2019-03-01T12:00:00Z"), [blockSlab(1)]);
    assert.deepEqual(types("2019-04-16T12:00:00Z"), [blockSlab(1)]);
    assert.deepEqual(types("2019-04-17T12:00:00Z"), [blockSlab(2)]);
    assert.deepEqual(types("2019-05-05T12:00:00Z"), [blockSlab(2)]);
    assert.deepEqual(types("2019-04-05T12:00:00Z", v820), [blockSlab(1)]);
  });
});

test("the Inferno Challenges: 8.30's data has them as an outfit's, given to an Inferno owner", () => {
  const schedules = inBuild(v830, athenaChallengeSchedules);
  assert.equal(schedules.bundleschedule_styles_redsuitguy.category, "ChallengeCategory.Style");
  assert.ok(isStylesCategory(schedules.bundleschedule_styles_redsuitguy.category));
  assert.equal(styleSchedules.bundleschedule_styles_redsuitguy, "AthenaCharacter:cid_370_athena_commando_m_evilsuit");
  // The earlier outfits' have the tag read since 8.00's and 8.20's overlays were extracted again.
  for (const id of ["bundleschedule_styles_skulltrooper", "bundleschedule_styles_cupiddark"]) assert.ok(schedules[id], id);
  assert.equal(inBuild(v820, athenaChallengeSchedules).bundleschedule_styles_skulltrooper.category, "ChallengeCategory.Style");
  withConfig(season8, () => withSession(v830, "inferno830", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(templatesOf(session).includes("ChallengeBundleSchedule:bundleschedule_styles_redsuitguy"), false, "not without the outfit");
    grantCosmetic(session, "AthenaCharacter:cid_370_athena_commando_m_evilsuit");
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:bundleschedule_styles_redsuitguy"));
    assert.ok(templates.includes("Quest:quest_br_redsuitguy_complete_daily_challenges_06"));
    assert.equal(templates.includes("ChallengeBundleSchedule:season8_shiny_schedule"), false, "a progressive schedule isn't an outfit's");
  }));
});

test("Season 8's LTMs and Save the World's Spring 2019 run on 8.30 as on 8.20; Buccaneer's Bounty's days", () => {
  const dated = { ltmOriginalDates: true };
  withConfig(season8, () => {
    for (const id of ["fiftyFiftySeason8", "playgroundV2", "creative"]) assert.equal(ltmOn(id, v830, {}, at("2019-04-11T12:00:00Z")), true, id);
    const days = [["flyExplosivesSeason8Squads", "2019-04-10"], ["oneShotSeason8Squads", "2019-04-11"], ["closeEncountersSeason8Squads", "2019-04-12"],
      ["solidGoldSeason8Squads", "2019-04-13"], ["getawaySeason8Squads", "2019-04-14"], ["classicSeason8Squads", "2019-04-15"],
      ["teamRumbleSeason8", "2019-04-12"], ["floorIsLavaSquads", "2019-03-28"]];
    for (const [id, day] of days) assert.equal(ltmOn(id, v830, dated, at(`${day}T12:00:00Z`)), true, `${id} ${day}`);
    for (const id of ["floorIsLavaSquads", "getawaySeason8Squads", "slideSeason8Duos", "teamRumbleSeason8"]) assert.ok(hasLtm(id, v830), id);
    const frontEnd = ltmFrontEndPlaylists(v830, {}).map(({ name }) => name);
    for (const name of ["Playlist_50v50", "Playlist_Playground", "Playlist_PlaygroundV2", "Playlist_Fill_Squads"]) assert.ok(frontEnd.includes(name), name);
  });
  assert.ok(activeEventFlags(v830).includes("EventFlag.LobbySeason8"));
  // Day 43 of the replay (11 April): Love Storm and Yarrr! both.
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(42) } }, () => {
    const spring = inBuild(v830, () => activeEventFlags(v830)).filter((flag) => flag.startsWith("EventFlag.Spring2019"));
    assert.deepEqual(spring, [spring2019Flag, spring2019Phase1, spring2019Phase2]);
  });
});

test("8.30 ships the siphon revert itself: no hotfix rows, not one of the switch's builds", () => {
  assert.equal(siphonOn(v830, { siphon: "on" }), null);
  assert.deepEqual(siphonRows(v830, { siphon: "on" }), []);
  assert.equal(siphonOn(v820, {}), false, "8.20 unchanged");
});

test("Season 8's shop history serves 8.30 its own items, and 8.20 only its own", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 8: "2019-02-28" } };
  configureItemShop(() => shopConfig);
  try {
    const birdie = "AthenaCharacter:cid_387_athena_commando_f_golf";
    const ids = (build) => inBuild(build, () => {
      const offers = itemShopOffers(at("2019-04-14T12:00:00Z"), shopConfig);
      return [...offers.BRWeeklyStorefront, ...offers.BRDailyStorefront].map(({ templateId }) => templateId);
    });
    assert.ok(ids(v830).includes(birdie));
    assert.equal(ids(v820).includes(birdie), false);
    const c830 = inBuild(v830, athenaCosmetics);
    assert.ok(ids(v830).every((id) => c830[id]));
  } finally {
    configureItemShop(null);
  }
});

// PongooDev/CoreV2#645: Season 8's islands, each from the build Epic released it on (Update v8.10's Sandbar and Volcano,
// Content Update v8.11's Black Glass: 8.20 is the first supported build with them; Update v8.30's Tropical and Rivers Edge);
// 8.00 gets none of them, and no build gets the unreleased Razor_Medium.
test("Season 8's Creative islands: 8.20 a Sandbar, Volcano and Black Glass island, 8.30 also a Tropical and Rivers Edge one", () => {
  const v800 = "5203069";
  const seasons = { mode: "auto", seasonStarts: { 7: "2018-12-06", 8: "2019-02-28" } };
  const plots = (build, name) => withConfig(seasons, () => withSession(build, name, (session) => {
    settleCreativePlots(session, at("2019-04-20T12:00:00Z"));
    return plotsOf(session.profile("creative").profile).map(([, item]) => item.templateId.replace("CreativePlot:", ""));
  }));
  const season7 = ["temperate_medium", "arctic_medium", "theblock_season7", "arctic_competitive_medium1"];
  const count = (list, id) => list.filter((plot) => plot === id).length;
  const p800 = plots(v800, "plots800-645");
  const p820 = plots(v820, "plots820-645");
  const p830 = plots(v830, "plots830-645");
  assert.deepEqual([...new Set(p800)].sort(), [...season7].sort());
  assert.deepEqual([...new Set(p820)].sort(), [...season7, "sandbar_large", "volcano_large", "blackglass_medium"].sort());
  assert.deepEqual([...new Set(p830)].sort(), [...season7, "sandbar_large", "volcano_large", "blackglass_medium", "tropical_medium", "military_medium"].sort());
  for (const id of ["sandbar_large", "volcano_large", "blackglass_medium", "tropical_medium", "military_medium"]) assert.equal(count(p830, id), 1, id);
  assert.equal(count(p830, "temperate_medium"), 4);
  assert.equal(p830.some((plot) => plot.startsWith("razor")), false);
  assert.equal(inBuild(v820, () => isForeignTemplate("CreativePlot:tropical_medium")), true);
  assert.equal(inBuild(v830, () => isForeignTemplate("CreativePlot:military_medium")), false);
  assert.equal(inBuild(v800, () => isForeignTemplate("CreativePlot:sandbar_large")), true);
  assert.equal(inBuild(v820, () => isForeignTemplate("CreativePlot:blackglass_medium")), false);
});
