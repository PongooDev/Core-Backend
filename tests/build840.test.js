import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventCard } from "../src/admin/eventschedules.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { airRoyaleCalendarEvent, airRoyaleDay, airRoyaleFlagsNow, airRoyaleStates } from "../src/events/airroyale.js";
import { blockEventOf, blockStates } from "../src/events/block.js";
import { buccaneersBountyStates } from "../src/events/buccaneersbounty.js";
import { activeEventFlags, blockSlab, configureEvents, lteBootyBay, ltmGoose, ltmHighStakes } from "../src/events/events.js";
import { hasLtm, ltmOn } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { siphonOn, siphonRows } from "../src/events/siphon.js";
import { spring2019Flag, spring2019Phase1, spring2019Phase2 } from "../src/events/spring2019.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { dataBuild } from "../src/gamedata/read.js";
import { athenaQuestLogin, grantCosmetic, setUpAthena } from "../src/profiles/athena.js";
import { styleSchedules } from "../src/profiles/challenges.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { yarrrEventItems } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";

// Fortnite 8.40 (Update v8.40, 17 April 2019; Season 8): CL-6005771, on its own data (gamedata/6005771). 8.30's events
// and modes on the same days, and its own: Air Royale and its challenges, Food Fight: Deep Fried, the Ruin Challenges,
// the Easter outfits in the shop and the Springtime Heroes in Save the World's Event Store.
const v840 = "6005771";
const v830 = "5793395";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-840-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const templatesOf = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);

test("8.40 is known, on its own data", () => {
  assert.equal(versionOf(v840), "8.40");
  assert.equal(allowedBuildList(["8.40"]).join(), v840);
  assert.equal(dataBuild(v840), v840);
  assert.equal(dataBuild("5900000"), v830, "a build between 8.30 and 8.40 plays on 8.30's");
  assert.equal(dataBuild("6030000"), v840, "a build between 8.40 and 8.50 plays on 8.40's");
  assert.equal(releasedOn(v840), Date.UTC(2019, 3, 17));
  assert.equal(buildOfSeason(8), "6165369", "8.51 is Season 8's newest (tests/build851.test.js)");
  assert.equal(seasonName(8), "Season 8 (8.00 – 8.51)");
  const season = inBuild(v840, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [8, "BRSeason8", 100]);
  assert.ok(season.challengeSchedulesAlwaysShown.includes("season8_ruin_schedule"));
});

test("8.40's cosmetics: 30 more than 8.30 (Supersonic, Hopper, Pastel, Nitehare, Splode, the Callsign wraps...), none gone", () => {
  const [c840, c830] = [inBuild(v840, athenaCosmetics), inBuild(v830, athenaCosmetics)];
  assert.equal(Object.keys(c840).length, 1640);
  assert.equal(Object.keys(c840).filter((id) => !c830[id]).length, 30);
  assert.deepEqual(Object.keys(c830).filter((id) => !c840[id]), []);
  for (const [id, name] of [["AthenaCharacter:cid_385_athena_commando_m_pilotskull", "Supersonic"],
    ["AthenaCharacter:cid_391_athena_commando_m_hoppityheist", "Hopper"], ["AthenaCharacter:cid_392_athena_commando_f_bountybunny", "Pastel"],
    ["AthenaCharacter:cid_390_athena_commando_m_evilbunny", "Nitehare"], ["AthenaCharacter:cid_388_athena_commando_m_thebomb", "Splode"],
    ["AthenaItemWrap:wrap_041_pilotbee", "Callsign Hornet"], ["AthenaItemWrap:wrap_045_angel", "Divine"]])
    assert.equal(c840[id]?.name, name, id);
  // Save the World's Springtime Heroes are in its item data.
  for (const id of ["Hero:hid_commando_028_bunnybrawler_sr_t01", "Hero:hid_ninja_027_bunnyninja_sr_t01"])
    assert.ok(inBuild(v840, () => getItem(id)), id);
});

test("the Air Royale Challenges' data: Schedule_LTM_Goose, three challenges at the start and three on days 2 and 4", () => inBuild(v840, () => {
  const schedule = athenaChallengeSchedules().schedule_ltm_goose;
  assert.deepEqual([schedule.eventName, schedule.cleanUpOnBundleCompletion], [ltmGoose, true]);
  const bundle = athenaChallengeBundles().questbundle_ltm_goose;
  assert.deepEqual(bundle.quests.map(({ grantWithBundle, unlockValue }) => (grantWithBundle ? 0 : unlockValue)), [0, 0, 0, 2, 2, 2, 4, 4, 4]);
  assert.equal(bundle.completionSteps[0].rewards[0].templateId, "AthenaItemWrap:wrap_041_pilotbee");
  assert.equal(inBuild(v830, athenaChallengeSchedules).schedule_ltm_goose, undefined, "8.30 has no such schedule");
}));

