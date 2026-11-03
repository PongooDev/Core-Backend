import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { starSaleOffer, starSaleToken } from "../src/battlepass/season2.js";
import { allowedBuildList, allowsBuild, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { battleRoyaleBuilds, versionOf } from "../src/builds/detect.js";
import { contentUpdateStates, updatedLootTables } from "../src/events/contentupdates.js";
import { activeEventFlags, fiftyFifty, hasEventEnded, isEventActive, mutantStorms2018, passiveMiniBosses, passiveStorms, spring2018,
  spring2018Phase1, spring2018Valentines } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { convertEventLeftovers } from "../src/events/leftovers.js";
import { stormLlama2018, stormTickets } from "../src/events/mutantstorms.js";
import { eventQuestLine } from "../src/events/quests.js";
import { firecrackerTickets, springLlama, upgradeLlamaFirecrackers } from "../src/events/spring2018.js";
import { athenaCosmetics, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { dataBuild } from "../src/gamedata/read.js";
import { missionAlertCategory } from "../src/gamedata/world.js";
import { assignmentBucket, showsMatchStart } from "../src/matchmaking/service.js";
import { completeMissionAlert } from "../src/profiles/alerts.js";
import { findItem } from "../src/profiles/items.js";
import { grant } from "../src/profiles/progress.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { xpForLevel } from "../src/profiles/xp.js";
import { purchaseCatalogEntry } from "../src/services/mcp/commands/PurchaseCatalogEntry.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreEnds, eventStoreOffers, hasEventStore, seasonalGold } from "../src/store/eventstore.js";
import { itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 2.5 (++Fortnite+Release-2.5-CL-3889387, UE 4.20, 13 February 2018): its own game data (the Crossbow, Impulse
// Grenade, vaulted SMG and Medium-ammo Revolver in its tables, the Valentine's and Lunar New Year cosmetics, Spring It
// On!'s quests, llama and items) and version, still Season 2 (its AthenaSeason3 is a stand-in), the storms over and
// Spring It On! on, and no match start countdown.
const v25 = "3889387";
const v242 = "3870737";
const v111 = "3807424";
const now = new Date("2026-11-03T12:00:00Z");
const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
const tiers = "/Game/Items/Datatables/AthenaLootTierData_Client.AthenaLootTierData_Client";
const withStore = (fn) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build25-"));
  try {
    return fn(createProfileStore(dataDir), dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

test("2.5 is known by its version and plays on its own game data", () => {
  assert.equal(versionOf(v25), "2.5");
  assert.equal(dataBuild(v25), v25);
  assert.ok(battleRoyaleBuilds.includes(v25));
  const cosmetics = inBuild(v25, athenaCosmetics);
  assert.ok(cosmetics["AthenaCharacter:cid_070_athena_commando_m_cupid"]);
  assert.ok(cosmetics["AthenaDance:eid_truelove"]);
  assert.equal(inBuild(v242, athenaCosmetics)["AthenaCharacter:cid_070_athena_commando_m_cupid"], undefined);
  assert.equal(inBuild(v25, () => getItem(firecrackerTickets)).name, "Firecracker Tickets");
  assert.equal(inBuild(v25, () => getItem(springLlama)).name, "Spring Llama");
  assert.equal(inBuild(v25, () => getItem("Weapon:wid_sniper_crossbow_athena_r_ore_t03_2")), undefined);
  // 2.2's Commander XP scale.
  assert.equal(inBuild(v25, () => xpForLevel(1)), 10_000_000);
});

test("2.5 is still Season 2 with 1.11 to 2.4.2, not its AthenaSeason3 stand-in, and its data is the season's newest", () => {
  const season = inBuild(v25, athenaSeason);
  assert.equal(season.seasonNumber, 2);
  assert.equal(season.storefront, "BRSeason2");
  assert.deepEqual(season, inBuild(v242, athenaSeason));
  assert.equal(buildOfSeason(2), v25);
  assert.equal(inBuild(v25, () => seasonEnd(now, { rotationHour: 0 })).toISOString(), inBuild(v111, () => seasonEnd(now, { rotationHour: 0 })).toISOString());
  const config = { mode: "custom", custom: { featured: [["AthenaGlider:glider_prismatic", 800]], daily: [["AthenaPickaxe:skiicepickaxe", 800]] } };
  assert.deepEqual(inBuild(v25, () => itemShopOffers(now, config)), inBuild(v242, () => itemShopOffers(now, config)));
  assert.equal(inBuild(v25, () => starSaleOffer("2018-02-16")).templateId, starSaleToken);
});

test("2.5 takes AssignMatch's six fields and a place on the allowed builds, but no match start countdown", () => {
  assert.equal(assignmentBucket(`${v25}:0:NA:2`, v25), `Fortnite:Fortnite:${v25}:0:NA:2`);
  assert.ok(!showsMatchStart(v25));
  assert.ok(showsMatchStart(v242));
  assert.ok(buildChoices().includes(v25));
  assert.equal(allowedBuildList(["2.5"]).join(), v25);
  assert.ok(!allowsBuild([v242, "other"], v25));
});

test("2.5 ends the storms, runs the passive storms and Mini-Bosses, Spring It On! and 50v50", () => {
  assert.deepEqual(activeEventFlags(v25), [fiftyFifty, passiveStorms, passiveMiniBosses, spring2018Valentines, spring2018Phase1]);
  assert.ok(!isEventActive(mutantStorms2018, v25));
  assert.ok(hasEventEnded(mutantStorms2018, v25));
  assert.ok(isEventActive(spring2018, v25));
  assert.ok(!isEventActive(spring2018, v242));
  assert.deepEqual(inBuild(v25, eventQuests), ["lovequest_2018_reactive_mailboxes", "springquest_2018_reactive_rescueval", "springquest_2018_reactive_fireworks"]);
  const line = inBuild(v25, () => eventQuestLine(spring2018));
  assert.equal(line.size, 19);
  assert.ok(line.has("lovequest_2018_reactive_teddybears") && line.has("springquest_2018_complete_fireworkclusters"));
  assert.ok(!line.has("springquest_2018_reactive_egghunt"));
});

const stonewood = "33A2311D4AE64B361CCE27BC9F313C8B";
const mainTheaters = [stonewood, "D477605B4FA48648107B649CE97FCF27", "E6ECBD064B153234656CB4BDE6743870", "D9A801C5444D1C74D1B7DAB5C7C12C5B"];
const perTheater = (info, category) => {
  const counts = {};
  for (const { theaterId, availableMissionAlerts } of info.missionAlerts) {
    for (const alert of availableMissionAlerts) if (alert.categoryName === category) counts[theaterId] = (counts[theaterId] ?? 0) + 1;
  }
  return counts;
};

// "Up to 3 Mutant Storms in Stonewood, 10 in other locations. | Quota: 4 per day. Up to 3 Miniboss Alerts in Stonewood, 6
// in other locations. | Quota: 3 per day."
test("2.5's map holds up to 3 passive storms in Stonewood and 10 elsewhere, and 3 and 6 Mini-Boss alerts, without tickets", () => inBuild(v25, () => {
  const info = worldInfo(now);
  assert.deepEqual(perTheater(info, "StormLowCategory"), Object.fromEntries(mainTheaters.map((id, index) => [id, index ? 10 : 3])));
  assert.deepEqual(perTheater(info, "GeneralCategory"), Object.fromEntries(mainTheaters.map((id, index) => [id, index ? 6 : 3])));
  for (const category of ["StormCategory", "MiniBossCategory"]) assert.deepEqual(perTheater(info, category), {}, category);
  const alerts = info.missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts);
  assert.ok(alerts.every(({ missionAlertRewards }) => missionAlertRewards.items.every(({ itemType }) => itemType !== stormTickets)));
  assert.equal(missionAlertCategory("StormLowCategory").quota, 4);
  assert.equal(missionAlertCategory("GeneralCategory").quota, 3);
}));

// The quotas are 2.5's and 3.0's MissionAlertCategories rows (StormLowCategory Quota 4; GeneralCategory Quota 3, tagged
// Stat.MissionAlert.MiniBoss and MissionAlert.Visual.Miniboss): a player's alert rewards stop at 4 storms and 3
// Mini-Bosses a day, and none of them is an event ticket.
for (const build of [v25, "3901517"]) {
  test(`${build}'s storm and Mini-Boss alerts reward up to 4 and 3 a day, with no event tickets`, () => withStore((store) => inBuild(build, () => {
    const info = worldInfo(now);
    const alerts = info.missionAlerts.flatMap(({ theaterId, availableMissionAlerts }) =>
      availableMissionAlerts.map((alert) => ({ theaterId, alert })));
    const tickets = [stormTickets, firecrackerTickets, "AccountResource:eventcurrency_snowballs"];
    assert.ok(alerts.every(({ alert }) => alert.missionAlertRewards.items.every(({ itemType }) => !tickets.includes(itemType))));
    const session = openSession(store, `quota${build}`);
    for (const [category, quota] of [["StormLowCategory", 4], ["GeneralCategory", 3]]) {
      const ofCategory = alerts.filter(({ alert }) => alert.categoryName === category);
      const done = ofCategory.slice(0, quota + 1).map(({ theaterId, alert }) => completeMissionAlert(session, theaterId, alert, now));
      assert.deepEqual(done, [...Array(quota).fill(true), false], category);
    }
  })));
}

test("2.5 sells the Spring Llama for 1,000 Firecracker Tickets, no Storm Llama, and Upgrade Llamas give Firecracker Tickets", () => withStore((store) => {
  const llama = inBuild(v25, () => findOffer("core_event_spring_llama", now));
  assert.equal(llama.templateId, springLlama);
  assert.equal(llama.currencySubType, firecrackerTickets);
  assert.equal(llama.price, 1000);
  assert.equal(inBuild(v25, () => findOffer("core_event_storm_llama", now)), undefined);
  assert.equal(inBuild(v242, () => findOffer("core_event_spring_llama", now)), undefined);
  const buy = (build) => inBuild(build, () => {
    const session = openSession(store, `llamas${build}`);
    grant(session, "Currency:mtxpurchased", 1000);
    const notifications = [];
    purchaseCatalogEntry({ req: { body: { offerId: "core_cardpack_bronze", purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: 50 } }, session, notifications });
    const { profile } = session.profile("profile0");
    session.commit();
    const held = (currency) => profile.items[findItem(profile, currency)]?.quantity ?? 0;
    return [held(firecrackerTickets), held(stormTickets)];
  });
  assert.deepEqual(buy(v25), [100, 0]);
  assert.deepEqual(buy(v242), [0, 100]);
  assert.equal(inBuild(v25, () => upgradeLlamaFirecrackers(findOffer("core_voucher_cardpack_bronze", now), 1)), 0);
}));

// "Heartbreaker Crossbow ... Available in the Event Store for Seasonal Gold."
test("2.5's Event Store is Spring It On!'s, with the Heartbreaker", () => {
  assert.ok(inBuild(v25, hasEventStore));
  const special = inBuild(v25, () => eventStoreOffers(now)).STWSpecialEventStoreFront;
  assert.deepEqual(special.map(({ templateId }) => templateId), ["Schematic:sid_sniper_crossbow_sr_ore_t01", "Hero:hid_ninja_009_f_valentine_sr_t01",
    "Schematic:sid_floor_flamegrill_sr_t01"]);
  assert.ok(special.every(({ purchaseLimitingEventId, currencySubType }) => purchaseLimitingEventId === "Spring2018.STWSpecialEventStoreFront"
    && currencySubType === seasonalGold));
  assert.ok(inBuild(v25, () => eventStoreEnds(now)).stwEventStoreEnd);
});

// "Each stack of 1000 Storm Event Tickets has been exchanged for Storm Llamas." "Up to 3000 Seasonal Gold will be converted
// 3 to 1 into Firecracker Tickets, and any additional gold beyond that is lost."
test("2.5 turns each 1,000 Storm Tickets into a Storm Llama and up to 3,000 Seasonal Gold into Firecracker Tickets, once", () => withStore((store) => {
  inBuild(v242, () => {
    const session = openSession(store, "leftovers25");
    grant(session, stormTickets, 2500);
    grant(session, seasonalGold, 4000);
    assert.deepEqual(convertEventLeftovers(session), [], "2.4.2 still runs the storms");
    session.commit();
  });
  inBuild(v25, () => {
    const session = openSession(store, "leftovers25");
    const granted = convertEventLeftovers(session);
    assert.deepEqual(granted.filter(({ templateId }) => templateId === stormLlama2018).length, 2);
    const { profile } = session.profile("profile0");
    assert.equal(findItem(profile, stormTickets), undefined);
    assert.equal(findItem(profile, seasonalGold), undefined);
    assert.equal(profile.items[findItem(profile, firecrackerTickets)].quantity, 1000);
    assert.ok(profile.coreMigrations.includes("eventLeftovers.MutantStorms2018"));
    assert.ok(profile.coreMigrations.includes("eventLeftovers.SeasonalGold2018"));
    assert.ok(!profile.coreMigrations.includes("eventLeftovers.MutantStorms2017"));
    grant(session, seasonalGold, 300);
    assert.deepEqual(convertEventLeftovers(session), [], "once");
    assert.equal(profile.items[findItem(profile, seasonalGold)].quantity, 300);
  });
}));

// The Crossbow, Minigun, Chug Jug, Impulse Grenade, SMG and Revolver changes of 2.5's notes are in its tables.
test("2.5's loot ships its notes' changes and the Crossbow, so it takes no content update", () => {
  const shipped = inBuild(v25, athenaLootTables);
  assert.equal(shipped[packages]["WorldList.AthenaLoot.Weapon.Crossbow.01"].Weight, 1);
  assert.equal(shipped[packages]["WorldList.AthenaLoot.Weapon.Crossbow.02"].Weight, 0.25);
  assert.equal(shipped[tiers]["Loot_AthenaTreasure_02"].LootPackage, "WorldPKG.AthenaLoot.Weapon.LMG");
  assert.equal(shipped[tiers]["Loot_AthenaTreasure_02"].Weight, 0.07);
  assert.equal(shipped[packages]["WorldList.AthenaHighConsumables.06"].Weight, 0.17);
  assert.match(shipped[packages]["WorldList.AthenaHighConsumables.10"].ItemDefinition, /Athena_KnockGrenade$/);
  assert.equal(shipped[packages]["WorldList.AthenaConsumables.10"].Weight, 0);
  for (const row of ["01", "02", "03"]) assert.equal(shipped[packages][`WorldList.AthenaLoot.Weapon.SMG.${row}`].Weight, 0, row);
  assert.deepEqual(inBuild(v25, () => contentUpdateStates(now, { mode: "season" })), []);
  assert.deepEqual(inBuild(v25, () => updatedLootTables(now)), {});
  // 2.4.2 takes none: its paks lack the Crossbow (build242.test.js).
  assert.deepEqual(inBuild(v242, () => contentUpdateStates(now, { mode: "season" })), []);
});
