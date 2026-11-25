import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventCard } from "../src/admin/eventschedules.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { blockEventOf, blockStates } from "../src/events/block.js";
import { datedEvent, shiftedDatedSchedule } from "../src/events/datedflags.js";
import { endgameStates } from "../src/events/endgame.js";
import { activeEventFlags, blockSlab, configureEvents, lteS8ExtraCredit, ltmAshton, unvaultingAfter, unvaultingCountdown,
  unvaultingEvent as unvaultingEventName, unvaultingLevel, unvaultingRune, unvaultingRuneWarmup } from "../src/events/events.js";
import { extraCreditCalendarEvent, extraCreditDay, extraCreditFlagsNow, extraCreditStates } from "../src/events/extracredit.js";
import { hasLtm, ltmOn } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { unvaultingFlagsNow, unvaultingStates } from "../src/events/unvaulting.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { advanceAthenaObjectives, athenaQuestLogin, grantAthenaQuest, seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason, buyBattlePass, buyTiers } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";

// Fortnite 8.51 (Update v8.51, 1 May 2019; Season 8): CL-6165369, on its own data (gamedata/6165369). 8.50's events and modes
// on the same days, and its own: the Unvaulting, the Season 8 Overtime Challenges and the Unvaulting playlist.
const v851 = "6165369";
const v850 = "6058028";
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
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-851-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const templatesOf = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);

test("8.51 is known, on its own data, Season 8's newest build", () => {
  assert.equal(versionOf(v851), "8.51");
  assert.equal(allowedBuildList(["8.51"]).join(), v851);
  assert.equal(dataBuild(v851), v851);
  assert.equal(dataBuild("6100000"), v850, "a build between 8.50 and 8.51 plays on 8.50's");
  assert.equal(dataBuild("6200000"), v851, "a later build Core doesn't know plays on 8.51's");
  assert.equal(releasedOn(v851), Date.UTC(2019, 4, 1));
  assert.equal(buildOfSeason(8), v851);
  assert.equal(seasonName(8), "Season 8 (8.00 – 8.51)");
  const season = inBuild(v851, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [8, "BRSeason8", 100]);
});

test("8.51's cosmetics are 8.50's; its data adds the Season 8 Overtime Challenges' schedule, run by its bundle's flag", () => {
  const [c851, c850] = [inBuild(v851, athenaCosmetics), inBuild(v850, athenaCosmetics)];
  assert.deepEqual(Object.keys(c851).sort(), Object.keys(c850).sort());
  inBuild(v851, () => {
    const schedule = athenaChallengeSchedules().season8_extracredit_schedule;
    assert.deepEqual([schedule.eventName, schedule.category], [lteS8ExtraCredit, "ChallengeCategory.Event"]);
    const bundle = athenaChallengeBundles().questbundle_s8_extracredit;
    assert.deepEqual(bundle.quests.filter(({ requiresBattlePass }) => !requiresBattlePass).map(({ unlockValue }) => unlockValue), [0, 0, 2, 2, 4, 4]);
    assert.equal(bundle.quests.filter(({ requiresBattlePass }) => requiresBattlePass).length, 3);
    assert.deepEqual(bundle.completionSteps.map(({ count, rewards }) => [count, rewards[0].templateId]), [[6, "AthenaLoadingScreen:lsid_119_volcanokey"]]);
  });
  assert.equal(inBuild(v850, athenaChallengeSchedules).season8_extracredit_schedule, undefined, "8.50's data predates the extractor's fix");
});

