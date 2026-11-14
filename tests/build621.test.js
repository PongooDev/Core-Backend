import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { activeEventFlags, configureEvents, cramSession2018, fortnitemares, fortnitemares2018, fortnitemaresPart4, halloweenBattleBus, hasEventEnded,
  isEventActive, islandCrack, islandPoi, islandRune, lobbySeason6, lobbySeason6Halloween, ltmFortnitemares, ltmLilKevin } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { founderHeroes2018, owedFounderHeroes } from "../src/events/fortnitemares2018.js";
import { islandStates } from "../src/events/island.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaLootTables, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { addSeasonXp, advanceAthenaObjectives, athenaQuestLogin, grantCosmetic, recordMatchProgress, seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { isStylesCategory, settleChallengeSchedules } from "../src/profiles/challenges.js";
import { heldGiftBoxes } from "../src/profiles/giftboxes.js";
import { buildOfSeason, buyBattlePass } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { contentPage } from "../src/services/content/pages.js";
import { createSettingsStore } from "../src/settings/store.js";
import { findOffer } from "../src/store/catalog.js";
import { affiliateRuntimeOptions } from "../src/store/creators.js";
import { eventStoreInstanceNow, eventStoreOffers, fortnitemares2018EventItems } from "../src/store/eventstore.js";
import { bundledBackBlings, itemShopOffers } from "../src/store/itemshop.js";
import { hasShowdown, showdownTicket, tournamentInformationFor } from "../src/tournaments/showdown.js";
import { createTournamentStore, tournamentPlaylists } from "../src/tournaments/store.js";
import { hexsylvania } from "../src/world/hexsylvania.js";
import { perkRewardPool } from "../src/world/theaters.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 6.21 (Update v6.21, 1 November 2018, Season 6): one build, CL-4526925, on its own data (gamedata/4526925). It
// keeps 6.20's Fortnitemares (the Cube Monsters' modes, now needing the calendar's POI0, the Fortnitemares Challenges in
// their gift box, Save the World's Part 1) and 6.00's to 6.10's Season 6, and adds the Lil' Kev challenges, the Balloons,
// Dim Mak Igor in the Event Store, the Perk Caches and every perk rarity from mid-Plankerton, and fourteen cosmetics in the
// shop's history.
const v621 = "4526925";
const v620 = "4497486";
const v610 = "4480234";
const v602 = "4461277";
const v600 = "4402180";
const replay = { mode: "auto", seasonStarts: { 6: "2018-09-27" } };
const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 6: "2018-09-27" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const at = (iso) => new Date(iso);
const agentOf = (build, version = "6.21") => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "core-621-"));
const withSession = (build, name, run) => {
  const dir = tempDir();
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const held = (session, profileId = "athena") => Object.values(session.profile(profileId).profile.items).map(({ templateId }) => templateId);
const asBuild = (build, version = "6.21") => (port, urlPath, token, method = "GET", body) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agentOf(build, version), ...(token ? { Authorization: `bearer ${token}` } : {}) };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
};

test("6.21 is known, on its own data, in Season 6", () => {
  assert.equal(versionOf(v621), "6.21");
  assert.equal(allowedBuildList(["6.21"]).join(), v621);
  assert.equal(dataBuild(v621), v621);
  assert.equal(dataBuild("4510000"), v620, "a build between 6.20 and 6.21 plays on 6.20's");
  assert.equal(dataBuild(v620), v620, "6.20 keeps its own data");
  assert.equal(buildOfSeason(6), "4573096", "Season 6's newest data is 6.30's now (tests/build630.test.js)");
  assert.equal(seasonName(6), "Season 6 (6.00 – 6.30)");
  assert.equal(inBuild(v621, athenaSeason).seasonNumber, 6);
  assert.deepEqual({ ...inBuild(v621, athenaSeason), seasonRewards: null }, { ...inBuild(v620, athenaSeason), seasonRewards: null }, "AthenaSeason6's tiers are 6.20's");
});

