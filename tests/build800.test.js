import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { configureEvents } from "../src/events/events.js";
import { hasLtm, ltmFrontEndPlaylists, ltmOn, ltms } from "../src/events/ltms.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { hasGifting } from "../src/store/gifting.js";
import { configureItemShop, hasSeasonHistory, itemShopOffers, seasonEnd, seasonOfBuild, weeklyStoreEnd } from "../src/store/itemshop.js";

// Fortnite 8.00 (Update v8.00, 28 February 2019; Season 8's first build): CL-5203069, on its own data (gamedata/5203069).
// Battle Royale: Season 8's Battle Pass (BRSeason8, 100 tiers; Blackheart, Hybrid, Peely, Sidewinder, Ember and Luxe),
// its ten free weekly challenge bundles, the cumulative and paid (Blackheart's and Hybrid's) ones.
const v800 = "5203069";
const v740 = "5046157";
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
// Season 8's replay started `days` days before today (UTC), so that today is 28 February 2019 + days on it.
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);
const season8 = { mode: "auto", seasonStarts: { 8: replayDaysAgo(3) } };
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-800-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

test("8.00 is known, on its own data, Season 8's first build", () => {
  assert.equal(versionOf(v800), "8.00");
  assert.equal(allowedBuildList(["8.00"]).join(), v800);
  assert.equal(dataBuild(v800), v800);
  assert.equal(dataBuild("5150000"), v740, "a build between 7.40 and 8.00 plays on 7.40's");
  assert.equal(dataBuild("5300000"), v800, "a later build Core doesn't know plays on 8.00's");
  assert.equal(releasedOn(v800), Date.UTC(2019, 1, 28));
  assert.equal(buildOfSeason(8), v800);
  assert.equal(seasonName(8), "Season 8 (8.00)");
  const season = inBuild(v800, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels, season.numSeasonLevels], [8, "BRSeason8", 100, 100]);
  assert.equal(inBuild(v800, seasonOfBuild), 8);
  // Gifting is 6.31's and later, so 8.00 has it.
  assert.equal(hasGifting(v800), true);
  // Its Battle Pass offers: Season 8's own pass and bundle, 950 and 2,800 V-Bucks, and its data's tier offer.
  assert.deepEqual(inBuild(v800, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]),
    [["core_br_season8_battlepass", "BRSeason8", 950], ["core_br_season8_battlebundle", "BRSeason8", 2800],
      ["E07E41D52D4A425F8DC6592496B75301", "BRSeason8", 150]]);
});

test("8.00's cosmetics: Blackheart, Hybrid, Peely, Sidewinder, Ember and Luxe; 123 added, none removed since 7.40", () => {
  const [c800, c740] = [inBuild(v800, athenaCosmetics), inBuild(v740, athenaCosmetics)];
  assert.equal(Object.keys(c800).length, 1510);
  assert.equal(Object.keys(c800).filter((id) => !c740[id]).length, 123);
  assert.deepEqual(Object.keys(c740).filter((id) => !c800[id]), []);
  for (const [id, name] of [["AthenaCharacter:cid_347_athena_commando_m_pirateprogressive", "Blackheart"],
    ["AthenaCharacter:cid_346_athena_commando_m_dragonninja", "Hybrid"],
    ["AthenaCharacter:cid_349_athena_commando_m_banana", "Peely"],
    ["AthenaCharacter:cid_348_athena_commando_f_medusa", "Sidewinder"],
    ["AthenaCharacter:cid_351_athena_commando_f_fireelf", "Ember"],
    ["AthenaCharacter:cid_352_athena_commando_f_shiny", "Luxe"],
    ["AthenaDance:eid_banana", "Nana Nana"], ["AthenaDance:eid_conga", "Conga"]]) {
    assert.equal(c800[id]?.name, name, id);
  }
});

