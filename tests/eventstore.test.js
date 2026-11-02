import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { trackChanges } from "../src/profiles/changes.js";
import { storefronts } from "../src/store/catalog.js";
import { ensureEventPurchaseTrackers, eventPurchaseTracker, eventStorefront, eventStoreInstance, seasonalGold, storeWeek,
  weeklyStoreInstance, weeklyStorefront } from "../src/store/eventstore.js";
import { send, startBackend, userLogin } from "./helpers.js";

// 1.11's Event Store (Core-Backend #144): the Loot tab's Event page, EventStoreRoot, whose StorefrontNames are
// ["STWSpecialEventStoreFront", "STWRotationalEventStorefront"].
const v111 = "3807424";
const v110 = "3790078";
const entriesOf = (changelist, name, now = new Date()) => inBuild(changelist, () => storefronts(null, now).find((storefront) => storefront.name === name)?.catalogEntries);
const meta = (entry) => Object.fromEntries(entry.metaInfo.map(({ key, value }) => [key, value]));
const grantOf = (entry) => entry.itemGrants[0];

test("1.11's Event Items are Survive the Holidays' offers for Seasonal Gold, each with its limit", () => {
  const event = entriesOf(v111, eventStorefront);
  const byTemplate = Object.fromEntries(event.map((entry) => [grantOf(entry).templateId, entry]));
  // The reference screenshot's: Sarah Claus 3,200, Copper Ralphie's Revenge 2,000, Copper Stabsworth the III 1,680 (2 left),
  // Skirmisher Edge 2,800.
  for (const [templateId, price, limit] of [["Hero:hid_ninja_013_sr_t01", 3200, 1], ["Schematic:sid_sniper_bbgun_sr_ore_t01", 2000, 1],
    ["Schematic:sid_edged_sword_light_sr_ore_t01", 1680, 2], ["Hero:hid_ninja_009_sr_t01", 2800, 1]]) {
    const entry = byTemplate[templateId];
    assert.ok(entry, templateId);
    assert.deepEqual([entry.prices[0].currencyType, entry.prices[0].currencySubType, entry.prices[0].finalPrice], ["GameItem", seasonalGold, price]);
    assert.deepEqual(meta(entry), { EventLimit: String(limit), PurchaseLimitingEventId: eventStoreInstance });
    // The tile takes its name from the item.
    assert.equal(entry.title, "");
  }
  // 1.10 has no Event Store, nor does 1.11 once the event is over.
  assert.equal(entriesOf(v110, eventStorefront), undefined);
  assert.equal(entriesOf(v110, weeklyStorefront), undefined);
});

