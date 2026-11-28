import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventCard } from "../src/admin/eventschedules.js";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { blockEventOf, blockStates } from "../src/events/block.js";
import { buildPlaylists } from "../src/events/buildplaylists.js";
import { activeEventFlags, blockSlab, configureEvents, lobbySeason9, ltm14DaysOfSummer, ltmMash, ltmVigilante, ltmWax, unvaultingDay } from "../src/events/events.js";
import { eventDaysOf } from "../src/events/fourteendays.js";
import { fourteenDaysSummerCalendarEvent, fourteenDaysSummerFlagsNow, fourteenDaysSummerQuests, fourteenDaysSummerStates } from "../src/events/fourteendayssummer.js";
import { hordeRushFlagsNow } from "../src/events/horderush.js";
import { hasLtm, isHeldLtm, ltmOn, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { season9Phase1, season9Phase2 } from "../src/events/talesofbeyond.js";
import { wargamesDailyQuests, wargamesFlag, wargamesGlobals, wargamesQuests } from "../src/events/wargames.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { teamsOfPlaylist } from "../src/matchmaking/service.js";
import { athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { storefronts } from "../src/store/catalog.js";
import { weeklyStorefront } from "../src/store/eventstore.js";
import { seasonOfBuild } from "../src/store/itemshop.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 9.30 (CL-7095426, Update v9.30, 18 June 2019), Season 9, on its own data (gamedata/7095426). Its paks hold its
// content updates too: the 14 Days of Summer (its challenges, the daily unvaulted weapons, its modes and Save the World's
// summer quests), Shortcut and Meltdown, and the Weekly Store's Astro Bat 9000 and 4th of July heroes.
const v930 = "7095426";
const v921 = "6922310";
const userAgent930 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-9.30-CL-7095426";
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const season9 = { mode: "auto", seasonStarts: { 9: "2019-05-09" } };
const typesOf = (states) => states[0]?.events.map(({ eventType }) => eventType) ?? [];
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-930-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const templatesOf = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);

test("9.30 is known as 9.30 on its own data, Season 9's newest", () => {
  assert.equal(versionOf(v930), "9.30");
  assert.equal(allowedBuildList(["9.30"]).join(), v930);
  assert.equal(dataBuild(v930), v930);
  assert.equal(dataBuild(v921), v921, "9.21 keeps its own data");
  assert.equal(dataBuild("7200000"), v930);
  assert.equal(releasedOn(v930), Date.UTC(2019, 5, 18));
  assert.equal(buildOfSeason(9), v930);
  assert.equal(seasonName(9), "Season 9 (9.00 – 9.30)");
  const season = inBuild(v930, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [9, "BRSeason9", 100]);
  assert.equal(inBuild(v930, seasonOfBuild), 9);
  assert.deepEqual(inBuild(v930, () => battlePassOffers()).map(({ offerId, price }) => [offerId, price]),
    [["core_br_season9_battlepass", 950], ["core_br_season9_battlebundle", 2800], ["33E185A84ED7B64F2856E69AADFD092C", 150]]);
});

test("9.30's data: 90 more cosmetics, the 14 Days of Summer's challenges and Save the World's summer, Shortcut and Meltdown", () => {
  const [c930, c921] = [inBuild(v930, athenaCosmetics), inBuild(v921, athenaCosmetics)];
  assert.equal(Object.keys(c930).length, Object.keys(c921).length + 90);
  assert.ok(Object.keys(c921).every((id) => Object.hasOwn(c930, id)));
  assert.ok(Object.hasOwn(c930, "AthenaBackpack:bid_303_bananasmoothie"));
  inBuild(v930, () => {
    assert.ok(getItem("Schematic:sid_sniper_explosivebow_sr_ore_t01"), "the Boom Bow");
    assert.ok(getItem("Schematic:sid_blunt_light_retroscifi_sr_ore_t01"), "the Astro Bat 9000");
    assert.ok(getQuest("summerquest_2019_complete_all"));
    assert.ok(getQuest("endurancewave30theater01"), "Storm Shield Endurance's quests");
  });
  assert.equal(inBuild(v921, () => getQuest("summerquest_2019_complete_all")), undefined);
});

test("the 14 Days of Summer Challenges: one with the bundle, one more each day from 25 June, all 14 for the Banana Smoothie", () => {
  inBuild(v930, () => {
    const schedule = athenaChallengeSchedules().schedule_14daysofsummer;
    assert.equal(schedule.eventName, ltm14DaysOfSummer);
    const bundle = athenaChallengeBundles().questbundle_14daysofsummer;
    assert.equal(bundle.quests.length, 14);
    assert.equal(bundle.quests.filter(({ grantWithBundle }) => grantWithBundle).length, 1);
    assert.deepEqual(bundle.completionSteps.map(({ count, rewards }) => [count, rewards[0].templateId]),
      [[-1, "AthenaBackpack:bid_303_bananasmoothie"]]);
  });
  withConfig(season9, () => {
    assert.deepEqual(inBuild(v930, () => fourteenDaysSummerFlagsNow(at("2019-06-25T12:00:00Z"))), [], "from 9 AM Eastern");
    assert.deepEqual(typesOf(inBuild(v930, () => fourteenDaysSummerStates(at("2019-06-25T13:00:00Z")))),
      [ltm14DaysOfSummer, fourteenDaysSummerCalendarEvent, unvaultingDay(1)]);
    assert.deepEqual(typesOf(inBuild(v930, () => fourteenDaysSummerStates(at("2019-07-08T14:00:00Z")))),
      [ltm14DaysOfSummer, fourteenDaysSummerCalendarEvent, unvaultingDay(14)]);
    assert.deepEqual(typesOf(inBuild(v930, () => fourteenDaysSummerStates(at("2019-07-12T12:00:00Z")))),
      [ltm14DaysOfSummer, fourteenDaysSummerCalendarEvent], "no weapon unvaulted after the fourteenth day");
    assert.deepEqual(inBuild(v930, () => fourteenDaysSummerFlagsNow(at("2019-07-16T12:00:00Z"))), []);
    assert.deepEqual(inBuild(v921, () => fourteenDaysSummerFlagsNow(at("2019-06-27T12:00:00Z"))), [], "9.21 has none of it");
    assert.equal(inBuild(v930, () => eventDaysOf(ltm14DaysOfSummer, at("2019-06-27T14:00:00Z"))), 2);
  });
  assert.deepEqual(season4Flag(ltm14DaysOfSummer).builds, [7095426, 7095426]);
  assert.deepEqual(season4Flag(unvaultingDay(9)).builds, [7095426, 7095426]);
  assert.deepEqual(eventCard("fourteenDaysSummer").ranges, [[7095426, 7095426]]);
  withConfig({ mode: "auto", seasonStarts: { 9: replayDaysAgo(48) } }, () => withSession(v930, "summer930", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:schedule_14daysofsummer"));
    assert.ok(templates.includes("ChallengeBundle:questbundle_14daysofsummer"));
    assert.ok(templates.includes("Quest:quest_br_fds_dance_beachparties"));
  }));
});

