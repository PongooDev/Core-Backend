import { poolMatching } from "../cardpacks/pools.js";
import { McpError } from "../errors.js";
import { getItem } from "../gamedata/items.js";
import { readGameData } from "../gamedata/read.js";
import { findItem, lootEntry } from "../profiles/items.js";
import { grant } from "../profiles/progress.js";
import { hasUnlocked } from "../profiles/unlocks.js";

// Item transform (TransmogItem), from the game data:
//  - A key (UFortConversionControlItemDefinition) is usable when the player owns one, or when its RequiredCatalysts
//    are unlocked by the skill tree (UFortInventoryContext::GetHomebaseUnlockedTransmogKeys lists those without an
//    item). bConsumedOnConversion keys are used up.
//  - The sacrificed items are worth their TransmogSacrificeRow's points; the result's rarity is the highest EFortRarity
//    whose TierCost is above 0 and within the points (GetTierFromSacrificePoints, sub_5C36F0), and that tier's
//    RequiredItemQuantity of the key's RequiredItem is spent.
// Core's: the result is a random item named by the key's loot tier group (CCK_People_Hero_Ninja -> a ninja hero,
// CCK_Melee_Axe -> an axe, CCK_Weapon_Core -> any weapon), at that rarity and the lowest tier there is; Epic rolled
// those groups on its servers.
const keys = new Map(Object.entries(readGameData("transmog", {})).map(([templateId, key]) => [templateId.toLowerCase(), { templateId, ...key }]));
const rarityCodes = ["c", "uc", "r", "vr", "sr"];
const skipWords = new Set(["cck", "expedition", "core", "people", "common", "uncommon", "rare", "veryrare", "superrare", "unique", "sr"]);
const kindsFor = { hero: ["hero"], defender: ["defender"], manager: ["manager"], worker: ["worker"], trap: ["trap"],
  melee: ["melee"], ranged: ["ranged"], weapon: ["ranged", "melee"] };

const fail = (message) => {
  throw new McpError("errors.com.epicgames.fortnite.transmog_failed", message);
};

export function transmogTier(key, points) {
  for (let tier = key.tiers.length - 1; tier >= 0; tier--) {
    const { cost } = key.tiers[tier];
    if (cost > 0 && points >= cost) return tier;
  }
  return -1;
}

export function rewardChoices(lootTierGroup, rarity) {
  const [kind, ...words] = lootTierGroup.toLowerCase().split("_").filter((word) => !skipWords.has(word));
  return kindsFor[kind] ? poolMatching(kindsFor[kind], words, rarity) : [];
}

function spend(tracker, templateId, quantity) {
  const stacks = Object.entries(tracker.profile.items).filter(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase());
  const have = stacks.reduce((sum, [, item]) => sum + item.quantity, 0);
  if (have < quantity) fail(`This takes ${quantity} ${templateId} and you have ${have}`);
  let left = quantity;
  for (const [itemId, item] of stacks) {
    const used = Math.min(left, item.quantity);
    left -= used;
    if (item.quantity > used) tracker.setQuantity(itemId, item.quantity - used);
    else tracker.removeItem(itemId);
    if (!left) break;
  }
}

// TransmogItem {transmogKeyTemplateId, sacrificeItemIds}; reported as transmogResult (FFortTransmogResultNotification
// {transmoggedItems, recycledItems}, both [FMcpLootEntry]).
export function transmogItem(session, keyTemplateId, sacrificeItemIds, notifications) {
  const key = keys.get(String(keyTemplateId ?? "").toLowerCase());
  if (!key) fail(`No transform key ${keyTemplateId}`);
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const ownedKey = findItem(profile, key.templateId);
  if (!ownedKey && !(key.catalysts.length && hasUnlocked(profile, key.catalysts))) fail(`You don't have ${key.templateId}`);

  const ids = Array.isArray(sacrificeItemIds) ? sacrificeItemIds : [];
  if (!ids.length || new Set(ids).size !== ids.length) fail("Choose the items to transform");
  let points = 0;
  for (const itemId of ids) {
    const item = typeof itemId === "string" && profile.items[itemId];
    const worth = item && getItem(item.templateId)?.transmogPoints;
    if (!worth) fail(`${itemId} can't be transformed`);
    if (item.attributes.squad_id) fail(`${item.templateId} is in a squad`);
    points += worth;
  }
  const tier = transmogTier(key, points);
  if (tier < 0) fail(`${points} points isn't enough for ${key.templateId}`);
  const choices = rewardChoices(key.lootTierGroup, rarityCodes[Math.min(tier, rarityCodes.length - 1)]);
  if (!choices.length) fail(`${key.templateId} has nothing to transform into`);

  if (key.requiredItem && key.tiers[tier].quantity > 0) spend(tracker, key.requiredItem, key.tiers[tier].quantity);
  const recycledItems = ids.map((itemId) => {
    const { templateId, quantity } = profile.items[itemId];
    tracker.removeItem(itemId);
    return lootEntry({ templateId, itemId, profileId: "profile0", quantity });
  });
  if (key.consumed && ownedKey) spend(tracker, key.templateId, 1);
  const result = choices[Math.floor(Math.random() * choices.length)];
  const transmoggedItems = grant(session, result, 1).map(lootEntry);
  notifications.push({ type: "transmogResult", primary: true, transmoggedItems, recycledItems });
}
