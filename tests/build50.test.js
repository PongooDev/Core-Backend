import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { contentUpdateStates } from "../src/events/contentupdates.js";
import { activeEventFlags, blockbuster2018Phase4, configureEvents, groupMission, lobbySeason4, lobbySeason5, passiveStorms } from "../src/events/events.js";
import { finalFightRows } from "../src/events/finalfight.js";
import { hasLtm, inOriginalWindow, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides } from "../src/events/ltms.js";
import { meteorStrikeRows } from "../src/events/meteorstrike.js";
import { rocketLaunchStates } from "../src/events/rocketlaunch.js";
import { athenaChallengeBundles, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { advanceAthenaObjectives, athenaQuestLogin, seasonRewardFunctions } from "../src/profiles/athena.js";
import { brokenChallengeOf } from "../src/profiles/challenges.js";
import { mtxProfileId, usesCommonProfiles } from "../src/profiles/common.js";
import { buildOfSeason, buyBattlePass } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 5.0, Season 5: CL-4204761 (++Fortnite+Release-5.0, "5.0.0", Update v5.00, 12 July 2018) and CL-4214610 ("5.0",
// the user's build), both on CL-4214610's data (gamedata/4214610).
const v500 = "4204761";
const v50 = "4214610";
const v50s = [v500, v50];
const v45 = "4166199";
const now = new Date("2026-11-09T12:00:00Z");

test("5.0's two builds are known by their versions, play on CL-4214610's data and are Season 5", () => {
  assert.deepEqual(v50s.map(versionOf), ["5.0.0", "5.0"]);
  for (const build of v50s) {
    assert.equal(dataBuild(build), v50, `${build} plays on CL-4214610's data, not 4.5's`);
    assert.ok(buildChoices().includes(build));
  }
  assert.equal(dataBuild("4190000"), v45, "a build between them Core doesn't know still plays on 4.5's");
  assert.equal(dataBuild("4220000"), v50);
  assert.equal(allowedBuildList(["5.0.0", "5.0"]).join(), v50s.join());
  assert.equal(buildOfSeason(5), v50);
  assert.equal(buildOfSeason(4), v45, "Season 4's newest data is still 4.5's");
  assert.equal(seasonName(5), "Season 5 (5.0)");
  const season = inBuild(v500, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.numSeasonLevels, season.numBookLevels, season.storefront, season.battlePassLevelOfferId],
    [5, 100, 100, "BRSeason5", "4B2E310BC1AE40B292A16D5AAD747E0A"]);
  assert.deepEqual(season.challengeSchedulesAlwaysShown, ["season5_free_schedule", "season5_paid_schedule"]);
  assert.deepEqual(season.grantsToEveryone, [{ templateId: "ChallengeBundleSchedule:season5_free_schedule", quantity: 1 }]);
  assert.deepEqual(season.firstWinRewards, [{ templateId: "AthenaGlider:umbrella_season_05", quantity: 1 }]);
});

test("5.0's data: Season 5's cosmetics and toys, and its weeks' free and Battle Pass halves with reward steps", () => {
  const c50 = inBuild(v50, athenaCosmetics);
  const c45 = inBuild(v45, athenaCosmetics);
  assert.equal(Object.keys(c50).filter((id) => !c45[id]).length, 104);
  assert.ok(Object.keys(c45).every((id) => c50[id]), "5.0 drops none of 4.5's");
  assert.deepEqual(["AthenaCharacter:cid_161_athena_commando_m_drift", "AthenaCharacter:cid_163_athena_commando_f_viking",
    "AthenaCharacter:cid_165_athena_commando_m_darkviking", "AthenaDance:toy_001_basketball"].map((id) => c50[id].name), ["Drift", "Huntress", "Ragnarok", "Basketball"]);
  assert.ok(!c50["AthenaDance:toy_000_testtoy"], "the test toy is left out");
  const week1 = inBuild(v50, athenaChallengeBundles).questbundle_s5_week_001;
  assert.deepEqual(week1.quests.map(({ requiresBattlePass }) => Boolean(requiresBattlePass)), [false, false, false, true, true, true, true]);
  assert.deepEqual(week1.completionSteps.map(({ count }) => count), [1, 2, 3, 4, 5, 6, -1]);
  assert.deepEqual(week1.completionSteps[3].rewards[0], { templateId: "AccountResource:athenaseasonalxp", quantity: 5000 });
  assert.deepEqual(week1.completionSteps[6].rewards.map(({ templateId }) => templateId),
    ["Token:athenabattlepass_weeklybundle_token", "Token:athenabattlepass_weeklychallenge_token"]);
  assert.deepEqual(inBuild(v50, athenaChallengeBundles).questbundle_s5_cumulative.completionSteps, [], "the Mystery Item is only shown");
});

test("5.0's shop: Season 5's history from 12 July, with 5.0's cosmetics on their days", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season5.json", import.meta.url), "utf8")).days;
  assert.deepEqual([history.length, history[0].date, history.at(-1).date], [77, "2018-07-12", "2018-09-26"]);
  const c45 = inBuild(v45, athenaCosmetics);
  const c50 = inBuild(v50, athenaCosmetics);
  const sold = new Set(history.flatMap((day) => [...day.featured, ...day.daily].map(([id]) => id)));
  assert.ok([...sold].every((id) => c50[id]), "only 5.0's cosmetics");
  assert.equal([...sold].filter((id) => !c45[id]).length, 14);
  // 9 November is the season's day 2, 13 July 2018: Moniker and Fortune in a tile of their own.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 5: "2026-11-08" } };
  for (const build of v50s) {
    const offers = inBuild(build, () => itemShopOffers(now, config));
    assert.deepEqual(offers.BRWeeklyStorefront.slice(0, 2).map(({ templateId }) => templateId),
      ["AthenaCharacter:cid_172_athena_commando_f_sharpdresser", "AthenaCharacter:cid_171_athena_commando_m_sharpdresser"], build);
  }
});

