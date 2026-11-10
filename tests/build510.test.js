import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { birthdayLlama, birthdayQuests } from "../src/events/birthday2018.js";
import { activeEventFlags, anniversary2018BR, birthday2018, birthdayBattleBus, configureEvents, groupMission, hordeFlag, isEventActive, lobbySeason5,
  passiveStorms, roadTrip2018Flag, supplyDropBDay } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { hasLtm, inOriginalWindow, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides } from "../src/events/ltms.js";
import { eventQuestLine } from "../src/events/quests.js";
import { hordeAlertRewards, roadTripTickets } from "../src/events/roadtrip2018.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { advanceAthenaObjectives, athenaQuestLogin, recordMatchProgress } from "../src/profiles/athena.js";
import { brokenChallengeOf } from "../src/profiles/challenges.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { storefronts } from "../src/store/catalog.js";
import { eventStoreOffers, eventStorefront } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";

// Fortnite 5.10, Season 5: CL-4225813 (++Fortnite+Release-5.10, "5.10.0", Update v5.10, 24 July 2018) and CL-4240749
// ("5.10", the user's build, Content Update v5.10 of 31 July), both on CL-4240749's data (gamedata/4240749).
const v5100 = "4225813";
const v510 = "4240749";
const v510s = [v5100, v510];
const v50 = "4214610";
const now = new Date("2026-11-09T12:00:00Z");
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const withStore = (run) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build510-"));
  try {
    return run(dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

test("5.10's two builds are known by their versions, play on CL-4240749's data and stay Season 5", () => {
  assert.deepEqual(v510s.map(versionOf), ["5.10.0", "5.10"]);
  for (const build of v510s) {
    assert.equal(dataBuild(build), v510, `${build} plays on CL-4240749's data, not 5.0's`);
    assert.ok(buildChoices().includes(build));
  }
  assert.equal(dataBuild("4220000"), v50, "a build between 5.0 and 5.10 Core doesn't know still plays on 5.0's");
  assert.equal(dataBuild("4230000"), v50, "nor one between 5.10's two");
  assert.equal(allowedBuildList(["5.10.0", "5.10"]).join(), v510s.join());
  assert.equal(buildOfSeason(5), v510);
  assert.equal(seasonName(5), "Season 5 (5.0 – 5.10)");
  for (const build of v510s) {
    const season = inBuild(build, athenaSeason);
    assert.deepEqual([season.seasonNumber, season.numBookLevels, season.storefront, season.battlePassLevelOfferId], [5, 100, "BRSeason5", "4B2E310BC1AE40B292A16D5AAD747E0A"]);
  }
});

test("5.10's data: 25 new cosmetics, the Birthday Challenges' schedule, week 3 finished, and Save the World's Birthday", () => {
  const c510 = inBuild(v510, athenaCosmetics);
  const c50 = inBuild(v50, athenaCosmetics);
  assert.equal(Object.keys(c510).filter((id) => !c50[id]).length, 25);
  assert.ok(Object.keys(c50).every((id) => c510[id]), "5.10 drops none of 5.0's");
  assert.deepEqual(["AthenaCharacter:cid_179_athena_commando_f_scuba", "AthenaBackpack:bid_084_birthday2018", "AthenaDance:spid_040_birthday2018",
    "AthenaBattleBus:bbid_birthdaybus"].map((id) => c510[id].name), ["Reef Ranger", "Birthday Cake", "Happy Birthday!", "Battle Bus"]);
  inBuild(v510, () => {
    assert.deepEqual(athenaChallengeSchedules().schedule_birthday2018_br,
      { bundles: [{ bundle: "questbundle_birthday2018_br", unlockType: "OnScheduleGranted", unlockValue: 0 }], category: "Event", eventName: anniversary2018BR });
    const bundle = athenaChallengeBundles().questbundle_birthday2018_br;
    assert.deepEqual(bundle.quests.map(({ quest }) => quest), ["quest_br_play_birthday", "quest_br_damage_birthday", "quest_br_dance_scavengerhunt_birthdaycakes"]);
    assert.deepEqual(bundle.completionSteps, [{ count: -1, rewards: [{ quantity: 1, templateId: "AthenaBackpack:bid_084_birthday2018" }] }]);
    // 5.0's unfinished week 3 challenge is finished: six shooting gallery targets, five of them to do.
    const targets = getAthenaQuest("quest_br_destroy_specifictargets");
    assert.deepEqual([targets.objectives.length, targets.objectiveCompletionCount, targets.objectives[0].stat], [6, 5, "destroytarget_location_shooter_01"]);
    assert.equal(getItem("Hero:hid_commando_010_bday_sr_t01").name, "Birthday Brigade Ramirez");
    assert.ok(getItem(birthdayLlama));
    assert.deepEqual(getQuest("anniversaryquest_2018_kill_cake_sploders").rewards, [{ quantity: 1, templateId: "Hero:hid_commando_010_bday_sr_t01" }]);
  });
  assert.equal(inBuild(v50, athenaChallengeSchedules).schedule_birthday2018_br, undefined, "5.0 has no Birthday");
  for (const build of v510s) assert.equal(brokenChallengeOf("quest_br_destroy_specifictargets", build), undefined, build);
  assert.equal(brokenChallengeOf("quest_br_destroy_specifictargets", v50)?.issue, "CoreV2 #299");
});

test("5.10's event flags: 5.0's and the Birthday's three; the Season 5 map flags only by the admin's switch", () => {
  for (const build of v510s) {
    assert.deepEqual(activeEventFlags(build), [groupMission, passiveStorms, lobbySeason5, roadTrip2018Flag, hordeFlag, anniversary2018BR, birthdayBattleBus, supplyDropBDay], build);
    assert.equal(isEventActive(birthday2018, build), true);
  }
  assert.equal(isEventActive(birthday2018, v50), false);
  assert.ok(!activeEventFlags(v50).includes(anniversary2018BR));
  withConfig({ mode: "auto", season4Flags: { overrides: { "EventFlag.BR_S5_Rift_Shrink": "on", "EventFlag.Anniversary2018_BR": "off" } } }, () => {
    assert.ok(activeEventFlags(v510).includes("EventFlag.BR_S5_Rift_Shrink"));
    assert.ok(!activeEventFlags(v50).includes("EventFlag.BR_S5_Rift_Shrink"), "5.0's paks have no such flag");
    assert.ok(!activeEventFlags(v510).includes(anniversary2018BR));
    assert.ok(activeEventFlags(v510).includes(birthdayBattleBus));
  });
});

test("5.10's modes: Playground v2 from 25 July with four teams, Fly Explosives new on CL-4240749 only", () => {
  const none = { matchmakingModes: {} };
  assert.equal(ltmNewMode(v5100, none), null, "Update v5.10's build has no new mode");
  assert.equal(ltmNewMode(v510, none).id, "flyExplosives");
  assert.equal(hasLtm("flyExplosives", v5100), false);
  for (const build of v510s) {
    assert.equal(ltmOfPlaylist(35, build).id, "playgroundV2");
    assert.equal(ltmOn("playgroundV2", build, none), false);
    assert.equal(ltmOn("playground", build, { matchmakingModes: { playground: true } }), false, "4.5's Playground ends with 5.0");
    assert.deepEqual(playlistTeamsOf(`${build}:0:NA:35`, build), { maxTeamCount: 4, maxTeamSize: 4, maxSquadSize: 4 });
    assert.equal(ltmOfPlaylist(50, build).id, "fiftyFiftySeason5");
  }
  assert.equal(ltmOfPlaylist(35, v50).id, "playground");
  assert.deepEqual(playlistTeamsOf(`${v50}:0:NA:35`, v50), { maxTeamCount: 1, maxTeamSize: 4, maxSquadSize: 4 });
  assert.deepEqual([120, 121, 122].map((id) => playlistTeamsOf(`${v510}:0:NA:${id}`, v510).maxTeamSize), [1, 2, 4]);
  assert.deepEqual(ltmPlaylistOverrides(v510, { matchmakingModes: { playgroundV2: true, flyExplosivesSolo: true } }),
    ["Playlist_Playground", "Playlist_FlyExplosives_Squads", "Playlist_FlyExplosives_Solo"]);
  withConfig({ mode: "auto", seasonStarts: { 5: "2018-07-12" } }, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    assert.equal(inOriginalWindow("playgroundV2", v510, new Date("2018-07-24T12:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("playgroundV2", v5100, new Date("2018-07-25T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("flyExplosives", v510, new Date("2018-08-01T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("flyExplosives", v510, new Date("2018-08-08T12:00:00Z"), dated), false);
  });
});

test("5.10's Birthday Challenges come at the quest login and give the emoticon, spray and, at all three, the back bling", () => withStore((dataDir) => {
  const store = createProfileStore(dataDir);
  inBuild(v510, () => {
    const session = openSession(store, "birthday510");
    athenaQuestLogin(session);
    const { profile } = session.profile("athena");
    const bundle = Object.values(profile.items).find((item) => item.templateId.toLowerCase() === "challengebundle:questbundle_birthday2018_br");
    assert.ok(Object.values(profile.items).some((item) => item.templateId.toLowerCase() === "challengebundleschedule:schedule_birthday2018_br"));
    const questIds = bundle.attributes.grantedquestinstanceids;
    assert.equal(questIds.length, 3);
    const holds = (templateId) => Object.values(profile.items).some((item) => item.templateId.toLowerCase() === templateId.toLowerCase());
    advanceAthenaObjectives(session, questIds.flatMap((id) => Object.keys(profile.items[id].attributes)
      .filter((name) => name.startsWith("completion_")).map((name) => ({ statName: name.slice("completion_".length), count: 100000 }))));
    assert.ok(holds("AthenaDance:emoji_birthday2018") && holds("AthenaDance:spid_040_birthday2018"));
    assert.ok(!holds("AthenaBackpack:bid_084_birthday2018"), "two of three");
    // "Play 14 matches": the match results count it (complete_athena).
    for (let match = 0; match < 14; match++) recordMatchProgress(session, 2, { place: 50, kills: 0 });
    assert.ok(holds("AthenaBackpack:bid_084_birthday2018"), "all three: the Birthday Cake back bling");
    session.commit();
  });
  inBuild(v50, () => {
    const session = openSession(store, "birthday50");
    athenaQuestLogin(session);
    assert.ok(!Object.values(session.profile("athena").profile.items).some((item) => /birthday/i.test(item.templateId)), "5.0 gives none");
  });
}));

test("5.10's shop: Season 5's history sells 5.10's cosmetics on 5.10 with their back blings, and not on 5.0", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season5.json", import.meta.url), "utf8")).days;
  const c510 = inBuild(v510, athenaCosmetics);
  const c50 = inBuild(v50, athenaCosmetics);
  const sold = new Set(history.flatMap((day) => [...day.featured, ...day.daily].map(([id]) => id)));
  assert.ok([...sold].every((id) => c510[id]), "only 5.10's cosmetics");
  assert.equal([...sold].filter((id) => !c50[id]).length, 16);
  assert.equal(history.find((day) => [...day.featured, ...day.daily].some(([id]) => id === "AthenaCharacter:cid_179_athena_commando_f_scuba")).date, "2018-07-27");
  // 9 November is the season's day 16, 27 July 2018: Reef Ranger and Wreck Raider.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 5: "2026-10-25" } };
  const featured = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront;
  for (const build of v510s) {
    const reef = featured(build).find(({ templateId }) => templateId === "AthenaCharacter:cid_179_athena_commando_f_scuba");
    assert.ok(reef, build);
    assert.deepEqual(reef.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_179_athena_commando_f_scuba", "AthenaBackpack:bid_082_scubafemale"]);
  }
  assert.ok(!featured(v50).some(({ templateId }) => !c50[templateId]), "5.0 sells none of them");
});

test("5.10's Save the World Birthday: its quests, the Birthday Llama for 1,000 Road Trip Tickets, the Sledgehammer and more Horde perks", () => {
  for (const build of v510s) {
    inBuild(build, () => {
      assert.ok(birthdayQuests.every((questId) => eventQuests().includes(questId)), build);
      assert.ok(birthdayQuests.every((questId) => eventQuestLine(birthday2018).has(questId)));
      const entries = storefronts(null, now).flatMap((storefront) => storefront.catalogEntries);
      const llama = entries.find((entry) => entry.itemGrants?.[0]?.templateId === birthdayLlama);
      assert.deepEqual([llama.prices[0].currencySubType, llama.prices[0].finalPrice], [roadTripTickets, 1000]);
      assert.ok(eventStoreOffers(now)[eventStorefront].some(({ templateId }) => templateId === "Hero:hid_commando_gunheadshot_m_v1_roadtrip_sr_t01"));
      assert.deepEqual(hordeAlertRewards("Theater_Horde_Final", 76).at(-1), ["AccountResource:reagent_alteration_generic", 300]);
    });
  }
  inBuild(v50, () => {
    assert.ok(!eventQuests().some((questId) => birthdayQuests.includes(questId)));
    assert.ok(!storefronts(null, now).flatMap((storefront) => storefront.catalogEntries).some((entry) => entry.itemGrants?.[0]?.templateId === birthdayLlama));
    assert.ok(!eventStoreOffers(now)[eventStorefront].some(({ templateId }) => templateId.startsWith("Hero:")));
    assert.deepEqual(hordeAlertRewards("Theater_Horde_Final", 76).at(-1), ["AccountResource:reagent_alteration_generic", 200]);
  });
});

test("5.10 gives every founder Warpaint and Rose Team Leader with their back blings; 5.0 and non-founders don't get them", () => withStore((dataDir) => {
  const founderCosmetics = ["AthenaCharacter:cid_095_athena_commando_m_founder", "AthenaCharacter:cid_096_athena_commando_f_founder",
    "AthenaBackpack:bid_032_foundermale", "AthenaBackpack:bid_033_founderfemale"];
  const locker = (build, accountId, founder) => inBuild(build, () => openSession(createProfileStore(dataDir, { ownsSaveTheWorld: () => founder }), accountId)
    .profile("athena").profile);
  const holds = (profile) => founderCosmetics.filter((id) => Object.values(profile.items).some((item) => item.templateId.toLowerCase() === id.toLowerCase()));
  assert.deepEqual(holds(locker(v510, "founder510", true)), founderCosmetics);
  assert.deepEqual(holds(locker(v5100, "founder5100", true)), founderCosmetics);
  assert.deepEqual(holds(locker(v510, "player510", false)), []);
  assert.deepEqual(holds(locker(v50, "founder50", true)), []);
}));