test("Save the World's summer quests: Complete All and one daily a day, in its objectives' order", () => {
  withConfig(season9, () => {
    assert.deepEqual(inBuild(v930, () => fourteenDaysSummerQuests(at("2019-06-24T12:00:00Z"))), []);
    assert.deepEqual(inBuild(v930, () => fourteenDaysSummerQuests(at("2019-06-27T14:00:00Z"))),
      ["summerquest_2019_complete_all", "summerquest_2019_fetch_water", "summerquest_2019_search_ice", "summerquest_2019_kill_melee"]);
    const july4 = inBuild(v930, () => fourteenDaysSummerQuests(at("2019-07-04T14:00:00Z")));
    assert.equal(july4.at(-1), "summerquest_2019_light_fireworks", "Light'em Up on 4 July");
    assert.equal(inBuild(v930, () => fourteenDaysSummerQuests(at("2019-07-10T14:00:00Z"))).length, 15);
  });
});

test("the 14 Days of Summer's modes, each by its day; Content Update v9.30 #3's rotation from 9 July", () => {
  const dated = { ltmOriginalDates: true };
  const days = [["teamSplashdown", "2019-06-25T14:00:00Z"], ["tagSquads", "2019-06-25T14:00:00Z"], ["useWithCareDuos", "2019-06-26T14:00:00Z"],
    ["teamRumbleSiphon", "2019-06-27T14:00:00Z"], ["buildersParadiseSquads", "2019-06-27T14:00:00Z"], ["wicksBountyDuos", "2019-06-28T14:00:00Z"],
    ["loadoutSwapSquads", "2019-06-30T14:00:00Z"], ["headshotsDuos", "2019-07-01T14:00:00Z"], ["heavyMetalSquads", "2019-07-02T14:00:00Z"],
    ["powerUpSolo", "2019-07-03T14:00:00Z"], ["strategicStructuresSquads", "2019-07-04T14:00:00Z"], ["teamRumbleLava", "2019-07-05T14:00:00Z"],
    ["leaveNoneBehindDuos", "2019-07-05T14:00:00Z"], ["rumbleSquads", "2019-07-06T14:00:00Z"], ["stormChasers", "2019-07-07T14:00:00Z"],
    ["tankBattleSquads", "2019-07-08T14:00:00Z"], ["highExplosivesSeason9Squads", "2019-07-10T12:00:00Z"], ["blitzSeason9Squads", "2019-07-10T12:00:00Z"]];
  for (const [id, now] of days) {
    assert.equal(hasLtm(id, v930), true, id);
    assert.equal(ltmOn(id, v930, dated, at(now)), true, `${id} on its day`);
    assert.equal(ltmOn(id, v930, dated, at("2019-06-20T12:00:00Z")), false, `${id} before the event`);
  }
  assert.equal(ltmOn("teamRumbleSiphon", v930, dated, at("2019-07-01T14:00:00Z")), false, "Siphon's days are 3 to 6, 9 and 10");
  assert.equal(ltmOn("teamSplashdown", v930, {}, at("2019-06-20T12:00:00Z")), true, "on by default");
  assert.equal(ltmOn("classicSeason9Squads", v930, {}, at("2019-06-20T12:00:00Z")), false, "the rotation is off by default");
  assert.equal(hasLtm("teamSplashdown", v921), false);
  assert.equal(hasLtm("solidGoldSeason9Squads", v930), false, "9.30's Playlist_SolidGold_* are The Blues");
  assert.equal(hasLtm("solidGoldSeason9Squads", v921), true);
  assert.equal(Object.hasOwn(buildPlaylists[v930], "Playlist_SolidGold_Duos"), false);
  assert.equal(Object.hasOwn(buildPlaylists[v921], "Playlist_SolidGold_Duos"), true, "9.21's held playlists are as they were");
  assert.equal(playlistIdOfName("playlist_bison_respawn", v930), 1039);
  assert.deepEqual(teamsOfPlaylist(1039, v930), { maxTeamCount: 2, maxTeamSize: 20, maxSquadSize: 4 });
  assert.deepEqual(teamsOfPlaylist(1043, v930), { maxTeamCount: 48, maxTeamSize: 4, maxSquadSize: 4 });
  assert.deepEqual(teamsOfPlaylist(1024, v930), { maxTeamCount: 20, maxTeamSize: 2, maxSquadSize: 2 });
  for (const id of ["fiftyFiftySeason9", "triosSeason9", "wicksBountySquads", "teamRumbleSeason9", "swordFightSeason9Squads", "hordeRush",
    "arenaSolo", "tournamentS9Solo", "creative"]) {
    assert.equal(hasLtm(id, v930), true, id);
  }
  assert.equal(ltmOn("hordeRush", v930, dated, at("2019-06-19T12:00:00Z")), true, "Horde Rush's last days are 9.30's");
  for (const id of ["endgame", "foodFight"]) assert.deepEqual([hasLtm(id, v930), isHeldLtm(id, v930)], [true, true], id);
});

