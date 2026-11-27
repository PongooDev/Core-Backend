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
//   bHasBeenRefunded itself, whatever the stat says: refundDate < 0x2BCA2875F4373FFF, FDateTime::MaxValue's ticks
//   (0xD92094). It lists them ("This list shows purchases within the last {0} days that are eligible for a refund.",
//   each by its lootResult[0]'s item), and "{0} refunds remaining" is refundCredits. A row (0x2A61850) says "Refunded {0}"
//   with refundDate when bHasBeenRefunded, "Purchased {0}" with purchaseDate otherwise, both as %m/%d/%y.
// - FMtxPurchaseHistoryEntry: purchaseId (FString), purchaseDate, refundDate (FDateTime), bHasBeenRefunded, lootResult
//   ([FMcpLootEntry] {itemType, itemGuid, itemProfile, quantity}), totalMtxPaid. Profile stats become structs through
//   the variant converter (0x31D8A0), whose FDateTime from a string is "min" (0), "max" (MaxValue, 9999-12-31
//   23:59:59.9999999), "now" or an ISO-8601 date. ISO-8601 stops at milliseconds, so no date it can carry reaches
//   MaxValue: a never-refunded entry's refundDate is "max" (Core-Backend #253; an entry without one is 0, refunded too).
// - UFortRefundConfirmation ("You can only refund purchases within {0} days", "You have {0} refunds remaining.", its
//   default 3 without a profile) sends UFortMcpProfileCommonCore::RefundMtxPurchase {purchaseId} on Yes.
// The command takes the purchase's items out of the locker, gives back the V-Bucks it took (each kind it took), marks it
// refunded and spends a credit. Core's own record of the V-Bucks kinds (coreMtxSpent) rides along; the client reads only
// the struct's fields.
export const refundsBuild = 4019403;
export const refundWindowDays = 30;
export const lifetimeRefunds = 3;
export const notRefunded = "max";
// What 3.6's first returns (8aea9a8) stored instead, which the client read as refunded on 31 December 9999 (#253).
const oldNotRefunded = "9999-12-31T23:59:59.999Z";
const dayMs = 86400000;

export const hasRefunds = (build = currentBuild()) => Number(build) >= refundsBuild;

// 9.20's (CL-6822798) Undo (Update v9.20: "Immediately after you make a new purchase you will be able to Undo this item
// purchase for a limited time as long as you stay on the purchase screen. After you Undo a purchase, there will be a
// cooldown on using Undo on that same item ... the ownership of that item will be revoked and you will be granted back the
// appropriate V-Bucks. Undo will follow the same eligibility requirements as Return Requests"). The client (9.20 IDB,
// image base 0xffff80081dac0000) has had it since 9.10, behind UFortRuntimeOptions' bEnableUndoPurchase, which the
// hotfix turns on from 9.20 (services/fortnite/cloudstorage.js):
// - the purchase screen shows Undo (0xffff800821446F50) and counts it down each second (0xffff800821472010) by common_core's
//   undo_timeout (0xffff80081F227B70: the stat's FDateTime less the server's now; none left hides the button);
// - an offer is on cooldown while common_core's undo_cooldowns [{offerId, cooldownExpires}] has an entry for it whose
//   cooldownExpires is after the server's now (0xffff80081F22D3E0);
// - Undo sends RefundMtxPurchase with its QuickReturn parameter, {purchaseId, quickReturn: true}.
// So a purchase sets undo_timeout, and an undo returns the purchase as a return does, without spending one of the three
// returns, ends the window and starts the offer's cooldown. 🟡 Epic's window and cooldown aren't recorded: Core's 30
// seconds and 24 hours.
export const undoBuild = 6822798;
export const undoWindowMs = 30000;
export const undoCooldownMs = 86400000;
export const hasUndo = (build = currentBuild()) => Number(build) >= undoBuild;
export const undoTimeoutStat = "undo_timeout";
export const undoCooldownsStat = "undo_cooldowns";
const undoCooldownsOf = (attributes) => (Array.isArray(attributes?.[undoCooldownsStat]) ? attributes[undoCooldownsStat] : []);

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

// Purchases from before 3.6's returns have no entry and can't be given one: Core keeps no record of when or for how
// much a locker item was bought (its attributes are level, item_seen and favorite; the log lives in memory; profile0's
// in_app_purchases holds V-Bucks pack receipts, undated).
//
// An item shop purchase, on 3.6 and later: its loot ([{itemType, itemGuid, itemProfile, quantity}]), what it cost and
// which V-Bucks it took ({templateId: amount}).
export function recordPurchase(tracker, { offerId, lootResult, totalMtxPaid, spent, creatorPayout = null, now = new Date() }) {
  const history = purchaseHistoryOf(tracker.profile.stats.attributes);
  const entry = {
    purchaseId: crypto.randomUUID(), offerId, purchaseDate: now.toISOString(), refundDate: notRefunded, lootResult, totalMtxPaid,
    coreMtxSpent: spent,
    // The Support-A-Creator payout the purchase made (store/creatorpayouts.js), which its return takes back.
    ...(creatorPayout ? { coreCreatorPayout: creatorPayout } : {})
  };
  tracker.setStat("mtx_purchase_history", { ...history, purchases: [...history.purchases, entry] });
  if (hasUndo()) tracker.setStat(undoTimeoutStat, new Date(now.getTime() + undoWindowMs).toISOString());
  return entry;
}

