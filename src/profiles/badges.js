import { getItem } from "../gamedata/items.js";
import { log } from "../log.js";
import { grantItem } from "./items.js";

// What the badges a player earned in a zone give (EndPrimaryMission's earnedBadgeData, [FFortQuestEarnedBadgeData
// {templateId, count}]). Epic's MCP knew a badge's rewards from its item template: static_cardpack_reward
// (BadgeCardPackReward) and static_item_rewards (ItemRewards, {templateId, quantity}), which UFortBadgeItemDefinition's
// template export (sub_5D1FD0) writes. Only the survivor badges (MissionBadge_Survivor_*, the survivor missions'
// GrantSurvivorBadge) carry a card pack, ZCP_Rescued[_Tnn] "Rescued Survivor", and only the distress call badge carries
// an item (its reactive quest). Every badge earned gives its rewards once. The packs are "Mission" packs, which the
// after-mission rewards screen opens with the zone's other rewards (OpenCardPackBatch).
// Core 🟡: the server's count is capped at maxBadgeCount per badge, and an item reward with no quantity (the quest's
// is 0) gives one.
export const maxBadgeCount = 100;

export function grantBadgeRewards(session, earnedBadgeData) {
  const granted = [];
  for (const { templateId, count } of Array.isArray(earnedBadgeData) ? earnedBadgeData : []) {
    const badge = typeof templateId === "string" && getItem(templateId);
    if (!badge || badge.class !== "FortBadgeItemDefinition" || !Number.isInteger(count) || count <= 0) continue;
    const times = Math.min(count, maxBadgeCount);
    if (badge.cardPackReward) {
      granted.push(...grantItem(session, badge.cardPackReward, times, { packSource: "Mission" }));
    }
    for (const reward of badge.itemRewards ?? []) {
      granted.push(...grantItem(session, reward.templateId, Math.max(reward.quantity, 1) * times));
    }
  }
  if (granted.length) {
    const totals = new Map();
    for (const { templateId, quantity } of granted) totals.set(templateId, (totals.get(templateId) ?? 0) + quantity);
    log("MCP", `EndPrimaryMission: badge rewards ${[...totals].map(([templateId, quantity]) => `${templateId} x${quantity}`).join(", ")}`);
  }
  return granted;
}
