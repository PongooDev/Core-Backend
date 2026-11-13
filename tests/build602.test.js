import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { cramSessionEventItems, cramSessionQuests } from "../src/events/cramsession2018.js";
import { cubeStates } from "../src/events/cube.js";
import { activeEventFlags, activeMiniBosses, configureEvents, cramSession2018, isEventActive, islandMoveTo, islandRune, lobbySeason6,
  passiveStorms } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { islandStates } from "../src/events/island.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaLootTables, athenaSeason, athenaVariantTokens,
  getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { customMatchOptionsOf, parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { advanceAthenaObjectives, athenaQuestLogin, claimAthenaQuest, grantAthenaQuest, grantCosmetic, recordMatchProgress,
  seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { styleSchedules } from "../src/profiles/challenges.js";
import { battlePassPurchaseGiftBox, heldGiftBoxes } from "../src/profiles/giftboxes.js";
import { buildOfSeason, buyBattlePass } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { subgameSelectImages, subgameSelectImagesFor } from "../src/services/content/pages.js";
import { playlistInformationFor } from "../src/services/content/playlistimages.js";
import { stwMfaRewardOffered, stwMfaRewards } from "../src/services/mcp/commands/ClaimMfaEnabled.js";
import { createSettingsStore } from "../src/settings/store.js";
import { affiliateBuild, affiliateOffered, affiliateRuntimeOptions, creatorNamed, sanitizeCreatorNames } from "../src/store/creators.js";
import { eventStoreEnds, eventStoreOffers, eventStorefront, weeklyStorefront } from "../src/store/eventstore.js";
import { bundledBackBlings, itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 6.02 (Update v6.02, 10 October 2018, Season 6): CL-4461277 ("6.02", the owner's build, on its own data,
// gamedata/4461277) and CL-4442095 ("6.02.0", the earlier one, whose paks Core has no copy of, on CL-4461277's). It keeps
// 6.00's and 6.01's Season 6 (Battle Pass, styles, floating island, Cram Session, Playground's custom options,
// matchmaking) and adds Disco Domination as its new mode, the Quad Launcher, twenty cosmetics, the Skull Trooper
// Challenges, the Weekly Store's Noble Launcher and Vindertech Disintegrator, and Support-A-Creator's SetAffiliateName.
const v602 = "4461277";
const v6020 = "4442095";
const v601 = "4424678";
const v6010 = "4417689";
const v600 = "4402180";
const v541 = "4363240";
const builds602 = [v6020, v602];
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
const agentOf = (build, version = "6.02") => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;

test("6.02's two changelists are known, both play on CL-4461277's data, Season 6's", () => {
  assert.equal(versionOf(v602), "6.02");
  assert.equal(versionOf(v6020), "6.02.0");
  for (const build of builds602) {
    assert.equal(dataBuild(build), v602, build);
    assert.ok(buildChoices().includes(build), build);
    const season = inBuild(build, athenaSeason);
    assert.deepEqual([season.seasonNumber, season.numSeasonLevels, season.numBookLevels, season.storefront], [6, 100, 100, "BRSeason6"]);
    assert.deepEqual(season.firstWinRewards, [{ quantity: 1, templateId: "AthenaGlider:umbrella_season_06" }]);
  }
  assert.equal(allowedBuildList(["6.02"]).join(), v602);
  assert.equal(allowedBuildList(["6.02.0"]).join(), v6020);
  assert.equal(dataBuild("4430000"), v601, "a build between 6.01 and 6.02 Core doesn't know plays on 6.01's");
  assert.equal(dataBuild(v601), v601, "6.01 keeps its own data");
  assert.equal(dataBuild(v6010), v601);
  assert.equal(dataBuild(v600), v600);
  assert.equal(buildOfSeason(6), "4497486", "Season 6's newest data is 6.20's now (tests/build620.test.js)");
  assert.equal(buildOfSeason(5), v541);
  assert.equal(seasonName(6), "Season 6 (6.00 – 6.20)");
});

test("6.02's data against 6.01's: twenty cosmetics, the Quad Launcher in the loot, week 3's later stages, the Skull Trooper's styles", () => {
  const [c602, c601] = [inBuild(v602, athenaCosmetics), inBuild(v601, athenaCosmetics)];
  const added = Object.keys(c602).filter((id) => !c601[id]).sort();
  assert.deepEqual(added.map((id) => [id, c602[id].name]), [
    ["AthenaBackpack:bid_126_darkbomber", "Dark Bag"], ["AthenaBackpack:bid_127_plaguemale", "Dismal Cape"], ["AthenaBackpack:bid_128_plaguefemale", "Arcanum"],
    ["AthenaBackpack:bid_129_pumpkinslice", "Mouldering Cloak"], ["AthenaCharacter:cid_229_athena_commando_f_darkbomber", "Dark Bomber"],
    ["AthenaCharacter:cid_240_athena_commando_f_plague", "Scourge"], ["AthenaCharacter:cid_241_athena_commando_m_plague", "Plague"],
    ["AthenaCharacter:cid_242_athena_commando_f_bullseye", "Bullseye"], ["AthenaCharacter:cid_243_athena_commando_m_pumpkinslice", "Hollowhead"],
    ["AthenaCharacter:cid_244_athena_commando_m_pumpkinsuit", "Jack Gourdon"], ["AthenaCharacter:cid_246_athena_commando_f_grave", "Skull Ranger"],
    ["AthenaDance:eid_electroswing", "Electro Swing"], ["AthenaDance:eid_headbang", "Headbanger"], ["AthenaDance:eid_lookatthis", "Behold!"],
    ["AthenaDance:eid_sprinkler", "Sprinkler"], ["AthenaGlider:glider_id_084_plague", "Lamplight"], ["AthenaGlider:glider_id_085_skulltrooper", "Crypt Cruiser"],
    ["AthenaPickaxe:pickaxe_id_107_plague", "Herald's Wand"], ["AthenaPickaxe:pickaxe_id_108_pumpkinslice", "Carver"],
    ["AthenaPickaxe:pickaxe_id_109_skulltrooper", "Skull Sickle"]]);
  assert.deepEqual(Object.keys(c601).filter((id) => !c602[id]), [], "none dropped");
  // Dark Bomber and her Dark Bag left 6.01's keyed paks for 6.02's main ones.
  assert.equal(c601["AthenaCharacter:cid_229_athena_commando_f_darkbomber"], undefined);

  // "Quad Launcher ... Available in Epic and Legendary variants ... Can be found in chests, Supply Drops, and Vending Machines."
  const quad = (build) => Object.entries(inBuild(build, athenaLootTables)["/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client"])
    .filter(([, row]) => /WID_Launcher_Military_Athena_(VR|SR)_Ore_T03$/.test(String(row.ItemDefinition)))
    .map(([name, row]) => [name, String(row.ItemDefinition).split(".").pop().split("_")[4], row.Weight]).sort();
  assert.deepEqual(quad(v602), [["WorldList.AthenaLoot.VendingMachine.Weapons.Epic.Rocket.04", "VR", 1],
    ["WorldList.AthenaLoot.VendingMachine.Weapons.Legendary.Rocket.04", "SR", 1], ["WorldList.AthenaLoot.Weapon.Rocket.09", "VR", 0.61],
    ["WorldList.AthenaLoot.Weapon.Rocket.10", "SR", 0.085], ["WorldList.AthenaSupplyDrop.Weapon.Rocket.04", "SR", 0.4]]);
  assert.deepEqual(quad(v601), []);

  inBuild(v602, () => {
    assert.equal(getItem("Weapon:wid_launcher_military_athena_sr_ore_t03").name, "Quad Launcher");
    assert.equal(getItem("Weapon:wid_launcher_military_athena_vr_ore_t03").name, "Quad Launcher");
    // Week 3's staged challenge ("Visit Risky Reels and Wailing Woods in a single match", then four more pairs).
    assert.deepEqual(["a", "b", "c", "d", "e"].map((stage) => getAthenaQuest(`quest_br_visit_twonamedlocs_chain_01_${stage}`).objectives.map(({ stat }) => stat.slice(15))),
      [["riskyreels", "wailingwoods"], ["paradisepalms", "dustydivot"], ["greasygrove", "lootlake"], ["luckylanding", "tiltedtowers"], ["snobbyshores", "saltysprings"]]);
    assert.deepEqual(getAthenaQuest("quest_br_visit_twonamedlocs_chain_01_a").rewards.at(-1), { quantity: 1, templateId: "Quest:quest_br_visit_twonamedlocs_chain_01_b" });
    // Week 3 swaps its doorbells for a trap elimination, and the tomato challenge counts its own stat.
    const week3 = athenaChallengeBundles().questbundle_s6_week_003.quests.map(({ quest }) => quest);
    assert.ok(week3.includes("quest_br_eliminate_trap") && !week3.includes("quest_br_ringdoorbell_differenthouses"));
    assert.deepEqual(getAthenaQuest("quest_br_hitplayer_with_tomatoemote").objectives, [{ count: 1, name: "battlepass_athena_hitplayer_tomatoemote", stat: "hit_player_with_tomato_toy" }]);
    assert.equal(getAthenaQuest("quest_br_timed_trials").objectiveCompletionCount, 3);
    // The daily challenges give a hidden daily challenge token, which the Skull Trooper Challenges count.
    assert.deepEqual(getAthenaQuest("athenadaily_playmatches").hiddenRewards, [{ quantity: 1, templateId: "Token:athena_dailychallenge_token" }]);
    // The Skull Trooper's styles: the Green Glow for everyone, the Purple Glow by its token; the Ghost Portal the same.
    assert.deepEqual(athenaCosmetics()["AthenaCharacter:cid_030_athena_commando_m_halloween"].variants,
      [{ channel: "ClothingColor", default: "Mat0", options: ["Mat0", "Mat1", "Mat2"], unlocked: ["Mat0", "Mat2"] }]);
    assert.deepEqual(athenaCosmetics()["AthenaBackpack:bid_105_ghostportal"].variants,
      [{ channel: "Particle", default: "Particle0", options: ["Particle0", "Particle1", "Particle2"], unlocked: ["Particle0", "Particle2"] }]);
    assert.deepEqual(athenaVariantTokens()["CosmeticVariantToken:vtid_052_skull_trooper_redflames"],
      { channel: "ClothingColor", cosmetic: "AthenaCharacter:cid_030_athena_commando_m_halloween", giftBox: true, variant: "Mat1" });
  });
  assert.equal(inBuild(v601, () => getAthenaQuest("quest_br_visit_twonamedlocs_chain_01_b")), undefined);
  assert.equal(inBuild(v601, () => getAthenaQuest("athenadaily_playmatches").hiddenRewards), undefined);
  // Save the World's quests are 6.00's still.
  assert.deepEqual(inBuild(v602, () => getQuest("autumnquest_explorezones_1")), inBuild(v600, () => getQuest("autumnquest_explorezones_1")));
});

test("6.02 keeps Season 6's Battle Pass: the same tiers and season challenges, the purchase's own gift box", () => {
  assert.deepEqual(inBuild(v602, athenaSeason), inBuild(v601, athenaSeason), "AthenaSeason6 is unchanged");
  const [schedules602, schedules601] = [inBuild(v602, athenaChallengeSchedules), inBuild(v601, athenaChallengeSchedules)];
  // 6.02's data adds the Skull Trooper's own schedule, and nothing else: 6.01's, extracted again for #334, has
  // Tomatohead's (5.30's) and the two of Season 5 that outlast it (Drift's and Ragnarok's) as 6.02's does.
  assert.deepEqual(Object.keys(schedules602).filter((id) => !schedules601[id]), ["bundleschedule_styles_skulltrooper"]);
  assert.deepEqual(Object.keys(schedules601).sort(), ["bundleschedule_styles_tomatohead", "schedule_ltm_heist", "season5_progressivea_schedule",
    "season5_progressiveb_schedule", "season6_free_schedule", "season6_paid_schedule", "season6_progressivea_schedule", "season6_progressiveb_schedule"]);
  // The rest are 6.01's entry for entry, CleanUpOnBundleCompletion too.
  for (const id of Object.keys(schedules601)) assert.deepEqual(schedules602[id], schedules601[id], id);
  for (const build of builds602) {
    assert.equal(inBuild(build, battlePassPurchaseGiftBox), "GiftBox:gb_battlepasspurchased", build);
    const tier59 = inBuild(build, athenaSeason).bookPaidRewards.find(({ level }) => level === 59).rewards.map(({ templateId }) => templateId);
    assert.ok(tier59.includes("CosmeticVariantToken:vtid_033_petcarrier_dog_styleb"), build);
    assert.equal(inBuild(build, athenaChallengeSchedules).season6_free_schedule.bundles.length, 10);
  }
});

test("a 6.02 client buys the Battle Pass in a GB_BattlePassPurchased and owns Bonesy's style at tier 59, on either changelist", async () => {
  const backend = await startBackend();
  try {
    for (const build of builds602) {
      const agent = `game=Fortnite, engine=UE4, build=++Fortnite+Release-6.02-CL-${build}`;
      const player = await userLogin(backend.port, `Pass602_${build}`);
      const command = (name, profileId, body = {}) => {
        const text = JSON.stringify(body);
        return send({ host: "127.0.0.1", port: backend.port, method: "POST",
          path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
          headers: { "User-Agent": agent, Authorization: `bearer ${player.token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
      };
      const profileOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId).profileChanges[0].profile;
      const query = async (profileId) => profileOf((await command("QueryProfile", profileId)).body, profileId);
      await query("athena");
      assert.equal((await post(backend.port, `/admin/api/accounts/${player.accountId}/currency`, undefined, { key: "vbucks", quantity: 10000 })).status, 200);
      const buy = async (offerId, expectedPrice, purchaseQuantity = 1) => {
        const bought = await command("PurchaseCatalogEntry", "common_core", { offerId, purchaseQuantity, currency: "MtxCurrency", expectedPrice });
        assert.equal(bought.status, 200, `${build}: ${JSON.stringify(bought.body)}`);
        return bought.body.notifications[0].lootResult.items;
      };
      const loot = await buy("core_br_season6_battlepass", 950);
      const boxes = Object.values((await query("common_core")).items).filter((item) => item.templateId.toLowerCase() === "giftbox:gb_battlepasspurchased");
      assert.deepEqual(boxes.at(-1).attributes.lootList, loot, "the purchase's own box (#326)");
      const tiers = await buy("A6FE59C497B844068E1B5D84396F19BA", 150, 58);
      assert.ok(tiers.some((item) => item.itemType === "CosmeticVariantToken:vtid_033_petcarrier_dog_styleb" && item.itemProfile === "athena"), "the style is shown (#332)");
      const athena = await query("athena");
      assert.deepEqual(athena.items["AthenaBackpack:petcarrier_001_dog"].attributes.variants, [{ channel: "Material", active: "Mat0", owned: ["Mat0", "Mat1"] }]);
    }
  } finally {
    backend.close();
  }
});

test("6.02's event flags are 6.01's: LobbySeason6, the ticketless storms and Cram Session, every range run on to it", () => {
  for (const build of builds602) {
    assert.deepEqual(activeEventFlags(build), [passiveStorms, lobbySeason6, activeMiniBosses], build);
    assert.deepEqual(activeEventFlags(build), activeEventFlags(v601));
    assert.equal(inBuild(build, () => isEventActive(cramSession2018)), true);
  }
  // Every range that ran to 6.02 runs to 6.20 now (tests/build610.test.js, tests/build620.test.js), but BR.CandyCaneGuns'.
  const v610 = "4497486";
  assert.equal(season4Flag("EventFlag.BR.CandyCaneGuns").builds[1], 4480234);
  assert.deepEqual(season4Flag(lobbySeason6).builds, [4395664, Number(v610)]);
  assert.equal(season4Flag("EventFlag.BirthdayBattleBus").builds[1], Number(v600), "gone since 6.01");
  for (const flag of ["EventFlag.SupplyDropBDay", "EventFlag.SupplyDropGift", "EventFlag.BR_S5_RiskyReels_Event",
    "EventFlag.Blockbuster2018Phase4", "EventFlag.Fortnitemares", "EventFlag.ActiveMiniBosses", "EventFlag.PassiveStorms"]) {
    assert.equal(season4Flag(flag).builds[1], Number(v610), flag);
  }
  for (const flag of ["EventFlag.BR_S5_Cube_TurnOn", "EventFlag.LTM_Heist", "EventFlag.RoadTrip2018", "EventFlag.Horde"]) {
    assert.equal(season4Flag(flag).builds[1], Number(v541), flag);
  }
  withConfig(replay, () => assert.deepEqual(inBuild(v602, () => cubeStates(at("2018-10-11T00:00:00Z"))), [], "6.02 places no Cube"));
});

test("6.02 keeps the floating island: the same sixteen flags by Season 6's dates, on both changelists", () => {
  const flags = [...[1, 2, 3, 4, 5, 6, 7, 8].map(islandMoveTo), ...[0, 1, 2, 3, 4, 5, 6, 7].map(islandRune)];
  for (const flag of flags) assert.deepEqual(season4Flag(flag).builds, [4395664, 4497486], flag);
  withConfig(replay, () => {
    for (const iso of ["2018-09-27T12:00:00Z", "2018-10-03T12:00:00Z", "2018-10-10T12:00:00Z", "2018-10-13T12:00:00Z", "2018-10-20T12:00:00Z",
      "2018-11-15T00:00:00Z", "2018-12-07T12:00:00Z"]) {
      const on600 = inBuild(v600, () => islandStates(at(iso)));
      assert.equal(on600[0].events.length, 1, iso);
      for (const build of builds602) assert.deepEqual(inBuild(build, () => islandStates(at(iso))), on600, `${build} at ${iso}`);
    }
    // Update v6.02's day: the island on its way from the Retail Row rune to Wailing Woods'.
    assert.deepEqual(inBuild(v602, () => islandStates(at("2018-10-10T12:00:00Z")))[0].events.map(({ eventType }) => eventType), [islandMoveTo(5)]);
  });
  withConfig({ ...replay, datedFlags: { island: { mode: "off" } } },
    () => assert.deepEqual(inBuild(v602, () => islandStates(at("2018-10-10T12:00:00Z")))[0]?.events ?? [], [], "off by its switch"));
});

test("the admin panel's island stop reaches a 6.02 client's calendar, on both changelists", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Island602");
    const islandServed = async (build) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": agentOf(build), Authorization: `bearer ${token}` } }))
      .body.channels["client-events"].states[0].activeEvents.map(({ eventType }) => eventType).filter((type) => type.startsWith("EventFlag.BR_S6_Island_"));
    for (const build of builds602) assert.deepEqual(await islandServed(build), [islandRune(0)], build);
    const moved = await post(backend.port, "/admin/api/events/dated-flags/move", null, { event: "island", to: "rune5" });
    assert.equal(moved.status, 200);
    for (const build of builds602) assert.deepEqual(await islandServed(build), [islandRune(5)], build);
  } finally {
    await backend.close();
  }
});

test("6.02's modes: Disco Domination on by default, its new mode; the 32 a side one, High Explosives and Steady Storm by their switches", () => {
  const defaults = createSettingsStore(null).get();
  assert.equal(defaults.matchmakingModes.discoDomination602, true, "on unless turned off");
  assert.equal(defaults.matchmakingModes.discoDomination, false, "6.01's stays by its switch");
  const byTheirSwitch = ["discoDomination32", "highExplosivesSeason6Solo", "highExplosivesSeason6Squads", "steadyStormSeason6Solo", "steadyStormSeason6Duos", "steadyStormSeason6Squads"];
  for (const id of byTheirSwitch) assert.equal(defaults.matchmakingModes[id], false, id);
  for (const build of builds602) {
    assert.equal(ltmOfPlaylist(50, build).id, "fiftyFiftySeason6");
    assert.equal(ltmOfPlaylist(35, build).id, "playgroundV2");
    assert.equal(ltmOfPlaylist(202, build).id, "discoDomination602");
    assert.equal(ltmOfPlaylist(217, build).id, "discoDomination32");
    assert.deepEqual([23, 24, 160, 161, 162].map((id) => ltmOfPlaylist(id, build).id),
      ["highExplosivesSeason6Solo", "highExplosivesSeason6Squads", "steadyStormSeason6Solo", "steadyStormSeason6Duos", "steadyStormSeason6Squads"]);
    for (const id of ["fiftyFiftySeason6", "playgroundV2", "discoDomination602"]) assert.equal(ltmOn(id, build, defaults), true, id);
    for (const id of ["soaring50s", ...byTheirSwitch]) assert.equal(ltmOn(id, build, defaults), false, id);
    assert.equal(hasLtm("discoDomination", build), false, "6.01's entry isn't 6.02's");
    for (const id of ["getaway", "soaringSolos", "steadyStormSolo", "highExplosivesSolo", "flyExplosives"]) assert.equal(hasLtm(id, build), false, id);
    assert.deepEqual(ltmPlaylistOverrides(build, defaults), ["Playlist_Playground", "Playlist_50v50", "Playlist_Disco"]);
    assert.deepEqual(ltmFrontEndPlaylists(build, defaults).map(({ name, enabled }) => [name, enabled]),
      [["Playlist_Playground", true], ["Playlist_Soaring_50s", false], ["Playlist_50v50", true], ["Playlist_Disco", true], ["Playlist_Disco_32", false],
        ["Playlist_HighExplosives_Solo", false], ["Playlist_HighExplosives_Squads", false], ["Playlist_Steady_Solo", false], ["Playlist_Steady_Duos", false],
        ["Playlist_Steady_Squads", false]]);
    assert.equal(ltmFrontEndPlaylists(build, defaults).find(({ name }) => name === "Playlist_Disco").ltm.advertise, "New");
    // Switched off, the lobby hides it; the others switched on, it lists them.
    const without = { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, discoDomination602: false, discoDomination32: true, steadyStormSeason6Duos: true } };
    assert.equal(ltmOn("discoDomination602", build, without), false);
    assert.deepEqual(ltmPlaylistOverrides(build, without), ["Playlist_Playground", "Playlist_50v50", "Playlist_Disco_32", "Playlist_Steady_Duos"]);
    for (const [name, id] of [["playlist_50v50", 50], ["playlist_playground", 35], ["playlist_defaultsolo", 2], ["playlist_disco", 202], ["playlist_disco_32", 217],
      ["playlist_highexplosives_solo", 23], ["playlist_highexplosives_squads", 24], ["playlist_steady_solo", 160], ["playlist_steady_duos", 161], ["playlist_steady_squads", 162]]) {
      assert.equal(playlistIdOfName(name, build), id);
      assert.equal(parseBucket(`${build}:0:NAE:${name}`, build).playlistId, id);
    }
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_disco`, build), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_disco_32`, build), { maxTeamCount: 2, maxTeamSize: 32, maxSquadSize: 4 });
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_highexplosives_squads`, build), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_steady_duos`, build), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_playground`, build), { maxTeamCount: 4, maxTeamSize: 4, maxSquadSize: 4 });
  }
  // 6.01's lobby is as it was: Disco Domination by its switch, none of 6.02's playlists.
  for (const build of [v6010, v601]) {
    assert.equal(ltmOfPlaylist(202, build).id, "discoDomination");
    assert.equal(ltmOn("discoDomination", build, defaults), false);
    for (const id of ["discoDomination602", ...byTheirSwitch]) assert.equal(hasLtm(id, build), false, id);
    assert.deepEqual(ltmFrontEndPlaylists(build, defaults).map(({ name, enabled }) => [name, enabled]),
      [["Playlist_Playground", true], ["Playlist_Soaring_50s", false], ["Playlist_50v50", true], ["Playlist_Disco", false]]);
  }
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    // "Disco Domination ... introduced on October 10th 2018", and on to Update v6.10's day.
    assert.equal(inOriginalWindow("discoDomination602", v602, at("2018-10-09T23:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("discoDomination602", v602, at("2018-10-10T00:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("discoDomination602", v6020, at("2018-10-15T23:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("discoDomination602", v602, at("2018-10-16T00:00:00Z"), dated), false);
    assert.equal(ltmOn("discoDomination602", v602, dated, at("2018-10-12T12:00:00Z")), true);
    assert.equal(ltmOn("discoDomination602", v602, dated, at("2018-10-05T12:00:00Z")), false, "by its dates while Original dates is on");
    assert.equal(inOriginalWindow("playgroundV2", v602, at("2018-10-12T12:00:00Z"), dated), true, "Playground through Season 6");
    assert.equal(inOriginalWindow("discoDomination32", v602, at("2018-10-12T12:00:00Z"), dated), false, "nothing dates it");
  });
});

test("6.02's mode select: Disco Domination's tile for both its playlists, the returning modes' tiles, and Season 6's key art", () => {
  for (const build of builds602) {
    const playlists = playlistInformationFor(build).playlist_info.playlists;
    const tile = (name) => playlists.find(({ playlist_name: playlistName }) => playlistName === name)?.image ?? null;
    for (const name of ["Playlist_Disco", "Playlist_Disco_32"]) {
      assert.match(tile(name), /playlistinformation\/BR06_LobbyTile_LTM_DiscoDomination-1024x512-c79f07de78d8283656fcf4d1ee757f880911d775\.jpg$/, name);
    }
    assert.match(tile("Playlist_Steady_Solo"), /Steady-Storm/);
    assert.match(tile("Playlist_HighExplosives_Squads"), /HighExplosives/);
    assert.match(tile("Playlist_Playground"), /BR_LTM-Tile_Playground/);
    assert.deepEqual(subgameSelectImagesFor(build), subgameSelectImages[6], build);
  }
});

test("6.02's shop: Season 6's history with its sixteen cosmetics on their days; 6.01's and 6.00's days are as they were", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season6.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  const [c602, c601] = [inBuild(v602, athenaCosmetics), inBuild(v601, athenaCosmetics)];
  // The history holds 6.10's eight and 6.20's sixteen too (tests/build610.test.js, tests/build620.test.js); 6.02 is shown its own.
  const c610 = inBuild("4497486", athenaCosmetics);
  assert.ok(history.every((day) => [...day.featured, ...day.daily].every(([id]) => c610[id])), "only 6.20's cosmetics");
  const days = (id) => history.filter((day) => [...day.featured, ...day.daily].some(([entry]) => entry === id)).map(({ date }) => date.slice(5));
  assert.deepEqual(days("AthenaCharacter:cid_229_athena_commando_f_darkbomber"), ["10-05", "10-06", "11-21"]);
  for (const id of ["AthenaCharacter:cid_246_athena_commando_f_grave", "AthenaPickaxe:pickaxe_id_109_skulltrooper", "AthenaGlider:glider_id_085_skulltrooper"]) {
    assert.deepEqual(days(id), ["10-11", "10-12", "10-13", "10-14", "11-01"], id);
  }
  for (const id of ["AthenaCharacter:cid_241_athena_commando_m_plague", "AthenaCharacter:cid_240_athena_commando_f_plague", "AthenaPickaxe:pickaxe_id_107_plague",
    "AthenaGlider:glider_id_084_plague"]) assert.deepEqual(days(id), ["10-12", "10-13", "12-04"], id);
  for (const id of ["AthenaCharacter:cid_243_athena_commando_m_pumpkinslice", "AthenaPickaxe:pickaxe_id_108_pumpkinslice"]) {
    assert.deepEqual(days(id), ["10-14", "10-15", "10-31", "11-01"], id);
  }
  assert.deepEqual(days("AthenaCharacter:cid_244_athena_commando_m_pumpkinsuit"), ["10-20", "10-27", "10-31", "11-01"]);
  assert.deepEqual(days("AthenaCharacter:cid_242_athena_commando_f_bullseye"), ["11-07", "11-24"]);
  assert.deepEqual(["eid_lookatthis", "eid_sprinkler", "eid_electroswing", "eid_headbang"].map((id) => days(`AthenaDance:${id}`)),
    [["10-13", "11-07"], ["10-15", "11-07"], ["10-22", "11-29"], ["10-27", "11-22"]]);
  const own = [...new Set(history.flatMap((day) => [...day.featured, ...day.daily]).map(([id]) => id).filter((id) => !c601[id] && c602[id]))];
  assert.equal(own.length, 16);
  assert.equal(history.filter((day) => !day.featured.some(([id]) => c602[id])).length, 28);

  const featured = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRWeeklyStorefront;
  for (const build of builds602) {
    // 11 October 2018, the day after the Skull Squad's return: the Skull Trooper beside Skull Ranger, Skull Sickle and Crypt Cruiser.
    assert.deepEqual(featured(build, "2018-10-11T12:00:00Z").map(({ title, price }) => [title, price]),
      [["Skull Trooper", 1500], ["Skull Ranger", 1200], ["Skull Sickle", 1200], ["Crypt Cruiser", 1200]], build);
    // 12 October: Plague and Scourge with their back blings.
    const plague = featured(build, "2018-10-12T12:00:00Z");
    assert.deepEqual(plague.slice(0, 4).map(({ title, price }) => [title, price]), [["Plague", 1500], ["Scourge", 1500], ["Herald's Wand", 800], ["Lamplight", 800]]);
    assert.deepEqual(plague[0].itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_241_athena_commando_m_plague", "AthenaBackpack:bid_127_plaguemale"]);
    assert.deepEqual(plague[1].itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_240_athena_commando_f_plague", "AthenaBackpack:bid_128_plaguefemale"]);
    // 5 October: Dark Bomber herself, with her Dark Bag, beside her pickaxe and glider.
    const bomber = featured(build, "2018-10-05T12:00:00Z");
    assert.deepEqual(bomber.map(({ title, price }) => [title, price]), [["Dark Bomber", 1200], ["Thunder Crash", 1500], ["Dark Glyph", 500]]);
    assert.equal(bomber[0].itemGrants.at(-1).templateId, "AthenaBackpack:bid_126_darkbomber");
    // 14 October: Hollowhead with his Mouldering Cloak.
    const hollowhead = featured(build, "2018-10-14T12:00:00Z").find(({ title }) => title === "Hollowhead");
    assert.deepEqual([hollowhead.price, hollowhead.itemGrants.at(-1).templateId], [1500, "AthenaBackpack:bid_129_pumpkinslice"]);
    assert.equal(inBuild(build, () => seasonEnd(at("2018-10-11T12:00:00Z"), shopConfig)).toISOString(), "2018-12-06T00:00:00.000Z");
  }
  assert.equal(bundledBackBlings["AthenaCharacter:cid_229_athena_commando_f_darkbomber"], "AthenaBackpack:bid_126_darkbomber");
  // 6.01 has none of them: its days hold what they held.
  assert.deepEqual(featured(v601, "2018-10-11T12:00:00Z").map(({ title }) => title), ["Skull Trooper"]);
  assert.deepEqual(featured(v601, "2018-10-05T12:00:00Z").map(({ title }) => title), ["Thunder Crash", "Dark Glyph"]);
  assert.deepEqual(featured(v601, "2018-10-12T12:00:00Z").map(({ title }) => title), ["Skull Trooper"]);
  for (const iso of ["2018-09-28T12:00:00Z", "2018-10-03T12:00:00Z", "2018-10-07T12:00:00Z", "2018-10-10T12:00:00Z"]) {
    assert.deepEqual(featured(v602, iso).map(({ templateId }) => templateId), featured(v601, iso).map(({ templateId }) => templateId), iso);
  }
});

test("6.02's Save the World: Cram Session runs on, with the Noble Launcher and the Vindertech Disintegrator in the Weekly Store from 11 October", () => {
  withConfig(replay, () => {
    for (const build of builds602) {
      inBuild(build, () => {
        assert.deepEqual(eventQuests(), cramSessionQuests);
        assert.ok(cramSessionQuests.every((id) => getQuest(id)));
        const weekly = (iso) => eventStoreOffers(at(iso))[weeklyStorefront].slice(0, 2).map(({ templateId, price }) => [templateId, price]);
        // "Available Wednesday, Oct 10 at 8 PM Eastern Time until Wednesday, Oct 17 at 8 PM Eastern Time."
        assert.deepEqual(weekly("2018-10-11T00:00:00Z"), [["Schematic:sid_explosive_launcher_neonglow_sr_ore_t01", 1680], ["Schematic:sid_shotgun_standard_vt_sr_ore_t01", 1680]]);
        assert.deepEqual(weekly("2018-10-16T12:00:00Z"), weekly("2018-10-11T00:00:00Z"));
        // Before it, 6.01's week, and 6.00's before that.
        assert.deepEqual(weekly("2018-10-10T23:00:00Z"), [["Schematic:sid_blunt_hammer_ratrod_sr_ore_t01", 1680], ["Schematic:sid_sniper_military_sr_ore_t01", 1680]]);
        assert.deepEqual(weekly("2018-10-03T23:00:00Z"), [["Schematic:sid_pistol_ratrod_sr_ore_t01", 1680], ["Schematic:sid_blunt_hammer_hydraulic_vr_ore_t01", 600]]);
        const now = at("2018-10-12T12:00:00Z");
        assert.deepEqual(eventStoreOffers(now)[eventStorefront].map(({ templateId }) => templateId), cramSessionEventItems.map(({ templateId }) => templateId));
        assert.equal(eventStoreEnds(now).stwEventStoreEnd.toISOString(), "2018-12-06T00:00:00.000Z");
        // The 2FA reward (#328) is still asked for and still in the data.
        assert.equal(stwMfaRewardOffered(), true);
        assert.deepEqual(stwMfaRewards.map(({ templateId }) => getItem(templateId)?.name), ["Armory Slot", "Backpack Slot", "Legendary Troll Stash Llama"]);
      });
    }
    assert.equal(inBuild(v602, () => getItem("Weapon:wid_explosive_launcher_neonglow_sr_ore_t01").name), "Noble Launcher");
    assert.equal(inBuild(v602, () => getItem("Weapon:wid_shotgun_standard_vt_sr_ore_t01").name), "Vindertech Disintegrator");
    // 6.01 keeps its own week through the replay.
    assert.deepEqual(inBuild(v601, () => eventStoreOffers(at("2018-10-12T12:00:00Z")))[weeklyStorefront].slice(0, 2).map(({ templateId }) => templateId),
      ["Schematic:sid_blunt_hammer_ratrod_sr_ore_t01", "Schematic:sid_sniper_military_sr_ore_t01"]);
  });
});

test("a 6.02 client's ClaimMfaEnabled gives the Save the World 2FA reward once (#328)", async () => {
  const backend = await startBackend();
  try {
    for (const build of builds602) {
      const { token, accountId } = await userLogin(backend.port, `Mfa602_${build}`);
      const mcp = (command, profileId, body = {}) => {
        const text = JSON.stringify(body);
        return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`,
          headers: { "User-Agent": agentOf(build), Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
      };
      const campaignOf = (result) => (result.profileId === "campaign" ? result : result.multiUpdate?.find(({ profileId }) => profileId === "campaign"));
      const claim = await mcp("ClaimMfaEnabled", "common_core", { bClaimForStw: true });
      assert.equal(claim.status, 200, `${build}: ${JSON.stringify(claim.body)}`);
      const added = campaignOf(claim.body).profileChanges.filter(({ changeType }) => changeType === "itemAdded")
        .map(({ item }) => [item.templateId.toLowerCase(), item.quantity]);
      assert.deepEqual(added, [["token:accountinventorybonus", 50], ["token:worldinventorybonus", 10], ["cardpack:cardpack_jackpot", 1]], build);
      assert.equal(campaignOf((await mcp("ClaimMfaEnabled", "common_core", { bClaimForStw: true })).body), undefined, "once");
    }
  } finally {
    backend.close();
  }
});

// The Skull Trooper Challenges (profiles/challenges.js styleSchedules): "available from October 10th 2018 for anyone who
// has purchased the Skull Trooper Outfit ... rewarded players with the Ghost Portal Back Bling."
const skullTrooper = "AthenaCharacter:cid_030_athena_commando_m_halloween";
const ghostPortal = "AthenaBackpack:bid_105_ghostportal";
const tomatohead = "AthenaCharacter:cid_109_athena_commando_m_pizza";
const tomatoCrown = "CosmeticVariantToken:vtid_032_tomatohead_crown";
const challengeCompleteBox = "GiftBox:gb_challengecomplete";
function withSession(build, name, run) {
  return inBuild(build, () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build602-"));
    try {
      const session = openSession(createProfileStore(dataDir), name);
      setUpAthena(session);
      return run(session);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}
const itemsOf = (session, type) => Object.entries(session.profile("athena").profile.items).filter(([, item]) => item.templateId.toLowerCase().startsWith(`${type}:`));
const heldOf = (session, templateId) => itemsOf(session, templateId.split(":")[0].toLowerCase()).find(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase());
const questOf = (session, questId) => heldOf(session, `Quest:${questId}`);

test("6.02's data has the outfits' own challenges: the Skull Trooper's five for the Ghost Portal, Tomatohead's three for the Crown", () => inBuild(v602, () => {
  assert.deepEqual(styleSchedules, { bundleschedule_styles_tomatohead: tomatohead, bundleschedule_styles_skulltrooper: skullTrooper });
  assert.deepEqual(athenaChallengeSchedules().bundleschedule_styles_skulltrooper,
    { bundles: [{ bundle: "questbundle_styles_skulltrooper", unlockType: "OnScheduleGranted", unlockValue: 0 }], category: "Styles", cleanUpOnBundleCompletion: true });
  const bundle = athenaChallengeBundles().questbundle_styles_skulltrooper;
  assert.deepEqual(bundle.quests.map(({ quest }) => [quest, getAthenaQuest(quest).objectives[0].count]), [
    ["quest_br_styles_skulltrooper_complete_daily_challenges", 7], ["quest_br_styles_skulltrooper_play_matches", 50],
    ["quest_br_styles_skulltrooper_min1elimination", 14], ["quest_br_styles_skulltrooper_interact_chests_singlematch", 10],
    ["quest_br_styles_skulltrooper_damage_singlematch", 1000]]);
  assert.deepEqual(bundle.completionSteps, [{ count: -1, rewards: [{ giftBox: challengeCompleteBox, quantity: 1, templateId: ghostPortal }] }]);
  assert.equal(bundle.visualStyle, "FNSkullTrooperStyle");
  assert.deepEqual(getAthenaQuest("quest_br_styles_skulltrooper_complete_daily_challenges").objectives,
    [{ count: 7, item: "Token:athena_dailychallenge_token", itemEvent: "Acquire", name: "athena_skulltrooper_complete_daily_challenges" }]);
  assert.deepEqual(athenaChallengeBundles().questbundle_styles_tomatohead.completionSteps,
    [{ count: -1, rewards: [{ giftBox: challengeCompleteBox, quantity: 1, templateId: tomatoCrown }] }]);
  // The schedules that go once their bundle is completed (CleanUpOnBundleCompletion), and the rewards that come in
  // GB_ChallengeComplete: each week's season XP at four challenges, not its tokens.
  // Season 5's two are the ones its end doesn't take (Drift's and Ragnarok's, #334: tests/season-rollover.test.js).
  assert.deepEqual(Object.entries(athenaChallengeSchedules()).filter(([, schedule]) => schedule.cleanUpOnBundleCompletion).map(([id]) => id).sort(),
    ["bundleschedule_styles_skulltrooper", "bundleschedule_styles_tomatohead", "schedule_ltm_heist", "season5_progressivea_schedule",
      "season5_progressiveb_schedule", "season6_progressivea_schedule", "season6_progressiveb_schedule"]);
  assert.deepEqual(athenaChallengeBundles().questbundle_s6_week_001.completionSteps.flatMap(({ count, rewards }) => rewards
    .filter((reward) => reward.giftBox).map((reward) => [count, reward.templateId, reward.quantity, reward.giftBox])),
  [[4, "AccountResource:athenaseasonalxp", 5000, challengeCompleteBox]]);
  assert.equal(athenaChallengeBundles().questbundle_ltm_heist.completionSteps[0].rewards[0].giftBox, undefined, "High Stakes' names none");
  for (const outfit of Object.values(styleSchedules)) assert.ok(athenaCosmetics()[outfit], outfit);
  // 6.01's files have Tomatohead's and no Skull Trooper Challenges; 6.00's overlay was made before the extractor kept either.
  assert.equal(inBuild(v601, athenaChallengeSchedules).bundleschedule_styles_skulltrooper, undefined);
  assert.deepEqual(inBuild(v601, athenaChallengeSchedules).bundleschedule_styles_tomatohead, athenaChallengeSchedules().bundleschedule_styles_tomatohead);
  assert.deepEqual(inBuild(v601, athenaChallengeBundles).questbundle_styles_tomatohead, athenaChallengeBundles().questbundle_styles_tomatohead);
  assert.equal(Object.keys(inBuild(v600, athenaChallengeSchedules)).some((id) => id.includes("styles")), false);
}));

test("a Skull Trooper's owner gets the Skull Trooper Challenges at the quest login, once, on either changelist; nobody else does", () => {
  for (const build of builds602) {
    withSession(build, `owner${build}`, (session) => {
      athenaQuestLogin(session);
      assert.equal(heldOf(session, "ChallengeBundleSchedule:bundleschedule_styles_skulltrooper"), undefined, "not without the outfit");
      grantCosmetic(session, skullTrooper);
      athenaQuestLogin(session);
      const [scheduleId, schedule] = heldOf(session, "ChallengeBundleSchedule:bundleschedule_styles_skulltrooper");
      const [bundleId, bundle] = heldOf(session, "ChallengeBundle:questbundle_styles_skulltrooper");
      assert.deepEqual(schedule.attributes.granted_bundles, [bundleId]);
      assert.equal(bundle.attributes.challenge_bundle_schedule_id, scheduleId);
      assert.equal(bundle.attributes.num_granted_bundle_quests, 5);
      for (const questId of bundle.attributes.grantedquestinstanceids) {
        const quest = session.profile("athena").profile.items[questId];
        assert.deepEqual([quest.attributes.quest_state, quest.attributes.challenge_bundle_id], ["Active", bundleId], quest.templateId);
      }
      assert.equal(heldOf(session, "ChallengeBundleSchedule:bundleschedule_styles_tomatohead"), undefined, "Tomatohead's is its own outfit's");
      // Asked again, nothing more comes.
      athenaQuestLogin(session);
      assert.equal(itemsOf(session, "challengebundleschedule").filter(([, item]) => /styles_skulltrooper$/.test(item.templateId.toLowerCase())).length, 1);
      assert.equal(itemsOf(session, "challengebundle").filter(([, item]) => /styles_skulltrooper$/.test(item.templateId.toLowerCase())).length, 1);
      // Tomatohead's owner gets Tomatohead's.
      grantCosmetic(session, tomatohead);
      athenaQuestLogin(session);
      const [, crown] = heldOf(session, "ChallengeBundle:questbundle_styles_tomatohead");
      assert.equal(crown.attributes.num_granted_bundle_quests, 3);
    });
  }
  // 6.01's data has no such schedule: its Skull Trooper owners are as they were. Tomatohead's it has (5.30's, in its
  // overlay since it was extracted again for #334), so his owners get theirs there.
  withSession(v601, "owner601", (session) => {
    grantCosmetic(session, skullTrooper);
    athenaQuestLogin(session);
    assert.equal(itemsOf(session, "challengebundleschedule").some(([, item]) => /styles_/.test(item.templateId.toLowerCase())), false);
    grantCosmetic(session, tomatohead);
    athenaQuestLogin(session);
    assert.equal(heldOf(session, "ChallengeBundle:questbundle_styles_tomatohead")[1].attributes.num_granted_bundle_quests, 3);
    assert.equal(heldOf(session, "ChallengeBundleSchedule:bundleschedule_styles_skulltrooper"), undefined);
  });
  // 6.00's overlay has neither.
  withSession(v600, "owner600", (session) => {
    grantCosmetic(session, skullTrooper);
    grantCosmetic(session, tomatohead);
    athenaQuestLogin(session);
    assert.equal(itemsOf(session, "challengebundleschedule").some(([, item]) => /styles_/.test(item.templateId.toLowerCase())), false);
  });
});

test("the Skull Trooper Challenges: seven daily challenges collected count by their hidden token, and all five done give the Ghost Portal", () => {
  withSession(v602, "skull", (session) => {
    grantCosmetic(session, skullTrooper);
    athenaQuestLogin(session);
    const tracker = session.profile("athena");
    const stateOf = (questId) => questOf(session, questId)[1].attributes;
    const dailies = "quest_br_styles_skulltrooper_complete_daily_challenges";
    assert.equal(heldOf(session, ghostPortal), undefined);

    // A daily challenge counts when it is collected (its rewards, the hidden token among them), not when it completes.
    const collect = (dailyId) => {
      const itemId = questOf(session, dailyId)?.[0] ?? grantAthenaQuest(tracker, dailyId);
      const [objective] = getAthenaQuest(dailyId).objectives;
      advanceAthenaObjectives(session, [{ statName: objective.name, count: objective.count }]);
      assert.equal(tracker.profile.items[itemId].attributes.quest_state, "Completed", dailyId);
      return itemId;
    };
    const first = collect("athenadailyquest_interactammocrate");
    assert.equal(stateOf(dailies).completion_athena_skulltrooper_complete_daily_challenges ?? 0, 0, "not yet collected");
    claimAthenaQuest(session, first);
    assert.equal(stateOf(dailies).completion_athena_skulltrooper_complete_daily_challenges, 1);
    claimAthenaQuest(session, first);
    assert.equal(stateOf(dailies).completion_athena_skulltrooper_complete_daily_challenges, 1, "a challenge collected once");
    assert.equal(itemsOf(session, "token").some(([, item]) => item.templateId.toLowerCase() === "token:athena_dailychallenge_token"), false,
      "the token has no item in the client's files, so none is held");
    for (const dailyId of ["athenadailyquest_interacttreasurechest", "athenadailyquest_playereliminationassaultrifles", "athenadailyquest_playereliminationpistols",
      "athenadailyquest_playereliminationshotguns", "athenadailyquest_playereliminationsmgs", "athenadailyquest_playereliminationsniperrifles"]) {
      claimAthenaQuest(session, collect(dailyId));
    }
    assert.equal(stateOf(dailies).quest_state, "Claimed", "seven daily challenges");

    // The other four, as the gameserver reports them: the single match ones in one match, the matches one at a time.
    advanceAthenaObjectives(session, [{ statName: "skulltrooper_interact_athena_loot_chest_single_match", count: 10 },
      { statName: "skulltrooper_damage_athena_player_single_match", count: 1000 }]);
    for (let match = 0; match < 50 && heldOf(session, ghostPortal) === undefined; match++) {
      recordMatchProgress(session, 2, { place: 10, kills: 1 });
      advanceAthenaObjectives(session, [{ statName: "athena_styles_skulltrooper_play_matches_01", count: 1 }, { statName: "skulltrooper_complete_athena_with_killingblow", count: 1 }]);
    }
    const [, bundle] = heldOf(session, "ChallengeBundle:questbundle_styles_skulltrooper");
    assert.equal(bundle.attributes.num_quests_completed, 5);
    for (const { quest } of athenaChallengeBundles().questbundle_styles_skulltrooper.quests) assert.equal(stateOf(quest).quest_state, "Claimed", quest);
    const [, portal] = heldOf(session, ghostPortal);
    // The blue and green portals are everyone's; the purple one is the original owners' (#335, tests/original-owner.test.js),
    // and a Skull Trooper that was given is a later owner's.
    assert.deepEqual(portal.attributes.variants, [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2"] }]);
    assert.deepEqual(heldOf(session, skullTrooper)[1].attributes.variants, [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2"] }]);
  });
});

// A bundle's challenges done as the gameserver and the match results report them. Returns the bundle's item.
function finishBundle(session, bundleId, upTo = Infinity) {
  const tracker = session.profile("athena");
  const [, bundle] = heldOf(session, `ChallengeBundle:${bundleId}`);
  for (const questItemId of bundle.attributes.grantedquestinstanceids.slice(0, upTo)) {
    const questId = tracker.profile.items[questItemId].templateId.split(":")[1];
    advanceAthenaObjectives(session, getAthenaQuest(questId).objectives.map(({ name }) => ({ statName: name, count: 1_000_000 })));
  }
  // The ones counted from match results (play matches, matches with an elimination).
  if (upTo === Infinity) for (let match = 0; match < 60; match++) recordMatchProgress(session, 2, { place: 10, kills: 1 });
  return bundle;
}
const challengeBoxes = (session) => heldGiftBoxes(session.profile("profile0").profile).map(([, item]) => item)
  .filter((item) => item.templateId === challengeCompleteBox);
const boxOf = (session, bundleId) => challengeBoxes(session).filter((item) => item.attributes.params.HeaderTemplateId === `ChallengeBundle:${bundleId}`);

// GiftBoxToUse and CleanUpOnBundleCompletion (profiles/challenges.js): the reward's screen names the bundle it is for,
// and a schedule that is all done leaves the challenges tab.
test("the outfits' challenges done: the reward comes in GB_ChallengeComplete naming its bundle, and the schedule is cleaned up at the next quest login", () => {
  withSession(v602, "skullbox", (session) => {
    const { profile } = session.profile("athena");
    grantCosmetic(session, skullTrooper);
    grantCosmetic(session, tomatohead);
    athenaQuestLogin(session);
    // One of five: no reward, no box, and nothing to clean up.
    finishBundle(session, "questbundle_styles_skulltrooper", 1);
    athenaQuestLogin(session);
    assert.deepEqual(challengeBoxes(session), []);
    assert.ok(heldOf(session, "ChallengeBundleSchedule:bundleschedule_styles_skulltrooper"));

    finishBundle(session, "questbundle_styles_skulltrooper");
    const [, portal] = heldOf(session, ghostPortal);
    const [box] = boxOf(session, "questbundle_styles_skulltrooper");
    assert.equal(challengeBoxes(session).length, 1);
    const portalId = Object.keys(profile.items).find((id) => profile.items[id] === portal);
    assert.deepEqual(box.attributes.lootList, [{ itemType: ghostPortal, itemGuid: portalId, itemProfile: "athena", quantity: 1 }]);
    assert.deepEqual(box.attributes.params, { HeaderTemplateId: "ChallengeBundle:questbundle_styles_skulltrooper" });
    // Until the lobby's quest login the finished challenges are as they completed.
    assert.equal(heldOf(session, "ChallengeBundle:questbundle_styles_skulltrooper")[1].attributes.num_quests_completed, 5);

    athenaQuestLogin(session);
    assert.equal(heldOf(session, "ChallengeBundleSchedule:bundleschedule_styles_skulltrooper"), undefined);
    assert.equal(heldOf(session, "ChallengeBundle:questbundle_styles_skulltrooper"), undefined);
    assert.deepEqual(itemsOf(session, "quest").filter(([, item]) => /styles_skulltrooper/.test(item.templateId)), []);
    assert.deepEqual(profile.coreCleanedUpSchedules, ["bundleschedule_styles_skulltrooper"]);
    assert.ok(heldOf(session, ghostPortal), "what they gave stays");
    // Tomatohead's, not all done (the matches played count for its first), stay; the Skull Trooper's don't start over.
    assert.equal(heldOf(session, "ChallengeBundle:questbundle_styles_tomatohead")[1].attributes.num_quests_completed, 1);
    assert.ok(heldOf(session, "ChallengeBundleSchedule:bundleschedule_styles_tomatohead"));
    athenaQuestLogin(session);
    assert.equal(heldOf(session, "ChallengeBundleSchedule:bundleschedule_styles_skulltrooper"), undefined);
    assert.equal(challengeBoxes(session).length, 1, "one box, once");

    // Tomatohead's three give the Crown, a style: the box lists its token.
    finishBundle(session, "questbundle_styles_tomatohead");
    const [crown] = boxOf(session, "questbundle_styles_tomatohead");
    assert.deepEqual(crown.attributes.lootList, [{ itemType: tomatoCrown, itemGuid: tomatoCrown, itemProfile: "athena", quantity: 1 }]);
    athenaQuestLogin(session);
    assert.deepEqual(profile.coreCleanedUpSchedules, ["bundleschedule_styles_skulltrooper", "bundleschedule_styles_tomatohead"]);
    assert.deepEqual(itemsOf(session, "challengebundleschedule").filter(([, item]) => /styles_/.test(item.templateId)), []);
  });
});

test("Season 6's bundles on 6.02: a week's season XP and Calamity's reward come in GB_ChallengeComplete, and Calamity's go when all eight are done; 6.01's data says the same, 6.00's overlay has neither", () => {
  withSession(v602, "week1", (session) => {
    const { profile } = session.profile("athena");
    athenaQuestLogin(session);
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    // Three of week 1's challenges: their tokens, and no box.
    finishBundle(session, "questbundle_s6_week_001", 3);
    assert.deepEqual(challengeBoxes(session), []);
    finishBundle(session, "questbundle_s6_week_001", 4);
    const [week] = boxOf(session, "questbundle_s6_week_001");
    assert.deepEqual(week.attributes.lootList, [{ itemType: "AccountResource:athenaseasonalxp", itemGuid: "AccountResource:athenaseasonalxp", itemProfile: "athena", quantity: 5000 }]);
    finishBundle(session, "questbundle_s6_week_001", 7);
    assert.equal(boxOf(session, "questbundle_s6_week_001").length, 1, "the rest of the week gives tokens only");
    athenaQuestLogin(session);
    assert.ok(heldOf(session, "ChallengeBundle:questbundle_s6_week_001"), "a week stays to the season's end");

    // Calamity's: her harvesting tool at five, in a box of its own; all eight done, the schedule goes and her styles stay.
    const calamity = "AthenaCharacter:cid_237_athena_commando_f_cowgirl";
    finishBundle(session, "questbundle_s6_progressivea", 5);
    const [tool] = boxOf(session, "questbundle_s6_progressivea");
    assert.deepEqual(tool.attributes.lootList.map(({ itemType }) => itemType), ["AthenaPickaxe:pickaxe_id_104_cowgirl"]);
    athenaQuestLogin(session);
    assert.ok(heldOf(session, "ChallengeBundleSchedule:season6_progressivea_schedule"), "five of eight isn't all of them");
    finishBundle(session, "questbundle_s6_progressivea", 8);
    const styles = structuredClone(heldOf(session, calamity)[1].attributes.variants);
    athenaQuestLogin(session);
    assert.equal(heldOf(session, "ChallengeBundleSchedule:season6_progressivea_schedule"), undefined);
    assert.equal(heldOf(session, "ChallengeBundle:questbundle_s6_progressivea"), undefined);
    assert.ok(profile.coreCleanedUpSchedules.includes("season6_progressivea_schedule"));
    assert.deepEqual(heldOf(session, calamity)[1].attributes.variants, styles);
    assert.ok(heldOf(session, "ChallengeBundleSchedule:season6_free_schedule") && heldOf(session, "ChallengeBundle:questbundle_s6_week_001"), "the weeks stay");
    athenaQuestLogin(session);
    assert.equal(heldOf(session, "ChallengeBundleSchedule:season6_progressivea_schedule"), undefined, "a tier gives its schedule once");
  });
  // 6.01's files say the same, and its overlay has both since it was extracted again (#334).
  withSession(v601, "week1on601", (session) => {
    athenaQuestLogin(session);
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    finishBundle(session, "questbundle_s6_week_001", 7);
    finishBundle(session, "questbundle_s6_progressivea", 8);
    assert.equal(boxOf(session, "questbundle_s6_week_001").length, 1);
    assert.deepEqual(boxOf(session, "questbundle_s6_progressivea").map((box) => box.attributes.lootList.map(({ itemType }) => itemType)), [["AthenaPickaxe:pickaxe_id_104_cowgirl"]]);
    athenaQuestLogin(session);
    assert.equal(heldOf(session, "ChallengeBundleSchedule:season6_progressivea_schedule"), undefined);
    assert.deepEqual(session.profile("athena").profile.coreCleanedUpSchedules, ["season6_progressivea_schedule"]);
    assert.ok(heldOf(session, "ChallengeBundle:questbundle_s6_week_001"), "a week stays to the season's end");
  });
  // 6.00's overlay predates both: its bundles' rewards come without a box and its finished schedules stay, as before.
  withSession(v600, "week1on600", (session) => {
    athenaQuestLogin(session);
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    finishBundle(session, "questbundle_s6_week_001", 7);
    finishBundle(session, "questbundle_s6_progressivea", 8);
    athenaQuestLogin(session);
    assert.deepEqual(challengeBoxes(session), []);
    assert.ok(heldOf(session, "ChallengeBundleSchedule:season6_progressivea_schedule"));
    assert.equal(heldOf(session, "ChallengeBundle:questbundle_s6_progressivea")[1].attributes.num_quests_completed, 8);
    assert.equal(session.profile("athena").profile.coreCleanedUpSchedules, undefined);
  });
});

// Support-A-Creator (store/creators.js): 6.02's exe is the first with SetAffiliateName, the one MCP command it adds.
test("Support-A-Creator's creators: the admin's list, the hotfix that turns 6.02's button on with them, and nothing while none is listed", () => {
  assert.equal(affiliateBuild, Number(v6020));
  assert.deepEqual(createSettingsStore(null).get().creatorNames, [], "none by default: the feature stays off, as shipped");
  assert.deepEqual(sanitizeCreatorNames(["  Ninja ", "ninja", "ab", "bad=name", "semi;colon", "ok_name.1", 5, "x".repeat(40), "Two Words"]), ["Ninja", "ok_name.1", "Two Words"]);
  assert.equal(sanitizeCreatorNames("Ninja"), undefined);
  const listed = { creatorNames: ["Ninja", "Core Creator"] };
  for (const build of builds602) {
    assert.equal(affiliateOffered(build, listed), true, build);
    assert.equal(affiliateOffered(build, { creatorNames: [] }), false, build);
    assert.deepEqual(affiliateRuntimeOptions(build, listed), ["bDisableAffiliateFeature=false", "bUseHotfixedAffiliateNamesArray=true", "!AffiliateNames=ClearArray",
      "+AffiliateNames=Ninja", "+AffiliateNames=Core Creator"]);
    assert.deepEqual(affiliateRuntimeOptions(build, {}), []);
  }
  for (const build of [v601, v6010, v600]) assert.deepEqual(affiliateRuntimeOptions(build, listed), [], `${build} has no such feature`);
  assert.equal(creatorNamed("NINJA", listed), "Ninja", "in any case, as the list spells it");
  assert.equal(creatorNamed("  core creator ", listed), "Core Creator");
  assert.equal(creatorNamed("Somebody", listed), null);
  const store = createSettingsStore(null);
  store.update({ creatorNames: ["Ninja", "ninja", "!!"] });
  assert.deepEqual(store.get().creatorNames, ["Ninja"]);
  store.update({ warmupSeconds: 60 });
  assert.deepEqual(store.get().creatorNames, ["Ninja"], "kept by an update that doesn't name it");
});

test("a 6.02 client's SetAffiliateName keeps the creator and the time in common_core, on either changelist; the hotfix lists the creators", async () => {
  const backend = await startBackend();
  try {
    for (const build of builds602) {
      const { token, accountId } = await userLogin(backend.port, `Creator602_${build}`);
      const headers = { "User-Agent": agentOf(build), Authorization: `bearer ${token}` };
      const mcp = (command, profileId, body = {}) => {
        const text = JSON.stringify(body);
        return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`,
          headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
      };
      const runtimeOptions = async (agent = headers["User-Agent"]) => {
        const file = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini",
          headers: { ...headers, "User-Agent": agent } });
        return String(file.body);
      };
      assert.equal((await post(backend.port, "/admin/api/settings", null, { creatorNames: [] })).status, 200);
      // With no creator listed the file is the replays' alone, and no name is taken.
      assert.doesNotMatch(await runtimeOptions(), /Affiliate/);
      const refused = await mcp("SetAffiliateName", "common_core", { affiliateName: "Ninja" });
      assert.equal(refused.status, 400, JSON.stringify(refused.body));
      assert.equal(refused.body.errorCode, "errors.com.epicgames.fortnite.invalid_affiliate_name");

      const saved = await post(backend.port, "/admin/api/settings", null, { creatorNames: ["Ninja", "Core Creator"] });
      assert.equal(saved.status, 200);
      const file = await runtimeOptions();
      assert.match(file, /^\[\/Script\/FortniteGame\.FortRuntimeOptions\]\r\n/);
      assert.match(file, /bEnableReplayBrowser=true\r\n/);
      assert.match(file, /bDisableAffiliateFeature=false\r\nbUseHotfixedAffiliateNamesArray=true\r\n!AffiliateNames=ClearArray\r\n\+AffiliateNames=Ninja\r\n\+AffiliateNames=Core Creator\r\n/);
      assert.doesNotMatch(await runtimeOptions(agentOf(v601, "6.01")), /Affiliate/, "6.01 has no such option");

      const before = (await mcp("QueryProfile", "common_core")).body.profileChanges[0].profile.stats.attributes;
      assert.equal(before.mtx_affiliate, undefined);
      const set = await mcp("SetAffiliateName", "common_core", { affiliateName: "ninja" });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      assert.equal(set.body.profileId, "common_core");
      // A client at revision -1 is answered with the whole profile.
      const changes = set.body.profileChanges[0].profile.stats.attributes;
      assert.equal(changes.mtx_affiliate, "Ninja", "as the list spells it");
      assert.ok(Math.abs(Date.parse(changes.mtx_affiliate_set_time) - Date.now()) < 60_000, "an ISO 8601 time, now");
      assert.match(changes.mtx_affiliate_set_time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const after = (await mcp("QueryProfile", "common_core")).body.profileChanges[0].profile.stats.attributes;
      assert.deepEqual([after.mtx_affiliate, after.mtx_affiliate_set_time], [changes.mtx_affiliate, changes.mtx_affiliate_set_time]);
      // They are common_core's stats, not campaign's.
      const campaign = (await mcp("QueryProfile", "campaign")).body.profileChanges[0].profile.stats.attributes;
      assert.deepEqual([campaign.mtx_affiliate, campaign.mtx_affiliate_set_time], [undefined, undefined]);

      // An unlisted name changes nothing; an empty one clears the choice.
      const unknown = await mcp("SetAffiliateName", "common_core", { affiliateName: "Somebody Else" });
      assert.equal(unknown.status, 400);
      assert.equal((await mcp("QueryProfile", "common_core")).body.profileChanges[0].profile.stats.attributes.mtx_affiliate, "Ninja");
      const cleared = await mcp("SetAffiliateName", "common_core", { affiliateName: "" });
      assert.equal(cleared.status, 200);
      assert.equal((await mcp("QueryProfile", "common_core")).body.profileChanges[0].profile.stats.attributes.mtx_affiliate, "");
      assert.equal((await mcp("SetAffiliateName", "common_core", {})).status, 200, "nothing to clear");
    }
    // The shop page of the admin panel lists them.
    const shop = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/admin/api/shop?season=6" });
    assert.deepEqual(shop.body.creatorNames, ["Ninja", "Core Creator"]);
  } finally {
    backend.close();
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
const customOptions = "&player.option.custom_match_option.CreativeMutator_Gravity_C%3AGravityOverride=2" +
  "&player.option.custom_match_option.CreativeMutator_HealthAndShield_C%3AStartingHealth=50.000000";
const customOptionsText = "CreativeMutator_Gravity_C:GravityOverride=2;CreativeMutator_HealthAndShield_C:StartingHealth=50.000000";

// 6.02's MatchmakingServiceClient is 6.01's (CL-4461277's exe against CL-4424678's: no new ticket attribute, query
// parameter, message or service URL among its strings). A 6.02 player, on either changelist, takes a ticket for Solo,
// Disco Domination and Playground, hears Connecting, Waiting and Queued, and is sent to a registered 6.02 server;
// Playground's custom options (6.01's) still go to its server alone.
test("a 6.02 player matchmakes on either changelist: Solo, Disco Domination and Playground reach Queued and a 6.02 server", async () => {
  for (const build of builds602) {
    const as = (port, urlPath, token, method = "GET", body) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const headers = { "User-Agent": agentOf(build), Authorization: `bearer ${token}` };
      if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
    };
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
          `&bucketId=${build}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true${customOptions}`, player.token);
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
        assert.equal(assign.payload.matchOptions["match.option.customMatchOptions"], playlist === "playlist_playground" ? customOptionsText : undefined,
          `${build} ${playlist}`);
        gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
        const play = await nextOf(client, "Play");
        assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
        // The next playlist gets a server of its own.
        gameserver.close();
      }
      // The modes by their switches are refused until turned on, as the lobby hides them.
      const player = await userLogin(backend.port, `Off${build}`);
      const ticketFor = (playlist) => as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${build}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
      for (const playlist of ["playlist_disco_32", "playlist_steady_solo", "playlist_highexplosives_squads"]) {
        const refused = await ticketFor(playlist);
        assert.deepEqual([refused.status, refused.body.errorCode], [400, "errors.com.epicgames.fortnite.matchmaking_disabled"], playlist);
      }
      assert.equal((await post(backend.port, "/admin/api/matchmaking/config", null, { modes: { discoDomination32: true, discoDomination602: false } })).status, 200);
      assert.equal((await ticketFor("playlist_disco_32")).status, 200);
      assert.equal((await ticketFor("playlist_disco")).status, 400, "switched off");
    } finally {
      for (const client of clients) client.close();
      backend.close();
    }
  }
  assert.equal(customMatchOptionsOf({ "player.option.fillTeam": "true" }), null);
});

test("a 6.01 player's Disco Domination ticket is still refused by default: 6.02's switch isn't 6.01's", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Disco601");
    const ticket = await send({ host: "127.0.0.1", port: backend.port, method: "GET",
      path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}&bucketId=${v601}:0:NAE:playlist_disco&player.platform=Windows`,
      headers: { "User-Agent": agentOf(v601, "6.01"), Authorization: `bearer ${player.token}` } });
    assert.deepEqual([ticket.status, ticket.body.errorCode], [400, "errors.com.epicgames.fortnite.matchmaking_disabled"]);
  } finally {
    backend.close();
  }
});
