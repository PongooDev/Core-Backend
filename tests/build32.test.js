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
import { hasLtm, ltmQuests } from "../src/events/ltms.js";
import { athenaChallengeBundles, athenaCosmetics, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket, playlistTeamsOf, showsMatchStart } from "../src/matchmaking/service.js";
import { challengeWeekCount } from "../src/profiles/challenges.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { eventStoreOffers } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";
import { grant } from "../src/profiles/progress.js";
import { purchaseCatalogEntry } from "../src/services/mcp/commands/PurchaseCatalogEntry.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 3.2 (++Fortnite+Release-3.2-CL-3935073, UE 4.20, 8 March 2018): Season 3, on its own data
// (gamedata/3935073), sharing 3.0's Battle Pass, clock, shop and leaderboards.
const v32 = "3935073";
const v31 = "3915963";
const v30 = "3901517";
const now = new Date("2026-11-04T12:00:00Z");

test("3.2 is known by its version, plays on its own data and is Season 3 with 3.0's pass", () => {
  assert.equal(versionOf(v32), "3.2");
  assert.equal(dataBuild(v32), v32);
  assert.ok(buildChoices().includes(v32));
  assert.equal(allowedBuildList(["3.2"]).join(), v32);
  const season = inBuild(v32, athenaSeason);
  assert.deepEqual(season, inBuild(v30, athenaSeason), "AthenaSeason3 is 3.0's");
  assert.equal(buildOfSeason(3), v32);
  assert.deepEqual(inBuild(v32, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]),
    inBuild(v30, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]));
});

test("3.2's cosmetics: Power Chord, Sgt. Green Clover, Highland Warrior, Battle Hound and their gear, but not the test character", () => {
  const cosmetics = inBuild(v32, athenaCosmetics);
  for (const id of ["AthenaCharacter:cid_097_athena_commando_f_rockerpunk", "AthenaCharacter:cid_098_athena_commando_f_stpatty",
    "AthenaCharacter:cid_099_athena_commando_f_scathach", "AthenaCharacter:cid_100_athena_commando_m_cuchulainn",
    "AthenaPickaxe:pickaxe_id_034_rockerpunk", "AthenaGlider:glider_id_022_rockerpunk", "AthenaBackpack:bid_034_rockerpunk",
    "AthenaDance:eid_irishjig", "AthenaCharacter:cid_093_athena_commando_m_dinosaur"]) assert.ok(cosmetics[id], id);
  assert.equal(cosmetics["AthenaCharacter:dev_testasset"], undefined);
  assert.equal(inBuild(v31, athenaCosmetics)["AthenaCharacter:cid_097_athena_commando_f_rockerpunk"], undefined);
});

test("3.2's loot ships the notes' tables itself, so it takes no content update", () => {
  assert.deepEqual(inBuild(v32, () => contentUpdateStates(now, { mode: "season" })), []);
  assert.deepEqual(inBuild(v32, () => updatedLootTables(now)), {});
});

test("3.2's weekly challenges: ten weeks as 3.1's, with the notes' row changes in its data", () => {
  assert.equal(inBuild(v32, challengeWeekCount), 10);
  const bundles = inBuild(v32, athenaChallengeBundles);
  assert.equal(bundles.s3_week10_questbundle.completionThreshold, 4);
  assert.ok(bundles.s3_week9_questbundle.quests.some(({ quest }) => quest === "quest_br_damage_enemy_buildings"));
  // Use It & Lose It's quest, and the quest the Jetpack brings, are 3.2's.
  assert.equal(inBuild(v32, () => getAthenaQuest("athenaevent25_playmatches")).objectives[0].stat, "complete_athena_event_25");
  assert.ok(inBuild(v32, () => getAthenaQuest("quest_br_use_jetpack")));
  assert.equal(inBuild(v31, () => getAthenaQuest("athenaevent25_playmatches")), undefined);
});

test("Season 3's shop sells 3.2's cosmetics on Epic's days to 3.2 only, Power Chord with Six String", () => {
  // Day 32 of the replay is 25 March 2018: Power Chord, the Anarchy Axe and Stage Dive featured.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 3: "2026-10-04" } };
  const featured = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront;
  const chord = featured(v32).find(({ templateId }) => templateId === "AthenaCharacter:cid_097_athena_commando_f_rockerpunk");
  assert.ok(chord);
  assert.equal(chord.price, 2000);
  assert.deepEqual(chord.itemGrants.map(({ templateId }) => templateId),
    ["AthenaCharacter:cid_097_athena_commando_f_rockerpunk", "AthenaBackpack:bid_034_rockerpunk"]);
  const ids = featured(v32).map(({ templateId }) => templateId);
  assert.ok(ids.includes("AthenaPickaxe:pickaxe_id_034_rockerpunk") && ids.includes("AthenaGlider:glider_id_022_rockerpunk"));
  assert.ok(!featured(v31).some(({ templateId }) => /rockerpunk/.test(templateId)), "3.1 has none of them");
});