test("the Unvaulting on 8.51: the fifth rune, the 24-hour countdown ending at 18:00 UTC on 4 May, the event, the island after", () => {
  withConfig(season8, () => {
    const types = (iso, build = v851) => typesOf(inBuild(build, () => unvaultingStates(at(iso))));
    assert.deepEqual(types("2019-04-29T12:00:00Z"), []);
    assert.deepEqual(types("2019-04-30T12:00:00Z"), [unvaultingRuneWarmup]);
    assert.deepEqual(types("2019-05-02T12:00:00Z"), [unvaultingRune]);
    assert.deepEqual(types("2019-05-04T12:00:00Z"), [unvaultingCountdown]);
    assert.deepEqual(types("2019-05-04T17:45:00Z").sort(), [unvaultingCountdown, unvaultingLevel].sort());
    assert.deepEqual(types("2019-05-04T18:05:00Z").sort(), [unvaultingLevel, unvaultingEventName].sort());
    assert.deepEqual(types("2019-05-04T18:12:00Z").sort(), [unvaultingLevel, unvaultingAfter].sort());
    assert.deepEqual(types("2019-05-07T12:00:00Z"), [unvaultingAfter]);
    assert.deepEqual(types("2019-05-04T12:00:00Z", v850), [], "8.50 has no Unvaulting");
    // BP_SnowScripting counts its clock to GWS1's activeUntil: the event's moment.
    const countdown = inBuild(v851, () => unvaultingStates(at("2019-05-04T12:00:00Z")))[0].events[0];
    assert.deepEqual([countdown.activeSince, countdown.activeUntil], ["2019-05-03T18:00:00.000Z", "2019-05-04T18:00:00.000Z"]);
    // The next parts follow: the sky level at 17:30, the event at 18:00.
    const next = inBuild(v851, () => unvaultingStates(at("2019-05-04T12:00:00Z"))).slice(1, 3).map(({ validFrom }) => new Date(validFrom).toISOString());
    assert.deepEqual(next, ["2019-05-04T17:30:00.000Z", "2019-05-04T18:00:00.000Z"]);
  });
  withConfig({ ...season8, datedFlags: { unvaulting: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v851, () => unvaultingFlagsNow(at("2019-05-07T12:00:00Z"))), [], "off: the island as it was before");
  });
});

test("the Unvaulting on demand: a start time on the event's step plays every step at Epic's spacing", () => {
  const event = datedEvent("unvaulting");
  const startAt = "2026-11-24T20:00:00.000Z";
  const schedule = shiftedDatedSchedule(event, { startAt });
  assert.deepEqual(schedule.find(({ step }) => step === "event"), { step: "event", startAt, endAt: "2026-11-24T20:10:00.000Z" });
  assert.deepEqual(schedule.find(({ step }) => step === "countdown"), { step: "countdown", startAt: "2026-11-23T20:00:00.000Z", endAt: startAt });
  assert.deepEqual(schedule.find(({ step }) => step === "after"), { step: "after", startAt: "2026-11-24T20:10:00.000Z", endAt: null });
  withConfig({ ...season8, datedFlags: { unvaulting: { mode: "custom", schedule } } }, () => {
    const types = (iso) => typesOf(inBuild(v851, () => unvaultingStates(at(iso)))).sort();
    assert.deepEqual(types("2026-11-24T19:55:00Z"), [unvaultingCountdown, unvaultingLevel].sort());
    assert.deepEqual(types("2026-11-24T20:01:00Z"), [unvaultingLevel, unvaultingEventName].sort());
    assert.deepEqual(types("2026-12-01T00:00:00Z"), [unvaultingAfter], "after it, for good");
  });
  const card = eventCard("unvaulting");
  assert.deepEqual([card.ranges, card.key, card.flags], [[[6165369, 6165369]], "event", ["GWW5", "GW5", "GWS1", "GWLevel", "GWS0", "PGW"]]);
});

