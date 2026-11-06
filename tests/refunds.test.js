import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { viewProfile } from "../src/profiles/common.js";
import { grant } from "../src/profiles/progress.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { purchaseCatalogEntry } from "../src/services/mcp/commands/PurchaseCatalogEntry.js";
import { refundMtxPurchase } from "../src/services/mcp/commands/RefundMtxPurchase.js";
import { configureItemShop } from "../src/store/itemshop.js";
import { isRefunded, lifetimeRefunds, notRefunded, purchaseHistoryOf, refundRefusal } from "../src/store/refunds.js";

// 3.6's Self-Service Cosmetic Returns (Core-Backend #252, store/refunds.js): common_core's mtx_purchase_history and
// RefundMtxPurchase {purchaseId}.
const v36 = "4019403";
const v352 = "4008490";
const steelsight = "core_br_cid_111_athena_commando_f_robo";
const radiantStriker = "core_br_cid_091_athena_commando_m_redshirt";

// Season 3's replay day 65 (index 64) is 27 April 2018, Steelsight's first day in the shop.
function withShop(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-refunds-"));
  const start = new Date(Date.now() - 64 * 86400000).toISOString().slice(0, 10);
  configureItemShop({ mode: "fnbr", rotationHour: 0, seasonStarts: { 3: start } });
  try {
    return fn(dataDir);
  } finally {
    configureItemShop(null);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const vbucks = (session) => Object.values(session.profile("profile0").profile.items)
  .filter(({ templateId }) => templateId.toLowerCase().startsWith("currency:mtx")).reduce((sum, item) => sum + item.quantity, 0);
const owned = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId.toLowerCase());
const history = (session) => purchaseHistoryOf(session.profile("profile0").profile.stats.attributes);
const buy = (session, offerId, expectedPrice = 1500) =>
  purchaseCatalogEntry({ req: { body: { offerId, currency: "MtxCurrency", expectedPrice } }, session, notifications: [] });
const refund = (session, purchaseId) => refundMtxPurchase({ req: { body: { purchaseId } }, session });

test("3.6 records an item shop purchase and returns it: the items out, the V-Bucks back, a credit spent", () => withShop((dataDir) => inBuild(v36, () => {
  const session = openSession(createProfileStore(dataDir), "refund36");
  grant(session, "Currency:mtxgiveaway", 5000);
  const before = vbucks(session);
  buy(session, steelsight);
  assert.equal(vbucks(session), before - 1500);
  const [entry] = history(session).purchases;
  assert.equal(entry.offerId, steelsight);
  assert.equal(entry.totalMtxPaid, 1500);
  // 3.6's variant converter makes "max" FDateTime::MaxValue, the one refundDate it reads as not refunded (#253).
  assert.equal(entry.refundDate, "max");
  assert.equal(isRefunded(entry), false);
  assert.deepEqual(entry.lootResult.map(({ itemType }) => itemType.toLowerCase()).sort(),
    ["athenabackpack:bid_044_robo", "athenacharacter:cid_111_athena_commando_f_robo"]);
  assert.ok(entry.lootResult.every(({ itemProfile, itemGuid }) => itemProfile === "athena" && itemGuid));
  assert.deepEqual([history(session).refundCredits, history(session).refundsUsed], [lifetimeRefunds, 0]);

  refund(session, entry.purchaseId);
  assert.equal(vbucks(session), before);
  assert.ok(!owned(session).includes("athenacharacter:cid_111_athena_commando_f_robo"));
  assert.ok(!owned(session).includes("athenabackpack:bid_044_robo"));
  const after = history(session);
  assert.deepEqual([after.refundCredits, after.refundsUsed], [2, 1]);
  assert.equal(isRefunded(after.purchases[0]), true);
  assert.ok(!Number.isNaN(Date.parse(after.purchases[0].refundDate)));
  assert.throws(() => refund(session, entry.purchaseId), /returned already/);
  assert.throws(() => refund(session, "nope"), /No purchase/);

  // Bought again, it can be returned again, a credit each time, up to three.
  buy(session, steelsight);
  refund(session, history(session).purchases[1].purchaseId);
  buy(session, steelsight);
  refund(session, history(session).purchases[2].purchaseId);
  assert.equal(history(session).refundCredits, 0);
  buy(session, steelsight);
  assert.throws(() => refund(session, history(session).purchases[3].purchaseId), /no returns left/);
  assert.ok(owned(session).includes("athenacharacter:cid_111_athena_commando_f_robo"));
})));

test("a return is only for purchases of the last 30 days", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const entry = (days) => ({ purchaseId: "p", purchaseDate: new Date(now.getTime() - days * 86400000).toISOString(), refundDate: notRefunded });
  assert.equal(refundRefusal({ purchases: [entry(29)], refundCredits: 3 }, "p", now), null);
  assert.match(refundRefusal({ purchases: [entry(31)], refundCredits: 3 }, "p", now), /last 30 days/);
});

test("3.5.2 records no purchase and has no RefundMtxPurchase; common_core shows 3.6's three returns", () => withShop((dataDir) => {
  inBuild(v352, () => {
    const session = openSession(createProfileStore(dataDir), "refund352");
    grant(session, "Currency:mtxgiveaway", 5000);
    buy(session, radiantStriker, 1200);
    assert.equal(session.profile("profile0").profile.stats.attributes.mtx_purchase_history, undefined);
    assert.throws(() => refund(session, "anything"), /no cosmetic returns/);
  });
  const profile = { version: "x", wipeNumber: 1, stats: { attributes: {} }, items: {} };
  assert.deepEqual(inBuild(v36, () => viewProfile(profile, "common_core")).stats.attributes.mtx_purchase_history,
    { purchases: [], refundCredits: 3, refundsUsed: 0 });
  assert.equal(inBuild(v352, () => viewProfile(profile, "common_core")).stats.attributes.mtx_purchase_history, undefined);
}));

// #253: 8aea9a8 stored "9999-12-31T23:59:59.999Z", which 3.6 reads as refunded (it's below MaxValue's 100 ns ticks).
test("entries stored with 8aea9a8's 9999 date become \"max\" when profile0 loads; returned ones stay", () => withShop((dataDir) => {
  const store = createProfileStore(dataDir);
  const old = "9999-12-31T23:59:59.999Z";
  const recent = new Date(Date.now() - 2 * 86400000).toISOString();
  inBuild(v36, () => {
    const session = openSession(store, "refundmigrate");
    session.profile("profile0").setStat("mtx_purchase_history", { purchases: [
      { purchaseId: "a", offerId: steelsight, purchaseDate: recent, refundDate: old, bHasBeenRefunded: false, lootResult: [], totalMtxPaid: 1200 },
      { purchaseId: "b", offerId: steelsight, purchaseDate: recent, refundDate: recent, bHasBeenRefunded: true, lootResult: [], totalMtxPaid: 1200 }
    ], refundCredits: 2, refundsUsed: 1 });
    session.commit();
  });
  inBuild(v36, () => {
    const session = openSession(store, "refundmigrate");
    const [a, b] = history(session).purchases;
    assert.equal(a.refundDate, notRefunded);
    assert.ok(!("bHasBeenRefunded" in a));
    assert.equal(isRefunded(a), false);
    assert.equal(refundRefusal(history(session), "a"), null);
    assert.equal(b.refundDate, recent);
    assert.equal(isRefunded(b), true);
    assert.match(refundRefusal(history(session), "b"), /returned already/);
    assert.deepEqual([history(session).refundCredits, history(session).refundsUsed], [2, 1]);
  });
}));