test("Season 8's Battle Pass and challenges: BRSeason8, ten free weeks from the 28th, tier 1's paid bundles", () => {
  const season = inBuild(v800, athenaSeason);
  assert.deepEqual(season.grantsToEveryone, [{ quantity: 1, templateId: "ChallengeBundleSchedule:season8_free_schedule" }]);
  assert.deepEqual(season.challengeSchedulesAlwaysShown,
    ["season8_free_schedule", "season8_cumulative_schedule", "season8_paid_schedule"]);
  for (const token of ["Token:athenanextseasontierboost", "Token:athenabattlepass_weeklychallenge_token",
    "Token:athenabattlepass_weeklybundle_token"]) assert.ok(season.removedAtSeasonEnd.includes(token), token);
  assert.deepEqual(season.seasonRewards.find(({ level }) => level === 2).rewards,
    [{ quantity: 2, templateId: "AccountResource:athenabattlestar" }]);
  const tier1 = season.bookPaidRewards.find(({ level }) => level === 1).rewards.map(({ templateId }) => templateId);
  for (const id of ["AthenaCharacter:cid_347_athena_commando_m_pirateprogressive", "AthenaCharacter:cid_346_athena_commando_m_dragonninja",
    "ChallengeBundleSchedule:season8_paid_schedule"]) assert.ok(tier1.includes(id), id);

  const free = inBuild(v800, athenaChallengeSchedules).season8_free_schedule;
  assert.equal(free.bundles.length, 10);
  assert.deepEqual(free.bundles.slice(0, 3).map(({ unlockType, unlockValue }) => [unlockType, unlockValue]),
    [["OnScheduleGranted", 0], ["DaysSinceEventStart", 9], ["DaysSinceEventStart", 16]]);
  const week = (n) => inBuild(v800, athenaChallengeBundles)[`questbundle_s8_week_00${n}`].quests.map(({ quest }) => quest);
  assert.equal(week(1).length, 7);
  assert.ok(week(1).includes("quest_br_visit_piratecamps"));
  assert.ok(week(2).includes("quest_br_damage_player_with_cannon"));
  assert.equal(inBuild(v740, athenaChallengeSchedules).season8_free_schedule, undefined, "7.40 has no Season 8");
});

test("an 8.00 player's first login gets Season 8's free schedule and its first week, not the later ones", () => {
  withConfig(season8, () => withSession(v800, "season800", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const ids = Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);
    assert.ok(ids.includes("ChallengeBundleSchedule:season8_free_schedule"), "the schedule");
    assert.ok(ids.includes("ChallengeBundle:questbundle_s8_week_001"), "week 1");
    assert.ok(ids.includes("Quest:quest_br_visit_piratecamps"), "week 1's first challenge");
    assert.equal(ids.includes("ChallengeBundle:questbundle_s8_week_002"), false, "week 2 waits for its ninth day");
    assert.equal(session.profile("athena").profile.stats.attributes.season_num, 8);
  }));
});

test("8.00's shop: Season 8 has no recorded history, so it serves its own cosmetics from the random shop", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 8: "2019-02-28" } };
  configureItemShop(() => shopConfig);
  try {
    assert.equal(hasSeasonHistory(8), false);
    assert.equal(hasSeasonHistory(7), true);
    const cosmetics = inBuild(v800, athenaCosmetics);
    const shop = inBuild(v800, () => itemShopOffers(at("2019-03-05T12:00:00Z"), shopConfig));
    const offers = [...shop.BRWeeklyStorefront, ...shop.BRDailyStorefront];
    assert.ok(offers.length > 0, "offers instead of Season 1's 2017 days");
    assert.ok(offers.every(({ templateId }) => cosmetics[templateId]), "only 8.00's cosmetics");
    // Its countdowns follow the replay: the weekly pair at the end of its 7 seeded days, the season at the end of its own
    // 70 (28 February to 8 May 2019), not stuck on a 2019 date.
    const now = at("2019-03-05T12:00:00Z");
    const weekEnd = inBuild(v800, () => weeklyStoreEnd(now, shopConfig));
    const end = inBuild(v800, () => seasonEnd(now, shopConfig));
    assert.ok(weekEnd > now && weekEnd - now <= 7 * 86400000, "the weekly storefront's end");
    assert.equal(end.toISOString().slice(0, 10), "2019-05-09");
  } finally {
    configureItemShop(null);
  }
});

