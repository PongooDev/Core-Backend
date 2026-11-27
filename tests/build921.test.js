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
import { activeEventFlags, blockSlab, configureEvents, lobbySeason9, ltmMash, ltmVigilante, ltmWax } from "../src/events/events.js";
import { hordeRushCalendarEvent, hordeRushFlagsNow, hordeRushStates } from "../src/events/horderush.js";
import { hasLtm, isHeldLtm, ltmFrontEndPlaylists, ltmOn, ltmPlaylistTag, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { season9Phase1, season9Phase2 } from "../src/events/talesofbeyond.js";
import { wargamesDailyQuests, wargamesFlag, wargamesGlobals, wargamesQuests } from "../src/events/wargames.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { dataBuild } from "../src/gamedata/read.js";
import { botsInMode, noBotModes } from "../src/matchmaking/botmodes.js";
import { teamsOfPlaylist } from "../src/matchmaking/service.js";
import { athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { playlistInformationFor } from "../src/services/content/playlistimages.js";
import { storefronts } from "../src/store/catalog.js";
import { eventStorefront, weeklyStorefront } from "../src/store/eventstore.js";
import { seasonOfBuild } from "../src/store/itemshop.js";

// Fortnite 9.21 (CL-6922310, Update v9.21, 12 June 2019), Season 9, on its own data (gamedata/6922310: 9.20's but one
// Fortbyte quest). Season 9's Battle Pass, lobby, Fortbytes, Wargames, Tales of Beyond, Beyond the Stellar Horizon, Arena,
// Sword Fight and the Block's 9.20 builds run on; its own: Horde Rush and its challenges, Save the World's Quantum Countdown
// and the Plasmatron 9000 in the Weekly Store.
const v921 = "6922310";
const v920 = "6822798";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-921-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const templatesOf = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);

test("9.21 is known as 9.21 on its own data, Season 9's newest", () => {
  assert.equal(versionOf(v921), "9.21");
  assert.equal(allowedBuildList(["9.21"]).join(), v921);
  assert.equal(dataBuild(v921), v921);
  assert.equal(dataBuild(v920), v920, "9.20 keeps its own data");
  assert.equal(dataBuild("7000000"), v921);
  assert.equal(releasedOn(v921), Date.UTC(2019, 5, 12));
  assert.equal(buildOfSeason(9), "7095426", "9.30 is Season 9's newest");
  assert.equal(seasonName(9), "Season 9 (9.00 – 9.30)");
  const season = inBuild(v921, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [9, "BRSeason9", 100]);
  assert.equal(inBuild(v921, seasonOfBuild), 9);
  assert.deepEqual(inBuild(v921, () => battlePassOffers()).map(({ offerId, price }) => [offerId, price]),
    [["core_br_season9_battlepass", 950], ["core_br_season9_battlebundle", 2800], ["33E185A84ED7B64F2856E69AADFD092C", 150]]);
});

test("9.21's data is 9.20's but the first Rooster Fortbyte stage, whose next stage is now a reward", () => {
  const [c921, c920] = [inBuild(v921, athenaCosmetics), inBuild(v920, athenaCosmetics)];
  assert.deepEqual(Object.keys(c921).sort(), Object.keys(c920).sort());
  assert.equal(Object.keys(c921).length, 1889);
  const [q921, q920] = [inBuild(v921, () => getAthenaQuest("quest_br_s9_rooster_collectglyphs_01_a")),
    inBuild(v920, () => getAthenaQuest("quest_br_s9_rooster_collectglyphs_01_a"))];
  assert.deepEqual(q921.rewards.map(({ templateId }) => templateId), ["AthenaBackpack:bid_261_rooster", "Quest:quest_br_s9_rooster_collectglyphs_01_b"]);
  assert.deepEqual(q920.hiddenRewards.map(({ templateId }) => templateId), ["Quest:quest_br_s9_rooster_collectglyphs_01_b"]);
  assert.ok(inBuild(v921, () => getItem("Schematic:sid_pistol_retroscifi_sr_ore_t01")), "the Plasmatron 9000");
});

test("Horde Rush: 9.21's own, on by default and in the lobby, one squad of 4, no player bots; by its dates 13 to 19 June", () => {
  const dated = { ltmOriginalDates: true };
  assert.equal(hasLtm("hordeRush", v921), true);
  assert.equal(hasLtm("hordeRush", v920), false, "9.20's paks hold the asset, but the mode is 9.21's");
  assert.equal(isHeldLtm("hordeRush", v921), false);
  assert.equal(ltmOn("hordeRush", v921, {}, at("2019-06-12T12:00:00Z")), true, "on by default");
  assert.equal(ltmOn("hordeRush", v921, { matchmakingModes: { hordeRush: false } }, at("2019-06-14T12:00:00Z")), false, "off by its switch");
  assert.equal(ltmOn("hordeRush", v921, dated, at("2019-06-12T12:00:00Z")), false);
  assert.equal(ltmOn("hordeRush", v921, dated, at("2019-06-13T00:00:00Z")), true);
  assert.equal(ltmOn("hordeRush", v921, dated, at("2019-06-19T23:00:00Z")), true);
  assert.equal(ltmOn("hordeRush", v921, dated, at("2019-06-20T12:00:00Z")), false);
  assert.equal(playlistIdOfName("playlist_mash_squads", v921), 514);
  assert.deepEqual(teamsOfPlaylist(514, v921), { maxTeamCount: 1, maxTeamSize: 4, maxSquadSize: 4 });
  assert.equal(ltmPlaylistTag(514, v921), "Athena.Playlist.Mash");
  const lobby = ltmFrontEndPlaylists(v921, {}, at("2019-06-14T12:00:00Z")).find(({ name }) => name === "Playlist_Mash_Squads");
  assert.deepEqual([lobby?.enabled, lobby?.ltm.advertise], [true, "New"]);
  assert.equal(ltmFrontEndPlaylists(v920, {}, at("2019-06-14T12:00:00Z")).some(({ name }) => name === "Playlist_Mash_Squads"), false);
  assert.ok(noBotModes.has("hordeRush"));
  assert.equal(botsInMode({}, "hordeRush"), false);
  // #446: the mode select tile is Epic's own, not the default picture.
  assert.deepEqual(playlistInformationFor(v921).playlist_info.playlists.find((entry) => entry.playlist_name === "Playlist_Mash_Squads"), {
    image: "https://cdn2.unrealengine.com/Fortnite/fortnite-game/playlistinformation/09BR_LTM_HordeRush_Mode_Tile-1024x512-a844840eb58db868b6abfbe18fc8a8f483e18c60.jpg",
    playlist_name: "Playlist_Mash_Squads", special_border: "None", _type: "FortPlaylistInfo" });
});

test("9.21's other modes: 9.20's run on, Sword Fight by its switches", () => {
  for (const id of ["fiftyFiftySeason9", "playgroundV2", "creative"]) assert.equal(ltmOn(id, v921, {}, at("2019-06-14T12:00:00Z")), true, id);
  for (const id of ["swordFightSeason9Squads", "triosSeason9", "wicksBountySquads", "teamRumbleSeason9", "arenaSolo", "arenaDuos", "tournamentS9Solo"]) {
    assert.equal(hasLtm(id, v921), true, id);
  }
  assert.equal(ltmOn("swordFightSeason9Squads", v921, { ltmOriginalDates: true }, at("2019-06-14T12:00:00Z")), false, "9.20's rotation ended on 9.21's day");
  assert.equal(ltmOn("swordFightSeason9Solo", v921, { matchmakingModes: { swordFightSeason9Solo: true } }, at("2019-06-14T12:00:00Z")), true);
  for (const id of ["endgame", "foodFight"]) assert.deepEqual([hasLtm(id, v921), isHeldLtm(id, v921)], [true, true], id);
});

test("the Horde Rush Challenges: 9.21's schedule, served 13 to 19 June on Season 9's replay, given at quest login", () => {
  inBuild(v921, () => {
    const schedule = athenaChallengeSchedules().schedule_ltm_mash;
    assert.equal(schedule.eventName, ltmMash);
    const bundle = athenaChallengeBundles().questbundle_ltm_mash;
    assert.equal(bundle.quests.length, 7);
    assert.ok(bundle.quests.every(({ grantWithBundle }) => grantWithBundle));
    assert.deepEqual(bundle.completionSteps.map(({ count, rewards }) => [count, rewards[0].templateId]), [[7, "AthenaItemWrap:wrap_079_mash"]]);
  });
  withConfig(season9, () => {
    assert.deepEqual(typesOf(inBuild(v921, () => hordeRushStates(at("2019-06-13T00:00:00Z")))), [ltmMash, hordeRushCalendarEvent]);
    assert.deepEqual(typesOf(inBuild(v921, () => hordeRushStates(at("2019-06-19T23:00:00Z")))), [ltmMash, hordeRushCalendarEvent]);
    assert.deepEqual(inBuild(v921, () => hordeRushFlagsNow(at("2019-06-12T12:00:00Z"))), []);
    assert.deepEqual(inBuild(v921, () => hordeRushFlagsNow(at("2019-06-20T12:00:00Z"))), []);
    assert.deepEqual(inBuild(v920, () => hordeRushFlagsNow(at("2019-06-14T12:00:00Z"))), [], "9.20 has no mode for them");
  });
  withConfig({ ...season9, season4Flags: { overrides: { [ltmMash]: "on" } } }, () => {
    assert.ok(inBuild(v921, () => activeEventFlags()).includes(ltmMash), "switched on, always served");
  });
  assert.deepEqual(season4Flag(ltmMash).builds, [6922310, 7095426]);
  assert.deepEqual(eventCard("hordeRush").ranges, [[6922310, 7095426]]);
  withConfig({ mode: "auto", seasonStarts: { 9: replayDaysAgo(36) } }, () => withSession(v921, "mash921", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:schedule_ltm_mash"));
    assert.ok(templates.includes("ChallengeBundle:questbundle_ltm_mash"));
    assert.ok(templates.includes("Quest:quest_br_mash_headshots"));
  }));
});