test("5.0's Battle Pass: BRSeason5's pass, bundle and tier offer at Epic's prices", () => {
  const offers = inBuild(v50, () => battlePassOffers());
  assert.deepEqual(offers.map(({ offerId, price, storefront }) => [offerId, price, storefront]), [["core_br_season5_battlepass", 950, "BRSeason5"],
    ["core_br_season5_battlebundle", 2800, "BRSeason5"], ["4B2E310BC1AE40B292A16D5AAD747E0A", 150, "BRSeason5"]]);
  assert.match(offers[0].description, /^Season 5: Jul 12 - Sep 26/);
  assert.equal(offers[0].displayAssetPath, "/Game/Catalog/DisplayAssets/DA_BR_Season5_BattlePass.DA_BR_Season5_BattlePass");
});

test("5.0's event flags: the Season 5 lobby, group missions and ticketless storms; no Blockbuster, Road Trip or rocket", () => {
  for (const build of v50s) {
    assert.deepEqual(activeEventFlags(build), [groupMission, passiveStorms, lobbySeason5], build);
    assert.deepEqual(rocketLaunchStates(now, build, { mode: "auto", rocketLaunch: { at: now.toISOString(), countdownHours: 48 } }), [], "no rocket or rift");
  }
  assert.ok(activeEventFlags(v45).includes(lobbySeason4) && activeEventFlags(v45).includes(blockbuster2018Phase4));
  assert.ok(!activeEventFlags(v45).includes(lobbySeason5));
});

