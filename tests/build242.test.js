import { test } from "node:test";
import assert from "node:assert/strict";
import { starSaleOffer, starSaleToken } from "../src/battlepass/season2.js";
import { allowedBuildList, allowsBuild, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { battleRoyaleBuilds, versionOf } from "../src/builds/detect.js";
import { contentUpdateStates, lootHotfixSection, updatedLootTables } from "../src/events/contentupdates.js";
import { activeEventFlags, activeMiniBosses, fiftyFifty, hasEventEnded, isEventActive, mutantStorms2018, passiveStorms, winter2017 } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { refreshExpeditions } from "../src/expeditions/expeditions.js";
import { athenaCosmetics, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { dataBuild } from "../src/gamedata/read.js";
import { missionAlertRow } from "../src/gamedata/world.js";
import { assignmentBucket, showsMatchStart } from "../src/matchmaking/service.js";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { xpForLevel } from "../src/profiles/xp.js";
import { eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 2.4.2 (++Fortnite+Release-Next-CL-3870737, UE 4.19, 8 February 2018): its own game data (2.4's with the
// Minigun and the Suppressed Pistol's cut in its tables, the Crossbow's items, Alpine Ace, the Cozy Campfire trap and the
// People Run and Trap Run expeditions) and version, still Season 2, 2.4's storms running on, and its notes' Crossbow.
const v242 = "3870737";
const v24 = "3858292";
const v111 = "3807424";
const now = new Date("2026-11-03T12:00:00Z");
const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
const tiers = "/Game/Items/Datatables/AthenaLootTierData_Client.AthenaLootTierData_Client";

test("2.4.2 is known by its version and plays on its own game data", () => {
  assert.equal(versionOf(v242), "2.4.2");
  assert.equal(dataBuild(v242), v242);
  assert.ok(battleRoyaleBuilds.includes(v242));
  const cosmetics = inBuild(v242, athenaCosmetics);
  assert.equal(cosmetics["AthenaCharacter:cid_053_athena_commando_m_skidude"].name, "Alpine Ace");
  assert.equal(inBuild(v24, athenaCosmetics)["AthenaCharacter:cid_053_athena_commando_m_skidude"], undefined);
  assert.equal(inBuild(v242, () => getItem("Weapon:wid_sniper_crossbow_athena_vr_ore_t03")).name, "Crossbow");
  assert.ok(inBuild(v242, () => getItem("Schematic:sid_floor_campfire_sr_t01")));
  assert.ok(!inBuild(v24, () => getItem("Schematic:sid_floor_campfire_sr_t01")));
  // 2.2's Commander XP scale.
  assert.equal(inBuild(v242, () => xpForLevel(1)), 10_000_000);
});

test("2.4.2 is still Season 2 with 1.11 to 2.4: its Battle Pass, clock, shop and tier sale, and its data is the season's newest", () => {
  const season = inBuild(v242, athenaSeason);
  assert.equal(season.seasonNumber, 2);
  assert.deepEqual(season, inBuild(v24, athenaSeason));
  // Season 2's newest data is 2.5's since (build25.test.js).
  assert.equal(buildOfSeason(2), "3889387");
  assert.equal(inBuild(v242, () => seasonEnd(now, { rotationHour: 0 })).toISOString(), inBuild(v111, () => seasonEnd(now, { rotationHour: 0 })).toISOString());
  const config = { mode: "custom", custom: { featured: [["AthenaGlider:glider_prismatic", 800]], daily: [["AthenaPickaxe:skiicepickaxe", 800]] } };
  assert.deepEqual(inBuild(v242, () => itemShopOffers(now, config)), inBuild(v24, () => itemShopOffers(now, config)));
  assert.equal(inBuild(v242, () => starSaleOffer("2018-01-18")).templateId, starSaleToken);
});

test("2.4.2 takes the Season 2 rules: AssignMatch's six fields, the match start countdown, a place on the allowed builds", () => {
  assert.equal(assignmentBucket(`${v242}:0:NA:2`, v242), `Fortnite:Fortnite:${v242}:0:NA:2`);
  assert.ok(showsMatchStart(v242));
  assert.ok(buildChoices().includes(v242));
  assert.equal(allowedBuildList(["2.4.2"]).join(), v242);
  assert.ok(!allowsBuild([v24, "other"], v242));
});

test("2.4.2 runs 2.4's storms, Mini-Bosses and 50v50 on, and not the Valentine's quests its data already has", () => {
  assert.deepEqual(activeEventFlags(v242), ["EventFlag.ActiveStorms", activeMiniBosses, fiftyFifty]);
  assert.ok(isEventActive(mutantStorms2018, v242));
  for (const event of [winter2017, passiveStorms]) assert.ok(!isEventActive(event, v242), event);
  // Survive the Holidays is over for good; the ticketless storms come back with 2.5 (build25.test.js).
  assert.ok(hasEventEnded(winter2017, v242));
  assert.deepEqual(inBuild(v242, eventQuests), inBuild(v24, eventQuests));
  assert.ok(inBuild(v242, eventQuests).every((questId) => !questId.startsWith("lovequest")));
  assert.equal(inBuild(v242, () => missionAlertRow("MissionAlert_MiniBossCategory_01").requiredEventFlag), activeMiniBosses);
  const alerts = inBuild(v242, () => worldInfo(now)).missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts);
  assert.ok(alerts.some(({ categoryName }) => categoryName === "StormCategory"));
  assert.ok(alerts.some(({ categoryName }) => categoryName === "MiniBossCategory"));
});

test("2.4.2's Event Store sells the Cozy Campfire 2.4's notes name; 2.4's, without it, doesn't", () => {
  assert.ok(inBuild(v242, hasEventStore));
  const special = (build) => inBuild(build, () => eventStoreOffers(now)).STWSpecialEventStoreFront.map(({ templateId }) => templateId);
  assert.deepEqual(special(v242), ["ConversionControl:cck_ranged_assault_hydra_consumable_sr", "Hero:hid_constructor_rushbase_f_sr_t01",
    "Schematic:sid_floor_campfire_sr_t01"]);
  assert.deepEqual(special(v24), ["ConversionControl:cck_ranged_assault_hydra_consumable_sr", "Hero:hid_constructor_rushbase_f_sr_t01"]);
});

// "Crossbow: ... Found from floor loot and treasure chests. This weapon comes in both Rare and Epic variants."
test("2.4.2's loot: the Minigun and the Suppressed Pistol's cut shipped in, the Crossbow as a hotfix of its own", () => {
  const shipped = inBuild(v242, athenaLootTables);
  assert.equal(shipped[packages]["WorldList.AthenaLoot.Weapon.LMG.01"].Weight, 0.6);
  assert.equal(shipped[packages]["WorldList.AthenaLoot.Weapon.SMG.10"], undefined);
  assert.equal(shipped[packages]["WorldList.AthenaLoot.Weapon.SuppressedHandgun.02"].Weight, 0.012);
  assert.equal(shipped[tiers]["Loot_AthenaSupplyDrop_02"].Weight, 1);
  assert.ok(!JSON.stringify(shipped).includes("Crossbow"));
  assert.deepEqual(inBuild(v242, () => contentUpdateStates(now, { mode: "season" })).map(({ id, on, why }) => [id, on, why]), [["crossbow", true, "shipped"]]);

  const updated = inBuild(v242, () => updatedLootTables(now));
  assert.deepEqual(Object.keys(updated), [packages]);
  const names = updated[packages].map(({ Name }) => Name);
  const at = names.indexOf("WorldList.AthenaLoot.Weapon.Sniper.05");
  assert.deepEqual(names.slice(at, at + 3), ["WorldList.AthenaLoot.Weapon.Sniper.05", "WorldList.AthenaLoot.Weapon.Sniper.06", "WorldList.AthenaLoot.Weapon.Sniper.07"]);
  assert.equal(names.length, Object.keys(shipped[packages]).length + 2);
  const rows = Object.fromEntries(updated[packages].map(({ Name, ...row }) => [Name, row]));
  assert.deepEqual(rows["WorldList.AthenaLoot.Weapon.Sniper.06"], { ...shipped[packages]["WorldList.AthenaLoot.Weapon.Sniper.05"], Weight: 1,
    ItemDefinition: "/Game/Athena/Items/Weapons/WID_Sniper_Crossbow_Athena_R_Ore_T03_2.WID_Sniper_Crossbow_Athena_R_Ore_T03_2",
    Annotation: ";List:WorldList.AthenaLoot.Weapon.Sniper.C0;Item:WID.Sniper.Crossbow.Athena.R.Ore.T03.2" });
  assert.equal(rows["WorldList.AthenaLoot.Weapon.Sniper.07"].Weight, 0.25);
  assert.match(rows["WorldList.AthenaLoot.Weapon.Sniper.07"].ItemDefinition, /WID_Sniper_Crossbow_Athena_VR_Ore_T03$/);
  assert.equal(rows["WorldList.AthenaLoot.Weapon.Sniper.07"].LootPackageID, "WorldList.AthenaLoot.Weapon.Sniper");
  const section = inBuild(v242, () => lootHotfixSection(now));
  assert.ok(section.startsWith("[AssetHotfix]"));
  assert.ok(section.includes("WID_Sniper_Crossbow_Athena_VR_Ore_T03"));
  // 2.4 still takes its own two, and no Crossbow.
  assert.deepEqual(inBuild(v24, () => contentUpdateStates(now, { mode: "season" })).map(({ id }) => id), ["minigun", "suppressedPistolNerf"]);
});

test("2.4.2's first skill tree node opens the People Run slot, which offers a People Run expedition", () => inBuild(v242, () => {
  const tracker = trackChanges({ profileId: "profile0", stats: { attributes: defaultStats("profile0") }, items: {} });
  tracker.addItem("node", { templateId: "HomebaseNode:t1_main_ad1499e010", attributes: { level: 1 }, quantity: 1 });
  refreshExpeditions({ profile: () => tracker }, now);
  const board = Object.fromEntries(Object.values(tracker.profile.items).filter((item) => item.templateId.startsWith("Expedition:"))
    .map((item) => [item.attributes.expedition_slot_id, item.templateId]));
  assert.match(board.PeopleRun, /^Expedition:expedition_peoplerun_(short|medium)_t00$/);
  assert.match(board.Land1_0, /^Expedition:expedition_(?!air|sea)[a-z_]+_t01$/);
}));