test("6.21's data against 6.20's: twenty-seven cosmetics and none gone, the Balloons in the loot, Save the World's new heroes, weapons and Perk Caches", () => {
  const [c621, c620] = [inBuild(v621, athenaCosmetics), inBuild(v620, athenaCosmetics)];
  const added = Object.keys(c621).filter((id) => !c620[id]);
  assert.equal(added.length, 27);
  assert.deepEqual(Object.keys(c620).filter((id) => !c621[id]), [], "Bunnymoon is in pakchunk0 now");
  for (const [id, name] of [["AthenaCharacter:cid_257_athena_commando_m_samuraiultra", "Shogun"], ["AthenaCharacter:cid_258_athena_commando_f_fuzzybearhalloween", "Spooky Team Leader"],
    ["AthenaCharacter:cid_262_athena_commando_m_madcommander", "Ruckus"], ["AthenaCharacter:cid_263_athena_commando_f_madcommander", "Mayhem"],
    ["AthenaCharacter:cid_264_athena_commando_m_animaljackets", "Growler"], ["AthenaCharacter:cid_265_athena_commando_f_animaljackets", "Flapjackie"],
    ["AthenaCharacter:cid_266_athena_commando_f_llamarider", "Yee-Haw!"], ["AthenaCharacter:cid_259_athena_commando_m_streetops", "Reflex"],
    ["AthenaBackpack:bid_147_lilkev", "Lil' Kev"], ["AthenaDance:eid_crazyfeet", "Crazy Feet"], ["AthenaGlider:glider_id_094_samuraiultra", "Kabuto"]]) {
    assert.equal(c621[id]?.name, name, id);
  }
  // Update v6.21's "Balloons added ... Can be found from floor loot, chests, Supply Drops, Supply Llamas, and Vending Machines".
  const loot = JSON.stringify(inBuild(v621, athenaLootTables));
  assert.ok(loot.includes("Athena_Balloons"));
  assert.equal(JSON.stringify(inBuild(v620, athenaLootTables)).includes("Athena_Balloons.Athena_Balloons"), false);
  assert.ok(inBuild(v621, () => getItem("Weapon:athena_balloons")));
  // Save the World: Dim Mak Igor, Part 2's two heroes and the Candy Corn LMG (Update v6.22's, already in the data), the
  // Perk Caches.
  for (const id of ["Hero:hid_ninja_018_sr_t01", "Hero:hid_ninja_019_sr_t01", "Hero:hid_outlander_018_sr_t01", "Schematic:sid_assault_lmg_halloween_sr_ore_t01",
    "CardPack:cardpack_cache_perk_sr", "WorldItem:cache_perk_r_pickup"]) {
    assert.ok(inBuild(v621, () => getItem(id)), id);
    assert.equal(inBuild(v620, () => getItem(id)), undefined, `${id} isn't 6.20's`);
  }
  assert.equal(inBuild(v621, () => getItem("WorldItem:cache_perk_r_pickup")).cardPackReward, "CardPack:cardpack_cache_perk_r");
  // The Deimos playlists' own mission generators are gone (MissionGen_Athena now).
  const generators = Object.keys(buildGameData(v621, "world", {}).missionGenerators);
  assert.equal(generators.some((id) => id.includes("MissionGen_AthenaEvent47")), false);
  assert.ok(Object.keys(buildGameData(v620, "world", {}).missionGenerators).some((id) => id.includes("MissionGen_AthenaEvent47")));
});

