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
import { activeEventFlags, fiftyFifty, hasEventEnded, isEventActive, mutantStorms, mutantStorms2018, passiveStorms, winter2017 } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { convertEventLeftovers } from "../src/events/leftovers.js";
import { stormLlama2018, stormTickets } from "../src/events/mutantstorms.js";
import { eventQuestLine, isEndedEventQuest } from "../src/events/quests.js";
import { holidayLlama, snowflakeTickets, winterEventQuests } from "../src/events/winter2017.js";
import { athenaCosmetics, athenaDisplayAssets, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { missionAlertCategories, missionAlertCategory } from "../src/gamedata/world.js";
import { assignmentBucket, showsMatchStart } from "../src/matchmaking/service.js";
import { alertsRemaining, completeMissionAlert, emptyAlertRecord } from "../src/profiles/alerts.js";
import { findItem } from "../src/profiles/items.js";
import { grant } from "../src/profiles/progress.js";
import { buildOfSeason, tiersLeft } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { earnScore, xpForLevel } from "../src/profiles/xp.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreEnds, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 2.3 (++Fortnite+Release-Cert-CL-3847564, UE 4.19, 25 January 2018): its own game data (2.2's, unchanged) and
// version, still Season 2, and its notes: Survive the Holidays over, the Mutant Storms back with the Mini-Bosses, and
// the Chug Jug.
const v23 = "3847564";
const v22 = "3841827";
const v111 = "3807424";
const withStore = (fn) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build23-"));
  try {
    return fn(createProfileStore(dataDir), dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const now = new Date("2026-11-02T12:00:00Z");

test("2.3 is known by its version and plays on its own game data, which is 2.2's", () => {
  assert.equal(versionOf(v23), "2.3");
  assert.equal(dataBuild(v23), v23);
  assert.equal(battleRoyaleBuilds.at(-1), v23);
  assert.deepEqual(inBuild(v23, athenaCosmetics), inBuild(v22, athenaCosmetics));
  assert.deepEqual(inBuild(v23, athenaDisplayAssets), inBuild(v22, athenaDisplayAssets));
  assert.deepEqual(inBuild(v23, athenaLootTables), inBuild(v22, athenaLootTables));
  // 2.2's Commander XP scale and mission alert record.
  assert.equal(inBuild(v23, () => xpForLevel(1)), 10_000_000);
  assert.equal(inBuild(v23, () => withStore((store) => earnScore(openSession(store, "score23"), 1_000_000).baseXPEarned)), 6_129_010);
  assert.ok(inBuild(v23, emptyAlertRecord).claimDataMap);
});

test("2.3 is still Season 2 with 1.11 to 2.2: its Battle Pass, clock, shop and tier sale, and its data is the season's newest", () => {
  const season = inBuild(v23, athenaSeason);
  assert.equal(season.seasonNumber, 2);
  assert.deepEqual(season, inBuild(v22, athenaSeason));
  assert.equal(buildOfSeason(2), v23);
  assert.equal(inBuild(v23, () => seasonEnd(now, { rotationHour: 0 })).toISOString(), inBuild(v111, () => seasonEnd(now, { rotationHour: 0 })).toISOString());
  const config = { mode: "custom", custom: { featured: [["AthenaGlider:glider_prismatic", 800]], daily: [["AthenaPickaxe:skiicepickaxe", 800]] } };
  assert.deepEqual(inBuild(v23, () => itemShopOffers(now, config)), inBuild(v22, () => itemShopOffers(now, config)));
  const sale = inBuild(v23, () => starSaleOffer("2018-01-18"));
  assert.equal(sale.templateId, starSaleToken);
  // "Players can no longer purchase the Battle Pass x10 Tier bundle when at or above Battle Pass tier 65": of 70 tiers,
  // tier 65 has five left, and ten tiers need ten.
  assert.equal(season.numBookLevels, 70);
  assert.ok(inBuild(v23, () => tiersLeft({ stats: { attributes: { book_level: 65 } } })) < sale.tiers);
});

test("2.3 takes the Season 2 rules from 1.11 and 2.2: AssignMatch's six fields, the match start countdown", () => {
  assert.equal(assignmentBucket(`${v23}:0:NA:2`, v23), `Fortnite:Fortnite:${v23}:0:NA:2`);
  assert.ok(showsMatchStart(v23));
  // A known build of its own on the allowed-builds list, no longer one of the "other" builds.
  assert.ok(buildChoices().includes(v23));
  assert.equal(allowedBuildList(["2.3"]).join(), v23);
  assert.ok(!allowsBuild([v22, "other"], v23));
});

// "The Save the World Winter event ends on January 25." "As the snow from Survive the Holidays melts, the Mutant Storms
// return!"
test("2.3 ends Survive the Holidays and brings the Mutant Storms back, with 50v50 still on", () => {
  assert.deepEqual(activeEventFlags(v23), ["EventFlag.ActiveStorms", fiftyFifty]);
  assert.ok(isEventActive(mutantStorms2018, v23));
  for (const event of [winter2017, passiveStorms]) {
    assert.ok(!isEventActive(event, v23), event);
    assert.ok(hasEventEnded(event, v23), event);
  }
  // The Vindertech storms aren't these: their quests and llama stay over.
  assert.ok(!isEventActive(mutantStorms, v23));
  assert.ok(!isEventActive(mutantStorms2018, v22));
  assert.deepEqual(inBuild(v23, winterEventQuests), []);
  // Hydraulic storm quests and the repeatable Mini-Boss quest.
  assert.deepEqual(inBuild(v23, eventQuests), ["firststormquest_completestormzones", "firststormquest_killenragedhusks",
    "firststormquest_killexplodingdeathbursthusks", "firststormquest_killquickenedhusks", "firststormquest_killhuskstraps",
    "firststormquest_killmistmonsters", "firststormquest_levelup_hydraulic", "winterquest_2017_killminibosses_repeatable"]);
  assert.ok(inBuild(v23, () => eventQuestLine(mutantStorms2018)).has("firststormquest_killwallweakeninghusks"));
  assert.ok(!inBuild(v23, () => isEndedEventQuest("winterquest_2017_killminibosses_repeatable")));
  assert.ok(inBuild(v23, () => isEndedEventQuest("winterquest_2017_reactive_fetch_radios")));
  assert.ok(!inBuild(v22, () => isEndedEventQuest("winterquest_2017_killminibosses_repeatable")));
});

test("2.3's map: Mutant Storms with Storm Tickets, Mini-Bosses in the generic alerts' place, no ticketless storms or Survive the Storm", () => inBuild(v23, () => {
  const alerts = worldInfo(now).missionAlerts.flatMap((theater) => theater.availableMissionAlerts);
  const of = (category) => alerts.filter((alert) => alert.categoryName === category);
  for (const category of ["GeneralCategory", "StormLowCategory", "Survival3DayCategory", "Survival7DayCategory"]) assert.equal(of(category).length, 0, category);
  assert.ok(of("StormCategory").length > 0);
  for (const alert of of("StormCategory")) assert.ok(alert.missionAlertRewards.items.some(({ itemType }) => itemType === stormTickets));
  const bosses = of("MiniBossCategory");
  assert.ok(bosses.length > 0);
  for (const alert of bosses) {
    const types = alert.missionAlertRewards.items.map(({ itemType }) => itemType);
    assert.ok(!types.includes(snowflakeTickets));
    assert.ok(types.some((type) => type.startsWith("CardPack:zcp_mtx_boost")));
  }
  // "Quota: 3 per day" for the Mini-Bosses, 10 for the storms.
  assert.equal(missionAlertCategory("MiniBossCategory").quota, 3);
  assert.equal(missionAlertCategories().StormCategory.quota, 10);
  assert.equal(inBuild(v22, () => missionAlertCategory("MiniBossCategory").quota), 10);
}));

test("2.3's Mini-Boss quota is 3 a day, though a record kept 2.2's 10 slots", () => withStore((store) => {
  const session = inBuild(v22, () => {
    const opened = openSession(store, "bosses23");
    opened.profile("profile0").setStat("mission_alert_redemption_record", emptyAlertRecord());
    return opened;
  });
  const alert = (guid) => ({ categoryName: "MiniBossCategory", missionAlertGuid: guid,
    missionAlertRewards: { tierGroupName: "MissionAlert_MiniBoss", items: [{ itemType: "CardPack:zcp_mtx_boost50", quantity: 1 }] } });
  inBuild(v23, () => {
    const record = () => session.profile("profile0").profile.stats.attributes.mission_alert_redemption_record;
    assert.equal(alertsRemaining(record(), now, "MiniBossCategory"), 3);
    for (const guid of ["a", "b", "c"]) assert.ok(completeMissionAlert(session, "t", alert(guid), now), guid);
    assert.equal(completeMissionAlert(session, "t", alert("d"), now), false, "the fourth is over the quota");
    assert.equal(alertsRemaining(record(), now, "MiniBossCategory"), 0);
    assert.equal(record().claimDataMap.MiniBossCategory.lastClaimedTimes.length, 10);
  });
}));

test("2.3 sells the Storm Llama for Storm Tickets, not the Holiday Survival or Vindertech Llamas, and keeps the Event Store", () => {
  const sells = (build, offerId) => inBuild(build, () => findOffer(offerId, now))?.templateId;
  assert.equal(sells(v23, "core_event_storm_llama"), stormLlama2018);
  assert.equal(inBuild(v23, () => findOffer("core_event_storm_llama", now)).currencySubType, stormTickets);
  assert.equal(sells(v23, "core_event_winter_llama"), undefined);
  assert.equal(sells(v23, "core_event_vindertech_llama"), undefined);
  assert.equal(sells(v22, "core_event_storm_llama"), undefined);
  assert.equal(sells(v22, "core_event_winter_llama"), holidayLlama);

  // "The Legendary Hydra Transform Key is available in the Event Store! The Event Store also offers Legendary
  // Constructor BASE Hype."
  assert.ok(inBuild(v23, hasEventStore));
  const store = inBuild(v23, () => eventStoreOffers(now));
  assert.deepEqual(store.STWSpecialEventStoreFront.map(({ templateId }) => templateId),
    ["ConversionControl:cck_ranged_assault_hydra_consumable_sr", "Hero:hid_constructor_rushbase_f_sr_t01"]);
  assert.ok(store.STWRotationalEventStorefront.length > 0);
  for (const offer of [...store.STWSpecialEventStoreFront, ...store.STWRotationalEventStorefront]) {
    assert.ok(offer.purchaseLimitingEventId.startsWith("MutantStorms2018."), offer.offerId);
  }
  assert.ok(inBuild(v22, () => eventStoreOffers(now)).STWSpecialEventStoreFront[0].purchaseLimitingEventId.startsWith("Winter2017."));
  assert.ok(inBuild(v23, () => eventStoreEnds(now)).stwEventStoreEnd);
});

// "For every 1,000 unspent Snowflake tickets, a Holiday Survival Llama will automatically be granted and can be found in
// the Loot Tab. All remaining tickets will be lost."
test("2.3 turns each 1,000 Snowflake Tickets into a Holiday Survival Llama once, and keeps Storm Tickets as the storms' currency", () => withStore((store) => {
  inBuild(v22, () => {
    const session = openSession(store, "leftovers23");
    grant(session, snowflakeTickets, 2500);
    assert.deepEqual(convertEventLeftovers(session), [], "2.2 still runs the event");
    session.commit();
  });
  inBuild(v23, () => {
    const session = openSession(store, "leftovers23");
    // Storm Tickets on 2.3 buy its Storm Llama: the Mutant Storms' conversion (1.11 to 2.2) waits.
    grant(session, stormTickets, 3000);
    const granted = convertEventLeftovers(session);
    assert.ok(granted.every(({ templateId }) => templateId === holidayLlama));
    assert.equal(granted.length, 2);
    const { profile } = session.profile("profile0");
    assert.equal(findItem(profile, snowflakeTickets), undefined);
    assert.equal(profile.items[findItem(profile, stormTickets)].quantity, 3000);
    assert.ok(profile.coreMigrations.includes("eventLeftovers.Winter2017"));
    assert.deepEqual(convertEventLeftovers(session), [], "once");
  });
}));

// "Chug Jug is a new consumable that releases with this patch. It is a Legendary item and can only be found in chests or
// supply drops. Max stack is 1."
test("2.3's Chug Jug comes in as a hotfix of its own tables, in chests and supply drops only", () => {
  const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
  const shipped = inBuild(v23, athenaLootTables)[packages];
  assert.equal(shipped["WorldList.AthenaHighConsumables.06"].Weight, 0);
  assert.match(shipped["WorldList.AthenaHighConsumables.06"].ItemDefinition, /Athena_SuperMedkit/);
  assert.deepEqual(inBuild(v23, () => contentUpdateStates(now, { mode: "season" })).map(({ id, on, why }) => [id, on, why]), [["chugJug", true, "shipped"]]);
  const rows = Object.fromEntries(inBuild(v23, () => updatedLootTables(now))[packages].map(({ Name, ...row }) => [Name, row]));
  assert.equal(rows["WorldList.AthenaHighConsumables.06"].Weight, 0.2);
  assert.equal(rows["WorldList.AthenaHighConsumables.06"].Count, 1);
  assert.equal(rows["WorldList.AthenaConsumables.06"].Weight, 0, "not on the floor");
  assert.ok(inBuild(v23, () => lootHotfixSection(now)).startsWith("[AssetHotfix]"));
  assert.equal(inBuild(v22, () => lootHotfixSection(now)), "");
});
