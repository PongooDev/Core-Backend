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
import { rollContents } from "../src/cardpacks/contents.js";
import { activeEventFlags, configureEvents, fiftyFifty, hasEventEnded, isEventActive, mutantStorms, mutantStorms2018, passiveStorms, winter2017 } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { convertEventLeftovers } from "../src/events/leftovers.js";
import { stormLlama2018, stormTickets, upgradeLlamaTickets } from "../src/events/mutantstorms.js";
import { getItem } from "../src/gamedata/items.js";
import { purchaseCatalogEntry } from "../src/services/mcp/commands/PurchaseCatalogEntry.js";
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
import { eventStoreEnds, eventStoreOffers, hasEventStore, seasonalGold } from "../src/store/eventstore.js";
import { itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { miniBossItem, worldInfo } from "../src/world/theaters.js";
import { requestToken, send, startBackend } from "./helpers.js";

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

// Core-Backend #179 and #180: the rest of 2.3.0's "Mutant Storm Event Returns!" and "Mini-Bosses".
const stonewood = "33A2311D4AE64B361CCE27BC9F313C8B";
const perTheater = (alerts, category) => {
  const counts = {};
  for (const alert of alerts.filter(({ categoryName }) => categoryName === category)) counts[alert.theaterId] = (counts[alert.theaterId] ?? 0) + 1;
  return counts;
};
const alertsOf = (info) => info.missionAlerts.flatMap(({ theaterId, availableMissionAlerts }) => availableMissionAlerts.map((alert) => ({ theaterId, ...alert })));
const mainTheaters = [stonewood, "D477605B4FA48648107B649CE97FCF27", "E6ECBD064B153234656CB4BDE6743870", "D9A801C5444D1C74D1B7DAB5C7C12C5B"];

test("2.3's map holds up to 5 Mutant Storms in Stonewood and 25 in each other zone, 3 and 6 Mini-Bosses, all day", () => inBuild(v23, () => {
  for (const time of ["00:00:01", "12:00:00", "23:59:00"]) {
    const alerts = alertsOf(worldInfo(new Date(`2026-11-02T${time}Z`)));
    assert.deepEqual(perTheater(alerts, "StormCategory"), Object.fromEntries(mainTheaters.map((id, index) => [id, index ? 25 : 5])), time);
    assert.deepEqual(perTheater(alerts, "MiniBossCategory"), Object.fromEntries(mainTheaters.map((id, index) => [id, index ? 6 : 3])), time);
    // One alert a mission.
    assert.equal(new Set(alerts.map(({ theaterId, tileIndex }) => `${theaterId}:${tileIndex}`)).size, alerts.length);
  }
}));

test("2.3's Mini-Boss alerts give a wide array of items, and can be played in zones not unlocked yet", () => {
  const info = inBuild(v23, () => worldInfo(now));
  const extras = alertsOf(info).filter(({ categoryName }) => categoryName === "MiniBossCategory").map(({ missionAlertRewards }) => {
    assert.equal(missionAlertRewards.items.length, 3);
    return missionAlertRewards.items[2].itemType;
  });
  // "including transform keys, schematics, survivors, and more!"
  const kinds = new Set(extras.map((itemType) => (itemType.startsWith("ConversionControl:") ? "key" : itemType.replace(/^CardPack:cardpack_|_(r|vr|sr)$/g, ""))));
  assert.ok(kinds.size >= 4, [...kinds].join());
  for (const itemType of extras) assert.ok(inBuild(v23, () => getItem(itemType)), itemType);
  assert.ok(inBuild(v23, () => miniBossItem(4, "seed"))[0][0].endsWith("_sr"));
  assert.ok(inBuild(v23, () => miniBossItem(1, "seed"))[0][0].endsWith("_r"));
  // FFortTheaterRuntimeData MissionAlertCategoryRequirements: the Mini-Boss category skips the tiles' region requirements.
  const unlocked = [{ missionAlertCategoryName: "MiniBossCategory", bRespectTileRequirements: false, bAllowQuickplay: true }];
  for (const theater of info.theaters) {
    assert.deepEqual(theater.runtimeInfo.missionAlertCategoryRequirements, mainTheaters.includes(theater.uniqueId) ? unlocked : undefined, theater.uniqueId);
  }
  assert.ok(inBuild(v22, () => worldInfo(now)).theaters.every(({ runtimeInfo }) => !runtimeInfo.missionAlertCategoryRequirements));
});

// "All missions will continue to award Seasonal Gold."
test("every mission gives Seasonal Gold while the Event Store is open, its tier's ZCP_EventScaling pack", () => {
  const missions = (build) => inBuild(build, () => worldInfo(now)).missions.flatMap(({ availableMissions }) => availableMissions);
  for (const build of [v23, v111]) {
    for (const { missionRewards } of missions(build)) {
      const tier = /^Mission_Select_T(\d\d)$/.exec(missionRewards.tierGroupName)?.[1];
      if (tier) assert.ok(missionRewards.items.some(({ itemType }) => itemType === `CardPack:zcp_eventscaling_t${tier}`), missionRewards.tierGroupName);
    }
  }
  assert.ok(missions(v23).some(({ missionRewards }) => missionRewards.items.some(({ itemType }) => itemType === "CardPack:zcp_eventscaling_t05")
    && missionRewards.tierGroupName === "Outpost_Select_Theater1"));
  assert.ok(missions("3790078").every(({ missionRewards }) => missionRewards.items.every(({ itemType }) => !itemType.includes("eventscaling"))),
    "1.10 has no Event Store");
  assert.deepEqual(inBuild(v23, () => rollContents("CardPack:zcp_eventscaling_t20")), [{ templateId: seasonalGold, quantity: 100 }]);
  assert.deepEqual(inBuild(v23, () => rollContents("CardPack:zcp_eventscaling_t01")), [{ templateId: seasonalGold, quantity: 5 }]);
});

// "Hydraulic Weapons and Storm Zone Heroes have returned, and are available in the Storm Llamas during this event." "The
// Event Storm Llama also has a chance of awarding this hero" (BASE Hype).
test("2.3's Storm Llama holds an Epic or Legendary Hydraulic weapon or Storm Zone hero", () => inBuild(v23, () => {
  const special = (templateId) => /^Schematic:sid_[a-z_]*hydra/.test(templateId)
    || /^Hero:hid_(commando_009_m|commando_011|constructor_011|constructor_rushbase_f|ninja_010_f|ninja_011|outlander_010_m|outlander_011)_(vr|sr)_t01$/.test(templateId);
  const seen = new Set();
  for (let index = 0; index < 200; index++) {
    const contents = rollContents(stormLlama2018);
    const found = contents.filter(({ templateId }) => special(templateId));
    assert.ok(found.length >= 1, JSON.stringify(contents));
    for (const { templateId } of found) seen.add(templateId.split(":")[0]);
    if (contents.some(({ templateId }) => templateId === "Hero:hid_constructor_rushbase_f_sr_t01")) seen.add("BASE Hype");
  }
  assert.deepEqual([...seen].sort(), ["BASE Hype", "Hero", "Schematic"]);
}));

// "Purchased upgrade Llamas award Storm Tickets."
test("2.3's Upgrade Llamas bought for V-Bucks give 100 Storm Tickets each; 2.2's and the voucher's don't", () => withStore((store) => {
  const buy = (build, offerId, price) => inBuild(build, () => {
    const session = openSession(store, `llamas${build}`);
    grant(session, "Currency:mtxpurchased", 1000);
    const notifications = [];
    purchaseCatalogEntry({ req: { body: { offerId, purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: price } }, session, notifications });
    const { profile } = session.profile("profile0");
    session.commit();
    const loot = notifications[0].lootResult.items.filter(({ itemType }) => itemType === stormTickets);
    return { held: profile.items[findItem(profile, stormTickets)]?.quantity ?? 0, loot: loot.reduce((sum, { quantity }) => sum + quantity, 0) };
  });
  assert.deepEqual(buy(v23, "core_cardpack_bronze", 50), { held: 100, loot: 100 });
  assert.deepEqual(buy(v23, "core_cardpack_bronze_x10", 375), { held: 1100, loot: 1000 });
  assert.deepEqual(buy(v22, "core_cardpack_bronze", 50), { held: 0, loot: 0 });
  assert.equal(inBuild(v23, () => upgradeLlamaTickets(findOffer("core_voucher_cardpack_bronze", now), 1)), 0);
}));

// The admin panel's Force Mutant Storms on 2.3 runs 2.3's storms, not 1.9.1's Vindertech ones its data doesn't have.
test("Force Mutant Storms on 2.3 runs its Hydraulic storms, Storm Llama, Mini-Bosses and Event Store", () => {
  configureEvents({ mode: "force_mutantstorms" });
  try {
    assert.ok(isEventActive(mutantStorms2018, v23));
    assert.ok(!isEventActive(mutantStorms, v23));
    assert.ok(isEventActive(mutantStorms, "3790078"));
    assert.ok(!isEventActive(mutantStorms2018, "3790078"));
    assert.equal(inBuild(v23, () => findOffer("core_event_storm_llama", now))?.templateId, stormLlama2018);
    assert.ok(inBuild(v23, hasEventStore));
    assert.equal(inBuild(v23, eventQuests).length, 8);
    assert.deepEqual(perTheater(alertsOf(inBuild(v23, () => worldInfo(now))), "MiniBossCategory"), Object.fromEntries(mainTheaters.map((id, index) => [id, index ? 6 : 3])));
    configureEvents({ mode: "custom", customFlags: ["EventFlag.ActiveStorms"] });
    assert.ok(isEventActive(mutantStorms2018, v23));
    assert.ok(isEventActive(mutantStorms, "3790078"));
  } finally {
    configureEvents(null);
  }
});

// Core-Backend #181: a 2.3 client's Event tab (EventStoreRoot: STWSpecialEventStoreFront, STWRotationalEventStorefront),
// through the backend as the client asks for it.
test("a 2.3 client's Event tab gets both storefronts' offers, their trackers and both countdowns", async () => {
  const backend = await startBackend();
  try {
    const login = await requestToken(backend.port, { grant_type: "password", username: "eventtab23", password: "test" });
    const headers = { "User-Agent": "Fortnite/++Fortnite+Release-2.3-CL-3847564 Windows/10.0.19045.1.256.64bit", Authorization: `bearer ${login.body.access_token}` };
    const get = (urlPath) => send({ host: "127.0.0.1", port: backend.port, path: urlPath, headers });
    const query = () => send({ host: "127.0.0.1", port: backend.port, method: "POST", headers: { ...headers, "Content-Type": "application/json", "Content-Length": 2 },
      path: `/fortnite/api/game/v2/profile/${login.body.account_id}/client/QueryProfile?profileId=profile0&rvn=-1` }, "{}");
    const profile = (await query()).body.profileChanges[0].profile;
    const trackers = Object.values(profile.items).filter(({ templateId }) => templateId === "EventPurchaseTracker:generic_instance")
      .map(({ attributes }) => attributes.event_instance_id).sort();
    assert.deepEqual(trackers, ["MutantStorms2018.STWRotationalEventStorefront", "MutantStorms2018.STWSpecialEventStoreFront"]);
    const { storefronts } = (await get("/fortnite/api/storefront/v2/catalog")).body;
    const store = (name) => storefronts.find((storefront) => storefront.name === name)?.catalogEntries ?? [];
    assert.deepEqual(store("STWSpecialEventStoreFront").map(({ itemGrants }) => itemGrants[0].templateId),
      ["ConversionControl:cck_ranged_assault_hydra_consumable_sr", "Hero:hid_constructor_rushbase_f_sr_t01"]);
    assert.ok(store("STWRotationalEventStorefront").length >= 8);
    for (const entry of [...store("STWSpecialEventStoreFront"), ...store("STWRotationalEventStorefront")]) {
      const meta = Object.fromEntries(entry.metaInfo.map(({ key, value }) => [key, value]));
      assert.ok(trackers.includes(meta.PurchaseLimitingEventId), entry.offerId);
      assert.ok(Number(meta.EventLimit) > 0, entry.offerId);
      assert.ok(inBuild(v23, () => getItem(entry.itemGrants[0].templateId)), entry.offerId);
    }
    const { state } = (await get("/fortnite/api/calendar/v1/timeline")).body.channels["client-events"].states[0];
    assert.deepEqual(state.activeEventFlags, ["EventFlag.ActiveStorms", fiftyFifty]);
    for (const end of ["stwEventStoreEnd", "stwWeeklyStoreEnd"]) assert.ok(Date.parse(state[end]) > Date.now(), end);
  } finally {
    backend.close();
  }
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