test("6.21's challenges: the Lil' Kev challenges while LTM_LilKevin is served, their back bling in Fortnitemares' gift box; Fortnitemares' parts as 6.20's, their rewards boxed", () => {
  const schedules = inBuild(v621, athenaChallengeSchedules);
  assert.deepEqual(schedules.schedule_ltm_lilkevin, { bundles: [{ bundle: "questbundle_ltm_lilkevin", unlockType: "OnScheduleGranted", unlockValue: 0 }],
    category: "Lil Kevin", cleanUpOnBundleCompletion: true, eventName: ltmLilKevin });
  assert.deepEqual(schedules.schedule_fortnitemares, inBuild(v620, athenaChallengeSchedules).schedule_fortnitemares);
  assert.deepEqual(Object.keys(schedules).filter((id) => !inBuild(v620, athenaChallengeSchedules)[id]), ["schedule_ltm_lilkevin"]);
  const bundles = inBuild(v621, athenaChallengeBundles);
  assert.deepEqual(bundles.questbundle_ltm_lilkevin.quests.map(({ quest }) => quest),
    ["quest_br_lilkevin_play_matches", "quest_br_lilkevin_gain_xp", "quest_br_lilkevin_outlive_opponents"]);
  for (const part of ["part1", "part2", "part3", "part4"]) {
    assert.equal(bundles[`questbundle_fortnitemares_${part}`].completionSteps[0].rewards[0].giftBox, "GiftBox:gb_fortnitemareschallenges", part);
  }
  assert.equal(inBuild(v620, athenaChallengeBundles).questbundle_fortnitemares_part1.completionSteps[0].rewards[0].giftBox, undefined, "6.20's named none");
  // "Complete 14 Fortnitemares challenges" counts the tokens held now (6.20's counted those acquired).
  assert.equal(inBuild(v621, () => getAthenaQuest("quest_fnm_completequests")).objectives[0].itemEvent, "HasItem");
  // The outfits' schedules are 6.20's.
  assert.ok(isStylesCategory(schedules.bundleschedule_styles_skulltrooper.category));
  withSession(v621, "kev621", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.ok(held(session).includes("ChallengeBundleSchedule:schedule_ltm_lilkevin"));
    assert.ok(held(session).includes("ChallengeBundleSchedule:schedule_fortnitemares"));
    for (const quest of ["quest_br_lilkevin_play_matches", "quest_br_lilkevin_gain_xp", "quest_br_lilkevin_outlive_opponents"]) {
      assert.ok(held(session).includes(`Quest:${quest}`), quest);
    }
    // Done (fifteen matches from the match results, 5,000 season XP gained, 500 opponents outlived from the gameserver's
    // quest manager), Lil' Kev comes in GB_FortnitemaresChallenges.
    for (let match = 0; match < 15; match += 1) recordMatchProgress(session, 2, { place: 40, kills: 0 });
    addSeasonXp(session, 5000);
    advanceAthenaObjectives(session, [{ statName: "ltm_lil_kevin_athena_outlive", count: 500 }]);
    assert.ok(held(session).includes("AthenaBackpack:bid_147_lilkev"));
    const boxes = heldGiftBoxes(session.profile("profile0").profile).map(([, item]) => item).filter((item) => item.templateId === "GiftBox:gb_fortnitemareschallenges");
    assert.equal(boxes.length, 1);
    assert.ok(JSON.stringify(boxes[0].attributes.lootList).includes("bid_147_lilkev"));
  });
  // 6.20 serves no LTM_LilKevin and has no such schedule.
  withSession(v620, "kev620", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(held(session).includes("ChallengeBundleSchedule:schedule_ltm_lilkevin"), false);
  });
  // The Fortnitemares parts still open by the files' days on Season 6's replay.
  withConfig(replay, () => withSession(v621, "fnm621", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const parts = (now) => {
      settleChallengeSchedules(session, seasonRewardFunctions(), now);
      return held(session).filter((id) => id.startsWith("ChallengeBundle:questbundle_fortnitemares")).length;
    };
    assert.equal(parts(at("2018-10-25T12:00:00Z")), 1);
    assert.equal(parts(at("2018-11-03T12:00:00Z")), 4);
  }));
});