test("the Unvaulting playlist: Playlist_Music_Highest (two teams of 50) around the event on 8.51, on by default", () => {
  const dated = { ltmOriginalDates: true };
  withConfig(season8, () => {
    assert.deepEqual([hasLtm("unvaulting", v851), hasLtm("unvaulting", v850)], [true, false]);
    assert.equal(ltmOn("unvaulting", v851, dated, at("2019-05-04T17:30:00Z")), true);
    assert.equal(ltmOn("unvaulting", v851, dated, at("2019-05-04T19:00:00Z")), false);
    assert.equal(ltmOn("unvaulting", v851, { matchmakingModes: { unvaulting: true } }, at("2019-03-10T12:00:00Z")), true, "its switch");
  });
  assert.deepEqual(playlistTeamsOf(`${v851}:0:NA:325`, v851), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
});

test("the Season 8 Overtime Challenges: 3 to 8 May 2019 on 8.51; their days; the switch and off", () => {
  withConfig(season8, () => {
    const types = (iso, build = v851) => typesOf(inBuild(build, () => extraCreditStates(at(iso))));
    assert.deepEqual(types("2019-05-02T23:59:00Z"), []);
    assert.deepEqual(types("2019-05-03T00:00:00Z"), [lteS8ExtraCredit, extraCreditCalendarEvent]);
    assert.deepEqual(types("2019-05-08T23:00:00Z"), [lteS8ExtraCredit, extraCreditCalendarEvent]);
    assert.deepEqual(types("2019-05-04T12:00:00Z", v850), [], "8.50 has none");
    assert.equal(inBuild(v851, () => extraCreditDay(at("2019-05-05T12:00:00Z"))), 2);
  });
  withConfig({ ...season8, season4Flags: { overrides: { [lteS8ExtraCredit]: "on" } } }, () => {
    assert.ok(inBuild(v851, () => activeEventFlags()).includes(lteS8ExtraCredit), "switched on, always served");
  });
  withConfig({ ...season8, datedFlags: { extraCredit: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v851, () => extraCreditFlagsNow(at("2019-05-04T12:00:00Z"))), []);
  });
  assert.deepEqual(season4Flag(lteS8ExtraCredit).builds, [6165369, 6165369]);
  assert.deepEqual(eventCard("extraCredit").ranges, [[6165369, 6165369]]);
});

test("an 8.51 player gets the Overtime Challenges while they run, their days' challenges as they come", () => {
  // The replay's day 66 is 5 May 2019: the challenges' third day (DaysFromEventStart 2), not yet the fifth.
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(66) } }, () => withSession(v851, "overtime851", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:season8_extracredit_schedule"), "the schedule");
    assert.ok(templates.includes("Quest:quest_br_extracredit_creative_collectcoins"), "a first challenge");
    assert.ok(templates.includes("Quest:quest_br_extracredit_damage"), "the third day's");
    assert.equal(templates.includes("Quest:quest_br_extracredit_outlast"), false, "not the fifth day's yet");
  }));
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(60) } }, () => withSession(v851, "noovertime851", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(templatesOf(session).includes("ChallengeBundleSchedule:season8_extracredit_schedule"), false, "not before them");
  }));
});

// The Overtime tier quests (HasLeveledUpBattlePass): Quest_BR_S8_ExtraCredit_CompleteQuests_ChainTest_01a, tier 23, gives
// Medusa (CID_348) and leads to _01b, two Overtime challenges (HasItem of the hidden Token:athena_s8extracredit_challenge_token
// each gives), her second style (VTID_176_Medusa_StyleB, Material Mat2).
const questOf = (session, questId) => Object.values(session.profile("athena").profile.items)
  .find(({ templateId }) => templateId.toLowerCase() === `quest:${questId}`);
const itemIdOf = (session, questId) => Object.keys(session.profile("athena").profile.items)
  .find((itemId) => session.profile("athena").profile.items[itemId].templateId.toLowerCase() === `quest:${questId}`);

