import { test } from "node:test";
import assert from "node:assert/strict";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { versionOf } from "../src/builds/detect.js";
import { contentUpdateStates, updatedLootTables } from "../src/events/contentupdates.js";
import { activeEventFlags, groupMission, passiveMiniBosses, passiveStorms, spring2018Phase1, spring2018Phase2, spring2018Phase3, spring2018Valentines } from "../src/events/events.js";
import { eventQuestLine } from "../src/events/quests.js";
import { springEventQuests } from "../src/events/spring2018.js";
import { hasLtm, ltmNewMode, ltmOn, ltmQuests } from "../src/events/ltms.js";
import { athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket, playlistTeamsOf, showsMatchStart } from "../src/matchmaking/service.js";
import { challengeWeekCount } from "../src/profiles/challenges.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { eventStoreOffers } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 3.3 (++Fortnite+Release-3.3-CL-3942182, UE 4.20, 15 March 2018): Season 3, on its own data
// (gamedata/3942182), sharing 3.0's Battle Pass, clock, shop and leaderboards.
const v33 = "3942182";
const v32 = "3935073";
const v31 = "3915963";
const v30 = "3901517";
const now = new Date("2026-11-04T12:00:00Z");

test("3.3 is known by its version, plays on its own data and is Season 3, with 3.0's pass", () => {
  assert.equal(versionOf(v33), "3.3");
  assert.equal(dataBuild(v33), v33);
  assert.ok(buildChoices().includes(v33));
  assert.equal(allowedBuildList(["3.3"]).join(), v33);
  assert.deepEqual(inBuild(v33, athenaSeason), inBuild(v30, athenaSeason), "AthenaSeason3 is 3.0's");
  assert.equal(buildOfSeason(3), "4019403", "Season 3's newest data is 3.6's (build36.test.js)");
  assert.deepEqual(inBuild(v33, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]),
    inBuild(v30, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]));
});

test("3.3 adds no cosmetic: 3.2's, with three rarities moved (Power Chord and Six String Fine, Sgt. Green Clover and Pot O' Gold lower)", () => {
  const now33 = inBuild(v33, athenaCosmetics);
  const before = inBuild(v32, athenaCosmetics);
  assert.deepEqual(Object.keys(now33).sort(), Object.keys(before).sort());
  assert.equal(now33["AthenaCharacter:dev_testasset"], undefined);
  assert.equal(before["AthenaCharacter:cid_097_athena_commando_f_rockerpunk"].rarity, "Quality");
  assert.equal(now33["AthenaCharacter:cid_097_athena_commando_f_rockerpunk"].rarity, "Fine");
  assert.equal(now33["AthenaBackpack:bid_034_rockerpunk"].rarity, "Fine");
  assert.equal(now33["AthenaCharacter:cid_098_athena_commando_f_stpatty"].rarity, "Ordinary");
  assert.equal(now33["AthenaPickaxe:pickaxe_id_033_potofgold"].rarity, "Sturdy");
});

test("3.3's loot and weapons: the notes' Hunting Rifle name, the Heavy Shotgun's tier, Cells' supply drop list gone", () => {
  assert.equal(inBuild(v33, () => getItem("Weapon:wid_sniper_noscope_athena_r_ore_t03")).name, "Hunting Rifle");
  assert.equal(inBuild(v32, () => getItem("Weapon:wid_sniper_noscope_athena_r_ore_t03")).name, "No-Scope Hunting Rifle");
  assert.equal(inBuild(v33, () => getItem("Weapon:wid_shotgun_slugfire_athena_sr")).tier, "V");
  // Its overlay is the notes' loot (Remote Explosives, the Smoke Grenade vaulted), served as it ships.
  assert.deepEqual(inBuild(v33, () => contentUpdateStates(now, { mode: "season" })), []);
  assert.deepEqual(inBuild(v33, () => updatedLootTables(now)), {});
  const packages = inBuild(v33, () => buildGameData(v33, "athena", {})).loot["/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client"];
  const rows = Object.keys(packages.rows ?? packages);
  assert.ok(rows.length > 0);
  assert.ok(!rows.includes("WorldList.AthenaSupplyDrop.Weapon.Cells.01"));
});

test("3.3's weekly challenges are 3.2's", () => {
  assert.equal(inBuild(v33, challengeWeekCount), 10);
});

test("Season 3's shop on 3.3 sells 3.2's cosmetics as 3.2 does, and 3.0's shop is as it was", () => {
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 3: "2026-10-04" } };
  const ids = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront.map(({ templateId }) => templateId);
  assert.deepEqual(ids(v33), ids(v32));
  assert.ok(ids(v33).includes("AthenaCharacter:cid_097_athena_commando_f_rockerpunk"));
  assert.ok(!ids(v30).some((id) => /rockerpunk/.test(id)));
});

