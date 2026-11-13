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
import { activeEventFlags, configureEvents, cramSession2018, fortnitemares, fortnitemares2018, halloweenBattleBus, hasEventEnded, isEventActive,
  islandRune, lobbySeason6, lobbySeason6Halloween, ltmFortnitemares } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { founderHeroes2018, owedFounderHeroes, settleFounderHeroes2018 } from "../src/events/fortnitemares2018.js";
import { islandStates } from "../src/events/island.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, ltmSchedule, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaLootTables, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { athenaQuestLogin, grantCosmetic, seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { isStylesCategory, originalOwnerStyles, settleChallengeSchedules, styleSchedules, weekPlan } from "../src/profiles/challenges.js";
import { buildOfSeason, buyBattlePass } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { contentPage } from "../src/services/content/pages.js";
import { createSettingsStore } from "../src/settings/store.js";
import { findOffer } from "../src/store/catalog.js";
import { affiliateCheck, affiliateRuntimeOptions } from "../src/store/creators.js";
import { eventStoreInstanceNow, eventStoreOffers, fortnitemares2018EventItems } from "../src/store/eventstore.js";
import { bundledBackBlings, itemShopOffers } from "../src/store/itemshop.js";
import { hasShowdown, showdownTicket, tournamentInformationFor } from "../src/tournaments/showdown.js";
import { createTournamentStore, tournamentPlaylists } from "../src/tournaments/store.js";
import { hexsylvania } from "../src/world/hexsylvania.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 6.20 (Update v6.20, 24 October 2018, Season 6): one build, CL-4497486, on its own data (gamedata/4497486). It
// keeps 6.00's to 6.10's Season 6 (Battle Pass, the schedules #334 carries over, the outfits' challenges, Support-A-Creator,
// the Events tab, the floating island) and adds Fortnitemares: the Cube Monsters' playlists and their tournament ones, the
// Fortnitemares Challenges, the Halloween lobby and bus, Save the World's Hexsylvania with Candy from Mini-Bosses, the 2018
// Fortnitemares Llama, Quickdraw Calamity and Bloodfinder A.C. in the Event Store and a founder's two heroes; sixteen
// cosmetics in the shop's history, and 6.20's check of a creator code.
const v620 = "4497486";
const v610 = "4480234";
const v6100 = "4464155";
const v602 = "4461277";
const v601 = "4424678";
const v600 = "4402180";
const v18 = "3724489";
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
const agentOf = (build, version = "6.20") => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "core-620-"));
const withSession = (build, name, run) => {
  const dir = tempDir();
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("6.20 is known, on its own data, Season 6's newest", () => {
  assert.equal(versionOf(v620), "6.20");
  assert.equal(allowedBuildList(["6.20"]).join(), v620);
  assert.equal(dataBuild(v620), v620);
  assert.equal(dataBuild("4490000"), v610, "a build between 6.10 and 6.20 plays on 6.10's");
  assert.equal(dataBuild(v610), v610, "6.10 keeps its own data");
  assert.equal(buildOfSeason(6), v620);
  assert.equal(seasonName(6), "Season 6 (6.00 – 6.20)");
  assert.equal(inBuild(v620, athenaSeason).seasonNumber, 6);
});

test("6.20's data against 6.10's: thirty-seven cosmetics (Bunnymoon from its keyed pak), the Onesie gone, the Bushido styles start unlocked, the new weapons in the loot", () => {
  const [c620, c610] = [inBuild(v620, athenaCosmetics), inBuild(v610, athenaCosmetics)];
  const added = Object.keys(c620).filter((id) => !c610[id]);
  assert.equal(added.length, 37);
  for (const [id, name] of [["AthenaCharacter:cid_250_athena_commando_m_evilcowboy", "Deadfire"], ["AthenaCharacter:cid_255_athena_commando_f_halloweenbunny", "Bunnymoon"],
    ["AthenaCharacter:cid_228_athena_commando_m_vampire", "Sanctum"], ["AthenaGlider:glider_id_088_evilcowboy", "Dark Engine"], ["AthenaDance:emoji_fiery", "Fiery"],
    ["AthenaSkyDiveContrail:trails_id_31_greenflame", "Virulent Flames"], ["AthenaDance:spid_063_cowboy", "Deadfire"], ["AthenaBattleBus:bbid_halloweenbus", "Halloween Bus"]]) {
    assert.equal(c620[id]?.name, name, id);
  }
  assert.deepEqual(Object.keys(c610).filter((id) => !c620[id]), ["AthenaCharacter:cid_245_athena_commando_f_durrburgerpjs"], "the Onesie is gone from 6.20's paks");
  // Update v6.20: "New variants added to the Musha and Hime Outfits ... If you own the Outfits they will be automatically unlocked."
  for (const id of ["AthenaCharacter:cid_198_athena_commando_m_bluesamurai", "AthenaCharacter:cid_199_athena_commando_f_bluesamurai"]) {
    assert.deepEqual(c620[id].variants, [{ channel: "Material", default: "Mat0", options: ["Mat0", "Mat1", "Mat2"], unlocked: ["Mat0", "Mat1", "Mat2"] }], id);
  }
  const loot = JSON.stringify(inBuild(v620, athenaLootTables));
  for (const weapon of ["WID_Pistol_Revolver_SingleAction_Athena_UC", "WID_Special_FiendHunter_Athena_VR_Ore_T03"]) assert.ok(loot.includes(weapon), weapon);
  assert.equal(JSON.stringify(inBuild(v610, athenaLootTables)).includes("FiendHunter"), false);
  // Save the World: the Fortnitemares heroes and the Rat Rod set, the 2018 llama.
  for (const id of ["Hero:hid_commando_018_sr_t01", "Hero:hid_commando_gunheadshothw_rs01_sr_t01", "Hero:hid_commando_007hw_rs01_sr_t01",
    "Schematic:sid_sniper_ratrod_sr_ore_t01", "CardPack:cardpack_event_2018_halloween"]) {
    assert.ok(inBuild(v620, () => getItem(id)), id);
  }
  assert.equal(inBuild(v610, () => getItem("Hero:hid_commando_018_sr_t01")), undefined);
});

test("6.20 keeps Season 6's Battle Pass and what #334 carries over; level 100 gains its emoticon, spray and banner", () => {
  const [s620, s610] = [inBuild(v620, athenaSeason), inBuild(v610, athenaSeason)];
  assert.deepEqual({ ...s620, seasonRewards: null }, { ...s610, seasonRewards: null }, "AthenaSeason6's tiers are 6.10's");
  assert.deepEqual(s620.seasonRewards.at(-1).rewards.map(({ templateId }) => templateId), ["AccountResource:athenaseasonalbp", "AthenaDance:emoji_s6lvl100",
    "AthenaDance:spid_064_s6lvl100", "HomebaseBannerIcon:brseason06seasonlevel100"]);
  const schedules = inBuild(v620, athenaChallengeSchedules);
  assert.deepEqual([schedules.season5_progressivea_schedule.keptPastSeason, schedules.season5_progressiveb_schedule.keptPastSeason], [5, 5]);
  assert.deepEqual(schedules.season6_free_schedule, inBuild(v610, athenaChallengeSchedules).season6_free_schedule);
  withSession(v620, "pass620", (session) => {
    setUpAthena(session);
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    assert.equal(session.profile("athena").profile.stats.attributes.book_purchased, true);
  });
});

test("6.20's outfits' challenges: the same schedules, each under a CategoryID of its own, given to the outfits' owners; the purple styles as 6.02's", () => {
  const schedules = inBuild(v620, athenaChallengeSchedules);
  assert.deepEqual([schedules.bundleschedule_styles_skulltrooper.category, schedules.bundleschedule_styles_tomatohead.category], ["Styles_SkullTrooper", "Styles_Tomatohead"]);
  for (const id of Object.keys(styleSchedules)) {
    assert.ok(isStylesCategory(schedules[id].category), id);
    assert.deepEqual({ ...schedules[id], category: "Styles" }, inBuild(v610, athenaChallengeSchedules)[id], id);
  }
  assert.equal(isStylesCategory("Fortnitemares"), false);
  for (const { token } of originalOwnerStyles) assert.ok(buildGameData(v620, "athena", {}).variantTokens[token.replace("cosmeticvarianttoken", "CosmeticVariantToken")], token);
  withSession(v620, "skull620", (session) => {
    setUpAthena(session);
    grantCosmetic(session, "AthenaCharacter:cid_030_athena_commando_m_halloween");
    athenaQuestLogin(session);
    const held = Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);
    assert.ok(held.includes("ChallengeBundleSchedule:bundleschedule_styles_skulltrooper"));
    assert.ok(held.includes("ChallengeBundle:questbundle_styles_skulltrooper"));
  });
});