test("Season 9's events run on 9.21; its Block is 9.20's, Firebase Omega, then Mythical Mayhem", () => {
  const flags = activeEventFlags(v921);
  for (const flag of [lobbySeason9, wargamesFlag, season9Phase1, season9Phase2]) assert.ok(flags.includes(flag), flag);
  assert.equal(flags.includes(ltmMash), false, "the Horde Rush Challenges are dated");
  assert.equal(blockEventOf(v921)?.id, "block920");
  withConfig(season9, () => {
    assert.deepEqual(typesOf(inBuild(v921, () => blockStates(at("2019-06-08T12:00:00Z")))), [blockSlab(1)]);
    assert.deepEqual(typesOf(inBuild(v921, () => blockStates(at("2019-06-14T12:00:00Z")))), [blockSlab(2)]);
  });
  for (const id of ["season9Lobby", "wargames", "talesOfBeyond"]) assert.deepEqual(eventCard(id).ranges, [[6337466, 7095426]], id);
  assert.deepEqual(eventCard("stellarHorizon").ranges, [[6822798, 7095426]]);
  assert.deepEqual(season4Flag(ltmWax).builds, [6428087, 7095426]);
  assert.deepEqual(season4Flag(ltmVigilante).builds, [6573057, 7095426]);
});

test("9.21's Wargames: Quantum Countdown joins Invasion; 9.20's unchanged", () => {
  const tags = (build) => wargamesGlobals(build).filter((line) => line.startsWith("+")).map((line) => line.split("=")[1]);
  assert.deepEqual(tags(v921), ["Stat.Mission.IronCity.Pods", "Stat.Mission.IronCity.MStorm", "Stat.Mission.IronCity.Tiki",
    "Stat.Mission.IronCity.Saucer", "Stat.Mission.IronCity.TeleBomb"]);
  assert.equal(tags(v920).includes("Stat.Mission.IronCity.TeleBomb"), false);
  const quests = inBuild(v921, wargamesQuests);
  assert.ok(quests.includes("wargames_quest_wargame_telebomb"));
  assert.ok(quests.includes("wargames_visibilityquest_wargame_telebomb"));
  assert.equal(inBuild(v920, wargamesQuests).some((id) => id.includes("telebomb")), false);
  assert.ok(inBuild(v921, () => wargamesDailyQuests("twine")).some((id) => id.startsWith("wargames_dailyquest_telebomb_")));
});

