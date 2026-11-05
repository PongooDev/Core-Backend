import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { removeCosmeticItem } from "../profiles/athena.js";
import { grant } from "../profiles/progress.js";

// 3.6's (CL-4019403) Self-Service Cosmetic Returns (Core-Backend #252): "Will allow you to return up to 3 cosmetic
// purchases for V-Bucks (lifetime). Only eligible purchases made within the past 30 days are able to be returned."
// What can be: emotes, gliders, harvesting tools, back blings and outfits; what can't: the Battle Pass and its tiers, the
// Starter Pack, Founder's Packs and their upgrades, Save the World's llamas and event and weekly items. So only the item
// shop's cosmetic offers (PurchaseCatalogEntry's athena offers) are recorded.
//
// The client (3.6's IDB, port 13338):
// - The store's Purchase History button (AthenaDirectAcquisitionScreen HandlePurchaseHistory, unless UFortRuntimeOptions
//   bDisablePurchaseHistoryScreen) opens UFortPurchaseHistoryScreen. Its refresh (0x2A5E1D0) reads common_core's
//   mtx_purchase_history stat (the FName at 0x458C4F8, read at 0xD91F10, cached by profile revision at 0xD855D0) as
//   FMtxPurchaseHistory {purchases: [FMtxPurchaseHistoryEntry], refundCredits, refundsUsed} (the SDK's structs), drops the
//   entries whose purchaseDate is more than 30 days before the server's now (2.592e13 ticks), and sets each entry's
//   bHasBeenRefunded to refundDate < FDateTime's largest; it lists them ("This list shows purchases within the last {0}
//   days that are eligible for a refund.", each by its lootResult[0]'s item), and "{0} refunds remaining" is
//   refundCredits.
// - FMtxPurchaseHistoryEntry: purchaseId (FString), purchaseDate, refundDate (FDateTime), bHasBeenRefunded, lootResult
//   ([FMcpLootEntry] {itemType, itemGuid, itemProfile, quantity}), totalMtxPaid. A never-refunded entry's refundDate is
//   FDateTime's largest (9999-12-31T23:59:59.999Z).
// - UFortRefundConfirmation ("You can only refund purchases within {0} days", "You have {0} refunds remaining.", its
//   default 3 without a profile) sends UFortMcpProfileCommonCore::RefundMtxPurchase {purchaseId} on Yes.
// The command takes the purchase's items out of the locker, gives back the V-Bucks it took (each kind it took), marks it
// refunded and spends a credit. Core's own record of the V-Bucks kinds (coreMtxSpent) rides along; the client reads only
// the struct's fields.
export const refundsBuild = 4019403;
export const refundWindowDays = 30;
export const lifetimeRefunds = 3;
export const notRefunded = "9999-12-31T23:59:59.999Z";
const dayMs = 86400000;

export const hasRefunds = (build = currentBuild()) => Number(build) >= refundsBuild;

// The account's history, as the stat holds it or a fresh one: {purchases, refundCredits, refundsUsed}.
export function purchaseHistoryOf(attributes) {
  const history = attributes?.mtx_purchase_history;
  if (!history || typeof history !== "object" || Array.isArray(history)) return { purchases: [], refundCredits: lifetimeRefunds, refundsUsed: 0 };
  return {
    ...history,
    purchases: Array.isArray(history.purchases) ? history.purchases : [],
    refundCredits: Number.isInteger(history.refundCredits) ? history.refundCredits : lifetimeRefunds,
    refundsUsed: Number.isInteger(history.refundsUsed) ? history.refundsUsed : 0
  };
}

// An item shop purchase, on 3.6 and later: its loot ([{itemType, itemGuid, itemProfile, quantity}]), what it cost and
// which V-Bucks it took ({templateId: amount}).
export function recordPurchase(tracker, { offerId, lootResult, totalMtxPaid, spent, now = new Date() }) {
  const history = purchaseHistoryOf(tracker.profile.stats.attributes);
  const entry = {
    purchaseId: crypto.randomUUID(), offerId, purchaseDate: now.toISOString(), refundDate: notRefunded, bHasBeenRefunded: false,
    lootResult, totalMtxPaid, coreMtxSpent: spent
  };
  tracker.setStat("mtx_purchase_history", { ...history, purchases: [...history.purchases, entry] });
  return entry;
}

const refusal = (message) => Object.assign(new Error(message), { refused: true });

// Whether the purchase can be returned now: null, or why not.
export function refundRefusal(history, purchaseId, now = new Date()) {
  const entry = history.purchases.find((candidate) => candidate.purchaseId === purchaseId);
  if (!entry) return `No purchase ${purchaseId}`;
  if (entry.bHasBeenRefunded || (entry.refundDate && entry.refundDate !== notRefunded)) return "That purchase was returned already";
  if (now.getTime() - Date.parse(entry.purchaseDate) > refundWindowDays * dayMs) return `Only purchases of the last ${refundWindowDays} days can be returned`;
  if (history.refundCredits < 1) return "You have no returns left";
  return null;
}

// Returns the purchase: [{profileId, itemId, templateId, quantity}] of the V-Bucks given back. Throws (refused) when it
// can't be.
export function refundPurchase(session, purchaseId, now = new Date()) {
  const tracker = session.profile("profile0");
  const history = purchaseHistoryOf(tracker.profile.stats.attributes);
  const why = refundRefusal(history, purchaseId, now);
  if (why) throw refusal(why);
  const entry = history.purchases.find((candidate) => candidate.purchaseId === purchaseId);
  for (const loot of entry.lootResult ?? []) if (loot.itemProfile === "athena") removeCosmeticItem(session, loot.itemGuid ?? loot.itemType);
  const spent = entry.coreMtxSpent && Object.keys(entry.coreMtxSpent).length ? entry.coreMtxSpent : { "Currency:mtxpurchased": entry.totalMtxPaid };
  const returned = Object.entries(spent).filter(([, amount]) => amount > 0).flatMap(([templateId, amount]) => grant(session, templateId, amount));
  const purchases = history.purchases.map((candidate) => (candidate === entry
    ? { ...candidate, refundDate: now.toISOString(), bHasBeenRefunded: true } : candidate));
  tracker.setStat("mtx_purchase_history", { ...history, purchases, refundCredits: history.refundCredits - 1, refundsUsed: history.refundsUsed + 1 });
  return returned;
}