test("8.51's Overtime tier style: tier 23 gives Medusa and her style stage, two Overtime challenges then her style", () => {
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(66) } }, () => withSession(v851, "tierstyle851", (session) => {
    setUpAthena(session);
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    assert.equal(questOf(session, "quest_br_s8_extracredit_completequests_chaintest_01a")?.attributes.quest_state, "Active");
    buyTiers(session, 22, seasonRewardFunctions());
    assert.equal(session.profile("athena").profile.stats.attributes.book_level, 23);
    assert.equal(questOf(session, "quest_br_s8_extracredit_completequests_chaintest_01a").attributes.quest_state, "Claimed", "tier 23");
    assert.equal(questOf(session, "quest_br_s8_extracredit_completequests_chaintest_02a").attributes.completion_quest_s8_extracredit_completequests_test_03, 23, "tier 71 waits");
    assert.ok(templatesOf(session).includes("AthenaCharacter:cid_348_athena_commando_f_medusa"));
    assert.equal(questOf(session, "quest_br_s8_extracredit_completequests_chaintest_01b")?.attributes.quest_state, "Active", "her style stage");
    advanceAthenaObjectives(session, [{ statName: "overtime_battlepass_play_featured_creative_content", count: 20 }]);
    assert.equal(questOf(session, "quest_br_s8_extracredit_completequests_chaintest_01b").attributes.completion_quest_s7_overtime_completequests_test_02, 1);
    advanceAthenaObjectives(session, [{ statName: "extracredit_battlepass_damage_athena_player", count: 1000 }]);
    assert.equal(questOf(session, "quest_br_s8_extracredit_completequests_chaintest_01b").attributes.quest_state, "Claimed", "two Overtime challenges");
    const medusa = Object.values(session.profile("athena").profile.items).find(({ templateId }) => templateId === "AthenaCharacter:cid_348_athena_commando_f_medusa");
    assert.ok(medusa.attributes.variants.some(({ channel, owned }) => channel === "Material" && owned.includes("Mat2")));
  }));
});

test("8.51: Overtime challenges collected before their hidden tokens were held count for the style stage at quest login", () => {
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(66) } }, () => withSession(v851, "oldtokens851", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const tracker = session.profile("athena");
    const claimed = itemIdOf(session, "quest_br_extracredit_creative_collectcoins");
    tracker.setItemAttribute(claimed, "quest_state", "Claimed");
    const stage = grantAthenaQuest(tracker, "quest_br_s8_extracredit_completequests_chaintest_01b");
    athenaQuestLogin(session);
    const held = Object.values(tracker.profile.items).filter(({ templateId }) => templateId.toLowerCase() === "token:athena_s8extracredit_challenge_token");
    assert.deepEqual(held.map(({ quantity }) => quantity), [1]);
    assert.equal(tracker.profile.items[stage].attributes.completion_quest_s7_overtime_completequests_test_02, 1);
    athenaQuestLogin(session);
    assert.equal(Object.values(tracker.profile.items).find(({ templateId }) => templateId.toLowerCase() === "token:athena_s8extracredit_challenge_token").quantity, 1, "once");
  }));
});

test("8.51 keeps 8.50's: the Endgame Challenges and Endgame to 5 May, the Block, Season 8's lobby and modes", () => {
  withConfig(season8, () => {
    assert.deepEqual(typesOf(inBuild(v851, () => endgameStates(at("2019-05-02T12:00:00Z")))), [ltmAshton, "CalendarEvent_Season8_Ashton"]);
    assert.equal(ltmOn("endgame", v851, { ltmOriginalDates: true }, at("2019-05-02T12:00:00Z")), true);
    for (const id of ["endgame48", "endgame64", "airRoyaleDuos", "foodFightDeepFried", "arenaSolo", "arenaDuos", "tournamentS8Solo",
      "fiftyFiftySeason8", "creative"]) assert.ok(hasLtm(id, v851), id);
    assert.deepEqual(typesOf(inBuild(v851, () => blockStates(at("2019-05-03T12:00:00Z")))), [blockSlab(2)]);
  });
  assert.equal(blockEventOf(v851)?.id, "block850");
  assert.ok(activeEventFlags(v851).includes("EventFlag.LobbySeason8"));
});