test("9.21's Weekly Store: Archeolo-Jess to 13 June, then the Plasmatron 9000 to 20 June; the Event Store and Sci-Fi Llama stay", () => {
  const offers = (build, store, now) => (inBuild(build, () => storefronts(null, at(now))).find(({ name }) => name === store)?.catalogEntries ?? [])
    .map(({ itemGrants, prices }) => [itemGrants[0].templateId, prices[0].finalPrice]);
  const plasmatron = "Schematic:sid_pistol_retroscifi_sr_ore_t01";
  const jess = "Hero:hid_outlander_zoneharvest_blockbuster_sr_t01";
  withConfig(season9, () => {
    assert.ok(offers(v921, weeklyStorefront, "2019-06-10T12:00:00Z").some(([id]) => id === jess));
    assert.deepEqual(offers(v921, weeklyStorefront, "2019-06-15T12:00:00Z").filter(([id]) => id === plasmatron), [[plasmatron, 1680]]);
    assert.equal(offers(v921, weeklyStorefront, "2019-06-15T12:00:00Z").some(([id]) => id === jess), false);
    assert.equal(offers(v921, weeklyStorefront, "2019-06-21T12:00:00Z").some(([id]) => id === plasmatron), false);
    assert.equal(offers(v920, weeklyStorefront, "2019-06-15T12:00:00Z").some(([id]) => id === plasmatron), false, "9.20's Weekly Store is as it was");
    assert.ok(offers(v921, eventStorefront, "2019-06-15T12:00:00Z").some(([id]) => id === "Schematic:sid_floor_tar_vr_t01"));
    const llamas = inBuild(v921, () => storefronts(null, at("2019-06-15T12:00:00Z"))).flatMap(({ catalogEntries }) => catalogEntries)
      .filter(({ offerId }) => /^core_event_(military|scifi)2019_llama$/.test(offerId)).map(({ offerId }) => offerId);
    assert.deepEqual([...new Set(llamas)], ["core_event_scifi2019_llama"]);
  });
});
