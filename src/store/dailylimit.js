import { currentBuild } from "../builds/context.js";

// 5.10's (CL-4225813) patch notes: "Upgrade Llamas are now limited to 50 quantity per day." Epic's catalog expressed a
// daily purchase limit as the offer's dailyLimit, and kept what the account bought in profile0's daily_purchases stat
// {lastInterval, purchaseList: {offerId: quantity}}: lastInterval is the 00:00 UTC the list belongs to, and a purchase
// on a later day starts the list again. Earlier builds' Upgrade Llamas have no limit (dailyLimit -1).
export const upgradeLlamaDailyLimit = { limit: 50, firstBuild: 4225813 };

// An offer's daily limit in the requesting build, or -1 for none.
export function dailyLimitOf(offer) {
  if (!offer.dailyLimit || Number(currentBuild()) < (offer.dailyLimitFirstBuild ?? 0)) return -1;
  return offer.dailyLimit;
}

const startOfDay = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

// What the account bought of an offer today (UTC), from the profile's daily_purchases stat.
export function dailyPurchases(profile, offer, now = new Date()) {
  const stat = profile.stats?.attributes?.daily_purchases;
  if (!stat || stat.lastInterval !== startOfDay(now)) return 0;
  return stat.purchaseList?.[offer.offerId] ?? 0;
}

// Counts quantity more of an offer bought today. tracker: profile0's change tracker.
export function recordDailyPurchase(tracker, offer, quantity, now = new Date()) {
  const today = startOfDay(now);
  const stat = tracker.profile.stats.attributes.daily_purchases;
  const list = stat?.lastInterval === today ? stat.purchaseList ?? {} : {};
  tracker.setStat("daily_purchases", { lastInterval: today, purchaseList: { ...list, [offer.offerId]: (list[offer.offerId] ?? 0) + quantity } });
}
