import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { versionOf } from "../src/builds/detect.js";
import { contentUpdateStates, updatedLootTables } from "../src/events/contentupdates.js";
import { activeEventFlags, passiveMiniBosses, passiveStorms, spring2018Phase1, spring2018Phase2, spring2018Valentines } from "../src/events/events.js";
import { eventQueueOfPlaylist, hasLtm, ltmForcedQueues, ltmQuests } from "../src/events/ltms.js";
import { athenaChallengeBundles, athenaCosmetics, athenaLootTables, athenaObjectiveStat, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket, playlistTeamsOf, showsMatchStart } from "../src/matchmaking/service.js";
import { seasonRewardFunctions } from "../src/profiles/athena.js";
import { challengeWeekCount, configureChallenges, settleChallengeSchedules } from "../src/profiles/challenges.js";
import { buildOfSeason, buyBattlePass, takeUpSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { eventStoreOffers } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";
import { grant } from "../src/profiles/progress.js";
import { purchaseCatalogEntry } from "../src/services/mcp/commands/PurchaseCatalogEntry.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 3.1 (++Fortnite+Release-3.1-CL-3915963, UE 4.20, 28 February 2018): Season 3, on its own data
// (gamedata/3915963), sharing 3.0's Battle Pass, clock, shop and leaderboards.
const v31 = "3915963";
const v30 = "3901517";
const now = new Date("2026-11-04T12:00:00Z");
const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
const itemsOf = (tracker, type) => Object.entries(tracker.profile.items).filter(([, item]) => item.templateId.toLowerCase().startsWith(`${type.toLowerCase()}:`));

test("3.1 is known by its version, plays on its own data and is Season 3 with 3.0's pass", () => {
  assert.equal(versionOf(v31), "3.1");
  assert.equal(dataBuild(v31), v31);
  assert.ok(buildChoices().includes(v31));
  assert.equal(allowedBuildList(["3.1"]).join(), v31);
  const season = inBuild(v31, athenaSeason);
  assert.deepEqual(season, inBuild(v30, athenaSeason), "AthenaSeason3 is 3.0's");
  // Season 3's newest data is 3.3's (build33.test.js).
  assert.equal(buildOfSeason(3), "3942182");
  assert.deepEqual(inBuild(v31, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]),
    inBuild(v30, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]));
  const cosmetics = inBuild(v31, athenaCosmetics);
  for (const id of ["AthenaCharacter:cid_093_athena_commando_m_dinosaur", "AthenaCharacter:cid_094_athena_commando_m_rider",
    "AthenaPickaxe:pickaxe_id_031_squeak", "AthenaDance:eid_zombie"]) assert.ok(cosmetics[id], id);
  assert.equal(inBuild(v30, athenaCosmetics)["AthenaCharacter:cid_093_athena_commando_m_dinosaur"], undefined);
});

test("3.1's loot ships the Hunting Rifle and the notes' drop rates, so it takes no content update", () => {
  const shipped = inBuild(v31, athenaLootTables)[packages];
  assert.match(shipped["WorldList.AthenaLoot.Weapon.Sniper.06"].ItemDefinition, /WID_Sniper_NoScope_Athena_UC_Ore_T03/);
  assert.match(shipped["WorldList.AthenaLoot.Weapon.Sniper.07"].ItemDefinition, /WID_Sniper_NoScope_Athena_R_Ore_T03/);
  assert.equal(shipped["WorldList.AthenaLoot.Weapon.Assault.03"].Weight, 0.4);
  assert.deepEqual(inBuild(v31, () => contentUpdateStates(now, { mode: "season" })), []);
  assert.deepEqual(inBuild(v31, () => updatedLootTables(now)), {});
});