test("6.21's event flags: 6.20's, POI0 (its Cube Monsters' spawners need it), Fortnitemares_Part4 and LTM_LilKevin; POI1, the crack and Part 2 by their switches", () => {
  assert.deepEqual(activeEventFlags(v621), ["EventFlag.Fortnitemares", "EventFlag.FortnitemaresPhase1", "EventFlag.ActiveMiniBosses", ltmFortnitemares,
    lobbySeason6Halloween, halloweenBattleBus, "POI0", fortnitemaresPart4, ltmLilKevin, "EventFlag.PassiveStorms", lobbySeason6]);
  assert.deepEqual(activeEventFlags(v620).filter((flag) => !activeEventFlags(v621).includes(flag)), []);
  assert.equal(activeEventFlags(v610).includes(islandPoi(0)), false, "6.10 is as it was");
  assert.equal(islandPoi(0), "POI0");
  for (const flag of ["POI0", "POI1", islandCrack]) assert.deepEqual(season4Flag(flag).builds, [Number(v620), 4543176], flag); // not 6.30's (tests/build630.test.js)
  assert.deepEqual(season4Flag(fortnitemaresPart4).builds, [Number(v621), Number(v621)], "gone from 6.22's paks");
  assert.deepEqual(season4Flag(ltmLilKevin).builds, [Number(v621), 4573096], "and on to 6.30 (tests/build622.test.js, tests/build630.test.js)");
  for (const flag of [ltmFortnitemares, lobbySeason6Halloween, halloweenBattleBus, "EventFlag.FortnitemaresPhase1", "EventFlag.FortnitemaresPhase2"]) {
    assert.deepEqual(season4Flag(flag).builds, [Number(v620), 4573096], flag);
  }
  for (const flag of [lobbySeason6, "EventFlag.SupplyDropGift", "EventFlag.BR_S5_RiskyReels_Event", "EventFlag.Blockbuster2018Phase4", "EventFlag.PassiveStorms"]) {
    assert.equal(season4Flag(flag).builds[1], 4573096, flag);
  }
  // The floating island's flags stop at 6.20: 6.21's BP_IslandScripting watches none of them.
  assert.equal(season4Flag(islandRune(8)).builds[1], Number(v620));
  withConfig(replay, () => assert.deepEqual(inBuild(v621, () => islandStates(at("2018-11-02T12:00:00Z"))), []));
  assert.equal(inBuild(v621, () => isEventActive(fortnitemares)), true);
  assert.equal(inBuild(v621, () => isEventActive(fortnitemares2018)), true);
  assert.equal(inBuild(v621, () => hasEventEnded(fortnitemares)), false);
  assert.equal(inBuild(v621, () => isEventActive(cramSession2018)), false);
  // The Butterfly by the admin's switches: POI0 off and POI1 on; Part 2's quest map; Lil' Kev off.
  withConfig({ mode: "auto", season4Flags: { overrides: { POI0: "off", POI1: "on", "EventFlag.FortnitemaresPhase2": "on", [ltmLilKevin]: "off" } } }, () => {
    const flags = activeEventFlags(v621);
    assert.ok(flags.includes("POI1") && flags.includes("EventFlag.FortnitemaresPhase2"));
    assert.equal(flags.includes("POI0") || flags.includes(ltmLilKevin), false);
    assert.equal(activeEventFlags(v610).includes("POI1"), false, "6.20's and 6.21's switch only");
  });
});

test("a 6.21 gameserver's calendar has POI0 among the active events, until the admin switches it off for the Butterfly", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Calendar621");
    const as = asBuild(v621);
    const events = async () => {
      const timeline = (await as(backend.port, "/fortnite/api/calendar/v1/timeline", token)).body;
      const [state] = timeline.channels["client-events"].states;
      return { types: state.activeEvents.map(({ eventType }) => eventType), flags: state.state.activeEventFlags };
    };
    let now = await events();
    assert.ok(now.types.includes("POI0") && now.flags.includes("POI0"), JSON.stringify(now));
    assert.ok(now.types.includes(ltmLilKevin));
    assert.equal((await post(backend.port, "/admin/api/events/flags", null, { flag: "POI0", state: "off" })).status, 200);
    assert.equal((await post(backend.port, "/admin/api/events/flags", null, { flag: "POI1", state: "on" })).status, 200);
    now = await events();
    assert.equal(now.types.includes("POI0"), false);
    assert.ok(now.types.includes("POI1"));
    // 6.10 never had either.
    const old = (await asBuild(v610, "6.10")(backend.port, "/fortnite/api/calendar/v1/timeline", token)).body.channels["client-events"].states[0];
    assert.equal(old.activeEvents.some(({ eventType }) => /^POI\d$/.test(eventType)), false);
  } finally {
    await backend.close();
  }
});