test("the Fortnitemares Challenges: Schedule_Fortnitemares while LTM_Fortnitemares is served, Part 1 at once, Parts 2 to 4 by the files' days; the weeks are still Season 6's", () => {
  const schedule = inBuild(v620, athenaChallengeSchedules).schedule_fortnitemares;
  assert.equal(schedule.eventName, ltmFortnitemares);
  assert.equal(schedule.cleanUpOnBundleCompletion, true);
  assert.deepEqual(schedule.bundles.map(({ bundle, unlockType, unlockValue }) => [bundle, unlockType, unlockValue]), [
    ["questbundle_fortnitemares_part1", "OnScheduleGranted", 0], ["questbundle_fortnitemares_part2", "DaysSinceEventStart", 32],
    ["questbundle_fortnitemares_part3", "DaysSinceEventStart", 34], ["questbundle_fortnitemares_part4", "DaysSinceEventStart", 36]]);
  const bundles = inBuild(v620, athenaChallengeBundles);
  assert.deepEqual(["part1", "part2", "part3", "part4"].map((part) => bundles[`questbundle_fortnitemares_${part}`].completionSteps[0].rewards[0].templateId),
    ["AthenaDance:emoji_fiery", "AthenaDance:spid_063_cowboy", "AthenaSkyDiveContrail:trails_id_31_greenflame", "AthenaGlider:glider_id_088_evilcowboy"]);
  // Its challenges count in the Deimos playlists only (the gameserver reports their stats).
  const quest = inBuild(v620, () => getAthenaQuest("quest_fnm_elim_ai"));
  assert.equal(quest.objectives[0].stat, "killingblow_athena_deimos_monster");
  assert.equal(buildGameData(v620, "athena", {}).objectiveStats.killingblow_athena_deimos_monster.contextTags, "Athena.Playlist.Deimos");
  withConfig(replay, () => {
    // The weekly settings still move Season 6's weeks: Week 2 is season6_free_schedule's, 10 days in.
    const plan = inBuild(v620, () => weekPlan(at("2018-10-30T12:00:00Z")));
    assert.equal(plan.weeks[1].bundle, "questbundle_s6_week_002");
    assert.equal(plan.totalWeeks, 10);
    withSession(v620, "fnm620", (session) => {
      setUpAthena(session);
      athenaQuestLogin(session);
      const bundlesHeld = (now) => {
        settleChallengeSchedules(session, seasonRewardFunctions(), now);
        return Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId)
          .filter((id) => id.startsWith("ChallengeBundle:questbundle_fortnitemares")).sort();
      };
      assert.ok(Object.values(session.profile("athena").profile.items).some(({ templateId }) => templateId === "ChallengeBundleSchedule:schedule_fortnitemares"));
      assert.deepEqual(bundlesHeld(at("2018-10-25T12:00:00Z")), ["ChallengeBundle:questbundle_fortnitemares_part1"]);
      assert.deepEqual(bundlesHeld(at("2018-10-30T12:00:00Z")), ["ChallengeBundle:questbundle_fortnitemares_part1", "ChallengeBundle:questbundle_fortnitemares_part2"]);
      assert.equal(bundlesHeld(at("2018-11-03T12:00:00Z")).length, 4);
    });
  });
  // 6.10 has no such schedule, and is given nothing of it.
  assert.equal(inBuild(v610, athenaChallengeSchedules).schedule_fortnitemares, undefined);
});