test("3.3 runs 3.2's Spring It On! flags and starts Luck of the Storm (Phase3)", () => {
  assert.deepEqual(activeEventFlags(v33), [passiveStorms, passiveMiniBosses, spring2018Valentines, spring2018Phase1, spring2018Phase2, groupMission, spring2018Phase3]);
  assert.ok(!activeEventFlags(v32).includes(spring2018Phase3), "3.2's notes don't start it");
  assert.ok(!activeEventFlags(v31).includes(groupMission));
  assert.deepEqual(activeEventFlags("3950000"), []);
});

test("Luck of the Storm: the pots of gold are granted on 3.3 only, and lead to the Pub quest's choice of St. Patrick's heroes", () => {
  const started = (build) => inBuild(build, springEventQuests);
  assert.ok(started(v33).includes("springquest_2018_reactive_potsofgold"));
  assert.ok(!started(v32).includes("springquest_2018_reactive_potsofgold"));
  assert.ok(started(v33).includes("springquest_2018_reactive_fireworks"), "the earlier chapters stay");
  const line = inBuild(v33, () => [...eventQuestLine("Spring2018")]);
  for (const id of ["springquest_2018_reactive_potsofgold", "springquest_2018_reactive_killcollect_clovers",
    "springquest_2018_reactive_leprechaun_traps", "springquest_2018_reactive_locationdiscovery_pub"]) assert.ok(line.includes(id), id);
  const pub = inBuild(v33, () => getQuest("springquest_2018_reactive_locationdiscovery_pub"));
  assert.equal(pub.selectableRewards.length, 3);
  assert.equal(pub.rewards[0].templateId, "Worker:worker_leprechaun_vr_t01");
});

test("3.3's Event Store keeps 3.2's items (Wukong, the DragonFire) and has no Shamrock Reclaimer: its paks lack the hero", () => {
  const store = (front) => inBuild(v33, () => eventStoreOffers(now))[front].map(({ templateId }) => templateId);
  assert.equal(store("STWRotationalEventStorefront")[0], "Schematic:sid_shotgun_dragon_drum_sr_ore_t01");
  assert.ok(store("STWSpecialEventStoreFront").includes("Hero:hid_commando_014_wukong_sr_t01"));
  assert.ok(!store("STWSpecialEventStoreFront").some((id) => /shamrock|reclaimer/i.test(id)));
  assert.equal(Object.keys(buildGameData(v33, "items", {})).filter((id) => /shamrock/i.test(id)).length, 0);
});

test("3.3's group missions run on as 3.2's world data", () => {
  const info = inBuild(v33, () => worldInfo(now));
  const groups = info.missions.flatMap(({ availableMissions }) => availableMissions.filter((mission) => /_Group(_PVE02on)?_C$/.test(mission.missionGenerator)));
  assert.ok(groups.length >= 8);
  assert.ok(info.missionAlerts.some(({ availableMissionAlerts }) => availableMissionAlerts.some(({ categoryName }) => categoryName === "GroupMissionCategory")));
});

test("3.3's LTMs: no new playlist, Blitz and the rest run on, and Teams of 20 is by hand again", () => {
  for (const id of ["sneakySilencers", "blitz", "fiveByTwenty", "shotguns", "blitzSolo", "blitzDuo", "useItOrLoseIt"]) assert.ok(hasLtm(id, v33), id);
  assert.ok(!hasLtm("fiftyFifty", v33));
  assert.equal(ltmNewMode(v33, { matchmakingModes: {} }), null, "3.3 has no new mode");
  assert.equal(ltmOn("fiveByTwenty", v33, { matchmakingModes: {} }), false);
  assert.equal(ltmOn("fiveByTwenty", v33, { matchmakingModes: { fiveByTwenty: true } }), true);
  assert.equal(ltmOn("fiveByTwenty", v32, { matchmakingModes: {} }), true, "3.2 keeps it as its new mode");
  assert.ok(ltmQuests({ running: false }, v33, now).includes("athenaevent25_playmatches"));
  assert.deepEqual(playlistTeamsOf(`${v33}:0:NA:22`, v33), playlistTeamsOf(`${v32}:0:NA:22`, v32), "Teams of 20 is 5x20");
  assert.deepEqual(playlistTeamsOf(`${v33}:0:NA:37`, v33), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
});

test("3.3 takes AssignMatch's six fields and no match start countdown", () => {
  assert.equal(assignmentBucket(`${v33}:0:NA:2`, v33), `Fortnite:Fortnite:${v33}:0:NA:2`);
  assert.ok(!showsMatchStart(v33));
});