// Whether the entry was returned, as the client reads it: any refundDate but "max" (case aside), none too. The old 9999
// date counts as not returned, as it was meant, until the entry is migrated.
export const isRefunded = (entry) => String(entry.refundDate ?? "").toLowerCase() !== notRefunded && entry.refundDate !== oldNotRefunded;

// Entries stored by 8aea9a8 before #253: their refundDate becomes "max" (and the bHasBeenRefunded they carried, which the
// client sets itself, goes). Returned ones stay as they are.
const isOldUnrefunded = (entry) => entry?.refundDate === oldNotRefunded;
export const purchaseHistoryNeedsMigration = (profile) => purchaseHistoryOf(profile.stats.attributes).purchases.some(isOldUnrefunded);

export function migratePurchaseHistory(tracker) {
  const history = purchaseHistoryOf(tracker.profile.stats.attributes);
  if (!history.purchases.some(isOldUnrefunded)) return;
  const purchases = history.purchases.map((entry) => {
    if (!isOldUnrefunded(entry)) return entry;
    const { bHasBeenRefunded, ...rest } = entry;
    return { ...rest, refundDate: notRefunded };
  });
  tracker.setStat("mtx_purchase_history", { ...history, purchases });
}

const refusal = (message) => Object.assign(new Error(message), { refused: true });

// Whether the purchase can be returned now: null, or why not.
export function refundRefusal(history, purchaseId, now = new Date()) {
  const entry = history.purchases.find((candidate) => candidate.purchaseId === purchaseId);
  if (!entry) return `No purchase ${purchaseId}`;
  if (entry.bHasBeenRefunded || isRefunded(entry)) return "That purchase was returned already";
  if (now.getTime() - Date.parse(entry.purchaseDate) > refundWindowDays * dayMs) return `Only purchases of the last ${refundWindowDays} days can be returned`;
  if (history.refundCredits < 1) return "You have no returns left";
  return null;
}

// Whether the purchase can be undone now (9.20): null, or why not. Only the account's newest purchase, inside its window,
// and not an offer still on cooldown.
export function undoRefusal(attributes, purchaseId, now = new Date()) {
  if (!hasUndo()) return "This build has no Undo";
  const history = purchaseHistoryOf(attributes);
  const entry = history.purchases.find((candidate) => candidate.purchaseId === purchaseId);
  if (!entry) return `No purchase ${purchaseId}`;
  if (entry.bHasBeenRefunded || isRefunded(entry)) return "That purchase was returned already";
  if (history.purchases.at(-1) !== entry) return "Only the newest purchase can be undone";
  const timeout = Date.parse(attributes?.[undoTimeoutStat] ?? "");
  if (!(timeout > now.getTime())) return "The time to undo that purchase is over";
  if (undoCooldownsOf(attributes).some((cooldown) => cooldown.offerId === entry.offerId && Date.parse(cooldown.cooldownExpires) > now.getTime())) {
    return "That item can't be undone again yet";
  }
  return null;
}

// Returns the purchase: [{profileId, itemId, templateId, quantity}] of the V-Bucks given back. Throws (refused) when it
// can't be. quickReturn is 9.20's Undo (above).
export function refundPurchase(session, purchaseId, now = new Date(), { quickReturn = false } = {}) {
  const tracker = session.profile("profile0");
  const history = purchaseHistoryOf(tracker.profile.stats.attributes);
  const why = quickReturn ? undoRefusal(tracker.profile.stats.attributes, purchaseId, now) : refundRefusal(history, purchaseId, now);
  if (why) throw refusal(why);
  const entry = history.purchases.find((candidate) => candidate.purchaseId === purchaseId);
  for (const loot of entry.lootResult ?? []) if (loot.itemProfile === "athena") removeCosmeticItem(session, loot.itemGuid ?? loot.itemType);
  const spent = entry.coreMtxSpent && Object.keys(entry.coreMtxSpent).length ? entry.coreMtxSpent : { "Currency:mtxpurchased": entry.totalMtxPaid };
  const returned = Object.entries(spent).filter(([, amount]) => amount > 0).flatMap(([templateId, amount]) => grant(session, templateId, amount));
  const purchases = history.purchases.map((candidate) => (candidate === entry
    ? { ...candidate, refundDate: now.toISOString() } : candidate));
  if (quickReturn) {
    tracker.setStat("mtx_purchase_history", { ...history, purchases });
    const cooldowns = undoCooldownsOf(tracker.profile.stats.attributes).filter((cooldown) => cooldown.offerId !== entry.offerId
      && Date.parse(cooldown.cooldownExpires) > now.getTime());
    tracker.setStat(undoCooldownsStat, [...cooldowns, { offerId: entry.offerId, cooldownExpires: new Date(now.getTime() + undoCooldownMs).toISOString() }]);
    tracker.setStat(undoTimeoutStat, "min");
    return returned;
  }
  tracker.setStat("mtx_purchase_history", { ...history, purchases, refundCredits: history.refundCredits - 1, refundsUsed: history.refundsUsed + 1 });
  return returned;
}
