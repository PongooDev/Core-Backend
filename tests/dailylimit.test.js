import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { grant } from "../src/profiles/progress.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { purchaseCatalogEntry } from "../src/services/mcp/commands/PurchaseCatalogEntry.js";
import { storefronts } from "../src/store/catalog.js";
import { dailyPurchases, recordDailyPurchase } from "../src/store/dailylimit.js";

// 5.10's notes: "Upgrade Llamas are now limited to 50 quantity per day." (Core-Backend #308)
const v510 = "4225813";
const v510Live = "4240749";
const v50 = "4214610";
const withStore = (fn) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-dailylimit-"));
  try {
    return fn(createProfileStore(dataDir));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const llama = (build) => inBuild(build, () => storefronts({ items: {} }, new Date())
  .find(({ name }) => name === "CardPackStore").catalogEntries.find(({ offerId }) => offerId === "core_cardpack_bronze"));
const buy = (store, build, accountId, quantity, offerId = "core_cardpack_bronze") => inBuild(build, () => {
  const session = openSession(store, accountId);
  grant(session, "Currency:mtxpurchased", 100000);
  purchaseCatalogEntry({ req: { body: { offerId, purchaseQuantity: quantity, currency: "MtxCurrency" } }, session, notifications: [] });
  session.commit();
});

test("5.10's catalog says the Upgrade Llama sells 50 a day; 5.0's has no limit", () => {
  assert.equal(llama(v510).dailyLimit, 50);
  assert.equal(llama(v510Live).dailyLimit, 50);
  assert.equal(llama(v50).dailyLimit, -1);
});

test("5.10 refuses the Upgrade Llama over 50 in a day, per account, and 5.0 doesn't", () => withStore((store) => {
  buy(store, v510, "a", 50);
  assert.throws(() => buy(store, v510, "a", 1), /sells 50 a day/);
  // Another account has its own count.
  buy(store, v510, "b", 30);
  assert.throws(() => buy(store, v510, "b", 21), /sells 50 a day/);
  buy(store, v510, "b", 20);
  // The ten-llama offer counts its own purchases.
  buy(store, v510, "a", 1, "core_cardpack_bronze_x10");
  // 5.0 is unlimited.
  buy(store, v50, "c", 50);
  buy(store, v50, "c", 50);
}));

test("the daily count resets at 00:00 UTC", () => withStore((store) => {
  const offer = { offerId: "core_cardpack_bronze" };
  const session = openSession(store, "d");
  const tracker = session.profile("profile0");
  recordDailyPurchase(tracker, offer, 50, new Date("2026-11-10T23:59:59Z"));
  assert.equal(dailyPurchases(tracker.profile, offer, new Date("2026-11-10T00:00:00Z")), 50);
  assert.equal(dailyPurchases(tracker.profile, offer, new Date("2026-11-11T00:00:00Z")), 0);
  recordDailyPurchase(tracker, offer, 2, new Date("2026-11-11T00:00:01Z"));
  assert.equal(dailyPurchases(tracker.profile, offer, new Date("2026-11-11T12:00:00Z")), 2);
  assert.equal(tracker.profile.stats.attributes.daily_purchases.lastInterval, "2026-11-11T00:00:00.000Z");
}));