test("6.21's modes are 6.20's: Fortnitemares on by default to 4 November, the tournament playlists, the Disco Dominations by their switches", () => {
  const defaults = createSettingsStore(null).get();
  assert.deepEqual(ltmFrontEndPlaylists(v621, defaults), ltmFrontEndPlaylists(v620, defaults));
  assert.deepEqual([47, 48, 49, 231, 232, 59071, 59072, 59073, 58071, 202, 50, 35, 53, 36].map((id) => ltmOfPlaylist(id, v621)?.id),
    [47, 48, 49, 231, 232, 59071, 59072, 59073, 58071, 202, 50, 35, 53, 36].map((id) => ltmOfPlaylist(id, v620)?.id));
  for (const id of ["fortnitemares2018Solo", "fortnitemares2018Duos", "fortnitemares2018Squads", "fiftyFiftySeason6", "playgroundV2", "discoDomination602"]) {
    assert.equal(ltmOn(id, v621, defaults), true, id);
  }
  for (const id of ["discoDomination40Alt", "fortnitemaresShowSolo", "showdownSolo"]) assert.equal(ltmOn(id, v621, defaults), false, id);
  for (const id of ["gliderRedeploySolo"]) assert.equal(hasLtm(id, v621), false, id);
  for (const [name, id] of [["playlist_deimos_solo", 47], ["playlist_deimos_squadshow", 59073], ["playlist_disco_32_alt", 232]]) {
    assert.equal(playlistIdOfName(name, v621), id, name);
    assert.equal(parseBucket(`${v621}:0:NAE:${name}`, v621).playlistId, id, name);
  }
  assert.deepEqual(["solo", "duo", "squad"].map((size) => playlistTeamsOf(`${v621}:0:NAE:playlist_deimos_${size}`, v621).maxTeamSize), [1, 2, 4]);
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("fortnitemares2018Solo", v621, at("2018-11-04T17:59:00Z"), dated), true);
    assert.equal(inOriginalWindow("fortnitemares2018Solo", v621, at("2018-11-04T18:00:00Z"), dated), false, "Update v6.21's end, the Butterfly");
  });
  assert.deepEqual(tournamentPlaylists.slice(-6, -3).map(({ id, builds }) => [id, builds[1]]),
    [["fortnitemaresShowSolo", Number(v621)], ["fortnitemaresShowDuos", Number(v621)], ["fortnitemaresShowSquads", Number(v621)]]);
  assert.equal(hasShowdown(v621), true);
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    store.create({ name: "Butterfly Cup", playlist: "fortnitemaresShowSquads", ruleset: "soloShowdownJuly2018" }, at("2018-11-01T00:00:00Z"));
    assert.ok(showdownTicket({ playlistId: 59073, partySize: 4, build: v621 }, new Date(), store).event);
    assert.ok(JSON.stringify(tournamentInformationFor(v621, new Date(), store)).includes('"title_line_2":"Squads"'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a 6.21 client's hotfix lists the same modes as 6.20's", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Lobby621");
    const gameIni = async (build, version) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": agentOf(build, version), Authorization: `bearer ${token}` } })).body.toString().split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
    const lines = await gameIni(v621);
    assert.ok(lines.some((line) => line.includes("PlaylistName=Playlist_Deimos_Solo,") && line.includes("bEnabled=true")));
    assert.deepEqual(lines, await gameIni(v620, "6.20"));
  } finally {
    await backend.close();
  }
});

