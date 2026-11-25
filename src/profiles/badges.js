import { frostniteWaveTickets } from "../events/frostnite2018.js";
import { wargameBadgeRewards } from "../events/wargames.js";
import { getItem } from "../gamedata/items.js";
import { log } from "../log.js";
import { grant } from "./progress.js";

// What the badges a player earned in a zone give (EndPrimaryMission's earnedBadgeData, [FFortQuestEarnedBadgeData
// {templateId, count}]). Epic's MCP knew a badge's rewards from its item template: static_cardpack_reward
// (BadgeCardPackReward) and static_item_rewards (ItemRewards, {templateId, quantity}), which UFortBadgeItemDefinition's
// template export (sub_5D1FD0) writes. Only the survivor badges (MissionBadge_Survivor_*, the survivor missions'
// GrantSurvivorBadge) carry a card pack, ZCP_Rescued[_Tnn] "Rescued Survivor", and only the distress call badge carries
// an item (its reactive quest). Every badge earned gives its rewards once. The packs are "Mission" packs, which the
// after-mission rewards screen opens with the zone's other rewards (OpenCardPackBatch).
// Core 🟡: the server's count is capped at maxBadgeCount per badge, and an item reward with no quantity (the quest's
// is 0) gives one. Frostnite's wave badges (EndlessMode_Badge_Wave_*) carry neither; they give Snowflake Tickets
// (events/frostnite2018.js).
export const maxBadgeCount = 100;

export function grantBadgeRewards(session, earnedBadgeData) {
  const granted = [];
  for (const { templateId, count } of Array.isArray(earnedBadgeData) ? earnedBadgeData : []) {
    const badge = typeof templateId === "string" && getItem(templateId);
    if (!badge || badge.class !== "FortBadgeItemDefinition" || !Number.isInteger(count) || count <= 0) continue;
    const times = Math.min(count, maxBadgeCount);
    if (badge.cardPackReward) {
      granted.push(...grant(session, badge.cardPackReward, times, { packSource: "Mission" }));
    }
    for (const reward of badge.itemRewards ?? []) {
      granted.push(...grant(session, reward.templateId, Math.max(reward.quantity, 1) * times));
    }
    // Frostnite's wave badges (7.10): Snowflake Tickets for each wave the team survived (events/frostnite2018.js).
    for (const reward of frostniteWaveTickets(templateId, times)) granted.push(...grant(session, reward.templateId, reward.quantity));
  }
  // 9.00's Wargames (events/wargames.js): the simulation's badge (IronCityMissionBadge01-25) gives its zone's Wargames
  // Rewards pack, the challenge's badge one more.
  for (const reward of wargameBadgeRewards(earnedBadgeData)) granted.push(...grant(session, reward.templateId, reward.quantity, { packSource: "Mission" }));
  if (granted.length) {
    const totals = new Map();
    for (const { templateId, quantity } of granted) totals.set(templateId, (totals.get(templateId) ?? 0) + quantity);
    log("MCP", `EndPrimaryMission: badge rewards ${[...totals].map(([templateId, quantity]) => `${templateId} x${quantity}`).join(", ")}`);
  }
  return granted;
}
