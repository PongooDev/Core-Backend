import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventCard } from "../src/admin/eventschedules.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { airRoyaleStates } from "../src/events/airroyale.js";
import { blockEventOf, blockStates } from "../src/events/block.js";
import { endgameCalendarEvent, endgameDay, endgameFlagsNow, endgameStates } from "../src/events/endgame.js";
import { activeEventFlags, blockSlab, configureEvents, lteBootyBay, ltmAshton, ltmGoose, ltmHighStakes } from "../src/events/events.js";
import { hasLtm, ltmOn, ltmPlaylistTag } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { spring2019Flag, spring2019Phase1, spring2019Phase2 } from "../src/events/spring2019.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { dataBuild } from "../src/gamedata/read.js";
import { formTeams, playlistTeamsOf } from "../src/matchmaking/service.js";
import { athenaQuestLogin, recordMatchProgress, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { epicPlaylistImageOf } from "../src/services/content/playlistimages.js";
import { yarrrEventItems } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";

// Fortnite 8.50 (Update v8.50, 25 April 2019; Season 8): CL-6058028, on its own data (gamedata/6058028). 8.40's events and
// modes on the same days, and its own: Endgame and its challenges, the Block's 8.50 builds, the Black Widow and Star-Lord in
// the shop and Cottontail Eagle Eye and Miss Bunny Penny in Save the World's Event Store.
const v850 = "6058028";
const v840 = "6005771";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-850-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const templatesOf = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);
const questOf = (session, templateId) => Object.values(session.profile("athena").profile.items).find((item) => item.templateId === templateId);

test("8.50 is known, on its own data, Season 8's newest build", () => {
  assert.equal(versionOf(v850), "8.50");
  assert.equal(allowedBuildList(["8.50"]).join(), v850);
  assert.equal(dataBuild(v850), v850);
  assert.equal(dataBuild("6030000"), v840, "a build between 8.40 and 8.50 plays on 8.40's");
  assert.equal(dataBuild("6100000"), v850, "a later build Core doesn't know plays on 8.50's");
  assert.equal(releasedOn(v850), Date.UTC(2019, 3, 25));
  assert.equal(buildOfSeason(8), v850);
  assert.equal(seasonName(8), "Season 8 (8.00 – 8.50)");
  const season = inBuild(v850, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [8, "BRSeason8", 100]);
});

test("8.50's cosmetics: 39 more than 8.40 (the Black Widow, Star-Lord, the Avengers Quinjet...), EID_RunningManV3 gone", () => {
  const [c850, c840] = [inBuild(v850, athenaCosmetics), inBuild(v840, athenaCosmetics)];
  assert.equal(Object.keys(c850).length, 1678);
  assert.equal(Object.keys(c850).filter((id) => !c840[id]).length, 39);
  assert.deepEqual(Object.keys(c840).filter((id) => !c850[id]), ["AthenaDance:eid_runningmanv3"]);
  for (const [id, name] of [["AthenaCharacter:cid_399_athena_commando_f_ashtonboardwalk", "Black Widow Outfit"],
    ["AthenaCharacter:cid_400_athena_commando_m_ashtonsaltlake", "Star-Lord Outfit"], ["AthenaGlider:glider_id_141_ashtonboardwalk", "Avengers Quinjet"],
    ["AthenaLoadingScreen:lsid_120_ashton", "Assemble"], ["AthenaCharacter:cid_395_athena_commando_f_shatterfly", "Dream"]])
    assert.equal(c850[id]?.name, name, id);
  for (const id of ["Hero:hid_outlander_026_bunnyoutlander_sr_t01", "Hero:hid_constructor_plasmadamage_easter_sr_t01"])
    assert.ok(inBuild(v850, () => getItem(id)), id);
  assert.equal(inBuild(v840, () => getItem("Hero:hid_outlander_026_bunnyoutlander_sr_t01")), undefined, "Cottontail Eagle Eye is new in 8.50");
});

test("the Endgame Challenges' data: Schedule_LTM_Ashton, three at the start and three on days 2, 4 and 6, any 10 for the Quinjet", () => inBuild(v850, () => {
  const schedule = athenaChallengeSchedules().schedule_ltm_ashton;
  assert.deepEqual([schedule.eventName, schedule.cleanUpOnBundleCompletion], [ltmAshton, true]);
  const bundle = athenaChallengeBundles().questbundle_ltm_ashton;
  assert.deepEqual(bundle.quests.map(({ grantWithBundle, unlockValue }) => (grantWithBundle ? 0 : unlockValue)), [0, 0, 0, 2, 2, 2, 4, 4, 4, 6, 6, 6]);
  assert.deepEqual(bundle.completionSteps.map(({ count, rewards }) => [count, rewards[0].templateId]), [[10, "AthenaGlider:glider_id_141_ashtonboardwalk"]]);
  assert.equal(inBuild(v840, athenaChallengeSchedules).schedule_ltm_ashton, undefined, "8.40 has no such schedule");
}));