test("Season 8's LTMs: 8.00's lobby, Close Encounters, Team Rumble and Buccaneer's Bounty's days", () => {
  const replay = { mode: "auto", seasonStarts: { 8: "2019-02-28" } };
  const dated = { ltmOriginalDates: true };
  withConfig(replay, () => {
    // 8.00's DefaultGame.ini: 50v50, Playground and Creative are on, and Close Encounters (Update v8.00's other mode) is
    // not a default.
    for (const id of ["fiftyFiftySeason8", "playgroundV2", "creative"]) assert.equal(ltmOn(id, v800, {}, at("2019-03-10T12:00:00Z")), true, id);
    assert.equal(ltmOn("closeEncountersSeason8Squads", v800, {}, at("2019-03-01T00:00:00Z")), false);
    // Playground and 50v50 stay on with Original dates too: their windows cover Season 8.
    for (const id of ["fiftyFiftySeason8", "playgroundV2"]) assert.equal(ltmOn(id, v800, dated, at("2019-03-10T12:00:00Z")), true, id);
    // Its launch window (8.00 to 8.10) and Buccaneer's Bounty's third day.
    assert.equal(ltmOn("closeEncountersSeason8Squads", v800, dated, at("2019-03-01T00:00:00Z")), true);
    assert.equal(ltmOn("closeEncountersSeason8Squads", v800, dated, at("2019-03-20T00:00:00Z")), false);
    const days = [["flyExplosivesSeason8Squads", "2019-04-10"], ["oneShotSeason8Squads", "2019-04-11"],
      ["closeEncountersSeason8Squads", "2019-04-12"], ["solidGoldSeason8Squads", "2019-04-13"],
      ["teamRumbleSeason8", "2019-04-10"], ["classicSeason8Squads", "2019-04-15"]];
    for (const [id, day] of days) assert.equal(ltmOn(id, v800, dated, at(`${day}T12:00:00Z`)), true, id);
    assert.equal(ltmOn("solidGoldSeason8Squads", v800, dated, at("2019-04-11T12:00:00Z")), false);
    assert.equal(ltmOn("classicSeason8Squads", v800, dated, at("2019-04-11T12:00:00Z")), false);
    // Nothing Season 8's later builds brought is served: no Getaway, lava or plane mode is one of 8.00's playlists.
    assert.equal(ltms.filter(({ seasons }) => seasons?.includes(8)).some(({ playlistName }) => /heist|lava|airroyale/i.test(playlistName ?? "")), false);
    // 8.00's entries are 8.00's alone, and 7.40's modes aren't 8.00's.
    for (const id of ["fiftyFiftySeason8", "closeEncountersSeason8Squads", "teamRumbleSeason8", "flyExplosivesSeason8Squads"])
      assert.deepEqual([hasLtm(id, v800), hasLtm(id, v740)], [true, false], id);
    assert.equal(hasLtm("fiftyFiftySeason7", v800), false);
    // The lobby hotfix keeps 8.00's shipped 50v50, Playground and Creative, and lists the Season 8 modes.
    const frontEnd = ltmFrontEndPlaylists(v800, {}).map(({ name }) => name);
    for (const name of ["Playlist_50v50", "Playlist_Playground", "Playlist_PlaygroundV2", "Playlist_Respawn_24"]) assert.ok(frontEnd.includes(name), name);
    assert.equal(frontEnd.includes("Playlist_Gungame_Solo"), false);
  });
});

test("7.40 is unchanged by 8.00: its own data, Season 7's pass, no Season 8 challenges", () => {
  assert.equal(dataBuild(v740), v740);
  assert.equal(buildOfSeason(7), v740);
  assert.equal(seasonName(7), "Season 7 (7.00 – 7.40)");
  const season = inBuild(v740, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront], [7, "BRSeason7"]);
  assert.deepEqual(season.challengeSchedulesAlwaysShown, ["season7_free_schedule", "season7_paid_schedule"]);
});