test("5.0's modes: no new mode; Playground and Season 5's 50v50 by their switches; Final Fight and 50v50 v3 gone", () => {
  const none = { matchmakingModes: {} };
  for (const build of v50s) {
    assert.equal(ltmNewMode(build, none), null, build);
    assert.equal(ltmOn("playground", build, none), false);
    assert.equal(ltmOn("playground", build, { matchmakingModes: { playground: true } }), true);
    assert.equal(ltmOfPlaylist(50, build).id, "fiftyFiftySeason5");
    assert.deepEqual(playlistTeamsOf(`${build}:0:NA:50`, build), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
    assert.deepEqual(ltmPlaylistOverrides(build, { matchmakingModes: { fiftyFiftySeason5: true, playground: true, finalFightTeams12: true } }),
      ["Playlist_Playground", "Playlist_50v50"]);
    for (const id of ["finalFightTeams12", "finalFight", "fiftyFiftyV3", "sniperShootoutV3"]) assert.equal(hasLtm(id, build), false, `${id} ${build}`);
  }
  assert.equal(hasLtm("fiftyFiftySeason5", v45), false);
  assert.equal(ltmOfPlaylist(50, v45).id, "fiftyFiftyV3");
  configureEvents({ mode: "auto", seasonStarts: { 5: "2018-07-12" } });
  try {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    assert.equal(inOriginalWindow("playground", v50, new Date("2018-07-14T12:00:00Z"), dated), false, "Playground came back with 5.10");
    assert.equal(inOriginalWindow("fiftyFiftySeason5", v50, new Date("2018-07-14T12:00:00Z"), dated), false);
  } finally {
    configureEvents(null);
  }
});

test("5.0 keeps 4.x's gates; no content update, curve RowUpdate or Final Fight rows", () => {
  for (const build of v50s) {
    assert.equal(inBuild(build, () => usesCommonProfiles()), true);
    assert.equal(inBuild(build, () => mtxProfileId()), "common_core");
    assert.deepEqual(inBuild(build, () => contentUpdateStates(now)), []);
    assert.deepEqual(meteorStrikeRows(build), []);
    assert.deepEqual(finalFightRows(build), []);
  }
});

test("5.0's unfinished week 3 challenge is listed as broken, and nothing else of Season 5's", () => {
  for (const build of v50s) {
    assert.equal(brokenChallengeOf("quest_br_destroy_specifictargets", build)?.issue, "CoreV2 #299");
    for (const quest of ["quest_br_damage_smg", "quest_br_score_baskets", "quest_br_use_riftportals", "quest_br_eliminate_weapon_minigunlmg"]) {
      assert.equal(brokenChallengeOf(quest, build), undefined, `${quest} on ${build}`);
    }
  }
});

// A week's challenges: a token each, 5,000 season XP at four, the weekly bundle token at seven, which the Road Trip counts.
test("Season 5's weeks: three free challenges, the Battle Pass's four, reward steps and the Road Trip's first loading screen", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build50-"));
  try {
    const store = createProfileStore(dataDir);
    inBuild(v50, () => {
      const session = openSession(store, "roadtrip50");
      const athena = session.profile("athena");
      athenaQuestLogin(session);
      const { profile } = athena;
      const bundleOf = (id) => Object.values(profile.items).find((item) => item.templateId.toLowerCase() === `challengebundle:${id}`);
      const questIds = () => bundleOf("questbundle_s5_week_001").attributes.grantedquestinstanceids;
      const finish = (ids) => advanceAthenaObjectives(session, ids.flatMap((id) => Object.keys(profile.items[id].attributes)
        .filter((name) => name.startsWith("completion_")).map((name) => ({ statName: name.slice("completion_".length), count: 100000 }))));
      const held = (templateId) => Object.values(profile.items).filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase())
        .reduce((sum, item) => sum + (item.quantity ?? 1), 0);
      assert.equal(questIds().length, 3, "without the pass, week 1's first three");
      finish(questIds());
      assert.equal(held("Token:athenabattlepass_weeklychallenge_token"), 3);
      assert.equal(bundleOf("questbundle_s5_week_001").attributes.num_quests_completed, 3);
      const xpBefore = profile.stats.attributes.xp + profile.stats.attributes.level * 1000000;
      buyBattlePass(session, seasonRewardFunctions());
      assert.equal(questIds().length, 7, "the pass gives the other four");
      finish(questIds().slice(3));
      assert.equal(held("Token:athenabattlepass_weeklychallenge_token"), 7);
      assert.equal(held("Token:athenabattlepass_weeklybundle_token"), 1);
      assert.ok(profile.stats.attributes.xp + profile.stats.attributes.level * 1000000 > xpBefore, "the 5,000 season XP at four");
      // The Road Trip's first challenge counts one week done: its loading screen.
      const roadTrip = Object.values(profile.items).find((item) => item.templateId.toLowerCase() === "quest:quest_br_s5_cumulative_collecttokens_01");
      assert.notEqual(roadTrip.attributes.quest_state, "Active");
      assert.equal(held("AthenaLoadingScreen:lsid_027_s5cumulative1"), 1);
      session.commit();
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("5.0's calendar: Season 5, its lobby flag, and its shop's replay kept from the day 5.0 is first served", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build50-shop-"));
  const backend = await startBackend({ dataDir });
  const dayMs = 86400000;
  try {
    const { token } = await userLogin(backend.port, "Season5Shop");
    const timeline = async (changelist) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-5.0-CL-${changelist}`, Authorization: `bearer ${token}` } })).body;
    const body = await timeline(v50);
    const { state } = body.channels["client-events"].states[0];
    const today = Math.floor(Date.parse(body.currentTime) / dayMs) * dayMs;
    assert.equal(state.seasonNumber, 5);
    assert.equal(state.seasonTemplateId, "AthenaSeason:athenaseason5");
    assert.ok(state.activeEventFlags.includes(lobbySeason5));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")).events.seasonStarts[5], new Date(today).toISOString().slice(0, 10));
    assert.equal(state.weeklyStoreEnd, new Date(today + dayMs).toISOString());
    assert.equal(state.seasonEnd, new Date(today + 77 * dayMs).toISOString());
    assert.equal((await timeline(v500)).channels["client-events"].states[0].state.seasonNumber, 5);
  } finally {
    await backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
