import { getItem } from "../gamedata/items.js";
import { log } from "../log.js";
import { grant } from "./progress.js";

// The item caches a player picked up in a zone (4.0, CoreV2 #290): EndPrimaryMission's earnedItemCaches, the template
// ids (GetPersistentName) of the UFortItemCacheItemDefinitions the gameserver kept for the player in
// AFortWorldManager::UnsavedPlayerEarnedItemCaches, one per cache. Each gives its definition's CardPackReward
// (tools/extractor: cardPackReward) as a card pack with pack_source "ItemCache". That is what the client looks for:
// UFortMcpContext::GetPendingItemCacheRewards (4.0 0xDFEC00) lists the campaign profile's card packs whose pack_source is
// "ItemCache", the frontend's CheckFrontEndRewardsAction (PopulateItemCacheRewards) shows them, and
// ClaimItemCacheReward (0xDED0E0) opens one with OpenCardPack, which rolls its contents (cardpacks/contents.js).
// The caches are kept whatever the mission's status, as the badges are. Core 🟡: at most maxItemCaches a mission.
export const itemCachePackSource = "ItemCache";
export const maxItemCaches = 100;

export function grantItemCacheRewards(session, earnedItemCaches) {
  const granted = [];
  let count = 0;
  for (const templateId of Array.isArray(earnedItemCaches) ? earnedItemCaches : []) {
    const cache = typeof templateId === "string" && getItem(templateId);
    if (!cache || cache.class !== "FortItemCacheItemDefinition" || !cache.cardPackReward) continue;
    if (++count > maxItemCaches) break;
    granted.push(...grant(session, cache.cardPackReward, 1, { packSource: itemCachePackSource }));
  }
  if (granted.length) {
    const totals = new Map();
    for (const { templateId, quantity } of granted) totals.set(templateId, (totals.get(templateId) ?? 0) + quantity);
    log("MCP", `EndPrimaryMission: item caches ${[...totals].map(([templateId, quantity]) => `${templateId} x${quantity}`).join(", ")}`);
  }
  return granted;
}