test("6.21's shop: its fourteen cosmetics on their days with their back blings; 6.20's days are as they were", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season6.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  const [c621, c620] = [inBuild(v621, athenaCosmetics), inBuild(v620, athenaCosmetics)];
  // The history holds 6.22's seventeen and 6.30's sixteen too (tests/build622.test.js, tests/build630.test.js); 6.21 is
  // shown its own.
  const c630 = inBuild("4573096", athenaCosmetics);
  assert.ok(history.every((day) => [...day.featured, ...day.daily].every(([id]) => c630[id])), "only 6.30's cosmetics");
  const own = [...new Set(history.flatMap((day) => [...day.featured, ...day.daily]).map(([id]) => id).filter((id) => !c620[id] && c621[id]))];
  assert.equal(own.length, 14);
  const days = (id) => history.filter((day) => [...day.featured, ...day.daily].some(([entry]) => entry === id)).map(({ date }) => date.slice(5));
  assert.deepEqual(days("AthenaCharacter:cid_258_athena_commando_f_fuzzybearhalloween"), ["11-02"]);
  assert.deepEqual(days("AthenaCharacter:cid_262_athena_commando_m_madcommander"), ["11-04", "11-05"]);
  assert.deepEqual(days("AthenaCharacter:cid_264_athena_commando_m_animaljackets"), ["11-09"]);
  assert.deepEqual(days("AthenaCharacter:cid_266_athena_commando_f_llamarider"), ["11-13"]);
  assert.deepEqual(days("AthenaCharacter:cid_257_athena_commando_m_samuraiultra"), ["11-18", "11-19"]);
  assert.deepEqual(days("AthenaDance:eid_crazyfeet"), ["11-22"]);
  assert.deepEqual(days("AthenaCharacter:cid_259_athena_commando_m_streetops"), [], "Reflex wasn't sold in Season 6");
  const nov4 = history.find(({ date }) => date === "2018-11-04");
  assert.deepEqual(nov4.featured, [["AthenaCharacter:cid_262_athena_commando_m_madcommander", 1200, { tile: 1, banner: "PickYourStyle" }],
    ["AthenaCharacter:cid_263_athena_commando_f_madcommander", 1200, { tile: 1, banner: "PickYourStyle" }],
    ["AthenaGlider:glider_id_091_madcommander", 1200, { tile: 2, banner: "CollectTheSet" }], ["AthenaPickaxe:pickaxe_id_117_madcommander", 800, { tile: 2, banner: "CollectTheSet" }]]);
  assert.equal(bundledBackBlings["AthenaCharacter:cid_257_athena_commando_m_samuraiultra"], "AthenaBackpack:bid_142_samuraiultra");
  assert.equal(bundledBackBlings["AthenaCharacter:cid_262_athena_commando_m_madcommander"], "AthenaBackpack:bid_143_madcommandermale");
  const featured = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRWeeklyStorefront;
  const ruckus = featured(v621, "2018-11-04T12:00:00Z").find(({ templateId }) => templateId === "AthenaCharacter:cid_262_athena_commando_m_madcommander");
  assert.deepEqual(ruckus.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_262_athena_commando_m_madcommander", "AthenaBackpack:bid_143_madcommandermale"]);
  assert.equal(ruckus.price, 1200);
  assert.deepEqual(featured(v621, "2018-11-18T12:00:00Z").map(({ title }) => title), ["Shogun", "Jawblade", "Kabuto"]);
  // 6.20 sells none of them.
  assert.equal(featured(v620, "2018-11-04T12:00:00Z").length, 0);
  const daily = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRDailyStorefront.map(({ templateId }) => templateId);
  assert.deepEqual(daily(v621, "2018-11-02T12:00:00Z").filter((id) => !c620[id]), ["AthenaCharacter:cid_258_athena_commando_f_fuzzybearhalloween"]);
  assert.deepEqual(daily(v620, "2018-11-02T12:00:00Z"), daily(v621, "2018-11-02T12:00:00Z").filter((id) => c620[id]));
});