test("the Air Royale Challenges' flag: 17 to 24 April 2019 from 8.40; its days; the switch and off", () => {
  withConfig(season8, () => {
    const types = (iso, build = v840) => typesOf(inBuild(build, () => airRoyaleStates(at(iso))));
    assert.deepEqual(types("2019-04-16T23:59:00Z"), []);
    assert.deepEqual(types("2019-04-17T00:00:00Z"), [ltmGoose, airRoyaleCalendarEvent]);
    assert.deepEqual(types("2019-04-24T23:00:00Z"), [ltmGoose, airRoyaleCalendarEvent]);
    assert.deepEqual(types("2019-04-25T00:00:00Z"), []);
    assert.deepEqual(types("2019-04-20T12:00:00Z", v830), [], "8.30 has no Air Royale Challenges");
    assert.equal(inBuild(v840, () => airRoyaleDay(at("2019-04-21T12:00:00Z"))), 4);
    assert.equal(inBuild(v840, () => airRoyaleDay(at("2019-04-16T12:00:00Z"))), null);
    // 8.20's High Stakes and 8.30's Buccaneer's Bounty run on 8.40 too.
    assert.deepEqual(typesOf(inBuild(v840, () => buccaneersBountyStates(at("2019-04-12T12:00:00Z")))), [lteBootyBay, "CalendarEvent_Season8_BootyBay"]);
  });
  withConfig({ ...season8, season4Flags: { overrides: { [ltmGoose]: "on" } } }, () => {
    assert.ok(inBuild(v840, () => activeEventFlags()).includes(ltmGoose), "switched on, always served");
  });
  withConfig({ ...season8, datedFlags: { airRoyale: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v840, () => airRoyaleFlagsNow(at("2019-04-20T12:00:00Z"))), []);
  });
  assert.deepEqual(season4Flag(ltmGoose).builds, [6005771, 6165369]);
  assert.deepEqual(season4Flag(lteBootyBay).builds, [5793395, 6165369]);
  assert.deepEqual(season4Flag(ltmHighStakes).builds, [5625478, 6165369]);
  assert.deepEqual(eventCard("airRoyale").ranges, [[6005771, 6165369]]);
});

test("an 8.40 player gets the Air Royale Challenges while they run, three more on the third day", () => {
  // The replay's day 51 is 19 April 2019: the challenges' third day (DaysFromEventStart 2), not yet the fifth.
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(50) } }, () => withSession(v840, "goose840", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:schedule_ltm_goose"), "the schedule");
    assert.ok(templates.includes("Quest:quest_br_goose_play_matches"), "a first challenge");
    assert.ok(templates.includes("Quest:quest_br_goose_destroy_stormwings"), "the third day's");
    assert.equal(templates.includes("Quest:quest_br_goose_place_top5"), false, "not the fifth day's yet");
  }));
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(20) } }, () => withSession(v840, "nogoose840", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(templatesOf(session).includes("ChallengeBundleSchedule:schedule_ltm_goose"), false, "not before it");
  }));
});

test("the Ruin Challenges: Ruin's 55-challenge quest gives them on 8.40, and Ruin's owners get them", () => {
  const ruin = "AthenaCharacter:cid_378_athena_commando_m_furnaceface";
  assert.equal(styleSchedules.season8_ruin_schedule, ruin);
  const bundle = inBuild(v840, athenaChallengeBundles).questbundle_s8_cumulative_ruin;
  assert.deepEqual(bundle.completionSteps.map(({ count, rewards }) => [count, rewards[0].templateId]),
    [[3, "AthenaBackpack:bid_242_furnaceface"], [-1, "AthenaPickaxe:pickaxe_id_187_furnaceface"]]);
  assert.equal(inBuild(v830, athenaChallengeSchedules).season8_ruin_schedule, undefined, "8.30 has none");
  withConfig(season8, () => withSession(v840, "ruin840", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(templatesOf(session).includes("ChallengeBundleSchedule:season8_ruin_schedule"), false, "not without Ruin");
    grantCosmetic(session, ruin);
    athenaQuestLogin(session);
    assert.ok(templatesOf(session).includes("ChallengeBundleSchedule:season8_ruin_schedule"));
  }));
  // Gemini's styles schedule is in 8.40's data, but Epic never released Gemini.
  assert.ok(inBuild(v840, athenaChallengeSchedules).bundleschedule_styles_spacebunny);
  assert.equal(styleSchedules.bundleschedule_styles_spacebunny, undefined);
});

