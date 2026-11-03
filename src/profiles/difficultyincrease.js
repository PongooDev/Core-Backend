import { rollContents } from "../cardpacks/contents.js";
import { isEventActive } from "../events/events.js";
import { firecrackerTickets, spring2018 } from "../events/spring2018.js";
import { getItem } from "../gamedata/items.js";
import { lootEntry } from "./items.js";
import { grant } from "./progress.js";

// The BluGlo Difficulty Pylon's opt-in difficulty (2.5 and 3.0: "Firecracker Tickets can be earned by using the new
// Opt-In Difficulty"; 3.0's notes move it to defense missions, before the defense starts).
//
// In the zone (✅ 3.0's Mission_BluGloPylon and B_BluGloPylon_Diff): each of up to five BluGlo deposits (1, 2, 3, 3 and
// 3, BluGloPylon_Diff_Curve) registers a DifficultyBoost0N modifier, raises GameDifficulty by DifficultyOffsets'
// DifficultyBoost_0N and sets AFortGameStateZone's DifficultyIncreaseRewardTier to N, which the game refuses above the
// zone's difficulty row's NumDifficultyIncreases (5 for Theater_Start_Zone2 to Theater_Nightmare_Zone5, 0 elsewhere).
// CoreV2 sends that tier as EndPrimaryMission's difficultyIncreaseTier (Epic's sender was stripped).
//
// On the profile (✅ 3.0's SDK and exe): profile0's stat difficulty_increase_rewards_record
// (FFortDifficultyIncreaseRewardRecord {pendingRewards: [FFortDifficultyIncreaseRewardEntry {difficultyIncreaseTier,
// difficultyIncreaseMissionRewards (FMcpLootResult)}]}). The front end's rewards screen asks
// UFortMcpContext::HasPendingDifficultyIncreaseRewards (pendingRewards non-empty) and then sends
// ClaimDifficultyIncreaseRewards, whose notification is claimedDifficultyIncreaseReward
// (FFortClaimedDifficultyIncreaseRewardNotification {lootGranted}).
//
// 🟡 What a tier gives is Core's: Epic's server rolled it from the row's DifficultyIncreaseLootTierGroup
// (BluGloDifficultyTG), which is server-only data (not in LootTierData_Client). Kept small: per tier reached, one more of
// the mission's own reward pack, and while Spring It On! runs, firecrackersPerTier Firecracker Tickets.
export const difficultyIncreaseTierGroup = "BluGloDifficultyTG";
export const maxDifficultyIncreaseTier = 5;
export const firecrackersPerTier = 25;

const recordStat = "difficulty_increase_rewards_record";

// The pack a tier repeats: the mission's first zone card pack that isn't its Seasonal Gold, else its first reward.
function basePack(missionRewards) {
  const items = missionRewards?.items ?? [];
  return items.find(({ itemType }) => /^cardpack:zcp_/i.test(itemType) && !/eventscaling/i.test(itemType)) ?? items[0];
}

// The zone details' difficultyIncreaseMissionRewards (FFortZoneInstanceDetails, TArray<FMcpLootResult>): what reaching
// each tier gives, tier 1 first, each the whole of that tier's rewards.
export function difficultyIncreaseMissionRewards(missionRewards) {
  const pack = basePack(missionRewards);
  const firecrackers = isEventActive(spring2018) && getItem(firecrackerTickets);
  return Array.from({ length: maxDifficultyIncreaseTier }, (_, index) => {
    const tier = index + 1;
    const items = [];
    if (pack) items.push({ itemType: pack.itemType, quantity: pack.quantity * tier });
    if (firecrackers) items.push({ itemType: firecrackerTickets, quantity: firecrackersPerTier * tier });
    return { tierGroupName: difficultyIncreaseTierGroup, items };
  });
}

const pendingOf = (tracker) => tracker.profile.stats.attributes[recordStat]?.pendingRewards ?? [];

// A won mission played at a raised difficulty: its tier's rewards wait in the record. Returns the entry, or undefined
// when the tier isn't one the pylon can reach.
export function addDifficultyIncreaseRewards(session, tier, missionRewards) {
  if (!Number.isInteger(tier) || tier < 1) return undefined;
  const reached = Math.min(tier, maxDifficultyIncreaseTier);
  const loot = difficultyIncreaseMissionRewards(missionRewards)[reached - 1];
  const entry = {
    difficultyIncreaseTier: reached,
    difficultyIncreaseMissionRewards: { ...loot, items: loot.items.map(({ itemType, quantity }) => ({ itemType, itemGuid: "", itemProfile: "", quantity })) }
  };
  const tracker = session.profile("profile0");
  tracker.setStat(recordStat, { pendingRewards: [...pendingOf(tracker), entry] });
  return entry;
}

// ClaimDifficultyIncreaseRewards (UFortMcpContext::GrantPendingDifficultyIncreaseRewards), no parameters: every pending
// entry granted, packs opened, one claimedDifficultyIncreaseReward with all of it.
export function claimDifficultyIncreaseRewards(session, notifications) {
  const tracker = session.profile("profile0");
  const pending = pendingOf(tracker);
  if (!pending.length) return;

  const items = [];
  for (const { difficultyIncreaseMissionRewards: loot } of pending) {
    for (const { itemType, quantity } of loot?.items ?? []) {
      const contents = itemType.toLowerCase().startsWith("cardpack:")
        ? Array.from({ length: quantity }, () => rollContents(itemType)).flat()
        : [{ templateId: itemType, quantity }];
      for (const content of contents) items.push(...grant(session, content.templateId, content.quantity).map(lootEntry));
    }
  }
  tracker.setStat(recordStat, { pendingRewards: [] });
  notifications.push({ type: "claimedDifficultyIncreaseReward", primary: true, lootGranted: { tierGroupName: difficultyIncreaseTierGroup, items } });
}