test("6.21's Save the World: Fortnitemares Part 1 still, Dim Mak Igor in the Event Store, the Perk Caches, and every perk rarity from mid-Plankerton", () => {
  assert.deepEqual(inBuild(v621, eventQuests), inBuild(v620, eventQuests));
  assert.ok(inBuild(v621, hexsylvania), "Hexsylvania");
  assert.equal(inBuild(v621, () => findOffer("core_event_fortnitemares2018_llama"))?.price, 500);
  assert.equal(inBuild(v621, eventStoreInstanceNow), "Fortnitemares2018.STWSpecialEventStoreFront");
  const store = JSON.stringify(inBuild(v621, () => eventStoreOffers(at("2018-11-02T12:00:00Z"))));
  // 6.22's Dire (fromBuild) isn't 6.21's, though its data has him (tests/build622.test.js).
  for (const { templateId } of fortnitemares2018EventItems.filter(({ fromBuild }) => !fromBuild)) assert.ok(store.includes(templateId), templateId);
  assert.equal(store.includes("hid_ninja_019"), false);
  assert.ok(fortnitemares2018EventItems.some(({ templateId, price }) => templateId === "Hero:hid_ninja_018_sr_t01" && price === 2800));
  assert.equal(JSON.stringify(inBuild(v620, () => eventStoreOffers(at("2018-11-02T12:00:00Z")))).includes("hid_ninja_018"), false, "6.20's store as it was");
  // The Perk Caches (Core's contents: the cache's rarity of RE-PERK! and one PERK-UP! pack).
  assert.deepEqual(inBuild(v621, () => rollContents("CardPack:cardpack_cache_perk_vr")), [
    { templateId: "AccountResource:reagent_alteration_generic", quantity: 20 }, { templateId: "AccountResource:reagent_alteration_upgrade_vr", quantity: 10 }]);
  assert.deepEqual(inBuild(v621, () => rollContents("CardPack:cardpack_cache_perk_uc")).map(({ quantity }) => quantity), [10, 10]);
  // Mission rewards: from Mission_Select_T08 every RE-PERK! level and PERK-UP! rarity on 6.21; 6.20 and early Plankerton as 4.2.
  const perks = (build, tier) => inBuild(build, () => perkRewardPool(tier, [])).map(({ itemType }) => itemType.split("_alteration_")[1]);
  assert.deepEqual(perks(v621, "Mission_Select_T08"), ["generic_low", "generic_medium", "generic_high", "upgrade_uc", "upgrade_r", "upgrade_vr", "upgrade_sr"]);
  assert.deepEqual(perks(v621, "Mission_Select_T07"), ["generic_low", "upgrade_uc"]);
  assert.deepEqual(perks(v620, "Mission_Select_T08"), ["generic_low", "upgrade_uc"]);
  assert.deepEqual(perks(v620, "Mission_Select_T16"), ["generic_high", "upgrade_vr", "upgrade_sr"]);
  const weights = inBuild(v621, () => perkRewardPool("Mission_Select_T16", [])).reduce((sum, { weight }) => sum + weight, 0);
  assert.equal(Math.round(weights * 1000) / 1000, 3, "the same weights, split between them");
  // A founder's two heroes on 6.21 too.
  withSession(v621, "founder621", (session) => {
    const tracker = session.profile("profile0");
    tracker.addItem(crypto.randomUUID(), { templateId: "Token:founderspack_1", attributes: {}, quantity: 1 });
    assert.deepEqual(owedFounderHeroes(tracker.profile), founderHeroes2018);
  });
});

test("6.20's, 6.10's and 6.02's work on 6.21: the Events tab and its page, the outfits' challenges, Support-A-Creator, the Battle Pass", async () => {
  const page = contentPage(undefined, undefined, v621);
  assert.ok(page.tournamentinformation && page.playlistinformation);
  assert.equal(page.koreancafe, undefined, "6.21's Korean PC bang section isn't served");
  assert.deepEqual(contentPage(undefined, undefined, v620).tournamentinformation, page.tournamentinformation);
  assert.deepEqual(affiliateRuntimeOptions(v621, { creatorNames: ["CoreCreator"] }), affiliateRuntimeOptions(v620, { creatorNames: ["CoreCreator"] }));
  withSession(v621, "skull621", (session) => {
    setUpAthena(session);
    grantCosmetic(session, "AthenaCharacter:cid_030_athena_commando_m_halloween");
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    assert.ok(held(session).includes("ChallengeBundle:questbundle_styles_skulltrooper"));
    assert.equal(session.profile("athena").profile.stats.attributes.book_purchased, true);
    // #334's carried-over Season 5 schedules are 6.20's.
    assert.deepEqual(inBuild(v621, athenaChallengeSchedules).season5_progressivea_schedule, inBuild(v620, athenaChallengeSchedules).season5_progressivea_schedule);
  });
  assert.equal(inBuild(v600, () => activeEventFlags()).includes(ltmLilKevin), false);
  const backend = await startBackend({ creatorNames: ["CoreCreator"] });
  try {
    const { token } = await userLogin(backend.port, "Creator621");
    const found = await asBuild(v621)(backend.port, "/affiliate/api/public/affiliates/slug/corecreator", token);
    assert.deepEqual([found.status, found.body.status], [200, "ACTIVE"]);
    assert.equal((await get(backend.port, "/affiliate/api/public/affiliates/slug/nobody", token)).status, 404);
  } finally {
    await backend.close();
  }
});