test("8.40's Block is 8.30's: Llama Sphinx, then Cordial Courtyard from 17 April", () => {
  assert.equal(blockEventOf(v840)?.id, "block830");
  assert.deepEqual(eventCard("block830").ranges, [[5793395, 6005771]]);
  withConfig(season8, () => {
    const types = (iso) => typesOf(inBuild(v840, () => blockStates(at(iso))));
    assert.deepEqual(types("2019-04-16T12:00:00Z"), [blockSlab(1)]);
    assert.deepEqual(types("2019-04-17T12:00:00Z"), [blockSlab(2)]);
  });
});

test("Air Royale (Duos) and Food Fight: Deep Fried from 17 April on 8.40; Season 8's modes and Spring 2019 run on as on 8.30", () => {
  const dated = { ltmOriginalDates: true };
  withConfig(season8, () => {
    for (const id of ["airRoyaleDuos", "foodFightDeepFried"]) {
      assert.deepEqual([hasLtm(id, v840), hasLtm(id, v830)], [true, false], id);
      assert.equal(ltmOn(id, v840, dated, at("2019-04-20T12:00:00Z")), true, id);
      assert.equal(ltmOn(id, v840, dated, at("2019-04-26T12:00:00Z")), false, id);
      assert.equal(ltmOn(id, v840, {}, at("2019-04-20T12:00:00Z")), false, `${id} is off by default`);
    }
    for (const id of ["fiftyFiftySeason8", "playgroundV2", "creative"]) assert.equal(ltmOn(id, v840, {}, at("2019-04-20T12:00:00Z")), true, id);
    for (const id of ["floorIsLavaSquads", "getawaySeason8Squads", "teamRumbleSeason8", "classicSeason8Squads"]) assert.ok(hasLtm(id, v840), id);
  });
  assert.ok(activeEventFlags(v840).includes("EventFlag.LobbySeason8"));
  withConfig({ mode: "auto", seasonStarts: { 8: replayDaysAgo(50) } }, () => {
    const spring = inBuild(v840, () => activeEventFlags(v840)).filter((flag) => flag.startsWith("EventFlag.Spring2019"));
    assert.deepEqual(spring, [spring2019Flag, spring2019Phase1, spring2019Phase2]);
  });
  assert.deepEqual(eventCard("spring2019").ranges, [[5203069, 6165369]]);
});

test("Save the World's Event Store sells the Springtime Heroes on 8.40 only", () => {
  const bunnies = yarrrEventItems.filter(({ fromBuild }) => fromBuild === 6005771).map(({ templateId }) => templateId);
  assert.deepEqual(bunnies, ["Hero:hid_commando_028_bunnybrawler_sr_t01", "Hero:hid_ninja_027_bunnyninja_sr_t01"]);
  for (const id of bunnies) assert.equal(inBuild(v830, () => getItem(id)), undefined, `8.30's data has no ${id}`);
});

test("8.40 keeps the siphon revert: no hotfix rows, not one of the switch's builds", () => {
  assert.equal(siphonOn(v840, { siphon: "on" }), null);
  assert.deepEqual(siphonRows(v840, { siphon: "on" }), []);
});

test("Season 8's shop history serves 8.40 its own items (Supersonic from 17 April), and 8.30 only its own", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 8: "2019-02-28" } };
  configureItemShop(() => shopConfig);
  try {
    const supersonic = "AthenaCharacter:cid_385_athena_commando_m_pilotskull";
    const ids = (build) => inBuild(build, () => {
      const offers = itemShopOffers(at("2019-04-17T12:00:00Z"), shopConfig);
      return [...offers.BRWeeklyStorefront, ...offers.BRDailyStorefront].map(({ templateId }) => templateId);
    });
    assert.ok(ids(v840).includes(supersonic));
    assert.equal(ids(v830).includes(supersonic), false);
    const c840 = inBuild(v840, athenaCosmetics);
    assert.ok(ids(v840).every((id) => c840[id]));
  } finally {
    configureItemShop(null);
  }
});