test("buying Power Chord gives Six String too", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-chord32-"));
  const start = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
  configureItemShop({ mode: "fnbr", rotationHour: 0, seasonStarts: { 3: start } });
  try {
    inBuild(v32, () => {
      const session = openSession(createProfileStore(dataDir), "chord32");
      grant(session, "Currency:mtxgiveaway", 5000);
      const notifications = [];
      purchaseCatalogEntry({ req: { body: { offerId: "core_br_cid_097_athena_commando_f_rockerpunk", currency: "MtxCurrency", expectedPrice: 2000 } },
        session, notifications });
      const owned = Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);
      assert.ok(owned.includes("AthenaCharacter:cid_097_athena_commando_f_rockerpunk"));
      assert.ok(owned.includes("AthenaBackpack:bid_034_rockerpunk"));
    });
  } finally {
    configureItemShop(null);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("3.2 runs 3.1's Spring It On! flags, features the DragonFire and adds Wukong to the Event Store", () => {
  assert.deepEqual(activeEventFlags(v32), [passiveStorms, passiveMiniBosses, spring2018Valentines, spring2018Phase1, spring2018Phase2]);
  const store = (build, front) => inBuild(build, () => eventStoreOffers(now))[front].map(({ templateId }) => templateId);
  assert.equal(store(v32, "STWRotationalEventStorefront")[0], "Schematic:sid_shotgun_dragon_drum_sr_ore_t01");
  assert.ok(store(v32, "STWSpecialEventStoreFront").includes("Hero:hid_commando_014_wukong_sr_t01"));
  assert.ok(!store(v31, "STWSpecialEventStoreFront").includes("Hero:hid_commando_014_wukong_sr_t01"), "3.1's notes have no Wukong");
});

test("3.2's quests: the Boost Pad goes with the Hoverboard, the St. Patrick's heroes come from the Pub quest", () => {
  const hoverboard = inBuild(v32, () => getQuest("stonewoodquest_reactive_fetch_hoverboard"));
  assert.deepEqual(hoverboard.rewards.map(({ templateId }) => templateId), ["PersonalVehicle:vid_hoverboard", "Schematic:sid_floor_hoverboard_speed_r_t01"]);
  assert.equal(inBuild(v31, () => getQuest("stonewoodquest_reactive_fetch_hoverboard")).rewards.length, 1);
  const pub = inBuild(v32, () => getQuest("springquest_2018_reactive_locationdiscovery_pub"));
  assert.equal(pub.selectableRewards.length, 3);
});

test("3.2 keeps the group missions of 3.1", () => {
  const missions = inBuild(v32, () => worldInfo(now)).missions.flatMap((theater) => theater.availableMissions);
  assert.ok(missions.filter((mission) => mission.missionGenerator.includes("MissionGen_1Gate_Group")).length >= 4);
});

test("3.2's LTMs: 3.1's run on, Use It & Lose It gets its quest, no queue is added", () => {
  for (const id of ["sneakySilencers", "blitz", "fiveByTwenty", "shotguns", "blitzSolo", "blitzDuo", "useItOrLoseIt"]) assert.ok(hasLtm(id, v32), id);
  assert.ok(!hasLtm("fiftyFifty", v32));
  assert.ok(ltmQuests({ running: false }, v32, now).includes("athenaevent25_playmatches"));
  assert.deepEqual(playlistTeamsOf(`${v32}:0:NA:22`, v32), playlistTeamsOf(`${v31}:0:NA:22`, v31), "Teams of 20 is 5x20");
  assert.deepEqual(playlistTeamsOf(`${v32}:0:NA:37`, v32), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
});

test("3.2 takes AssignMatch's six fields and no match start countdown", () => {
  assert.equal(assignmentBucket(`${v32}:0:NA:2`, v32), `Fortnite:Fortnite:${v32}:0:NA:2`);
  assert.ok(!showsMatchStart(v32));
});