test("6.20's event flags: Fortnitemares (its quest map's Part 1, the Mini-Bosses, the challenges, the Halloween lobby and bus) beside 6.10's; Cram Session over", () => {
  assert.deepEqual(activeEventFlags(v620), ["EventFlag.Fortnitemares", "EventFlag.FortnitemaresPhase1", "EventFlag.ActiveMiniBosses", ltmFortnitemares,
    lobbySeason6Halloween, halloweenBattleBus, "EventFlag.PassiveStorms", lobbySeason6]);
  assert.deepEqual(activeEventFlags(v610), ["EventFlag.PassiveStorms", lobbySeason6, "EventFlag.ActiveMiniBosses"], "6.10 is as it was");
  assert.equal(inBuild(v620, () => isEventActive(fortnitemares)), true);
  assert.equal(inBuild(v620, () => isEventActive(fortnitemares2018)), true);
  assert.equal(inBuild(v620, () => isEventActive(cramSession2018)), false, "Update v6.20 ends Cram Session's Gold");
  assert.equal(inBuild(v610, () => isEventActive(cramSession2018)), true);
  // Fortnitemares 2017 is still over on the builds between its runs (the candy conversion), and not over on 6.20.
  for (const build of ["3775276", v610, v600]) assert.equal(inBuild(build, () => hasEventEnded(fortnitemares)), true, build);
  assert.equal(inBuild(v620, () => hasEventEnded(fortnitemares)), false);
  assert.equal(inBuild(v18, () => isEventActive(fortnitemares)), true, "1.8's own run");
  for (const flag of [ltmFortnitemares, lobbySeason6Halloween, halloweenBattleBus, "EventFlag.FortnitemaresPhase1", "EventFlag.FortnitemaresPhase2"]) {
    assert.deepEqual(season4Flag(flag).builds, [Number(v620), Number(v620)], flag);
  }
  assert.deepEqual(season4Flag(lobbySeason6).builds, [4395664, Number(v620)]);
  assert.equal(season4Flag("EventFlag.BR.CandyCaneGuns").builds[1], Number(v610), "BR_Winter_CandyCaneGuns is gone from 6.20's paks");
  // The admin's switches: Part 2's quest map on, the lobby off.
  withConfig({ mode: "auto", season4Flags: { overrides: { "EventFlag.FortnitemaresPhase2": "on", "EventFlag.LobbySeason6Halloween": "off" } } }, () => {
    const flags = activeEventFlags(v620);
    assert.ok(flags.includes("EventFlag.FortnitemaresPhase2"));
    assert.equal(flags.includes(lobbySeason6Halloween), false);
    assert.equal(activeEventFlags(v610).includes("EventFlag.FortnitemaresPhase2"), false, "6.20's switch only");
  });
});