test("the Endgame Challenges' flag: 25 April to 5 May 2019 on 8.50 only; its days; the switch and off", () => {
  withConfig(season8, () => {
    const types = (iso, build = v850) => typesOf(inBuild(build, () => endgameStates(at(iso))));
    assert.deepEqual(types("2019-04-24T23:59:00Z"), []);
    assert.deepEqual(types("2019-04-25T00:00:00Z"), [ltmAshton, endgameCalendarEvent]);
    assert.deepEqual(types("2019-05-05T23:00:00Z"), [ltmAshton, endgameCalendarEvent]);
    assert.deepEqual(types("2019-05-06T00:00:00Z"), []);
    assert.deepEqual(types("2019-04-28T12:00:00Z", v840), [], "8.40 has no Endgame Challenges");
    assert.equal(inBuild(v850, () => endgameDay(at("2019-05-01T12:00:00Z"))), 6);
    assert.equal(inBuild(v850, () => endgameDay(at("2019-04-24T12:00:00Z"))), null);
    // 8.40's Air Royale Challenges run on 8.50 too, on their own days.
    assert.deepEqual(typesOf(inBuild(v850, () => airRoyaleStates(at("2019-04-20T12:00:00Z")))), [ltmGoose, "CalendarEvent_Season8_AirRoyale"]);
  });
  withConfig({ ...season8, season4Flags: { overrides: { [ltmAshton]: "on" } } }, () => {
    assert.ok(inBuild(v850, () => activeEventFlags()).includes(ltmAshton), "switched on, always served");
  });
  withConfig({ ...season8, datedFlags: { endgame: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v850, () => endgameFlagsNow(at("2019-04-28T12:00:00Z"))), []);
  });
  assert.deepEqual(season4Flag(ltmAshton).builds, [6058028, 6058028]);
  assert.deepEqual(season4Flag(ltmGoose).builds, [6005771, 6058028]);
  assert.deepEqual(season4Flag(lteBootyBay).builds, [5793395, 6058028]);
  assert.deepEqual(season4Flag(ltmHighStakes).builds, [5625478, 6058028]);
  assert.deepEqual(eventCard("endgame").ranges, [[6058028, 6058028]]);
  assert.deepEqual(eventCard("airRoyale").ranges, [[6005771, 6058028]]);
});

test("an 8.50 player gets the Endgame Challenges while they run, and Endgame's matches count for them", () => {
  // The replay's day 59 is 27 April 2019: the challenges' third day (DaysFromEventStart 2), not yet the fifth.
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(58) } }, () => withSession(v850, "ashton850", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:schedule_ltm_ashton"), "the schedule");
    assert.ok(templates.includes("Quest:quest_br_ashton_play_matches"), "a first challenge");
    assert.ok(templates.includes("Quest:quest_br_ashton_damage_turbo"), "the third day's");
    assert.equal(templates.includes("Quest:quest_br_ashton_damage_chicago"), false, "not the fifth day's yet");
    // Endgame's stats count in its playlist's own tag, Athena.Playlist.Ashton.
    assert.equal(ltmPlaylistTag(256), "Athena.Playlist.Ashton");
    recordMatchProgress(session, 256, { place: 2, kills: 0 });
    assert.equal(questOf(session, "Quest:quest_br_ashton_play_matches").attributes.completion_ltm_ashton_athena_play_matches, 1);
    recordMatchProgress(session, 2, { place: 2, kills: 0 });
    assert.equal(questOf(session, "Quest:quest_br_ashton_play_matches").attributes.completion_ltm_ashton_athena_play_matches, 1,
      "a Solo match doesn't count");
  }));
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(20) } }, () => withSession(v850, "noashton850", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(templatesOf(session).includes("ChallengeBundleSchedule:schedule_ltm_ashton"), false, "not before it");
  }));
  assert.equal(inBuild(v840, () => ltmPlaylistTag(256)), null, "no Endgame before 8.50");
});

