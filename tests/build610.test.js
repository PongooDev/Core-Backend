import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { cramSessionEventItems, cramSessionQuests } from "../src/events/cramsession2018.js";
import { cubeStates } from "../src/events/cube.js";
import { activeEventFlags, activeMiniBosses, configureEvents, cramSession2018, isEventActive, islandMoveTo, islandRune, lobbySeason6,
  passiveStorms } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { islandStates } from "../src/events/island.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltmSchedule, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaLootTables, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { athenaQuestLogin, grantCosmetic, seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { battlePassPurchaseGiftBox } from "../src/profiles/giftboxes.js";
import { buildOfSeason, buyBattlePass } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { contentPage, subgameSelectImages, subgameSelectImagesFor } from "../src/services/content/pages.js";
import { playlistInformationFor } from "../src/services/content/playlistimages.js";
import { stwMfaRewardOffered } from "../src/services/mcp/commands/ClaimMfaEnabled.js";
import { createSettingsStore } from "../src/settings/store.js";
import { affiliateOffered, affiliateRuntimeOptions } from "../src/store/creators.js";
import { eventStoreEnds, eventStoreOffers, eventStorefront, weeklyStorefront } from "../src/store/eventstore.js";
import { bundledBackBlings, itemShopOffers } from "../src/store/itemshop.js";
import { eliminationsStat, eventWindowHistory, hasShowdown, historiesOf, maxEliminationTiers, placementStat, showdownEvents, showdownRuntimeOptions,
  showdownTicket, showdownTiers, tournamentAndHistory, tournamentInformationFor } from "../src/tournaments/showdown.js";
import { createTournamentStore, matchPoints, rulesets, tournamentPlaylists } from "../src/tournaments/store.js";
import os from "node:os";
import path from "node:path";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 6.10 (Update v6.10, 16 October 2018, Season 6): CL-4480234 ("6.10", the owner's build, on its own data,
// gamedata/4480234), CL-4476098 ("6.10.1") and CL-4464155 ("6.10.0"), the two earlier ones, whose paks Core has no copy
// of, on CL-4480234's. It keeps 6.00's to 6.02's Season 6 (Battle Pass, floating island, Cram Session, Disco Domination,
// the outfits' challenges, Support-A-Creator, matchmaking) and adds the in-game tournaments' Events tab, thirteen
// cosmetics, weeks 4 to 7 of Season 6's challenges as Epic ran them, the island's last stop and the Weekly Store's Rat
// King and Grave Digger.
const v610 = "4480234";
const v6101 = "4476098";
const v6100 = "4464155";
const v602 = "4461277";
const v6020 = "4442095";
const v601 = "4424678";
const v600 = "4402180";
const v541 = "4363240";
const builds610 = [v6100, v6101, v610];
// Season 6's replay from its real first day, so the replay's dates are Epic's.
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
const agentOf = (build, version = "6.10") => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "core-610-"));

test("6.10's three changelists are known, all play on CL-4480234's data, Season 6's", () => {
  assert.deepEqual(builds610.map(versionOf), ["6.10.0", "6.10.1", "6.10"]);
  for (const build of builds610) {
    assert.equal(dataBuild(build), v610, build);
    assert.ok(buildChoices().includes(build), build);
    const season = inBuild(build, athenaSeason);
    assert.deepEqual([season.seasonNumber, season.numSeasonLevels, season.numBookLevels, season.storefront], [6, 100, 100, "BRSeason6"]);
  }
  assert.equal(allowedBuildList(["6.10"]).join(), v610);
  assert.equal(allowedBuildList(["6.10.0"]).join(), v6100);
  assert.equal(allowedBuildList(["6.10.1"]).join(), v6101);
  assert.equal(dataBuild("4462000"), v602, "a build between 6.02 and 6.10 Core doesn't know plays on 6.02's");
  assert.equal(dataBuild(v602), v602, "6.02 keeps its own data");
  assert.equal(dataBuild(v6020), v602);
  assert.equal(dataBuild(v601), v601);
  assert.equal(buildOfSeason(6), "4526925", "Season 6's newest data is 6.21's now (tests/build621.test.js)");
  assert.equal(buildOfSeason(5), v541);
  assert.equal(seasonName(6), "Season 6 (6.00 – 6.21)");
});