// The matchmaking service's client is 6.20's: 6.21's exe adds no ticket attribute or query parameter (its strings against
// CL-4497486's).
function matchmakingClient(port, authorization) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/", headers: { Connection: "Upgrade", Upgrade: "websocket",
      "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"), Authorization: authorization } });
    request.on("error", reject);
    request.on("upgrade", (response, socket, head) => {
      const messages = [];
      const waiters = [];
      let buffer = Buffer.alloc(0);
      const deliver = (text) => (waiters.length ? waiters.shift()(text) : messages.push(text));
      const receive = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          let length = buffer[1] & 0x7f;
          let offset = 2;
          if (length === 126) {
            length = buffer.readUInt16BE(2);
            offset = 4;
          }
          if (buffer.length < offset + length) return;
          if ((buffer[0] & 0x0f) === 0x1) deliver(buffer.subarray(offset, offset + length).toString("utf8"));
          buffer = buffer.subarray(offset + length);
        }
      };
      receive(head);
      socket.on("data", receive);
      socket.on("close", () => {
        while (waiters.length) waiters.shift()(null);
      });
      resolve({
        send: (text) => {
          const payload = Buffer.from(text);
          const mask = crypto.randomBytes(4);
          const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length])
            : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
          socket.write(Buffer.concat([header, mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))]));
        },
        next: () => (messages.length ? Promise.resolve(messages.shift()) : new Promise((done) => waiters.push(done))),
        close: () => socket.destroy()
      });
    });
    request.end();
  });
}
const authorizationOf = ({ ticketType, payload, signature }) => `Epic-Signed ${ticketType} ${payload} ${signature}`;
async function nextOf(connection, name) {
  for (;;) {
    const text = await connection.next();
    if (text === null) return null;
    const message = JSON.parse(text);
    if (message.name === name || message.payload?.state === name) return message;
  }
}

test("a 6.21 player matchmakes: Solo and Fortnitemares reach Queued and a 6.21 server; a mode switched off is refused", async () => {
  const as = asBuild(v621);
  const backend = await startBackend({ matchmakingGatherMs: 100 });
  const clients = [];
  try {
    const server = await userLogin(backend.port, "Server621");
    for (const playlist of ["playlist_defaultsolo", "playlist_deimos_duo"]) {
      const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
        ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
        maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: v621, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
      })).body;
      const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
        `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${v621}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
        server.token)).body));
      clients.push(gameserver);
      assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
      const player = await userLogin(backend.port, `P621${playlist.length}`);
      const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${v621}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
      assert.equal(ticket.status, 200, `${playlist}: ${JSON.stringify(ticket.body)}`);
      const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
      clients.push(client);
      const states = [];
      for (;;) {
        const { name, payload } = JSON.parse(await client.next());
        states.push(name === "StatusUpdate" ? payload.state : name);
        if (states.at(-1) === "Queued") break;
      }
      assert.deepEqual(states, ["Connecting", "Waiting", "Queued"], playlist);
      const assign = await nextOf(gameserver, "AssignMatch");
      assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${v621}:0:NAE:${playlist}`);
      gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
      const play = await nextOf(client, "Play");
      assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
      gameserver.close();
    }
    const player = await userLogin(backend.port, "Off621");
    const ticketFor = (playlist) => as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
      `&bucketId=${v621}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
    assert.equal((await ticketFor("playlist_disco_40_alt")).status, 400, "by its switch");
    assert.equal((await post(backend.port, "/admin/api/matchmaking/config", null, { modes: { fortnitemares2018Duos: false } })).status, 200);
    assert.equal((await ticketFor("playlist_deimos_duo")).status, 400, "switched off");
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});