test("Season 9's events run on to 9.30 with its four returning Block levels", () => {
  const flags = activeEventFlags(v930);
  for (const flag of [lobbySeason9, wargamesFlag, season9Phase1, season9Phase2]) assert.ok(flags.includes(flag), flag);
  assert.equal(flags.includes(ltm14DaysOfSummer), false, "the 14 Days of Summer are dated");
  assert.equal(blockEventOf(v930)?.id, "block930");
  assert.deepEqual(eventCard("block930").ranges, [[7095426, 7095426]]);
  withConfig(season9, () => {
    for (const [day, slab] of [["05-09", 1], ["06-18", 1], ["06-24", 1], ["06-25", 2], ["07-01", 2],
      ["07-02", 3], ["07-08", 3], ["07-09", 4]]) {
      const states = inBuild(v930, () => blockStates(at(`2019-${day}T00:00:00Z`)));
      assert.deepEqual(typesOf(states), [blockSlab(slab)], day);
    }
  });
  assert.equal(blockEventOf(v921)?.id, "block920");
  for (const id of ["season9Lobby", "wargames", "talesOfBeyond"]) assert.deepEqual(eventCard(id).ranges, [[6337466, 7095426]], id);
  assert.deepEqual(eventCard("stellarHorizon").ranges, [[6822798, 7095426]]);
  assert.deepEqual(season4Flag(ltmWax).builds, [6428087, 7095426]);
  assert.deepEqual(season4Flag(ltmVigilante).builds, [6573057, 7095426]);
  assert.deepEqual(season4Flag(ltmMash).builds, [6922310, 7095426]);
  withConfig(season9, () => {
    assert.deepEqual(inBuild(v930, () => hordeRushFlagsNow(at("2019-06-19T12:00:00Z"))).includes(ltmMash), true);
  });
});