test("6.10's data against 6.02's: thirteen cosmetics, weeks 4 to 7 as Epic ran them, the eased Skull Trooper Challenges, the loot's new weights", () => {
  const [c610, c602] = [inBuild(v610, athenaCosmetics), inBuild(v602, athenaCosmetics)];
  const added = Object.keys(c610).filter((id) => !c602[id]).sort();
  assert.deepEqual(added.map((id) => [id, c610[id].name]), [
    ["AthenaBackpack:bid_131_blackwidowfemale", "Long Legs"], ["AthenaBackpack:bid_132_blackwidowmale", "Spider Shield"], ["AthenaBackpack:bid_133_guanyu", "Loyal Shield"],
    ["AthenaCharacter:cid_245_athena_commando_f_durrburgerpjs", "Onesie"], ["AthenaCharacter:cid_247_athena_commando_m_guanyu", "Guan Yu"],
    ["AthenaCharacter:cid_248_athena_commando_m_blackwidow", "Spider Knight"], ["AthenaCharacter:cid_249_athena_commando_f_blackwidow", "Arachne"],
    ["AthenaDance:emoji_birthday2018", "Fortnite Birthday!"], ["AthenaGlider:glider_id_086_blackwidow", "Hatchling"], ["AthenaGlider:glider_id_087_guanyu", "Divine Dragon"],
    ["AthenaPickaxe:pickaxe_id_110_vampire", "Moonrise"], ["AthenaPickaxe:pickaxe_id_111_blackwidow", "Web Breaker"], ["AthenaPickaxe:pickaxe_id_112_guanyu", "Guandao"]]);
  assert.deepEqual(Object.keys(c602).filter((id) => !c610[id]), [], "none dropped");

  inBuild(v610, () => {
    const week = (number) => athenaChallengeBundles()[`questbundle_s6_week_00${number}`].quests.map(({ quest }) => quest);
    // Week 4: "Use a Port-a-Fort", "Ring a doorbell in different named locations", the shooting gallery.
    assert.deepEqual(week(4), ["quest_br_use_portafort", "quest_br_interact_ammobox_locations_different", "quest_br_ringdoorbell_differenthouses", "quest_br_land_chain_02a",
      "quest_br_dance_scavengerhunt_locations_chain_01a", "quest_br_shoot_specifictargets", "quest_br_eliminate_location_sevenseals"]);
    // Week 5: the radar signs, the flaming hoops, and two weapon damage chains.
    assert.deepEqual(week(5), ["quest_br_recordspeed_radarsigns", "quest_br_touch_flamingrings_vehicle", "quest_br_damage_chain_shotgun_a", "quest_br_eliminate_maxdistance",
      "quest_br_damage_smg", "quest_br_eliminate_weapon_minigun", "quest_br_damage_chain_pistol_a"]);
    assert.deepEqual(week(6), ["quest_br_use_freezetrap", "quest_br_interact_chests_locations_different", "quest_br_eliminate_trap", "quest_br_land_chain_03a",
      "quest_br_damage_pickaxe", "quest_br_pianochain_visit_map1", "quest_br_eliminate_weapon_raritychain_grey"]);
    assert.deepEqual(week(7), ["quest_br_interact_ammoboxes_singlematch", "quest_br_damage_headshot", "quest_br_eliminate_weapon_shotgun", "quest_br_land_bulleyes_different",
      "quest_br_skydive_rings", "quest_br_interact_healingitems_questchain_01_a", "quest_br_eliminate_location_pleasantpark"]);
    // Every challenge a week names is in the data, and the staged ones lead on.
    for (const number of [1, 2, 3, 4, 5, 6, 7, 8, 9]) for (const quest of week(number)) assert.ok(getAthenaQuest(quest), quest);
    assert.deepEqual(["a", "b", "c"].map((stage) => getAthenaQuest(`quest_br_damage_chain_shotgun_${stage}`).objectives[0].stat),
      ["damage_athena_player_shotgun_tactical", "damage_athena_player_shotgun_pump", "damage_athena_player_shotgun_heavy"]);
    assert.deepEqual(getAthenaQuest("quest_br_damage_chain_pistol_a").rewards.at(-1), { quantity: 1, templateId: "Quest:quest_br_damage_chain_pistol_b" });
    assert.deepEqual(["quest_br_pianochain_visit_map1", "quest_br_pianochain_play_piano1", "quest_br_pianochain_visit_map2", "quest_br_pianochain_play_piano2"]
      .map((id) => getAthenaQuest(id).objectives[0].stat), ["giant_piano_visit_sheetmusic_1", "giant_piano_use_piano_1", "giant_piano_visit_sheetmusic_2", "giant_piano_use_piano_2"]);
    assert.equal(getAthenaQuest("quest_br_recordspeed_radarsigns").objectiveCompletionCount, 5);
    assert.equal(getAthenaQuest("quest_br_recordspeed_radarsigns").objectives.length, 7);
    assert.equal(getAthenaQuest("quest_br_use_freezetrap").objectives[0].stat, "place_trap_freeze");
    assert.equal(getAthenaQuest("quest_br_eliminate_maxdistance").objectives[0].stat, "killingblow_athena_player_under_5_meters");
    // "Use a Port-a-Fort" five times now, and Hunting Party's fourth week gives Season 6's own banner.
    assert.equal(getAthenaQuest("quest_br_use_portafort").objectives[0].count, 5);
    assert.deepEqual(getAthenaQuest("quest_br_s6_cumulative_quest4").hiddenRewards, [{ quantity: 1, templateId: "HomebaseBannerIcon:brseason06tattered" }]);
    // The Skull Trooper Challenges, eased: 300 damage and 6 chests in a single match (1,000 and 10 on 6.02).
    assert.equal(getAthenaQuest("quest_br_styles_skulltrooper_damage_singlematch").objectives[0].count, 300);
    assert.equal(getAthenaQuest("quest_br_styles_skulltrooper_interact_chests_singlematch").objectives[0].count, 6);
    assert.deepEqual(athenaChallengeBundles().questbundle_styles_skulltrooper, inBuild(v602, () => athenaChallengeBundles().questbundle_styles_skulltrooper));
    // The Rat King, the Weekly Store's new rifle, and the daily challenge token, an item now.
    assert.equal(getItem("Schematic:sid_assault_ratrod_slug_sr_ore_t01").class, "FortSchematicItemDefinition");
    assert.equal(getItem("Token:athena_dailychallenge_token").class, "FortTokenType");
  });
  assert.equal(inBuild(v602, () => getAthenaQuest("quest_br_styles_skulltrooper_damage_singlematch").objectives[0].count), 1000);
  assert.equal(inBuild(v602, () => getAthenaQuest("quest_br_recordspeed_radarsigns")), undefined);
  assert.equal(inBuild(v602, () => getItem("Token:athena_dailychallenge_token")), undefined);

  // The Quad Launcher's and the Grenade Launcher's weights in the rocket list (0.61 and 0.085, and 1.5, on 6.02).
  const rows = (build) => inBuild(build, athenaLootTables)["/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client"];
  const weights = (build) => ["Rocket.03", "Rocket.09", "Rocket.10"].map((row) => rows(build)[`WorldList.AthenaLoot.Weapon.${row}`].Weight);
  assert.deepEqual(weights(v610), [0.6, 0.3, 0.1]);
  assert.deepEqual(weights(v602), [1.5, 0.61, 0.085]);
  // The Quadcrasher is a vehicle the map places (Athena_QuadSpawner): no loot row names it.
  assert.equal(Object.values(rows(v610)).some((row) => /Quadcrasher|Antelope/i.test(JSON.stringify(row))), false);

  // Save the World: the Beta Storm's ten quests and its alert category are in the data (nothing serves them: the alert
  // rows aren't), and Fortnitemares 2017's Hexsylvania generators have left the paks.
  const [world610, world602] = [buildGameData(v610, "world", {}), buildGameData(v602, "world", {})];
  assert.deepEqual(world610.missionAlertCategories.NewMissionIntroductionCategory, { category: "NewMissionIntroductionCategory", quota: 5, repeatable: true });
  assert.equal(world602.missionAlertCategories.NewMissionIntroductionCategory, undefined);
  assert.equal(Object.keys(world610.missionGenerators).some((id) => /TRV/.test(id)), false);
  assert.equal(Object.keys(world602.missionGenerators).some((id) => /TRV/.test(id)), true);
  inBuild(v610, () => {
    for (let stage = 1; stage <= 10; stage++) assert.equal(getQuest(`newmissionintro_rtdredux_${stage}`).objectives[0].stat, `newmissionintro_rtdredux_${stage}`);
    assert.deepEqual(getQuest("autumnquest_explorezones_1"), inBuild(v600, () => getQuest("autumnquest_explorezones_1")), "Cram Session's quests are 6.00's still");
  });
  assert.equal(inBuild(v602, () => getQuest("newmissionintro_rtdredux_1")), undefined);
});