test("1.11's Weekly Items are the same all week and change with the weekly countdown", () => {
  const monday = new Date("2026-11-02T12:00:00Z");
  const sameWeek = new Date(new Date(inBuild(v111, () => storeWeek(monday)).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3T00:00:00Z")).getTime() - 60 * 60 * 1000);
  const nextWeek = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekly = (now) => entriesOf(v111, weeklyStorefront, now);
  const ids = (entries) => entries.map(({ offerId }) => offerId);
  assert.deepEqual(ids(weekly(monday)), ids(weekly(sameWeek)));
  assert.notDeepEqual(ids(weekly(monday)), ids(weekly(nextWeek)));
  const entries = weekly(monday);
  assert.equal(entries.length, 9);
  for (const entry of entries) {
    assert.equal(entry.prices[0].currencySubType, seasonalGold);
    assert.equal(meta(entry).PurchaseLimitingEventId, weeklyStoreInstance);
    assert.ok(entry.offerId.includes(inBuild(v111, () => storeWeek(monday))), entry.offerId);
  }
  const offered = (templateId) => entries.find((entry) => grantOf(entry).templateId === templateId);
  // Every week: a Survivor for 250 (2 left), ten Epic Flux for 75 (5 left), ten Rare Flux for 30 (10 left).
  assert.deepEqual([offered("Worker:workerbasic_vr_t01").prices[0].finalPrice, meta(offered("Worker:workerbasic_vr_t01")).EventLimit], [250, "2"]);
  assert.deepEqual([grantOf(offered("AccountResource:reagent_evolverarity_vr")).quantity, offered("AccountResource:reagent_evolverarity_vr").prices[0].finalPrice], [10, 75]);
  assert.deepEqual([grantOf(offered("AccountResource:reagent_evolverarity_r")).quantity, offered("AccountResource:reagent_evolverarity_r").prices[0].finalPrice], [10, 30]);
  // A rare hero for 400 and a legendary one for 2,800.
  assert.ok(entries.some((entry) => /^Hero:hid_.*_r_t01$/.test(grantOf(entry).templateId) && entry.prices[0].finalPrice === 400));
  assert.ok(entries.some((entry) => /^Hero:hid_.*_sr_t01$/.test(grantOf(entry).templateId) && entry.prices[0].finalPrice === 2800));
});

test("a new week takes the past weeks' purchases out of the weekly tracker and keeps the event's", () => inBuild(v111, () => {
  const tracker = trackChanges({ stats: { attributes: {} }, items: {} });
  const now = new Date("2026-11-02T12:00:00Z");
  const ids = ensureEventPurchaseTrackers(tracker, now);
  assert.deepEqual(Object.values(tracker.profile.items).map((item) => [item.templateId, item.attributes.event_instance_id]),
    [[eventPurchaseTracker, eventStoreInstance], [eventPurchaseTracker, weeklyStoreInstance]]);
  tracker.profile.items[ids[eventStoreInstance]].attributes.event_purchases = { core_stw_event_hid_ninja_013_sr_t01: 1 };
  tracker.profile.items[ids[weeklyStoreInstance]].attributes.event_purchases = { [`core_stw_weekly_${storeWeek(now)}_workerbasic_vr_t01`]: 2 };
  ensureEventPurchaseTrackers(tracker, now);
  assert.equal(Object.keys(tracker.profile.items).length, 2);
  assert.equal(Object.keys(tracker.profile.items[ids[weeklyStoreInstance]].attributes.event_purchases).length, 1);
  ensureEventPurchaseTrackers(tracker, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  assert.deepEqual(tracker.profile.items[ids[weeklyStoreInstance]].attributes.event_purchases, {});
  assert.deepEqual(tracker.profile.items[ids[eventStoreInstance]].attributes.event_purchases, { core_stw_event_hid_ninja_013_sr_t01: 1 });
}));

const agent = (changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`;
const mcp = (changelist, port, { accountId, token }, name, body = {}) => {
  const text = JSON.stringify(body);
  return send({ host: "127.0.0.1", port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`,
    headers: { "User-Agent": agent(changelist), Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
};
const profileOf = (response) => [response.body, ...(response.body.multiUpdate ?? [])].find((update) => update.profileId === "profile0")
  .profileChanges.find((change) => change.changeType === "fullProfileUpdate").profile;
const held = (profile, templateId) => Object.values(profile.items).filter((item) => item.templateId === templateId)
  .reduce((sum, item) => sum + item.quantity, 0);

test("1.11's Event Store sells for Seasonal Gold up to each offer's limit, counted in the account's tracker", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "EventStore");
    // Loading the account gives it the trackers the store's "N left" counts on.
    const loaded = profileOf(await mcp(v111, backend.port, player, "QueryProfile"));
    const trackers = Object.values(loaded.items).filter((item) => item.templateId === eventPurchaseTracker);
    assert.deepEqual(trackers.map((item) => item.attributes.event_instance_id).sort(), [eventStoreInstance, weeklyStoreInstance].sort());

    const file = path.join(backend.dataDir, "accounts", player.accountId, "profiles", "profile0.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.items.core_test_gold = { templateId: seasonalGold, attributes: {}, quantity: 5000 };
    fs.writeFileSync(file, JSON.stringify(saved));

    const stabsworth = entriesOf(v111, eventStorefront).find((entry) => grantOf(entry).templateId === "Schematic:sid_edged_sword_light_sr_ore_t01");
    const buy = () => mcp(v111, backend.port, player, "PurchaseCatalogEntry", { offerId: stabsworth.offerId, purchaseQuantity: 1,
      currency: "GameItem", currencySubType: seasonalGold, expectedPrice: 1680 });
    for (let bought = 1; bought <= 2; bought++) {
      const response = await buy();
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const counted = Object.values(profileOf(response).items)
        .find((item) => item.templateId === eventPurchaseTracker && item.attributes.event_instance_id === eventStoreInstance);
      assert.deepEqual(counted.attributes.event_purchases, { [stabsworth.offerId]: bought });
    }
    // "2 left" is spent.
    const third = await buy();
    assert.equal(third.body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed");

    const after = profileOf(await mcp(v111, backend.port, player, "QueryProfile"));
    assert.equal(held(after, seasonalGold), 5000 - 2 * 1680);
    assert.equal(held(after, "Schematic:sid_edged_sword_light_sr_ore_t01"), 2);
  } finally {
    backend.close();
  }
});
