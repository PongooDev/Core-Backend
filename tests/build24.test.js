import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { starSaleOffer, starSaleToken } from "../src/battlepass/season2.js";
import { allowedBuildList, allowsBuild, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { battleRoyaleBuilds, versionOf } from "../src/builds/detect.js";
import { contentUpdateStates, lootHotfixSection, updatedLootTables } from "../src/events/contentupdates.js";
import { activeEventFlags, activeMiniBosses, configureEvents, fiftyFifty, hasEventEnded, isEventActive, mutantStorms, mutantStorms2018, passiveStorms, winter2017 } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { stormLlama2018, stormTickets } from "../src/events/mutantstorms.js";
import { eventQuestLine } from "../src/events/quests.js";
import { getItem } from "../src/gamedata/items.js";
import { athenaCosmetics, athenaDisplayAssets, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { missionAlertCategories, missionAlertCategory, missionAlertRow } from "../src/gamedata/world.js";
import { assignmentBucket, showsMatchStart } from "../src/matchmaking/service.js";
import { emptyAlertRecord } from "../src/profiles/alerts.js";
import { grant } from "../src/profiles/progress.js";
import { findQuestItem, grantQuest } from "../src/profiles/quests.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { earnScore, xpForLevel } from "../src/profiles/xp.js";
import { purchaseCatalogEntry } from "../src/services/mcp/commands/PurchaseCatalogEntry.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreEnds, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 2.4 (++Fortnite+Release-Cert-CL-3858292, UE 4.19, 31 January 2018): its own game data (2.3's with the
// Minigun, the Hydra schematics, the storms' own quests and the Mini-Bosses' own flag) and version, still Season 2,
// the Mutant Storms and Mini-Bosses running on, and its notes' Minigun and Suppressed Pistol cut.
const v24 = "3858292";
const v23 = "3847564";
const v111 = "3807424";
const withStore = (fn) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build24-"));
  try {
    return fn(createProfileStore(dataDir), dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const now = new Date("2026-11-02T12:00:00Z");
const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
const tiers = "/Game/Items/Datatables/AthenaLootTierData_Client.AthenaLootTierData_Client";

test("2.4 is known by its version and plays on its own game data", () => {
  assert.equal(versionOf(v24), "2.4");
  assert.equal(dataBuild(v24), v24);
  assert.ok(battleRoyaleBuilds.includes(v24));
  // The same cosmetics and display assets as 2.3; the Hydra's schematics and the Minigun in its items.
  assert.deepEqual(inBuild(v24, athenaCosmetics), inBuild(v23, athenaCosmetics));
  assert.deepEqual(inBuild(v24, athenaDisplayAssets), inBuild(v23, athenaDisplayAssets));
  assert.ok(inBuild(v24, () => getItem("Schematic:sid_assault_hydra_sr_ore_t01")));
  assert.ok(inBuild(v24, () => getItem("Weapon:wid_assault_lmg_athena_sr_ore_t03")));
  assert.equal(inBuild(v24, () => getItem("ConversionControl:cck_ranged_assault_hydra_consumable_sr")).name, "Hydra Transform Key");
  // 2.2's Commander XP scale and mission alert record.
  assert.equal(inBuild(v24, () => xpForLevel(1)), 10_000_000);
  assert.equal(inBuild(v24, () => withStore((store) => earnScore(openSession(store, "score24"), 1_000_000).baseXPEarned)), 6_129_010);
  assert.ok(inBuild(v24, emptyAlertRecord).claimDataMap);
});

test("2.4 is still Season 2 with 1.11 to 2.3: its Battle Pass, clock, shop and tier sale, and its data is the season's newest", () => {
  const season = inBuild(v24, athenaSeason);
  assert.equal(season.seasonNumber, 2);
  assert.deepEqual(season, inBuild(v23, athenaSeason));
  // Season 2's newest data is 2.4.2's since (build242.test.js).
  assert.equal(buildOfSeason(2), "3870737");
  assert.equal(inBuild(v24, () => seasonEnd(now, { rotationHour: 0 })).toISOString(), inBuild(v111, () => seasonEnd(now, { rotationHour: 0 })).toISOString());
  const config = { mode: "custom", custom: { featured: [["AthenaGlider:glider_prismatic", 800]], daily: [["AthenaPickaxe:skiicepickaxe", 800]] } };
  assert.deepEqual(inBuild(v24, () => itemShopOffers(now, config)), inBuild(v23, () => itemShopOffers(now, config)));
  assert.equal(inBuild(v24, () => starSaleOffer("2018-01-18")).templateId, starSaleToken);
});

test("2.4 takes the Season 2 rules: AssignMatch's six fields, the match start countdown, a place on the allowed builds", () => {
  assert.equal(assignmentBucket(`${v24}:0:NA:2`, v24), `Fortnite:Fortnite:${v24}:0:NA:2`);
  assert.ok(showsMatchStart(v24));
  assert.ok(buildChoices().includes(v24));
  assert.equal(allowedBuildList(["2.4"]).join(), v24);
  assert.ok(!allowsBuild([v23, "other"], v24));
});

test("2.4 runs the Mutant Storms and Mini-Bosses on, on its own flags, with 50v50", () => {
  assert.deepEqual(activeEventFlags(v24), ["EventFlag.ActiveStorms", activeMiniBosses, fiftyFifty]);
  assert.deepEqual(activeEventFlags(v23), ["EventFlag.ActiveStorms", fiftyFifty]);
  assert.ok(isEventActive(mutantStorms2018, v24));
  assert.ok(!isEventActive("EventFlag.PassiveMiniBosses", v24));
  assert.ok(!isEventActive(mutantStorms, v24));
  for (const event of [winter2017, passiveStorms]) assert.ok(hasEventEnded(event, v24), event);
  // The storms' own quest line, in place of the FirstStorm and winter quests.
  assert.deepEqual(inBuild(v24, eventQuests), ["mutantstormsquest_2018_completestormzones_1", "mutantstormsquest_2018_killenragedhusks_1",
    "mutantstormsquest_2018_killexplodingdeathbursthusks_1", "mutantstormsquest_2018_killquickenedhusks_1", "mutantstormsquest_2018_killhuskstraps",
    "mutantstormsquest_2018_killmistmonsters", "mutantstormsquest_2018_hydraulicstormllama", "mutantstormsquest_2018_killminibosses_repeatable"]);
  const line = inBuild(v24, () => eventQuestLine(mutantStorms2018));
  for (const questId of ["mutantstormsquest_2018_killwallweakeninghusks_3", "mutantstormsquest_2018_killlifeleechattackhusks_1", "mutantstormsquest_2018_completestormzones_3"]) {
    assert.ok(line.has(questId), questId);
  }
  // 2.3 keeps its FirstStorm quests.
  assert.equal(inBuild(v23, eventQuests)[0], "firststormquest_completestormzones");
});

const stonewood = "33A2311D4AE64B361CCE27BC9F313C8B";
const mainTheaters = [stonewood, "D477605B4FA48648107B649CE97FCF27", "E6ECBD064B153234656CB4BDE6743870", "D9A801C5444D1C74D1B7DAB5C7C12C5B"];
const alertsOf = (info) => info.missionAlerts.flatMap(({ theaterId, availableMissionAlerts }) => availableMissionAlerts.map((alert) => ({ theaterId, ...alert })));
const perTheater = (alerts, category) => {
  const counts = {};
  for (const alert of alerts.filter(({ categoryName }) => categoryName === category)) counts[alert.theaterId] = (counts[alert.theaterId] ?? 0) + 1;
  return counts;
};

test("2.4's map is 2.3's: 5 and 25 Mutant Storms, 3 and 6 Mini-Bosses on their own flag, no generic alerts", () => inBuild(v24, () => {
  // Its Mini-Boss rows wait for EventFlag.ActiveMiniBosses, its General ones (with the Mini-Boss modifier) for
  // EventFlag.PassiveMiniBosses, which stays off.
  assert.equal(missionAlertRow("MissionAlert_MiniBossCategory_01").requiredEventFlag, activeMiniBosses);
  assert.equal(missionAlertRow("MissionAlert_GeneralCategory_01").requiredEventFlag, "EventFlag.PassiveMiniBosses");
  assert.equal(inBuild(v23, () => missionAlertRow("MissionAlert_MiniBossCategory_01").requiredEventFlag), winter2017);
  const info = worldInfo(now);
  const alerts = alertsOf(info);
  for (const category of ["GeneralCategory", "StormLowCategory", "Survival3DayCategory", "Survival7DayCategory"]) assert.equal(perTheater(alerts, category)[stonewood], undefined, category);
  assert.deepEqual(perTheater(alerts, "StormCategory"), Object.fromEntries(mainTheaters.map((id, index) => [id, index ? 25 : 5])));
  assert.deepEqual(perTheater(alerts, "MiniBossCategory"), Object.fromEntries(mainTheaters.map((id, index) => [id, index ? 6 : 3])));
  for (const alert of alerts.filter(({ categoryName }) => categoryName === "StormCategory")) {
    assert.ok(alert.missionAlertRewards.items.some(({ itemType }) => itemType === stormTickets));
  }
  for (const alert of alerts.filter(({ categoryName }) => categoryName === "MiniBossCategory")) assert.equal(alert.missionAlertRewards.items.length, 3);
  assert.equal(missionAlertCategory("MiniBossCategory").quota, 3);
  assert.equal(missionAlertCategories().StormCategory.quota, 10);
  for (const theater of info.theaters.filter(({ uniqueId }) => mainTheaters.includes(uniqueId))) {
    assert.deepEqual(theater.runtimeInfo.missionAlertCategoryRequirements, [{ missionAlertCategoryName: "MiniBossCategory", bRespectTileRequirements: false, bAllowQuickplay: true }]);
  }
}));

test("2.4 sells the Storm Llama and keeps the Event Store; buying the llama counts for its quest", () => withStore((store) => {
  assert.equal(inBuild(v24, () => findOffer("core_event_storm_llama", now))?.templateId, stormLlama2018);
  assert.ok(inBuild(v24, hasEventStore));
  const offers = inBuild(v24, () => eventStoreOffers(now));
  assert.deepEqual(offers.STWSpecialEventStoreFront.map(({ templateId }) => templateId),
    ["ConversionControl:cck_ranged_assault_hydra_consumable_sr", "Hero:hid_constructor_rushbase_f_sr_t01"]);
  assert.ok(offers.STWRotationalEventStorefront.length > 0);
  assert.ok(inBuild(v24, () => eventStoreEnds(now)).stwEventStoreEnd);

  inBuild(v24, () => {
    const session = openSession(store, "stormllama24");
    const tracker = session.profile("profile0");
    grantQuest(tracker, "mutantstormsquest_2018_hydraulicstormllama");
    grant(session, stormTickets, 1000);
    purchaseCatalogEntry({ req: { body: { offerId: "core_event_storm_llama", purchaseQuantity: 1, currency: "GameItem", currencySubType: stormTickets, expectedPrice: 1000 } },
      session, notifications: [] });
    const quest = tracker.profile.items[findQuestItem(tracker.profile, "mutantstormsquest_2018_hydraulicstormllama")];
    assert.equal(quest.attributes.completion_purchase_cardpack_event_firststorm, 1);
    session.commit();
  });
}));

// "Minigun: Found in Chests and Supply drops." "Suppressed Pistol: Reduced drop chances of Epic variant by 20%. Reduced
// drop chances of Legendary variant by 33%."
test("2.4's loot: the Chug Jug shipped in, the Minigun and the Suppressed Pistol's cut as hotfixes of its own", () => {
  const shipped = inBuild(v24, athenaLootTables);
  assert.equal(shipped[packages]["WorldList.AthenaHighConsumables.06"].Weight, 0.2);
  assert.equal(shipped[packages]["WorldList.AthenaLoot.Weapon.SMG.11"].Weight, 0);
  assert.match(shipped[packages]["WorldList.AthenaLoot.Weapon.SMG.11"].ItemDefinition, /WID_Assault_LMG_Athena_SR_Ore_T03/);
  assert.equal(shipped[tiers]["Loot_AthenaSupplyDrop_02"].Weight, 0);
  assert.deepEqual(inBuild(v24, () => contentUpdateStates(now, { mode: "season" })).map(({ id, on, why }) => [id, on, why]),
    [["minigun", true, "shipped"], ["suppressedPistolNerf", true, "shipped"]]);
  const updated = inBuild(v24, () => updatedLootTables(now));
  const rows = (table) => Object.fromEntries(updated[table].map(({ Name, ...row }) => [Name, row]));
  const loot = rows(packages);
  assert.equal(loot["WorldList.AthenaLoot.Weapon.SMG.10"].Weight, 0.025);
  assert.equal(loot["WorldList.AthenaLoot.Weapon.SMG.11"].Weight, 0.00625);
  assert.equal(rows(tiers)["Loot_AthenaSupplyDrop_02"].Weight, 1);
  // The chests' rows take the cut as 2.4.2's tables have it; the floor's stay.
  assert.equal(loot["WorldList.AthenaLoot.Weapon.SuppressedHandgun.01"].Weight, 0.06);
  assert.equal(loot["WorldList.AthenaLoot.Weapon.SuppressedHandgun.02"].Weight, 0.012);
  assert.equal(loot["WorldList.AthenaLoot.Weapon.Handgun.04"].Weight, 0.075);
  assert.equal(loot["WorldList.AthenaLoot.Weapon.Handgun.05"].Weight, 0.01875);
  assert.equal(loot["WorldList.AthenaHighConsumables.06"].Weight, 0.2, "the Chug Jug as shipped");
  assert.ok(inBuild(v24, () => lootHotfixSection(now)).startsWith("[AssetHotfix]"));
  // 2.3 still takes the Chug Jug alone.
  assert.deepEqual(inBuild(v23, () => contentUpdateStates(now, { mode: "season" })).map(({ id }) => id), ["chugJug"]);
});

test("Force Mutant Storms on 2.4 runs its storms and the Mini-Bosses' flag", () => {
  configureEvents({ mode: "force_mutantstorms" });
  try {
    assert.ok(activeEventFlags(v24).includes(activeMiniBosses));
    assert.ok(!activeEventFlags(v23).includes(activeMiniBosses));
    assert.ok(isEventActive(activeMiniBosses, v24));
    assert.ok(isEventActive(mutantStorms2018, v24));
    assert.deepEqual(perTheater(alertsOf(inBuild(v24, () => worldInfo(now))), "MiniBossCategory"), Object.fromEntries(mainTheaters.map((id, index) => [id, index ? 6 : 3])));
  } finally {
    configureEvents(null);
  }
});