test("3.1's weekly challenges: Week 10 at 63 days, Lucky Landing in Week 9, and its row fixes", () => {
  assert.equal(inBuild(v31, challengeWeekCount), 10);
  assert.equal(inBuild(v30, challengeWeekCount), 9);
  const bundles = inBuild(v31, athenaChallengeBundles);
  assert.equal(bundles.s3_week10_questbundle.completionThreshold, 4);
  assert.ok(bundles.s3_week9_questbundle.quests.some(({ quest }) => quest === "quest_br_damage_enemy_buildings"));
  assert.equal(inBuild(v31, () => getAthenaQuest("quest_br_eliminate_location_luckylanding")).objectives[0].stat, "killingblow_athena_player_luckylanding");
  assert.equal(inBuild(v31, () => getAthenaQuest("quest_br_use_cozycampfire")).objectives[0].stat, "place_trap_campfire");
  assert.equal(inBuild(v31, () => athenaObjectiveStat("complete_athena_with_a_killingblow")).contextTags, "Athena.Playlist");
});

test("a Week 9 given on 3.0 gets 3.1's sixth quest, and Week 10 comes on 3.1 only", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build31-"));
  try {
    const store = createProfileStore(dataDir);
    configureChallenges({ challengeUnlock: { season3: { mode: "manual", manualWeeks: 10 } } });
    const week = (tracker, n) => itemsOf(tracker, "ChallengeBundle").find(([, item]) => item.templateId.toLowerCase() === `challengebundle:s3_week${n}_questbundle`);
    inBuild(v30, () => {
      const session = openSession(store, "weeks31");
      takeUpSeason(session);
      buyBattlePass(session, seasonRewardFunctions());
      const tracker = session.profile("athena");
      assert.equal(week(tracker, 9)[1].attributes.num_granted_bundle_quests, 5);
      assert.equal(week(tracker, 10), undefined);
      session.commit();
    });
    inBuild(v31, () => {
      const session = openSession(store, "weeks31");
      settleChallengeSchedules(session, seasonRewardFunctions(), now);
      const tracker = session.profile("athena");
      const [, week9] = week(tracker, 9);
      assert.equal(week9.attributes.num_granted_bundle_quests, 6);
      assert.equal(week9.attributes.grantedquestinstanceids.length, 6);
      assert.ok(week9.attributes.grantedquestinstanceids.some((id) => tracker.profile.items[id].templateId === "Quest:quest_br_damage_enemy_buildings"));
      assert.ok(week(tracker, 10));
      settleChallengeSchedules(session, seasonRewardFunctions(), now);
      assert.equal(week(tracker, 9)[1].attributes.grantedquestinstanceids.length, 6, "once");
    });
  } finally {
    configureChallenges(undefined);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("Season 3's shop sells 3.1's cosmetics on Epic's days to 3.1 only, Rex with Scaly", () => {
  // Day 11 of the replay is 4 March 2018: Rex and Pick Squeak featured.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 3: "2026-10-25" } };
  const featured = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront;
  const rex = featured(v31).find(({ templateId }) => templateId === "AthenaCharacter:cid_093_athena_commando_m_dinosaur");
  assert.ok(rex);
  assert.equal(rex.price, 2000);
  assert.deepEqual(rex.itemGrants.map(({ templateId }) => templateId),
    ["AthenaCharacter:cid_093_athena_commando_m_dinosaur", "AthenaBackpack:bid_031_dinosaur"]);
  assert.ok(featured(v31).some(({ templateId }) => templateId === "AthenaPickaxe:pickaxe_id_031_squeak"));
  assert.equal(featured(v30).length, 0, "3.0 has neither");
});

test("buying Rex gives Scaly too", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-rex31-"));
  const start = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  configureItemShop({ mode: "fnbr", rotationHour: 0, seasonStarts: { 3: start } });
  try {
    inBuild(v31, () => {
      const session = openSession(createProfileStore(dataDir), "rex31");
      grant(session, "Currency:mtxgiveaway", 5000);
      const notifications = [];
      purchaseCatalogEntry({ req: { body: { offerId: "core_br_cid_093_athena_commando_m_dinosaur", currency: "MtxCurrency", expectedPrice: 2000 } },
        session, notifications });
      const owned = Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);
      assert.ok(owned.includes("AthenaCharacter:cid_093_athena_commando_m_dinosaur"));
      assert.ok(owned.includes("AthenaBackpack:bid_031_dinosaur"));
      assert.equal(notifications[0].lootResult.items.length, 2);
    });
  } finally {
    configureItemShop(null);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("3.1 runs Spring It On!'s Brave Beginnings (Phase2) and features the DragonFire in the Weekly Store", () => {
  assert.deepEqual(activeEventFlags(v31), [passiveStorms, passiveMiniBosses, spring2018Valentines, spring2018Phase1, spring2018Phase2]);
  assert.ok(!activeEventFlags(v30).includes(spring2018Phase2));
  const weekly = (build) => inBuild(build, () => eventStoreOffers(now)).STWRotationalEventStorefront.map(({ templateId }) => templateId);
  assert.equal(weekly(v31)[0], "Schematic:sid_shotgun_dragon_drum_sr_ore_t01");
  assert.ok(!weekly(v31).includes("Schematic:sid_pistol_handcannon_de_sr_ore_t01"));
  assert.equal(weekly(v30)[0], "Schematic:sid_pistol_handcannon_de_sr_ore_t01");
});

test("3.1's group missions: one Fight the Storm (Group) a main theater region, at the group row, rewards doubled", () => {
  const missions = (build) => inBuild(build, () => worldInfo(now)).missions.flatMap((theater) => theater.availableMissions);
  assert.equal(missions(v30).filter((mission) => mission.missionGenerator.includes("_Group")).length, 0);
  const groups = missions(v31).filter((mission) => mission.missionGenerator.includes("MissionGen_1Gate_Group"));
  assert.ok(groups.length >= 4);
  for (const mission of groups) {
    assert.match(mission.missionDifficultyInfo.rowName, /^Theater_(Start|Normal|Hard|Nightmare)_Group_Zone\d$/);
    assert.match(mission.missionRewards.tierGroupName, /^Mission_Select_Group_T\d\d$/);
    // Spring It On! Gold stays one pack.
    assert.ok(mission.missionRewards.items.filter(({ itemType }) => itemType.startsWith("CardPack:zcp_eventscaling")).length <= 1);
  }
});

test("3.1's LTMs: 3.0's run on, Blitz Solo and Duo are queues 36 and 37 counting Blitz's challenge, High Jump has a quest", () => {
  for (const id of ["sneakySilencers", "blitz", "fiveByTwenty", "shotguns"]) assert.ok(hasLtm(id, v31), id);
  assert.ok(hasLtm("blitzSolo", v31) && !hasLtm("blitzSolo", v30));
  assert.equal(eventQueueOfPlaylist[36], 8);
  assert.equal(eventQueueOfPlaylist[37], 8);
  const settings = { matchmakingModes: { blitzSolo: true, highJump: true } };
  assert.deepEqual(ltmForcedQueues(v31, settings), [23, 36]);
  assert.deepEqual(ltmForcedQueues(v30, settings), [23]);
  assert.deepEqual(playlistTeamsOf(`${v31}:0:NA:36`, v31), { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 });
  assert.deepEqual(playlistTeamsOf(`${v31}:0:NA:37`, v31), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
  assert.equal(inBuild(v31, () => getAthenaQuest("athenaevent23_playmatches")).objectives[0].stat, "complete_athena_event_23");
});

test("a quest two LTMs share runs while either is on", async () => {
  const { configureLtms } = await import("../src/events/ltms.js");
  try {
    configureLtms({ matchmakingModes: { blitz: false, blitzDuo: true } });
    assert.ok(ltmQuests({ running: true }, v31, now).includes("athenaevent8_playmatches"));
    assert.ok(!ltmQuests({ running: false }, v31, now).includes("athenaevent8_playmatches"));
    configureLtms({ matchmakingModes: {} });
    assert.ok(ltmQuests({ running: false }, v31, now).includes("athenaevent8_playmatches"));
  } finally {
    configureLtms(undefined);
  }
});

test("3.1 takes AssignMatch's six fields and no match start countdown", () => {
  assert.equal(assignmentBucket(`${v31}:0:NA:2`, v31), `Fortnite:Fortnite:${v31}:0:NA:2`);
  assert.ok(!showsMatchStart(v31));
});