test("9.30's Wargames: Shortcut and Meltdown join; RiotCity isn't given; 9.21's unchanged", () => {
  const tags = (build) => wargamesGlobals(build).filter((line) => line.startsWith("+")).map((line) => line.split("=")[1]);
  assert.deepEqual(tags(v930), ["Stat.Mission.IronCity.Pods", "Stat.Mission.IronCity.MStorm", "Stat.Mission.IronCity.Tiki",
    "Stat.Mission.IronCity.Saucer", "Stat.Mission.IronCity.TeleBomb", "Stat.Mission.IronCity.TpRifts", "Stat.Mission.IronCity.AntiShield"]);
  assert.deepEqual(tags(v921), ["Stat.Mission.IronCity.Pods", "Stat.Mission.IronCity.MStorm", "Stat.Mission.IronCity.Tiki",
    "Stat.Mission.IronCity.Saucer", "Stat.Mission.IronCity.TeleBomb"]);
  const quests = inBuild(v930, wargamesQuests);
  for (const id of ["wargames_quest_wargame_tprifts", "wargames_quest_wargame_overload", "wargames_visibilityquest_wargame_tprifts"]) {
    assert.ok(quests.includes(id), id);
  }
  assert.equal(quests.some((id) => id.includes("riotcity")), false);
  const dailies = inBuild(v930, () => wargamesDailyQuests("twine"));
  assert.ok(dailies.some((id) => id.startsWith("wargames_dailyquest_tprifts_")));
  assert.ok(dailies.some((id) => id.startsWith("wargames_dailyquest_overload_")));
  assert.equal(dailies.some((id) => id.startsWith("wargames_dailyquest_riotcity_")), false);
});

test("9.30's Weekly Store: the Astro Bat 9000 from 27 June, the 4th of July heroes from 4 July", () => {
  const offers = (build, now) => (inBuild(build, () => storefronts(null, at(now))).find(({ name }) => name === weeklyStorefront)?.catalogEntries ?? [])
    .map(({ itemGrants, prices }) => [itemGrants[0].templateId, prices[0].finalPrice]);
  const bat = "Schematic:sid_blunt_light_retroscifi_sr_ore_t01";
  const heroes = ["Hero:hid_commando_guntough_f_4thjuly_sr_t01", "Hero:hid_constructor_hammerplasma_4thjuly_sr_t01",
    "Hero:hid_outlander_010_m_4thjuly_sr_t01"];
  withConfig(season9, () => {
    assert.ok(offers(v930, "2019-06-15T12:00:00Z").some(([id]) => id === "Schematic:sid_pistol_retroscifi_sr_ore_t01"));
    assert.equal(offers(v930, "2019-06-22T12:00:00Z").some(([id]) => id === bat), false);
    assert.deepEqual(offers(v930, "2019-06-28T12:00:00Z").filter(([id]) => id === bat), [[bat, 1680]]);
    assert.deepEqual(offers(v930, "2019-07-05T12:00:00Z").filter(([id]) => heroes.includes(id)).map(([id, price]) => [id, price]),
      heroes.map((id) => [id, 2800]));
    assert.equal(offers(v930, "2019-07-12T12:00:00Z").some(([id]) => id === bat || heroes.includes(id)), false);
    assert.equal(offers(v921, "2019-06-28T12:00:00Z").some(([id]) => id === bat), false, "9.21's Weekly Store is as it was");
  });
});

test("9.30's endpoints: content-controls' rules and athena's SetContextTutorialInformation", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Summer930Player");
    const headers = { "User-Agent": userAgent930, Authorization: `bearer ${player.token}` };
    const rules = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: `/content-controls/${player.accountId}/rules/namespaces/fn`, headers });
    assert.equal(rules.status, 200);
    for (const key of ["result", "namespaceSetting", "userSetting"]) {
      assert.equal(rules.body.data[key].allowedToMakePurchases, true, key);
      assert.equal(rules.body.data[key].playtimeReportingFrequency, "none", key);
      assert.equal(rules.body.data[key].purchaseReportingEnabled, false, key);
    }
    const unauthorized = await send({ host: "127.0.0.1", port: backend.port, method: "GET",
      path: `/content-controls/${player.accountId}/rules/namespaces/fn`, headers: { "User-Agent": userAgent930 } });
    assert.equal(unauthorized.status, 401);

    const command = (body) => send({ host: "127.0.0.1", port: backend.port, method: "POST",
      path: `/fortnite/api/game/v2/profile/${player.accountId}/client/SetContextTutorialInformation?profileId=athena&rvn=-1`,
      headers: { ...headers, "Content-Type": "application/json" } }, JSON.stringify(body));
    const set = await command({ index: 9, count: 3 });
    assert.equal(set.status, 200);
    const changes = set.body.profileChanges.map((change) => change.changeType === "fullProfileUpdate"
      ? { name: "context_tutorial_9", value: change.profile.stats.attributes.context_tutorial_9 } : change);
    assert.ok(changes.some(({ name, value }) => name === "context_tutorial_9" && value === 3), JSON.stringify(set.body.profileChanges).slice(0, 300));
    const bad = await command({ index: 40, count: 1 });
    assert.equal(bad.status, 200);
    assert.equal(bad.body.profileChanges.some(({ name }) => name === "context_tutorial_40"), false);
  } finally {
    backend.close();
  }
});