test("6.10 keeps Season 6's Battle Pass and what #334 carries over: the same tiers and schedules, the purchase's own gift box", () => {
  assert.deepEqual(inBuild(v610, athenaSeason), inBuild(v602, athenaSeason), "AthenaSeason6 is unchanged");
  const [schedules610, schedules602] = [inBuild(v610, athenaChallengeSchedules), inBuild(v602, athenaChallengeSchedules)];
  assert.deepEqual(schedules610, schedules602, "the schedules are 6.02's, Drift's and Ragnarok's kept past Season 5 among them");
  assert.deepEqual([schedules610.season5_progressivea_schedule.keptPastSeason, schedules610.season5_progressiveb_schedule.keptPastSeason], [5, 5]);
  assert.equal(schedules610.bundleschedule_styles_skulltrooper.cleanUpOnBundleCompletion, true);
  for (const build of builds610) {
    const dir = tempDir();
    try {
      const session = inBuild(build, () => {
        const opened = openSession(createProfileStore(dir), `pass${build}`);
        setUpAthena(opened);
        buyBattlePass(opened, seasonRewardFunctions());
        athenaQuestLogin(opened);
        return opened;
      });
      const athena = session.profile("athena").profile;
      assert.equal(athena.stats.attributes.book_purchased, true, build);
      assert.equal(inBuild(build, battlePassPurchaseGiftBox), "GiftBox:gb_battlepasspurchased", build);
      // The season's weeks are held with the pass, weeks 4 to 7's new challenges among them once their week unlocks.
      assert.ok(Object.values(athena.items).some(({ templateId }) => templateId === "ChallengeBundleSchedule:season6_paid_schedule"), build);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("6.10's event flags are 6.02's: LobbySeason6, the ticketless storms and Cram Session, every range run on to it", () => {
  for (const build of builds610) {
    assert.deepEqual(activeEventFlags(build), [passiveStorms, lobbySeason6, activeMiniBosses], build);
    assert.deepEqual(activeEventFlags(build), activeEventFlags(v602));
    assert.equal(inBuild(build, () => isEventActive(cramSession2018)), true);
  }
  // Every range that ran to 6.10 runs to 6.21 now (tests/build620.test.js, tests/build621.test.js), but BR.CandyCaneGuns',
  // whose item 6.20 drops.
  assert.deepEqual(season4Flag(lobbySeason6).builds, [4395664, 4526925]);
  assert.equal(season4Flag("EventFlag.BR.CandyCaneGuns").builds[1], Number(v610));
  for (const flag of ["EventFlag.SupplyDropBDay", "EventFlag.SupplyDropGift", "EventFlag.BR_S5_RiskyReels_Event",
    "EventFlag.Blockbuster2018Phase4", "EventFlag.Fortnitemares", "EventFlag.ActiveMiniBosses", "EventFlag.PassiveStorms"]) {
    assert.equal(season4Flag(flag).builds[1], 4526925, flag);
  }
  for (const flag of ["EventFlag.BR_S5_Cube_TurnOn", "EventFlag.LTM_Heist", "EventFlag.RoadTrip2018", "EventFlag.Horde"]) {
    assert.equal(season4Flag(flag).builds[1], Number(v541), flag);
  }
  // Halloween came with Update v6.20: nothing of it is served by itself.
  assert.equal(activeEventFlags(v610).includes("EventFlag.Fortnitemares"), false);
  withConfig(replay, () => assert.deepEqual(inBuild(v610, () => cubeStates(at("2018-10-17T00:00:00Z"))), [], "6.10 places no Cube"));
});

test("6.10 keeps the floating island and has its last stop: back over Loot Lake it is served _Rune8, where 6.00 to 6.02 get _Rune0", () => {
  const sixteen = [...[1, 2, 3, 4, 5, 6, 7, 8].map(islandMoveTo), ...[0, 1, 2, 3, 4, 5, 6, 7].map(islandRune)];
  for (const flag of sixteen) assert.deepEqual(season4Flag(flag).builds, [4395664, 4497486], flag);
  assert.deepEqual(season4Flag(islandRune(8)).builds, [Number(v6100), 4497486], "6.10's own, and 6.20's");
  const served = (build, iso) => inBuild(build, () => islandStates(at(iso)))[0].events.map(({ eventType }) => eventType);
  withConfig(replay, () => {
    // Until the island is back, 6.10 is served what 6.00 is.
    for (const iso of ["2018-09-27T12:00:00Z", "2018-10-03T12:00:00Z", "2018-10-13T12:00:00Z", "2018-10-16T12:00:00Z", "2018-10-18T12:00:00Z", "2018-10-20T12:00:00Z"]) {
      const on600 = inBuild(v600, () => islandStates(at(iso)));
      assert.equal(on600[0].events.length, 1, iso);
      for (const build of builds610) assert.deepEqual(inBuild(build, () => islandStates(at(iso)))[0], on600[0], `${build} at ${iso}`);
    }
    // Update v6.10's day: the island over Lazy Links' rune; then the map's middle, and the way back.
    assert.deepEqual(served(v610, "2018-10-16T12:00:00Z"), [islandRune(6)]);
    assert.deepEqual(served(v610, "2018-10-18T12:00:00Z"), [islandRune(7)]);
    assert.deepEqual(served(v610, "2018-10-20T12:00:00Z"), [islandMoveTo(8)]);
    // Back over Loot Lake, from 21 October to the season's end: _Rune8 on 6.10, _Rune0 before it.
    for (const iso of ["2018-10-21T00:00:00Z", "2018-11-15T00:00:00Z", "2018-12-05T12:00:00Z"]) {
      for (const build of builds610) assert.deepEqual(served(build, iso), [islandRune(8)], `${build} at ${iso}`);
      for (const build of [v600, v601, v6020, v602]) assert.deepEqual(served(build, iso), [islandRune(0)], `${build} at ${iso}`);
    }
    // The next lap starts over Loot Lake at rune 0 again.
    assert.deepEqual(served(v610, "2018-12-06T12:00:00Z"), [islandRune(0)]);
  });
  withConfig({ ...replay, datedFlags: { island: { mode: "off" } } },
    () => assert.deepEqual(inBuild(v610, () => islandStates(at("2018-10-22T12:00:00Z")))[0]?.events ?? [], [], "off by its switch"));
});

test("the admin panel's island stop reaches a 6.10 client's calendar on every changelist: home is _Rune8 there, _Rune0 on 6.02", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Island610");
    const islandServed = async (build, version = "6.10") => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": agentOf(build, version), Authorization: `bearer ${token}` } }))
      .body.channels["client-events"].states[0].activeEvents.map(({ eventType }) => eventType).filter((type) => type.startsWith("EventFlag.BR_S6_Island_"));
    for (const build of builds610) assert.deepEqual(await islandServed(build), [islandRune(0)], build);
    assert.equal((await post(backend.port, "/admin/api/events/dated-flags/move", null, { event: "island", to: "rune5" })).status, 200);
    for (const build of builds610) assert.deepEqual(await islandServed(build), [islandRune(5)], build);
    assert.equal((await post(backend.port, "/admin/api/events/dated-flags/move", null, { event: "island", to: "home" })).status, 200);
    for (const build of builds610) assert.deepEqual(await islandServed(build), [islandRune(8)], build);
    assert.deepEqual(await islandServed(v602, "6.02"), [islandRune(0)]);
  } finally {
    await backend.close();
  }
});

test("6.10's modes: 6.02's lobby with 50v50 a default playlist, two more Disco Dominations, Blitz! v2 and the glider redeploy defaults by their switches, Steady Storm gone", () => {
  const defaults = createSettingsStore(null).get();
  assert.equal(defaults.matchmakingModes.discoDomination602, true, "on unless turned off");
  const byTheirSwitch = ["discoDomination32", "highExplosivesSeason6Solo", "highExplosivesSeason6Squads", "discoDomination40", "discoDominationAlt",
    "blitzSeason6Solo", "blitzSeason6Duos", "blitzSeason6Squads", "gliderRedeploySolo", "gliderRedeployDuos", "gliderRedeploySquads"];
  for (const id of byTheirSwitch) assert.equal(defaults.matchmakingModes[id], false, id);
  // The tournament playlists are no lobby mode: they have no switch, and the panel's mode list leaves them out.
  for (const id of ["showdownSolo", "showdownDuos", "showdownSquads"]) {
    assert.equal(Object.hasOwn(defaults.matchmakingModes, id), false, id);
    assert.equal(ltmSchedule(defaults).list.some((ltm) => ltm.id === id), false, id);
  }
  for (const build of builds610) {
    assert.equal(ltmOfPlaylist(50, build).id, "fiftyFiftySeason6");
    assert.equal(ltmOfPlaylist(35, build).id, "playgroundV2");
    assert.equal(ltmOfPlaylist(202, build).id, "discoDomination602");
    assert.deepEqual([217, 218, 230, 23, 24, 36, 37, 19, 223, 224, 225, 58071, 58072, 58073].map((id) => ltmOfPlaylist(id, build).id),
      ["discoDomination32", "discoDomination40", "discoDominationAlt", "highExplosivesSeason6Solo", "highExplosivesSeason6Squads", "blitzSeason6Solo", "blitzSeason6Duos",
        "blitzSeason6Squads", "gliderRedeploySolo", "gliderRedeployDuos", "gliderRedeploySquads", "showdownSolo", "showdownDuos", "showdownSquads"]);
    for (const id of ["fiftyFiftySeason6", "playgroundV2", "discoDomination602"]) assert.equal(ltmOn(id, build, defaults), true, id);
    for (const id of ["soaring50s", ...byTheirSwitch, "showdownSolo", "showdownDuos", "showdownSquads"]) assert.equal(ltmOn(id, build, defaults), false, id);
    for (const id of ["steadyStormSeason6Solo", "steadyStormSeason6Duos", "steadyStormSeason6Squads", "discoDomination", "soaringSolos"]) assert.equal(hasLtm(id, build), false, id);
    assert.deepEqual(ltmPlaylistOverrides(build, defaults), ["Playlist_Playground", "Playlist_50v50", "Playlist_Disco"]);
    assert.deepEqual(ltmFrontEndPlaylists(build, defaults).map(({ name, enabled }) => [name, enabled]),
      [["Playlist_Playground", true], ["Playlist_Soaring_50s", false], ["Playlist_50v50", true], ["Playlist_Disco", true], ["Playlist_Disco_32", false],
        ["Playlist_HighExplosives_Solo", false], ["Playlist_HighExplosives_Squads", false], ["Playlist_Disco_40", false], ["Playlist_Disco_Alt", false],
        ["Playlist_Blitz_Solo", false], ["Playlist_Blitz_Duos", false], ["Playlist_Blitz_Squad", false], ["Playlist_GRD_Solo", false], ["Playlist_GRD_Duos", false],
        ["Playlist_GRD_Squads", false], ["Playlist_Showdown_Solo", false], ["Playlist_Showdown_Duos", false], ["Playlist_Showdown_Squads", false]]);
    for (const [name, id] of [["playlist_50v50", 50], ["playlist_playground", 35], ["playlist_defaultsolo", 2], ["playlist_disco", 202], ["playlist_disco_40", 218],
      ["playlist_disco_alt", 230], ["playlist_blitz_solo", 36], ["playlist_blitz_duos", 37], ["playlist_blitz_squad", 19], ["playlist_grd_solo", 223],
      ["playlist_grd_duos", 224], ["playlist_grd_squads", 225], ["playlist_showdown_solo", 58071], ["playlist_showdown_duos", 58072], ["playlist_showdown_squads", 58073]]) {
      assert.equal(playlistIdOfName(name, build), id, name);
      assert.equal(parseBucket(`${build}:0:NAE:${name}`, build).playlistId, id, name);
    }
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_disco_40`, build), { maxTeamCount: 2, maxTeamSize: 40, maxSquadSize: 4 });
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_disco_alt`, build), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_blitz_squad`, build), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_grd_duos`, build), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
    assert.deepEqual(["solo", "duos", "squads"].map((mode) => playlistTeamsOf(`${build}:0:NAE:playlist_showdown_${mode}`, build).maxTeamSize), [1, 2, 4]);
  }
  // 6.02's lobby is as it was: Steady Storm by its switches, none of 6.10's playlists.
  for (const build of [v6020, v602]) {
    for (const id of ["discoDomination40", "blitzSeason6Solo", "gliderRedeploySolo", "showdownSolo"]) assert.equal(hasLtm(id, build), false, id);
    assert.deepEqual(ltmFrontEndPlaylists(build, defaults).map(({ name }) => name),
      ["Playlist_Playground", "Playlist_Soaring_50s", "Playlist_50v50", "Playlist_Disco", "Playlist_Disco_32", "Playlist_HighExplosives_Solo",
        "Playlist_HighExplosives_Squads", "Playlist_Steady_Solo", "Playlist_Steady_Duos", "Playlist_Steady_Squads"]);
  }
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    // Update v6.10 keeps the mode ("What's New? Reduced all bandage spawns by 50%"): from its day to Update v6.20's.
    assert.equal(inOriginalWindow("discoDomination602", v610, at("2018-10-15T23:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("discoDomination602", v610, at("2018-10-16T00:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("discoDomination602", v6100, at("2018-10-23T23:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("discoDomination602", v610, at("2018-10-24T00:00:00Z"), dated), false);
    // 6.02's own window is unchanged.
    assert.equal(inOriginalWindow("discoDomination602", v602, at("2018-10-12T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("discoDomination602", v602, at("2018-10-16T00:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("playgroundV2", v610, at("2018-10-20T12:00:00Z"), dated), true, "Playground through Season 6");
    assert.equal(inOriginalWindow("blitzSeason6Solo", v610, at("2018-10-20T12:00:00Z"), dated), false, "nothing dates it");
  });
});

test("a 6.10 client's hotfix lists the lobby as shipped: 50v50 among the defaults and the three tournament playlists, disabled", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Lobby610");
    const gameIni = async (build, version) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": agentOf(build, version), Authorization: `bearer ${token}` } })).body.toString();
    for (const build of builds610) {
      const lines = (await gameIni(build, "6.10")).split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
      assert.equal(lines[0], "!FrontEndPlaylistData=ClearArray", build);
      const of = (name) => lines.find((line) => line.includes(`PlaylistName=${name},`));
      assert.equal(of("Playlist_50v50"), "+FrontEndPlaylistData=(PlaylistName=Playlist_50v50, PlaylistAccess=(bEnabled=true, bIsDefaultPlaylist=true, " +
        "bVisibleWhenDisabled=true, AdvertiseType=None, bDisplayAsLimitedTime=false, DisplayPriority=3))", build);
      assert.deepEqual(["Solo", "Duos", "Squads"].map((mode) => of(`Playlist_Showdown_${mode}`)), [50, 51, 52].map((priority, index) =>
        `+FrontEndPlaylistData=(PlaylistName=Playlist_Showdown_${["Solo", "Duos", "Squads"][index]}, PlaylistAccess=(bEnabled=false, bIsDefaultPlaylist=false, ` +
        `bVisibleWhenDisabled=false, AdvertiseType=None, bDisplayAsLimitedTime=false, DisplayPriority=${priority}))`), build);
      assert.match(of("Playlist_Disco"), /bEnabled=true, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false, AdvertiseType=New, bDisplayAsLimitedTime=true/);
      assert.match(of("Playlist_Playground"), /bEnabled=true, .*AdvertiseType=Updated, bDisplayAsLimitedTime=true, DisplayPriority=15/);
    }
    // 6.02's hotfix is as it was: 50v50 a limited time mode at 10, no tournament playlist.
    const lines602 = (await gameIni(v602, "6.02")).split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
    assert.ok(lines602.includes("+FrontEndPlaylistData=(PlaylistName=Playlist_50v50, PlaylistAccess=(bEnabled=true, bIsDefaultPlaylist=false, " +
      "bVisibleWhenDisabled=false, AdvertiseType=None, bDisplayAsLimitedTime=true, DisplayPriority=10))"));
    assert.equal(lines602.some((line) => line.includes("Showdown")), false);
  } finally {
    await backend.close();
  }
});

test("6.10's mode select: Disco Domination's tile and the returning modes', and Season 6's key art", () => {
  for (const build of builds610) {
    const playlists = playlistInformationFor(build).playlist_info.playlists;
    const tile = (name) => playlists.find(({ playlist_name: playlistName }) => playlistName === name)?.image ?? null;
    for (const name of ["Playlist_Disco", "Playlist_Disco_32"]) assert.match(tile(name), /BR06_LobbyTile_LTM_DiscoDomination/, name);
    assert.match(tile("Playlist_HighExplosives_Squads"), /HighExplosives/);
    assert.match(tile("Playlist_Playground"), /BR_LTM-Tile_Playground/);
    assert.deepEqual(subgameSelectImagesFor(build), subgameSelectImages[6], build);
  }
});

test("6.10's shop: Season 6's history with its eight cosmetics on their days; 6.02's days are as they were", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season6.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  const [c610, c602] = [inBuild(v610, athenaCosmetics), inBuild(v602, athenaCosmetics)];
  // The history holds 6.20's sixteen and 6.21's fourteen too (tests/build620.test.js, tests/build621.test.js); 6.10 is
  // shown its own.
  const c620 = inBuild("4526925", athenaCosmetics);
  assert.ok(history.every((day) => [...day.featured, ...day.daily].every(([id]) => c620[id])), "only 6.21's cosmetics");
  const days = (id) => history.filter((day) => [...day.featured, ...day.daily].some(([entry]) => entry === id)).map(({ date }) => date.slice(5));
  assert.deepEqual(days("AthenaPickaxe:pickaxe_id_110_vampire"), ["10-19", "10-20", "11-28"]);
  for (const id of ["AthenaCharacter:cid_248_athena_commando_m_blackwidow", "AthenaCharacter:cid_249_athena_commando_f_blackwidow",
    "AthenaPickaxe:pickaxe_id_111_blackwidow", "AthenaGlider:glider_id_086_blackwidow"]) assert.deepEqual(days(id), ["10-21", "10-22", "11-29"], id);
  for (const id of ["AthenaCharacter:cid_247_athena_commando_m_guanyu", "AthenaPickaxe:pickaxe_id_112_guanyu", "AthenaGlider:glider_id_087_guanyu"]) {
    assert.deepEqual(days(id), ["12-02", "12-03"], id);
  }
  const own = [...new Set(history.flatMap((day) => [...day.featured, ...day.daily]).map(([id]) => id).filter((id) => !c602[id] && c610[id]))];
  assert.equal(own.length, 8);
  assert.equal(history.filter((day) => !day.featured.some(([id]) => c610[id])).length, 22);

  const featured = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRWeeklyStorefront;
  for (const build of builds610) {
    // 21 October 2018: Spider Knight and Arachne with their back blings, Web Breaker and Hatchling.
    const spiders = featured(build, "2018-10-21T12:00:00Z");
    assert.deepEqual(spiders.map(({ title, price }) => [title, price]), [["Spider Knight", 2000], ["Arachne", 2000], ["Web Breaker", 800], ["Hatchling", 1200]], build);
    assert.deepEqual(spiders[0].itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_248_athena_commando_m_blackwidow", "AthenaBackpack:bid_132_blackwidowmale"]);
    assert.deepEqual(spiders[1].itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_249_athena_commando_f_blackwidow", "AthenaBackpack:bid_131_blackwidowfemale"]);
    // 19 October: Moonrise. 2 December: Guan Yu with his Loyal Shield, Guandao and Divine Dragon.
    assert.deepEqual(featured(build, "2018-10-19T12:00:00Z").map(({ title, price }) => [title, price]), [["Moonrise", 1200]]);
    const guanYu = featured(build, "2018-12-02T12:00:00Z");
    assert.deepEqual(guanYu.map(({ title, price }) => [title, price]), [["Guan Yu", 1500], ["Guandao", 800], ["Divine Dragon", 1200]]);
    assert.equal(guanYu[0].itemGrants.at(-1).templateId, "AthenaBackpack:bid_133_guanyu");
  }
  assert.equal(bundledBackBlings["AthenaCharacter:cid_247_athena_commando_m_guanyu"], "AthenaBackpack:bid_133_guanyu");
  // 6.02 has none of them: its days hold what they held.
  for (const iso of ["2018-10-19T12:00:00Z", "2018-10-21T12:00:00Z", "2018-12-02T12:00:00Z"]) assert.deepEqual(featured(v602, iso), [], iso);
  assert.deepEqual(featured(v602, "2018-11-29T12:00:00Z").map(({ title }) => title), ["Rabbit Raider", "Bunny Brawler", "Carrot Stick"]);
  for (const iso of ["2018-09-28T12:00:00Z", "2018-10-05T12:00:00Z", "2018-10-11T12:00:00Z", "2018-10-14T12:00:00Z", "2018-11-07T12:00:00Z"]) {
    assert.deepEqual(featured(v610, iso).map(({ templateId }) => templateId), featured(v602, iso).map(({ templateId }) => templateId), iso);
  }
});

test("6.10's Save the World: Cram Session runs on, with the Rat King and the Grave Digger in the Weekly Store from 18 October; no Beta Storm quest is given", () => {
  withConfig(replay, () => {
    for (const build of builds610) {
      inBuild(build, () => {
        assert.deepEqual(eventQuests(), cramSessionQuests);
        assert.ok(cramSessionQuests.every((id) => getQuest(id)));
        assert.equal(eventQuests().some((id) => id.startsWith("newmissionintro")), false);
        const weekly = (iso) => eventStoreOffers(at(iso))[weeklyStorefront].slice(0, 2).map(({ templateId, price }) => [templateId, price]);
        // "Available Wednesday, October 17 at 8 PM ET until Wednesday, October 24 at 8 PM ET."
        assert.deepEqual(weekly("2018-10-18T00:00:00Z"), [["Schematic:sid_assault_ratrod_slug_sr_ore_t01", 1680], ["Schematic:sid_assault_auto_halloween_sr_ore_t01", 1680]]);
        assert.deepEqual(weekly("2018-10-23T12:00:00Z"), weekly("2018-10-18T00:00:00Z"));
        // Before it, 6.02's week, 6.01's and 6.00's.
        assert.deepEqual(weekly("2018-10-17T23:00:00Z"), [["Schematic:sid_explosive_launcher_neonglow_sr_ore_t01", 1680], ["Schematic:sid_shotgun_standard_vt_sr_ore_t01", 1680]]);
        assert.deepEqual(weekly("2018-10-10T23:00:00Z"), [["Schematic:sid_blunt_hammer_ratrod_sr_ore_t01", 1680], ["Schematic:sid_sniper_military_sr_ore_t01", 1680]]);
        assert.deepEqual(weekly("2018-10-03T23:00:00Z"), [["Schematic:sid_pistol_ratrod_sr_ore_t01", 1680], ["Schematic:sid_blunt_hammer_hydraulic_vr_ore_t01", 600]]);
        const now = at("2018-10-19T12:00:00Z");
        assert.deepEqual(eventStoreOffers(now)[eventStorefront].map(({ templateId }) => templateId), cramSessionEventItems.map(({ templateId }) => templateId));
        assert.equal(eventStoreEnds(now).stwEventStoreEnd.toISOString(), "2018-12-06T00:00:00.000Z");
        assert.equal(stwMfaRewardOffered(), true);
      });
    }
    // 6.02 keeps its own week through the replay.
    assert.deepEqual(inBuild(v602, () => eventStoreOffers(at("2018-10-19T12:00:00Z")))[weeklyStorefront].slice(0, 2).map(({ templateId }) => templateId),
      ["Schematic:sid_explosive_launcher_neonglow_sr_ore_t01", "Schematic:sid_shotgun_standard_vt_sr_ore_t01"]);
  });
});

test("6.02's work on 6.10: the outfits' challenges for their owners, Support-A-Creator's hotfix, on every changelist", () => {
  for (const build of builds610) {
    const dir = tempDir();
    try {
      inBuild(build, () => {
        const session = openSession(createProfileStore(dir), `skull${build}`);
        setUpAthena(session);
        grantCosmetic(session, "AthenaCharacter:cid_030_athena_commando_m_halloween");
        athenaQuestLogin(session);
        const held = Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);
        assert.ok(held.includes("ChallengeBundleSchedule:bundleschedule_styles_skulltrooper"), build);
        assert.ok(held.includes("Quest:quest_br_styles_skulltrooper_damage_singlematch"), build);
        assert.equal(held.includes("ChallengeBundleSchedule:bundleschedule_styles_tomatohead"), false, "no Tomatohead in the locker");
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(affiliateOffered(build, { creatorNames: ["Pongo"] }), true, build);
    assert.deepEqual(affiliateRuntimeOptions(build, { creatorNames: ["Pongo"] }),
      ["bDisableAffiliateFeature=false", "bUseHotfixedAffiliateNamesArray=true", "!AffiliateNames=ClearArray", "+AffiliateNames=Pongo"]);
    assert.deepEqual(affiliateRuntimeOptions(build, { creatorNames: [] }), []);
  }
});

// The in-game tournaments (tournaments/showdown.js).
const soloTable = rulesets.soloShowdownJuly2018;
const eventOn = (store, options, now) => store.create({ name: "Core Cup", playlist: "showdownSolo", ruleset: "soloShowdownJuly2018", ...options }, now);

test("the tournament playlists: 4.2's Solo Showdown and 6.10's three, the in-game ones; an event's pin score is an in-game event's", () => {
  assert.deepEqual(tournamentPlaylists.map(({ id, playlistId, inGame }) => [id, playlistId, inGame]),
    [["soloShowdown", 51, false], ["showdownSolo", 58071, true], ["showdownDuos", 58072, true], ["showdownSquads", 58073, true],
      // 6.20's Fortnitemares ones (tests/build620.test.js).
      ["fortnitemaresShowSolo", 59071, true], ["fortnitemaresShowDuos", 59072, true], ["fortnitemaresShowSquads", 59073, true]]);
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    assert.equal(eventOn(store, { pinScore: 250 }).pinScore, 250);
    assert.equal(eventOn(store, {}).pinScore, null);
    assert.equal(Object.hasOwn(store.create({ playlist: "soloShowdown", pinScore: 250 }), "pinScore"), false, "4.2's has no pin");
    for (const bad of [0, -5, 1.5, "many", 1000001]) assert.throws(() => eventOn(store, { pinScore: bad }), /pin score/, String(bad));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const build of builds610) assert.equal(hasShowdown(build), true, build);
  for (const build of [v602, v6020, v601, v600, "4072250", "3724489"]) assert.equal(hasShowdown(build), false, build);
});

test("an in-game event as the client reads it: one tournament of one window, the event's scoring as reward tiers that add up to its points", () => {
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    const created = at("2026-11-12T10:00:00.000Z");
    assert.deepEqual(tournamentAndHistory("player", v610, created, store), { eventTournaments: [], eventWindowHistories: [] }, "nothing by default");
    const event = eventOn(store, { startsAt: "2026-11-12T18:00:00.000Z", endsAt: "2026-11-12T21:00:00.000Z", pinScore: 300 }, created);
    const { eventTournaments, eventWindowHistories } = tournamentAndHistory("player", v610, created, store);
    assert.deepEqual(eventWindowHistories, []);
    assert.equal(eventTournaments.length, 1);
    const [tournament] = eventTournaments;
    assert.deepEqual({ ...tournament, eventWindows: undefined }, { tournamentId: event.id, regions: [], platformGroups: [], displayDataId: event.id,
      announcementTime: "2026-11-12T10:00:00.000Z", beginTime: "2026-11-12T10:00:00.000Z", endTime: "2026-11-12T21:00:00.000Z", eventWindows: undefined });
    assert.equal(tournament.eventWindows.length, 1);
    const [window] = tournament.eventWindows;
    // The countdown begins with the announcement (#336): the lobby's Showdown state from the first list that holds it.
    assert.deepEqual({ ...window, eventData: undefined }, { eventWindowId: event.id, countdownBeginTime: "2026-11-12T10:00:00.000Z", beginTime: "2026-11-12T18:00:00.000Z",
      endTime: "2026-11-12T21:00:00.000Z", bIsTBD: false, eventData: undefined });
    assert.equal(window.eventData.playlistId, "Playlist_Showdown_Solo");
    assert.deepEqual(window.eventData.rewardTable, []);
    assert.deepEqual(window.eventData.scoringRules.map(({ trackedStat, rewardTiers }) => [trackedStat, rewardTiers.length]),
      [[placementStat, soloTable.placementPoints.length], [eliminationsStat, maxEliminationTiers]]);
    // The tiers add up to the event's points for every placement and elimination count the tiers reach.
    const { placement, eliminations } = showdownTiers(event);
    assert.deepEqual(placement.slice(0, 3), [{ keyValue: 1, pointsEarned: 6 }, { keyValue: 2, pointsEarned: 3 }, { keyValue: 3, pointsEarned: 3 }]);
    assert.deepEqual(placement.at(-1), { keyValue: 100, pointsEarned: 25 });
    assert.deepEqual(eliminations[0], { keyValue: 1, pointsEarned: 6 });
    for (const place of [1, 2, 7, 10, 11, 33, 76, 100, 101]) {
      for (const kills of [0, 1, 5, maxEliminationTiers]) {
        const tiered = placement.filter((tier) => place <= tier.keyValue).reduce((total, tier) => total + tier.pointsEarned, 0)
          + eliminations.filter((tier) => kills >= tier.keyValue).reduce((total, tier) => total + tier.pointsEarned, 0);
        assert.equal(tiered, matchPoints(soloTable, { place, kills }), `place ${place}, ${kills} eliminations`);
      }
    }
    // An event without dates runs from its creation, with no end; one of 4.2's playlist isn't an in-game event.
    const open = eventOn(store, { name: "Open Cup", playlist: "showdownDuos", ruleset: "soloShowdownMay2018" }, at("2026-11-12T10:05:00.000Z"));
    store.create({ name: "Solo Showdown", playlist: "soloShowdown" }, at("2026-11-12T10:06:00.000Z"));
    const listed = tournamentAndHistory("player", v6100, at("2026-11-12T10:10:00.000Z"), store).eventTournaments;
    assert.deepEqual(listed.map(({ tournamentId }) => tournamentId), [event.id, open.id], "oldest first");
    assert.deepEqual([listed[1].beginTime, listed[1].endTime, listed[1].eventWindows[0].beginTime, listed[1].eventWindows[0].eventData.playlistId],
      ["2026-11-12T10:05:00.000Z", "9999-12-31T23:59:59.000Z", "2026-11-12T10:05:00.000Z", "Playlist_Showdown_Duos"]);
    assert.deepEqual(listed[1].eventWindows[0].eventData.scoringRules.map(({ trackedStat }) => trackedStat), [placementStat], "May's rules count no eliminations");
    // Every 6.10 changelist is offered them; an earlier build, which has no Events tab, none.
    for (const build of builds610) assert.equal(showdownEvents(build, at("2026-11-12T10:10:00.000Z"), store).length, 2, build);
    for (const build of [v602, v601, "4072250"]) assert.deepEqual(tournamentAndHistory("player", build, at("2026-11-12T10:10:00.000Z"), store), { eventTournaments: [], eventWindowHistories: [] }, build);
    // An ended event stays for two weeks, as a completed tournament.
    store.end(open.id, at("2026-11-12T11:00:00.000Z"));
    assert.equal(tournamentAndHistory("player", v610, at("2026-11-20T00:00:00.000Z"), store).eventTournaments.find(({ tournamentId }) => tournamentId === open.id).endTime, "2026-11-12T11:00:00.000Z");
    assert.equal(tournamentAndHistory("player", v610, at("2026-11-27T00:00:00.000Z"), store).eventTournaments.some(({ tournamentId }) => tournamentId === open.id), false);

    // The content page's entry for the tile, by the tournament's displayDataId.
    const info = tournamentInformationFor(v610, created, store);
    assert.deepEqual(info.tournament_info.tournaments.map((entry) => entry.tournament_display_id), [event.id, open.id]);
    const entry = info.tournament_info.tournaments[0];
    assert.deepEqual([entry.title_line_1, entry.title_line_2, entry.short_format_title, entry.long_format_title, entry.pin_score_requirement],
      ["Core Cup", "Solo", "Core Cup", "Core Cup (Solo)", 300]);
    assert.equal(entry.schedule_info, "2026-11-12 18:00 UTC to 2026-11-12 21:00 UTC");
    assert.match(entry.details_description, /Points for placement and 6 for each elimination\. Your first 25 matches count\./);
    assert.equal(Object.hasOwn(info.tournament_info.tournaments[1], "pin_score_requirement"), false, "no pin without a pin score");
    assert.equal(tournamentInformationFor(v602, created, store), undefined, "6.02 has no such page");
    assert.deepEqual(tournamentInformationFor(v610, created, createTournamentStore(tempDir())).tournament_info.tournaments, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a player's history in an in-game event: the matches, the team, and the points by the tier they were for", () => {
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    const now = at("2026-11-12T10:00:00.000Z");
    const solo = eventOn(store, {}, now);
    store.recordResult("ann", 58071, { place: 1, kills: 3, matchId: "m1", build: v610, team: ["ann"] }, now);
    store.recordResult("ann", 58071, { place: 12, kills: 0, matchId: "m2", build: v610, team: ["ann"] }, now);
    store.recordResult("ann", 58071, { place: 12, kills: 0, matchId: "m2", build: v610, team: ["ann"] }, now);
    const [history, ...more] = historiesOf(store.get(solo.id), "ann");
    assert.deepEqual(more, []);
    assert.deepEqual([history.tournamentId, history.eventWindowId, history.matchIds, history.teammateIds], [solo.id, solo.id, ["m1", "m2"], ["ann"]]);
    // 100 + 3 × 6 for the win, 55 for twelfth.
    assert.equal(history.payload.pointsEarned, 173);
    const breakdown = history.payload.pointBreakdown;
    assert.equal(Object.values(breakdown).reduce((total, { pointsEarned }) => total + pointsEarned, 0), 173, "the breakdown is the points");
    assert.deepEqual(breakdown[`${placementStat}:1`], { timesAchieved: 1, pointsEarned: 6 }, "one Victory Royale");
    assert.deepEqual(breakdown[`${placementStat}:15`], { timesAchieved: 2, pointsEarned: 10 });
    assert.deepEqual(breakdown[`${placementStat}:100`], { timesAchieved: 2, pointsEarned: 50 });
    assert.deepEqual([1, 2, 3, 4].map((count) => breakdown[`${eliminationsStat}:${count}`]),
      [{ timesAchieved: 1, pointsEarned: 6 }, { timesAchieved: 1, pointsEarned: 6 }, { timesAchieved: 1, pointsEarned: 6 }, undefined]);
    // Eliminations past the last tier still score, on that tier's entry.
    store.recordResult("bob", 58071, { place: 50, kills: maxEliminationTiers + 2, matchId: "m3", build: v610, team: ["bob"] }, now);
    const bob = historiesOf(store.get(solo.id), "bob")[0].payload;
    assert.equal(bob.pointsEarned, 35 + 6 * (maxEliminationTiers + 2));
    assert.equal(Object.values(bob.pointBreakdown).reduce((total, { pointsEarned }) => total + pointsEarned, 0), bob.pointsEarned);
    assert.deepEqual(bob.pointBreakdown[`${eliminationsStat}:${maxEliminationTiers}`], { timesAchieved: 1, pointsEarned: 18 });

    // A duo's history names both players; another partner is another history.
    const duos = eventOn(store, { name: "Duo Cup", playlist: "showdownDuos" }, now);
    store.recordResult("ann", 58072, { place: 2, kills: 4, matchId: "d1", build: v610, team: ["ann", "bob"] }, now);
    store.recordResult("ann", 58072, { place: 9, kills: 1, matchId: "d2", build: v610, team: ["cat", "ann"] }, now);
    assert.deepEqual(historiesOf(store.get(duos.id), "ann").map(({ teammateIds, matchIds, payload }) => [teammateIds, matchIds, payload.pointsEarned]),
      [[["ann", "bob"], ["d1"], 94 + 24], [["ann", "cat"], ["d2"], 65 + 6]]);

    // Both ways the client asks: with the list, and one window's alone.
    const answer = tournamentAndHistory("ann", v610, now, store);
    assert.deepEqual(answer.eventWindowHistories.map(({ eventWindowId }) => eventWindowId), [solo.id, duos.id, duos.id]);
    assert.deepEqual(eventWindowHistory("ann", solo.id, v610, now, store), [history]);
    assert.deepEqual(eventWindowHistory("nobody", solo.id, v610, now, store), []);
    assert.equal(eventWindowHistory("ann", "no-such-window", v610, now, store), null);
    assert.equal(eventWindowHistory("ann", solo.id, v602, now, store), null, "6.02 isn't offered it");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a ticket for a tournament playlist: taken while an event of it runs, for a full party; refused as Epic's service named it", () => {
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    const now = at("2026-11-12T12:00:00.000Z");
    const code = (ticket, when = now) => showdownTicket({ build: v610, ...ticket }, when, store).error?.code?.split(".").pop() ?? null;
    assert.equal(code({ playlistId: 58071, partySize: 1 }), "event_window_time_invalid", "no event");
    const solo = eventOn(store, { startsAt: "2026-11-12T13:00:00.000Z", endsAt: "2026-11-12T15:00:00.000Z" }, at("2026-11-12T11:00:00.000Z"));
    assert.equal(code({ playlistId: 58071, tournamentId: solo.id, windowId: solo.id, partySize: 1 }), "event_window_time_invalid", "not begun");
    const during = at("2026-11-12T13:30:00.000Z");
    assert.equal(showdownTicket({ playlistId: 58071, tournamentId: solo.id, windowId: solo.id, partySize: 1, build: v610 }, during, store).event.id, solo.id);
    assert.equal(showdownTicket({ playlistId: 58071, partySize: 1, build: v6100 }, during, store).event.id, solo.id, "a ticket that names none takes the running one");
    assert.equal(code({ playlistId: 58071, tournamentId: "nope", windowId: solo.id, partySize: 1 }, during), "invalid_tournament_id");
    assert.equal(code({ playlistId: 58071, tournamentId: solo.id, windowId: "nope", partySize: 1 }, during), "invalid_event_window_id");
    assert.equal(code({ playlistId: 58071, tournamentId: solo.id, windowId: solo.id, partySize: 2 }, during), "wrong_number_of_event_players");
    assert.equal(code({ playlistId: 58072, tournamentId: solo.id, windowId: solo.id, partySize: 2 }, during), "invalid_tournament_id", "another playlist's event");
    assert.equal(code({ playlistId: 58071, tournamentId: solo.id, windowId: solo.id, partySize: 1 }, at("2026-11-12T15:00:00.000Z")), "event_window_time_invalid", "over");
    assert.equal(code({ playlistId: 58071, tournamentId: solo.id, windowId: solo.id, partySize: 1, build: v602 }, during), "invalid_tournament_id", "6.02 has no such playlist");
    const squads = eventOn(store, { name: "Squad Cup", playlist: "showdownSquads" }, at("2026-11-12T11:00:00.000Z"));
    assert.equal(code({ playlistId: 58073, tournamentId: squads.id, windowId: squads.id, partySize: 3 }), "wrong_number_of_event_players");
    assert.equal(showdownTicket({ playlistId: 58073, tournamentId: squads.id, windowId: squads.id, partySize: 4, build: v610 }, now, store).event.id, squads.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the Events tab's hotfix lines: the list refreshed each lobby, an event or not (#336), the tab hidden only by the admin's switch", () => {
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    const now = at("2026-11-12T12:00:00.000Z");
    assert.equal(createSettingsStore(null).get().hideEmptyEventsTab, false, "off by default");
    for (const build of builds610) {
      // An empty list isn't kept for ten hours either: an event made after the game started shows at the next lobby.
      assert.deepEqual(showdownRuntimeOptions(build, { hideEmptyEventsTab: false }, now, store), ["ShowdownTournamentCacheExpirationHours=0"], build);
      assert.deepEqual(showdownRuntimeOptions(build, { hideEmptyEventsTab: true }, now, store), ["bEnableShowdown=false"], build);
    }
    assert.deepEqual(showdownRuntimeOptions(v602, { hideEmptyEventsTab: true }, now, store), [], "6.02 has no such option to set");
    eventOn(store, {}, now);
    for (const hide of [false, true]) assert.deepEqual(showdownRuntimeOptions(v610, { hideEmptyEventsTab: hide }, now, store), ["ShowdownTournamentCacheExpirationHours=0"]);
    assert.deepEqual(showdownRuntimeOptions(v602, {}, now, store), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
const asBuild = (build, version = "6.10") => (port, urlPath, token, method = "GET", body) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agentOf(build, version), ...(token ? { Authorization: `bearer ${token}` } : {}) };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
};

// 6.10's MatchmakingServiceClient is 6.02's but for the two tournament attributes (CL-4480234's exe against
// CL-4461277's: player.option.tournamentId and player.option.windowId are its only new ticket strings). A 6.10 player, on
// any changelist, takes a ticket for Solo, Disco Domination and Playground and is sent to a registered 6.10 server.
test("a 6.10 player matchmakes on every changelist: Solo, Disco Domination and Playground reach Queued and a 6.10 server", async () => {
  for (const build of builds610) {
    const as = asBuild(build);
    const backend = await startBackend({ matchmakingGatherMs: 100 });
    const clients = [];
    try {
      const server = await userLogin(backend.port, `Server${build}`);
      for (const playlist of ["playlist_defaultsolo", "playlist_disco", "playlist_playground"]) {
        const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
          ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
          maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
        })).body;
        const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
          `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
          server.token)).body));
        clients.push(gameserver);
        assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
        const player = await userLogin(backend.port, `P${build}${playlist.length}`);
        const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
          `&bucketId=${build}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
        assert.equal(ticket.status, 200, `${build} ${playlist}: ${JSON.stringify(ticket.body)}`);
        const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
        clients.push(client);
        const states = [];
        for (;;) {
          const { name, payload } = JSON.parse(await client.next());
          states.push(name === "StatusUpdate" ? payload.state : name);
          if (states.at(-1) === "Queued") break;
        }
        assert.deepEqual(states, ["Connecting", "Waiting", "Queued"], `${build} ${playlist}`);
        const assign = await nextOf(gameserver, "AssignMatch");
        assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${build}:0:NAE:${playlist}`);
        gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
        const play = await nextOf(client, "Play");
        assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
        gameserver.close();
      }
      // The modes by their switches are refused until turned on; Steady Storm isn't 6.10's at all.
      const player = await userLogin(backend.port, `Off${build}`);
      const ticketFor = (playlist) => as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${build}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
      for (const playlist of ["playlist_disco_40", "playlist_blitz_solo", "playlist_grd_solo", "playlist_highexplosives_squads"]) {
        const refused = await ticketFor(playlist);
        assert.deepEqual([refused.status, refused.body.errorCode], [400, "errors.com.epicgames.fortnite.matchmaking_disabled"], playlist);
      }
      assert.equal((await post(backend.port, "/admin/api/matchmaking/config", null, { modes: { blitzSeason6Solo: true, discoDomination602: false } })).status, 200);
      assert.equal((await ticketFor("playlist_blitz_solo")).status, 200);
      assert.equal((await ticketFor("playlist_disco")).status, 400, "switched off");
    } finally {
      for (const client of clients) client.close();
      backend.close();
    }
  }
});

test("a 6.10 client's Events tab end to end: the empty list, an admin's event listed, queued for with its ids, scored from the match and read back", async () => {
  for (const build of builds610) {
    const as = asBuild(build);
    const backend = await startBackend({ matchmakingGatherMs: 100 });
    const clients = [];
    try {
      const ann = await userLogin(backend.port, `Ann${build}`);
      const base = "/fortnite/api/game/v2/events";
      const list = () => as(backend.port, `${base}/tournamentandhistory/${ann.accountId}/NAE/WindowsClient`, ann.token);
      const pageOf = async () => (await as(backend.port, "/content/api/pages/fortnite-game", ann.token)).body.tournamentinformation;
      const runtimeIni = async () => (await as(backend.port, "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini", ann.token)).body.toString();

      // As shipped: the tab's request is answered with no tournament and the page has none; the hotfix only keeps the
      // empty list from being cached (#336), so an event made later shows at the next lobby.
      const empty = await list();
      assert.deepEqual([empty.status, empty.body], [200, { eventTournaments: [], eventWindowHistories: [] }], build);
      assert.deepEqual((await pageOf()).tournament_info.tournaments, []);
      assert.match(await runtimeIni(), /\r\nShowdownTournamentCacheExpirationHours=0\r\n/);
      assert.equal(/bEnableShowdown/.test(await runtimeIni()), false);
      // Somebody else's list isn't the player's to read, and a tournament ticket without an event is refused.
      const bob = await userLogin(backend.port, `Bob${build}`);
      assert.equal((await as(backend.port, `${base}/tournamentandhistory/${bob.accountId}/NAE/WindowsClient`, ann.token)).status, 403);
      const ticketFor = (player, query = "") => as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${build}:0:NAE:playlist_showdown_solo&player.platform=Windows${query}`, player.token);
      const refused = await ticketFor(ann);
      assert.deepEqual([refused.status, refused.body.errorCode], [400, "errors.com.epicgames.fortnite.event_window_time_invalid"]);
      // The admin's switch hides the empty tab.
      assert.equal((await post(backend.port, "/admin/api/settings", null, { hideEmptyEventsTab: true })).status, 200);
      assert.match(await runtimeIni(), /\r\nbEnableShowdown=false\r\n/);
      assert.equal((await as(backend.port, "/admin/api/tournaments", null)).body.hideEmptyEventsTab, true);

      // The admin makes an event on the Solo tournament playlist: it is listed, with its tile's texts.
      const made = await post(backend.port, "/admin/api/tournaments", null, { name: "Core Cup", playlist: "showdownSolo", ruleset: "soloShowdownJuly2018", pinScore: 150 });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      const eventId = made.body.event.id;
      assert.deepEqual(made.body.playlists.map(({ id, inGame }) => [id, inGame]),
        [["soloShowdown", false], ["showdownSolo", true], ["showdownDuos", true], ["showdownSquads", true],
          ["fortnitemaresShowSolo", true], ["fortnitemaresShowDuos", true], ["fortnitemaresShowSquads", true]]);
      const listed = (await list()).body;
      assert.deepEqual(listed.eventTournaments.map(({ tournamentId, displayDataId }) => [tournamentId, displayDataId]), [[eventId, eventId]]);
      assert.equal(listed.eventTournaments[0].eventWindows[0].eventData.playlistId, "Playlist_Showdown_Solo");
      const entry = (await pageOf()).tournament_info.tournaments[0];
      assert.deepEqual([entry.tournament_display_id, entry.title_line_1, entry.pin_score_requirement], [eventId, "Core Cup", 150]);
      const ini = await runtimeIni();
      assert.match(ini, /\r\nShowdownTournamentCacheExpirationHours=0\r\n/);
      assert.equal(/bEnableShowdown/.test(ini), false, "the tab has a tournament");
      // A 6.02 client is offered nothing of it.
      const on602 = asBuild(v602, "6.02");
      assert.deepEqual((await on602(backend.port, `${base}/tournamentandhistory/${ann.accountId}/NAE/WindowsClient`, ann.token)).body, { eventTournaments: [], eventWindowHistories: [] });
      assert.equal((await on602(backend.port, "/content/api/pages/fortnite-game", ann.token)).body.tournamentinformation, undefined);

      // Queueing: the ticket names the tournament and its window; a wrong id is Epic's refusal.
      const wrong = await ticketFor(ann, "&player.option.tournamentId=nope&player.option.windowId=nope");
      assert.deepEqual([wrong.status, wrong.body.errorCode], [400, "errors.com.epicgames.fortnite.invalid_tournament_id"]);
      const server = await userLogin(backend.port, `Server${build}`);
      const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
        ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
        maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
      })).body;
      const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
        `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
        server.token)).body));
      clients.push(gameserver);
      assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
      const ticket = await ticketFor(ann, `&player.option.tournamentId=${eventId}&player.option.windowId=${eventId}`);
      assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
      const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
      clients.push(client);
      assert.ok(await nextOf(client, "Queued"));
      const assign = await nextOf(gameserver, "AssignMatch");
      assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${build}:0:NAE:playlist_showdown_solo`);
      gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
      assert.ok(await nextOf(client, "Play"));

      // The game server's match report scores it: second place with four eliminations, 94 + 4 × 6.
      const serverToken = await dedicatedServerToken(backend.port);
      const report = await as(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", serverToken, "POST",
        { playlistId: 58071, matchId: "0123456789abcdef0123456789abcdef", results: [{ accountId: ann.accountId, place: 2, kills: 4, secondsAlive: 900 }] });
      assert.equal(report.status, 200, JSON.stringify(report.body));
      const history = await as(backend.port, `${base}/eventwindowhistory/${ann.accountId}/${eventId}`, ann.token);
      assert.equal(history.status, 200);
      assert.deepEqual(history.body.map(({ tournamentId, eventWindowId, matchIds, teammateIds, payload }) => [tournamentId, eventWindowId, matchIds, teammateIds, payload.pointsEarned]),
        [[eventId, eventId, ["0123456789abcdef0123456789abcdef"], [ann.accountId], 118]]);
      assert.deepEqual(history.body[0].payload.pointBreakdown[`${eliminationsStat}:4`], { timesAchieved: 1, pointsEarned: 6 });
      assert.deepEqual((await list()).body.eventWindowHistories, history.body);
      assert.deepEqual((await as(backend.port, `${base}/eventwindowhistory/${bob.accountId}/${eventId}`, bob.token)).body, []);
      const unknown = await as(backend.port, `${base}/eventwindowhistory/${ann.accountId}/nope`, ann.token);
      assert.deepEqual([unknown.status, unknown.body.errorCode], [404, "errors.com.epicgames.fortnite.invalid_event_window_id"]);
      // The panel's leaderboard has the same points.
      const board = (await as(backend.port, "/admin/api/tournaments", null)).body.events.find(({ id }) => id === eventId).leaderboard;
      assert.deepEqual(board.map(({ accountId, points, eliminations }) => [accountId, points, eliminations]), [[ann.accountId, 118, 4]]);

      // Epic's own report (FMcpTournamentStats) is taken from a game server: once a match, and not from a player.
      const stats = { tournamentId: eventId, eventWindowId: eventId, teamAccountIds: [bob.accountId], matchId: "fedcba9876543210fedcba9876543210", numTeamEliminations: 1, finalTeamPlacement: 1 };
      assert.equal((await as(backend.port, `${base}/reporttournamentstats`, bob.token, "POST", stats)).status, 403);
      assert.equal((await as(backend.port, `${base}/reporttournamentstats`, serverToken, "POST", stats)).status, 204);
      assert.equal((await as(backend.port, `${base}/reporttournamentstats`, serverToken, "POST", stats)).status, 204);
      assert.deepEqual((await as(backend.port, `${base}/eventwindowhistory/${bob.accountId}/${eventId}`, bob.token)).body.map(({ matchIds, payload }) => [matchIds.length, payload.pointsEarned]), [[1, 106]]);
      const missing = await as(backend.port, `${base}/reporttournamentstats`, serverToken, "POST", { ...stats, tournamentId: "nope" });
      assert.deepEqual([missing.status, missing.body.errorCode], [404, "errors.com.epicgames.fortnite.invalid_tournament_id"]);

      // Ended in the panel: no more tickets, and the tab has it as a completed tournament.
      assert.equal((await post(backend.port, `/admin/api/tournaments/${eventId}/end`, null, {})).status, 200);
      const over = await ticketFor(ann, `&player.option.tournamentId=${eventId}&player.option.windowId=${eventId}`);
      assert.deepEqual([over.status, over.body.errorCode], [400, "errors.com.epicgames.fortnite.event_window_time_invalid"]);
      assert.equal(Date.parse((await list()).body.eventTournaments[0].endTime) <= Date.now(), true);
    } finally {
      for (const client of clients) client.close();
      backend.close();
    }
  }
});

test("a duo's tournament match: the report's two players of one place are the team, its eliminations theirs together", async () => {
  const backend = await startBackend();
  try {
    const as = asBuild(v610);
    const [ann, bob, cat] = await Promise.all(["DuoAnn", "DuoBob", "DuoCat"].map((name) => userLogin(backend.port, name)));
    const made = await post(backend.port, "/admin/api/tournaments", null, { name: "Duo Cup", playlist: "showdownDuos", ruleset: "soloShowdownJuly2018" });
    const eventId = made.body.event.id;
    const serverToken = await dedicatedServerToken(backend.port);
    const report = await as(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", serverToken, "POST", { playlistId: 58072, matchId: "00000000000000000000000000000610",
      results: [{ accountId: ann.accountId, place: 3, kills: 2, secondsAlive: 800 }, { accountId: bob.accountId, place: 3, kills: 5, secondsAlive: 820 },
        { accountId: cat.accountId, place: 40, kills: 1, secondsAlive: 300 }] });
    assert.equal(report.status, 200);
    const historyOf = async (player) => (await as(backend.port, `/fortnite/api/game/v2/events/eventwindowhistory/${player.accountId}/${eventId}`, player.token)).body;
    const team = [ann.accountId, bob.accountId].sort();
    // Third place, seven eliminations between them: 91 + 7 × 6 each.
    for (const player of [ann, bob]) {
      assert.deepEqual((await historyOf(player)).map(({ teammateIds, payload }) => [teammateIds, payload.pointsEarned]), [[team, 133]], player.accountId);
    }
    assert.deepEqual((await historyOf(cat)).map(({ teammateIds, payload }) => [teammateIds, payload.pointsEarned]), [[[cat.accountId], 46]]);
    // A duo's ticket needs both players.
    const alone = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${ann.accountId}?partyPlayerIds=${ann.accountId}` +
      `&bucketId=${v610}:0:NAE:playlist_showdown_duos&player.platform=Windows&player.option.tournamentId=${eventId}&player.option.windowId=${eventId}`, ann.token);
    assert.deepEqual([alone.status, alone.body.errorCode], [400, "errors.com.epicgames.fortnite.wrong_number_of_event_players"]);
    const together = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${ann.accountId}?partyPlayerIds=${ann.accountId},${bob.accountId}` +
      `&bucketId=${v610}:0:NAE:playlist_showdown_duos&player.platform=Windows&player.option.tournamentId=${eventId}&player.option.windowId=${eventId}`, ann.token);
    assert.equal(together.status, 200, JSON.stringify(together.body));
  } finally {
    backend.close();
  }
});

test("the content page on 6.10 carries tournamentinformation beside the rest; 6.02's page is as it was", () => {
  const page610 = contentPage(undefined, undefined, v610);
  assert.deepEqual(Object.keys(page610.tournamentinformation.tournament_info), ["_type", "tournaments"]);
  assert.equal(page610.tournamentinformation._title, "tournamentinformation");
  assert.ok(page610.playlistinformation && page610.subgameselectdata && page610.battleRoyaleNews);
  assert.equal(Object.hasOwn(contentPage(undefined, undefined, v602), "tournamentinformation"), false);
});