test("Endgame (Playlist_Ashton_Sm) from 25 April to 5 May on 8.50, two teams of 20 in squads of 4, Epic's tile", () => {
  const dated = { ltmOriginalDates: true };
  withConfig(season8, () => {
    assert.deepEqual([hasLtm("endgame", v850), hasLtm("endgame", v840)], [true, false]);
    assert.equal(ltmOn("endgame", v850, dated, at("2019-04-28T12:00:00Z")), true);
    assert.equal(ltmOn("endgame", v850, dated, at("2019-05-06T12:00:00Z")), false);
    assert.equal(ltmOn("endgame", v850, {}, at("2019-04-28T12:00:00Z")), false, "off by default");
    assert.equal(ltmOn("endgame", v850, { matchmakingModes: { endgame: true } }, at("2019-03-10T12:00:00Z")), true, "its switch");
    for (const id of ["endgame48", "endgame64"]) {
      assert.ok(hasLtm(id, v850), id);
      assert.equal(ltmOn(id, v850, dated, at("2019-04-28T12:00:00Z")), false, `${id} has no original dates`);
    }
  });
  assert.deepEqual(playlistTeamsOf(`${v850}:0:NA:256`, v850), { maxTeamCount: 2, maxTeamSize: 20, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v850}:0:NA:257`, v850), { maxTeamCount: 2, maxTeamSize: 24, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v850}:0:NA:258`, v850), { maxTeamCount: 2, maxTeamSize: 32, maxSquadSize: 4 });
  // Ten squads of four make two sides of 20.
  const parties = Array.from({ length: 10 }, (_, party) => ({ players: Array.from({ length: 4 }, (__, player) => `p${party}-${player}`), fill: false }));
  const teams = formTeams(parties, playlistTeamsOf(`${v850}:0:NA:256`, v850), { teamsAreSquads: false });
  assert.equal(teams.length, 2);
  assert.deepEqual(teams.map((team) => team.flat().length), [20, 20]);
  assert.equal(teams.squads, "1,1,1,1,1;1,1,1,1,1", "five squads a side, each one party");
  const tile = epicPlaylistImageOf("Playlist_Ashton_Sm", v850);
  assert.match(tile, /08BR_LTM_Endgame_InGame_Mode-Tile-1024x512-03bb0dc121ae8b2dcd27b8b386670737093d0c83\.jpg$/);
});

test("8.50 keeps 8.40's modes: Air Royale, Deep Fried, the Arena and the tournaments run on; Season 8 and Spring 2019 too", () => {
  withConfig(season8, () => {
    for (const id of ["airRoyaleDuos", "foodFightDeepFried", "arenaSolo", "arenaDuos", "tournamentS8Solo", "tournamentS8Duos",
      "tournamentS8Squads", "fiftyFiftySeason8", "floorIsLavaSquads", "teamRumbleSeason8", "creative"])
      assert.ok(hasLtm(id, v850), id);
    for (const id of ["fiftyFiftySeason8", "creative"]) assert.equal(ltmOn(id, v850, {}, at("2019-04-28T12:00:00Z")), true, id);
  });
  assert.equal(inBuild(v850, () => ltmPlaylistTag(301)), "Athena.Playlist.Goose.Duos");
  assert.ok(activeEventFlags(v850).includes("EventFlag.LobbySeason8"));
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(58) } }, () => {
    const spring = inBuild(v850, () => activeEventFlags(v850)).filter((flag) => flag.startsWith("EventFlag.Spring2019"));
    assert.deepEqual(spring, [spring2019Flag, spring2019Phase1, spring2019Phase2]);
  });
  assert.deepEqual(eventCard("spring2019").ranges, [[5203069, 6058028]]);
  assert.deepEqual(eventCard("season8Lobby").ranges, [[5203069, 6058028]]);
});

test("8.50's Block: Tricky Tracks, then Alien Sanctuary from 2 May", () => {
  assert.equal(blockEventOf(v850)?.id, "block850");
  assert.equal(blockEventOf(v840)?.id, "block830");
  assert.deepEqual(eventCard("block850").ranges, [[6058028, 6058028]]);
  withConfig(season8, () => {
    const types = (iso) => typesOf(inBuild(v850, () => blockStates(at(iso))));
    assert.deepEqual(types("2019-05-01T12:00:00Z"), [blockSlab(1)]);
    assert.deepEqual(types("2019-05-02T12:00:00Z"), [blockSlab(2)]);
  });
});

test("Save the World's Event Store sells Cottontail Eagle Eye and Miss Bunny Penny from 8.50", () => {
  const heroes = yarrrEventItems.filter(({ fromBuild }) => fromBuild === 6058028).map(({ templateId, price }) => [templateId, price]);
  assert.deepEqual(heroes, [["Hero:hid_outlander_026_bunnyoutlander_sr_t01", 2800], ["Hero:hid_constructor_plasmadamage_easter_sr_t01", 2800]]);
});

test("Season 8's shop history serves 8.50 its own items (the Black Widow on 25 April), and 8.40 only its own", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 8: "2019-02-28" } };
  configureItemShop(() => shopConfig);
  try {
    const ids = (build, iso) => inBuild(build, () => {
      const offers = itemShopOffers(at(iso), shopConfig);
      return [...offers.BRWeeklyStorefront, ...offers.BRDailyStorefront].map(({ templateId }) => templateId);
    });
    const sold = new Set(["2019-04-25", "2019-04-26", "2019-04-27", "2019-04-28", "2019-04-29", "2019-04-30"]
      .flatMap((day) => ids(v850, `${day}T12:00:00Z`)));
    assert.ok(sold.has("AthenaCharacter:cid_399_athena_commando_f_ashtonboardwalk"), "the Black Widow");
    const c850 = inBuild(v850, athenaCosmetics);
    assert.ok([...sold].every((id) => c850[id]));
    assert.equal(ids(v840, "2019-04-25T12:00:00Z").includes("AthenaCharacter:cid_399_athena_commando_f_ashtonboardwalk"), false);
  } finally {
    configureItemShop(null);
  }
});
