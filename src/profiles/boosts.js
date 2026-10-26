import { McpError } from "../errors.js";
import { getItem } from "../gamedata/items.js";
import { perBuild } from "../gamedata/read.js";
import { consume, consumedInto } from "./friendcodes.js";
import { findItem, grantItem } from "./items.js";

// Rest XP and XP boosts, from the client:
//  - Rest XP is profile0's Quota:RestXP item (UFortQuotaItem: current_value, last_mod_time, units_per_minute_recharge,
//    max_quota, recharge_delay_minutes). The client reads its value as current_value plus units_per_minute_recharge for
//    every minute since last_mod_time once recharge_delay_minutes have passed, up to max_quota (sub_5E3CF0). The level
//    row (XPAccountLevels RestXPCap, RestXPRechargeRate) sets the cap and rate; the RestXP definition starts it full
//    and waits 360 minutes before refilling.
//  - Boost XP is the quantity of Token:xpboost (sub_6712C0). An XP Boost consumable adds the level row's
//    BoostXPPerConsumable to it; SmallXpBoost works on yourself only, SmallXpBoost_Gift on others only.
//  - UFortGameData's constructor (sub_4CC560, not overridden by DefaultGameData): CriticalMatch_XpBonusPercent 0.2,
//    PersonalBoost_XpBonusPercent 0.3, GroupBoost_XpBonusPercent 0.05, GroupBoost_BuffMultiplier 2,
//    Rest_XpBonusPercent 1.
const levels = perBuild((read) => read("accountlevels", []));
const levelData = (level) => levels().find((entry) => entry.level === level) ?? levels()[0] ?? {};
export const xpBonus = { criticalMatch: 0.2, personalBoost: 0.3, groupBoost: 0.05, groupBuffMultiplier: 2, rest: 1 };

const restTemplate = "Quota:restxp";
const boostTemplate = "Token:xpboost";

export function restQuotaAttributes(level, now = new Date()) {
  const info = getItem(restTemplate) ?? {};
  const row = levelData(level);
  const cap = row.restXpCap || info.maximumValue || 0;
  return {
    current_value: Math.min(info.startingValue ?? cap, cap),
    last_mod_time: now.toISOString(),
    units_per_minute_recharge: row.restXpRechargeRate || info.rechargePerMinute || 0,
    max_quota: cap,
    recharge_delay_minutes: info.rechargeDelayMinutes ?? 0,
    level: 1,
    item_seen: 1
  };
}

export function restValue(attributes, now = new Date()) {
  const minutes = (now.getTime() - Date.parse(attributes.last_mod_time)) / 60000;
  const refill = minutes >= (attributes.recharge_delay_minutes ?? 0) ? (attributes.units_per_minute_recharge ?? 0) * minutes : 0;
  return Math.max(0, Math.min(attributes.max_quota ?? 0, Math.floor((attributes.current_value ?? 0) + refill)));
}

function restQuota(session, now) {
  const tracker = session.profile("profile0");
  let itemId = findItem(tracker.profile, restTemplate);
  if (!itemId) {
    itemId = grantItem(session, restTemplate, 1)[0]?.itemId;
    if (!itemId) return null;
    for (const [name, value] of Object.entries(restQuotaAttributes(tracker.profile.stats.attributes.level ?? 1, now))) {
      tracker.setItemAttribute(itemId, name, value);
    }
  }
  return { tracker, itemId, attributes: tracker.profile.items[itemId].attributes };
}

export function restBalance(session, now = new Date()) {
  const quota = restQuota(session, now);
  return quota ? restValue(quota.attributes, now) : 0;
}

// Using rest XP takes it from the pool and restarts the wait before it refills.
export function spendRest(session, amount, now = new Date()) {
  const quota = restQuota(session, now);
  if (!quota || amount <= 0) return;
  quota.tracker.setItemAttribute(quota.itemId, "current_value", restValue(quota.attributes, now) - amount);
  quota.tracker.setItemAttribute(quota.itemId, "last_mod_time", now.toISOString());
}

// A new level brings its own rest XP cap and refill rate.
export function levelRest(session, level, now = new Date()) {
  const quota = restQuota(session, now);
  if (!quota) return;
  const row = levelData(level);
  if (row.restXpCap) quota.tracker.setItemAttribute(quota.itemId, "max_quota", row.restXpCap);
  if (row.restXpRechargeRate) quota.tracker.setItemAttribute(quota.itemId, "units_per_minute_recharge", row.restXpRechargeRate);
}

export function boostBalance(session) {
  const { profile } = session.profile("profile0");
  const itemId = findItem(profile, boostTemplate);
  return itemId ? profile.items[itemId].quantity : 0;
}

export function spendBoost(session, amount) {
  const tracker = session.profile("profile0");
  const itemId = findItem(tracker.profile, boostTemplate);
  if (!itemId || amount <= 0) return;
  const left = tracker.profile.items[itemId].quantity - amount;
  if (left > 0) tracker.setQuantity(itemId, left);
  else tracker.removeItem(itemId);
}

const fail = (code, message) => {
  throw new McpError(`errors.com.epicgames.fortnite.${code}`, message);
};

// ActivateConsumable {targetItemId, targetAccountId}: an XP Boost adds the target's level's BoostXPPerConsumable to
// their Token:xpboost. A gifted one tells the target with receivedGiftedBoostXp (FFortReceivedGiftedBoostXpNotification
// {amountBoostXpGifted, gifterAccountId}). Returns that notification for a gift, so it can reach the target.
export function activateConsumable(session, accountId, itemId, targetAccountId, targetSession) {
  const tracker = session.profile("profile0");
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  const info = item && getItem(item.templateId);
  if (info?.class !== "FortConsumableAccountItemDefinition") fail("item_not_found", `No consumable ${itemId}`);
  const self = !targetAccountId || targetAccountId === accountId;
  if (self && !info.activateOnSelf) fail("invalid_parameter", `${item.templateId} can only be given to someone else`);
  if (!self && !info.activateOnOthers) fail("invalid_parameter", `${item.templateId} can only be used on yourself`);
  const target = self ? session : targetSession;
  if (!target) fail("invalid_parameter", `No account ${targetAccountId}`);
  // A founder's friend code is consumed as it is granted (profiles/friendcodes.js); one still held becomes its code token.
  if (self && consumedInto(item.templateId)) {
    consume(session, itemId);
    return null;
  }
  if (!/^consumableaccountitem:smallxpboost(_gift)?$/i.test(item.templateId)) fail("invalid_parameter", `Nothing uses ${item.templateId} yet`);

  const amount = levelData(target.profile("profile0").profile.stats.attributes.level ?? 1).boostXpPerConsumable ?? 0;
  if (item.quantity > 1) tracker.setQuantity(itemId, item.quantity - 1);
  else tracker.removeItem(itemId);
  grantItem(target, boostTemplate, amount);
  return self ? null : { type: "receivedGiftedBoostXp", primary: false, amountBoostXpGifted: amount, gifterAccountId: accountId };
}