test("6.20 keeps the floating island back over Loot Lake at _Rune8, by Season 6's dates", () => {
  const served = (build, iso) => inBuild(build, () => islandStates(at(iso)))[0].events.map(({ eventType }) => eventType);
  withConfig(replay, () => {
    for (const iso of ["2018-10-24T12:00:00Z", "2018-11-15T00:00:00Z"]) assert.deepEqual(served(v620, iso), [islandRune(8)], iso);
    assert.deepEqual(served(v602, "2018-10-24T12:00:00Z"), [islandRune(0)], "6.02 as it was");
  });
});

test("6.20's modes: Fortnitemares on by default by its dates, two more Disco Dominations by their switches, the glider redeploy defaults gone, Fortnitemares' tournament playlists", () => {
  const defaults = createSettingsStore(null).get();
  for (const id of ["fortnitemares2018Solo", "fortnitemares2018Duos", "fortnitemares2018Squads"]) assert.equal(defaults.matchmakingModes[id], true, id);
  for (const id of ["discoDomination40Alt", "discoDomination32Alt"]) assert.equal(defaults.matchmakingModes[id], false, id);
  for (const id of ["fortnitemaresShowSolo", "fortnitemaresShowDuos", "fortnitemaresShowSquads"]) {
    assert.equal(Object.hasOwn(defaults.matchmakingModes, id), false, id);
    assert.equal(ltmSchedule(defaults).list.some((ltm) => ltm.id === id), false, id);
  }
  assert.deepEqual([47, 48, 49, 231, 232, 59071, 59072, 59073, 58071, 202, 50, 35].map((id) => ltmOfPlaylist(id, v620).id),
    ["fortnitemares2018Solo", "fortnitemares2018Duos", "fortnitemares2018Squads", "discoDomination40Alt", "discoDomination32Alt", "fortnitemaresShowSolo",
      "fortnitemaresShowDuos", "fortnitemaresShowSquads", "showdownSolo", "discoDomination602", "fiftyFiftySeason6", "playgroundV2"]);
  for (const id of ["fortnitemares2018Solo", "fortnitemares2018Squads", "fiftyFiftySeason6", "playgroundV2"]) assert.equal(ltmOn(id, v620, defaults), true, id);
  for (const id of ["discoDomination40Alt", "fortnitemaresShowSolo", "showdownSolo"]) assert.equal(ltmOn(id, v620, defaults), false, id);
  for (const id of ["gliderRedeploySolo", "gliderRedeployDuos", "gliderRedeploySquads"]) assert.equal(hasLtm(id, v620), false, id);
  for (const id of ["fortnitemares2018Solo", "discoDomination40Alt", "fortnitemaresShowSolo"]) assert.equal(hasLtm(id, v610), false, `${id} isn't 6.10's`);
  assert.deepEqual(ltmFrontEndPlaylists(v620, defaults).map(({ name, enabled }) => [name, enabled]),
    [["Playlist_Playground", true], ["Playlist_Soaring_50s", false], ["Playlist_50v50", true], ["Playlist_Disco", true], ["Playlist_Disco_32", false],
      ["Playlist_HighExplosives_Solo", false], ["Playlist_HighExplosives_Squads", false], ["Playlist_Disco_40", false], ["Playlist_Disco_Alt", false],
      ["Playlist_Blitz_Solo", false], ["Playlist_Blitz_Duos", false], ["Playlist_Blitz_Squad", false], ["Playlist_Showdown_Solo", false], ["Playlist_Showdown_Duos", false],
      ["Playlist_Showdown_Squads", false], ["Playlist_Deimos_Solo", true], ["Playlist_Deimos_Duo", true], ["Playlist_Deimos_Squad", true], ["Playlist_Disco_40_Alt", false],
      ["Playlist_Disco_32_Alt", false], ["Playlist_Deimos_SoloShow", false], ["Playlist_Deimos_DuoShow", false], ["Playlist_Deimos_SquadShow", false]]);
  for (const [name, id] of [["playlist_deimos_solo", 47], ["playlist_deimos_duo", 48], ["playlist_deimos_squad", 49], ["playlist_disco_40_alt", 231],
    ["playlist_disco_32_alt", 232], ["playlist_deimos_soloshow", 59071], ["playlist_deimos_squadshow", 59073]]) {
    assert.equal(playlistIdOfName(name, v620), id, name);
    assert.equal(parseBucket(`${v620}:0:NAE:${name}`, v620).playlistId, id, name);
  }
  assert.deepEqual(["solo", "duo", "squad"].map((size) => playlistTeamsOf(`${v620}:0:NAE:playlist_deimos_${size}`, v620).maxTeamSize), [1, 2, 4]);
  assert.deepEqual(playlistTeamsOf(`${v620}:0:NAE:playlist_disco_40_alt`, v620), { maxTeamCount: 2, maxTeamSize: 40, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v620}:0:NAE:playlist_disco_32_alt`, v620), { maxTeamCount: 2, maxTeamSize: 32, maxSquadSize: 4 });
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    // From Update v6.20's day to Update v6.21's "Sunday, November 4 at 1 PM Eastern Time".
    assert.equal(inOriginalWindow("fortnitemares2018Solo", v620, at("2018-10-23T23:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("fortnitemares2018Solo", v620, at("2018-10-24T00:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("fortnitemares2018Squads", v620, at("2018-11-04T17:59:00Z"), dated), true);
    assert.equal(inOriginalWindow("fortnitemares2018Squads", v620, at("2018-11-04T18:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("discoDomination602", v620, at("2018-10-25T12:00:00Z"), dated), false, "Disco Domination's dates end on 24 October");
  });
  // Fortnitemares' tournament playlists are in-game ones, as the Showdown ones.
  assert.deepEqual(tournamentPlaylists.slice(-3).map(({ id, playlistId, inGame }) => [id, playlistId, inGame]),
    [["fortnitemaresShowSolo", 59071, true], ["fortnitemaresShowDuos", 59072, true], ["fortnitemaresShowSquads", 59073, true]]);
  assert.equal(hasShowdown(v620), true);
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    store.create({ name: "Cube Cup", playlist: "fortnitemaresShowDuos", ruleset: "soloShowdownJuly2018" }, at("2018-10-25T00:00:00Z"));
    assert.equal(showdownTicket({ playlistId: 59072, partySize: 1, build: v620 }, new Date(), store).error.code, "errors.com.epicgames.fortnite.wrong_number_of_event_players");
    assert.ok(showdownTicket({ playlistId: 59072, partySize: 2, build: v620 }, new Date(), store).event);
    assert.equal(showdownTicket({ playlistId: 59072, partySize: 2, build: v610 }, new Date(), store).error.code, "errors.com.epicgames.fortnite.event_window_time_invalid",
      "6.10 has no Fortnitemares playlist");
    // The Events tab's page names it as the Showdown ones are named.
    const info = JSON.stringify(tournamentInformationFor(v620, new Date(), store));
    assert.ok(info.includes("Cube Cup") && info.includes('"title_line_2":"Duos"') && !info.includes("Playlist_Deimos"), info.slice(0, 300));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a 6.20 client's hotfix lists Fortnitemares as New and its tournament playlists disabled after the Showdown ones", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Lobby620");
    const gameIni = async (build, version) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": agentOf(build, version), Authorization: `bearer ${token}` } })).body.toString();
    const lines = (await gameIni(v620)).split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
    const of = (name) => lines.find((line) => line.includes(`PlaylistName=${name},`));
    assert.match(of("Playlist_Deimos_Solo"), /bEnabled=true, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false, AdvertiseType=New, bDisplayAsLimitedTime=true/);
    assert.match(of("Playlist_50v50"), /bIsDefaultPlaylist=true, .*DisplayPriority=3\)\)/);
    assert.deepEqual(["Showdown_Solo", "Showdown_Duos", "Showdown_Squads", "Deimos_SoloShow", "Deimos_DuoShow", "Deimos_SquadShow"]
      .map((name) => /DisplayPriority=(\d+)/.exec(of(`Playlist_${name}`))[1]), ["50", "51", "52", "53", "54", "55"]);
    assert.match(of("Playlist_Deimos_SoloShow"), /bEnabled=false, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false/);
    assert.equal(lines.some((line) => line.includes("CreativeTestIsland")), false, "its playlist asset isn't in the paks");
    const lines610 = (await gameIni(v610, "6.10")).split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
    assert.equal(lines610.some((line) => line.includes("Deimos")), false, "6.10's as it was");
  } finally {
    await backend.close();
  }
});

test("6.20's shop: Season 6's history with its sixteen cosmetics on their days and its outfits' back blings; 6.10's days are as they were", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season6.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  const [c620, c610] = [inBuild(v620, athenaCosmetics), inBuild(v610, athenaCosmetics)];
  assert.ok(history.every((day) => [...day.featured, ...day.daily].every(([id]) => c620[id])), "only 6.20's cosmetics");
  const days = (id) => history.filter((day) => [...day.featured, ...day.daily].some(([entry]) => entry === id)).map(({ date }) => date.slice(5));
  assert.deepEqual(days("AthenaCharacter:cid_250_athena_commando_m_evilcowboy"), ["10-25", "10-28", "10-29"]);
  assert.deepEqual(days("AthenaCharacter:cid_228_athena_commando_m_vampire"), ["10-19", "10-20", "11-28"]);
  assert.deepEqual(days("AthenaCharacter:cid_255_athena_commando_f_halloweenbunny"), ["10-28", "10-31", "11-01"]);
  for (const id of ["AthenaCharacter:cid_252_athena_commando_m_muertos", "AthenaCharacter:cid_251_athena_commando_f_muertos", "AthenaGlider:glider_id_089_muertos",
    "AthenaPickaxe:pickaxe_id_113_muertos"]) assert.deepEqual(days(id), ["11-02", "11-03"], id);
  const own = [...new Set(history.flatMap((day) => [...day.featured, ...day.daily]).map(([id]) => id).filter((id) => !c610[id]))];
  assert.equal(own.length, 16);
  // 2 November: Dante and Rosa share a tile (Pick your Style!), Spirit and Six String Striker another (Collect the Set!).
  const nov2 = history.find(({ date }) => date === "2018-11-02");
  assert.deepEqual(nov2.featured, [["AthenaCharacter:cid_252_athena_commando_m_muertos", 1500, { tile: 1, banner: "PickYourStyle" }],
    ["AthenaCharacter:cid_251_athena_commando_f_muertos", 1500, { tile: 1, banner: "PickYourStyle" }],
    ["AthenaGlider:glider_id_089_muertos", 1200, { tile: 2, banner: "CollectTheSet" }], ["AthenaPickaxe:pickaxe_id_113_muertos", 1200, { tile: 2, banner: "CollectTheSet" }]]);
  assert.equal(bundledBackBlings["AthenaCharacter:cid_250_athena_commando_m_evilcowboy"], "AthenaBackpack:bid_137_evilcowboy");
  const featured = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRWeeklyStorefront;
  const deadfire = featured(v620, "2018-10-25T12:00:00Z").find(({ templateId }) => templateId === "AthenaCharacter:cid_250_athena_commando_m_evilcowboy");
  assert.deepEqual(deadfire.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_250_athena_commando_m_evilcowboy", "AthenaBackpack:bid_137_evilcowboy"]);
  assert.equal(deadfire.price, 2000);
  // 6.10 sells none of them on those days.
  assert.equal(featured(v610, "2018-10-25T12:00:00Z").length, 0);
  assert.deepEqual(featured(v620, "2018-11-02T12:00:00Z").map(({ title }) => title), ["Dante", "Rosa", "Spirit", "Six String Striker"]);
});

test("6.20's Save the World: Fortnitemares Part 1 with Hexsylvania and its quests, the 2018 llama for Candy, Quickdraw Calamity and Bloodfinder A.C. in the Event Store", () => {
  assert.deepEqual(inBuild(v620, eventQuests), ["halloweenquest_2017_opener", "halloweenquest_2017_hidden_watchvideo", "halloweenquest_2017_epicheroes",
    "halloweenquest_2017_legendaryheroes", "halloweenquest_2017_completemissions_1"]);
  assert.deepEqual(inBuild(v610, eventQuests).filter((id) => id.startsWith("halloweenquest")), [], "6.10 has no Fortnitemares");
  const theater = inBuild(v620, hexsylvania);
  assert.ok(theater, "Hexsylvania, from 6.20's moved zone themes");
  assert.ok(theater.data.tiles.every(({ zoneTheme }) => zoneTheme.startsWith("/Game/World/ZoneThemes/Spooky/BP_ZT_TRV_HF")));
  assert.equal(inBuild(v610, hexsylvania), null);
  assert.ok(inBuild(v18, hexsylvania)?.data.tiles.every(({ zoneTheme }) => zoneTheme.includes("/TestZoneThemes/")), "1.8's as it was");
  assert.equal(inBuild(v620, () => findOffer("core_event_fortnitemares2018_llama"))?.price, 500);
  assert.equal(inBuild(v620, () => findOffer("core_event_fortnitemares_llama")), undefined, "the 2018 llama in 2017's place");
  assert.equal(inBuild(v18, () => findOffer("core_event_fortnitemares_llama"))?.templateId, "CardPack:cardpack_event_2017_halloween");
  assert.equal(inBuild(v18, () => findOffer("core_event_fortnitemares2018_llama")), undefined);
  assert.equal(inBuild(v620, eventStoreInstanceNow), "Fortnitemares2018.STWSpecialEventStoreFront");
  const store = JSON.stringify(inBuild(v620, () => eventStoreOffers(at("2018-10-25T12:00:00Z"))));
  for (const { templateId } of fortnitemares2018EventItems) assert.ok(store.includes(templateId), templateId);
  assert.ok(!JSON.stringify(inBuild(v610, () => eventStoreOffers(at("2018-10-20T12:00:00Z")))).includes("hid_commando_018"), "6.10's store as it was");
  assert.equal(inBuild(v610, eventStoreInstanceNow), "CramSession2018.STWSpecialEventStoreFront");
});

test("a founder logging in on 6.20 gets Skull Ranger Ramirez and Brainiac Jonesy once; nobody else, and not on 6.10", () => {
  withSession(v620, "founder620", (session) => {
    const tracker = session.profile("profile0");
    assert.deepEqual(owedFounderHeroes(tracker.profile), [], "no Founder's Pack");
    tracker.addItem(crypto.randomUUID(), { templateId: "Token:founderspack_1", attributes: {}, quantity: 1 });
    assert.deepEqual(owedFounderHeroes(tracker.profile), founderHeroes2018);
    const granted = [];
    assert.deepEqual(settleFounderHeroes2018(session, (s, templateId, quantity) => granted.push([templateId, quantity])), founderHeroes2018);
    assert.deepEqual(granted, founderHeroes2018.map((templateId) => [templateId, 1]));
    assert.deepEqual(settleFounderHeroes2018(session, () => assert.fail("given twice")), []);
  });
  withSession(v610, "founder610", (session) => {
    const tracker = session.profile("profile0");
    tracker.addItem(crypto.randomUUID(), { templateId: "Token:founderspack_1", attributes: {}, quantity: 1 });
    assert.deepEqual(owedFounderHeroes(tracker.profile), []);
  });
});

test("6.20's creator code check: a listed creator is ACTIVE as the list spells it, any other name the service's 404; Support-A-Creator's hotfix as 6.02's", async () => {
  const settings = { creatorNames: ["CoreCreator"] };
  assert.deepEqual(affiliateCheck("corecreator", settings), { id: affiliateCheck("CoreCreator", settings).id, slug: "CoreCreator", displayName: "CoreCreator",
    avatar: "", status: "ACTIVE", verified: false });
  assert.equal(affiliateCheck("someoneelse", settings), null);
  assert.deepEqual(affiliateRuntimeOptions(v620, settings), affiliateRuntimeOptions(v602, settings));
  const backend = await startBackend({ creatorNames: ["CoreCreator"] });
  try {
    const { token } = await userLogin(backend.port, "Creator620");
    const found = await get(backend.port, "/affiliate/api/public/affiliates/slug/corecreator", token);
    assert.equal(found.status, 200);
    assert.deepEqual([found.body.slug, found.body.status], ["CoreCreator", "ACTIVE"]);
    const missing = await get(backend.port, "/affiliate/api/public/affiliates/slug/nobody", token);
    assert.deepEqual([missing.status, missing.body.errorCode], [404, "errors.com.epicgames.ecommerce.affiliate.not_found"]);
  } finally {
    await backend.close();
  }
});

test("6.10's work on 6.20: the Events tab and its content page, the outfits' challenges, the island; 6.02's and 6.01's too", () => {
  const page = contentPage(undefined, undefined, v620);
  assert.ok(page.tournamentinformation, "the Events tab's page");
  assert.ok(page.playlistinformation, "the mode select's tiles");
  assert.deepEqual(contentPage(undefined, undefined, v610).tournamentinformation, page.tournamentinformation);
  assert.equal(hasShowdown(v620), true);
  for (const build of [v6100, v610, v620]) assert.equal(season4Flag(islandRune(8)).builds[1] >= Number(build), true, build);
  // 6.01's Playground custom options and 6.00's Battle Pass gift box are data the build keeps.
  assert.equal(inBuild(v620, () => getItem("GiftBox:gb_battlepasspurchased"))?.class ?? "kept", inBuild(v610, () => getItem("GiftBox:gb_battlepasspurchased"))?.class ?? "kept");
  assert.deepEqual(Object.keys(inBuild(v620, athenaChallengeSchedules)).filter((id) => !inBuild(v610, athenaChallengeSchedules)[id]), ["schedule_fortnitemares"]);
  assert.deepEqual(inBuild(v620, athenaChallengeBundles).questbundle_styles_skulltrooper, inBuild(v602, athenaChallengeBundles).questbundle_styles_skulltrooper
    ?? inBuild(v620, athenaChallengeBundles).questbundle_styles_skulltrooper);
  assert.equal(inBuild(v601, () => activeEventFlags()).includes(ltmFortnitemares), false);
});

// The matchmaking service's client is 6.10's: 6.20's exe adds no ticket attribute or query parameter (its strings against
// CL-4480234's).
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
const asBuild = (build, version = "6.20") => (port, urlPath, token, method = "GET", body) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agentOf(build, version), ...(token ? { Authorization: `bearer ${token}` } : {}) };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
};

test("a 6.20 player matchmakes: Solo and Fortnitemares reach Queued and a 6.20 server; the modes by their switches are refused", async () => {
  const as = asBuild(v620);
  const backend = await startBackend({ matchmakingGatherMs: 100 });
  const clients = [];
  try {
    const server = await userLogin(backend.port, "Server620");
    for (const playlist of ["playlist_defaultsolo", "playlist_deimos_solo", "playlist_deimos_squad"]) {
      const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
        ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
        maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: v620, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
      })).body;
      const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
        `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${v620}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
        server.token)).body));
      clients.push(gameserver);
      assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
      const player = await userLogin(backend.port, `P620${playlist.length}`);
      const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${v620}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
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
      assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${v620}:0:NAE:${playlist}`);
      gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
      const play = await nextOf(client, "Play");
      assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
      gameserver.close();
    }
    const player = await userLogin(backend.port, "Off620");
    const ticketFor = (playlist) => as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
      `&bucketId=${v620}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
    for (const playlist of ["playlist_disco_40_alt", "playlist_grd_solo"]) {
      const refused = await ticketFor(playlist);
      assert.equal(refused.status, 400, playlist);
    }
    // A Fortnitemares tournament playlist is taken only while an event of it runs.
    const tournament = await ticketFor("playlist_deimos_soloshow");
    assert.deepEqual([tournament.status, tournament.body.errorCode], [400, "errors.com.epicgames.fortnite.event_window_time_invalid"]);
    assert.equal((await post(backend.port, "/admin/api/matchmaking/config", null, { modes: { fortnitemares2018Solo: false } })).status, 200);
    assert.equal((await ticketFor("playlist_deimos_solo")).status, 400, "switched off");
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});
