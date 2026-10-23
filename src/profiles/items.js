import crypto from "node:crypto";
import { isChoicePack, rollOptions } from "../cardpacks/contents.js";
import { unlockPage } from "../collectionbook/pages.js";
import { bannerTemplateId } from "../gamedata/banners.js";
import { getItem } from "../gamedata/items.js";
import { log } from "../log.js";
import { heroAttributes } from "./heroes.js";
import { grantQuest } from "./quests.js";
import { settleBackpack, worldStackCap } from "./vault.js";
import { rollWorkerAttributes } from "./workers.js";

const profileFor = { profile: "profile0", theater: "theater0" };

function itemInfo(templateId) {
  // Homebase nodes are built from data tables rather than assets; their class derives from FortAccountItemDefinition.
  if (templateId.toLowerCase().startsWith("homebasenode:")) return { profile: "profile", maxStackSize: 1 };
  // So are banners: every icon shares DefaultHomebaseBannerIconItemDefinition and keeps its row (BannerRowName).
  if (bannerTemplateId(templateId)) return { profile: "profile", maxStackSize: 1 };
  return getItem(templateId);
}

export function findItem(profile, templateId) {
  return Object.keys(profile.items).find((itemId) => profile.items[itemId].templateId.toLowerCase() === templateId.toLowerCase());
}

// Characters start outside any squad: the client treats squad_id "" / squad_slot_idx -1 as unassigned.
const unassigned = {
  FortHeroType: { squad_id: "", squad_slot_idx: -1, slotted_building_id: "", building_slot_used: -1 },
  FortWorkerType: { squad_id: "", squad_slot_idx: -1, slotted_building_id: "", building_slot_used: -1 },
  FortDefenderItemDefinition: { squad_id: "", squad_slot_idx: -1 },
  // A storm shield core with nothing built and no build saved (see profiles/outposts.js).
  FortOutpostItemDefinition: { outpost_core_info: { placedBuildings: [], accountsWithEditPermission: [] }, cloud_save_info: { saveCount: 0, savedRecords: [] } }
};

// V-Bucks count only with platform "Epic": the client's balance (sub_68A110) adds up Currency:MtxPurchased,
// MtxPurchaseBonus, MtxGiveaway and MtxComplimentary items whose platform attribute is exactly "Epic" (sub_A4ED0).
const mtxCurrencies = new Set(["currency:mtxpurchased", "currency:mtxpurchasebonus", "currency:mtxgiveaway", "currency:mtxcomplimentary"]);
export const mtxPlatform = "Epic";
export const isMtxCurrency = (templateId) => mtxCurrencies.has(templateId.toLowerCase());

// The client's llama store only opens packs whose pack_source is Store, CollectionBook, Quest, LevelUp or Schedule;
// the after-mission rewards screen opens "Mission" packs. Choice packs need their options when granted.
export function cardPackAttributes(templateId, packSource = "Store") {
  return isChoicePack(templateId) ? { pack_source: packSource, options: rollOptions(templateId) } : { pack_source: packSource };
}

// A world item's FFortItemEntry is read from its attributes by property name; without durability it loads at the entry's
// default, 1.0, and breaks on its first use. New ones start at their template's static_max_durability (🟡).
function addItem(tracker, templateId, quantity, info, options) {
  const itemId = crypto.randomUUID();
  const attributes = info.profile === "profile" ? { level: info.minLevel ?? 1, item_seen: 0, ...structuredClone(unassigned[info.class]) } : {};
  if (info.profile === "theater" && info.maxDurability !== undefined) attributes.durability = info.maxDurability;
  if (info.class === "FortCardPackItemDefinition") Object.assign(attributes, cardPackAttributes(templateId, options.packSource));
  if (info.class === "FortWorkerType") Object.assign(attributes, rollWorkerAttributes(templateId));
  if (info.class === "FortHeroType") Object.assign(attributes, heroAttributes(templateId));
  if (isMtxCurrency(templateId)) attributes.platform = mtxPlatform;
  tracker.addItem(itemId, { templateId, attributes, quantity });
  return itemId;
}

const sameTemplate = (item, templateId) => item.templateId.toLowerCase() === templateId.toLowerCase();

// A world item given the way the world inventory gives one (AFortInventory, as CoreV2's GiveItemToInventoryOwner
// restores it): each stack of the template below its MaxStackSize is topped up in turn, then the rest becomes new stacks
// of at most MaxStackSize. Returns [itemId, amount] per stack that grew or was made.
// New stacks stop at the world inventory's 512-stack cap (profiles/vault.js); what is left isn't granted. New stacks that
// don't fit the backpack go to its overflow.
function grantWorldStacks(session, tracker, templateId, quantity, limit, info, options) {
  const changed = [];
  const added = [];
  let remaining = quantity;
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (remaining <= 0) break;
    if (!sameTemplate(item, templateId) || item.quantity >= limit) continue;
    const amount = Math.min(remaining, limit - item.quantity);
    tracker.setQuantity(itemId, item.quantity + amount);
    changed.push([itemId, amount]);
    remaining -= amount;
  }
  while (remaining > 0 && Object.keys(tracker.profile.items).length < worldStackCap) {
    const amount = Math.min(remaining, limit);
    const itemId = addItem(tracker, templateId, amount, info, options);
    changed.push([itemId, amount]);
    added.push(itemId);
    remaining -= amount;
  }
  if (remaining > 0) log("Items", `${tracker.profile.profileId} holds ${worldStackCap} stacks, ${remaining} ${templateId} not granted`);
  if (added.length && tracker.profile.profileId === "theater0") settleBackpack(tracker, session.profile("profile0").profile, added);
  return changed;
}

// The new stacks a world item grant needs.
export function worldStacksNeeded(profile, templateId, quantity) {
  const info = itemInfo(templateId);
  const limit = info?.maxStackSize > 0 ? info.maxStackSize : Infinity;
  const room = Object.values(profile.items).filter((item) => sameTemplate(item, templateId))
    .reduce((total, item) => total + Math.max(0, limit - item.quantity), 0);
  return Math.max(0, Math.ceil((quantity - room) / limit));
}

const stableJson = (value) => (value && typeof value === "object" && !Array.isArray(value)
  ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
  : JSON.stringify(value));

// A world profile (theater0, outpost0) as the game would have kept it: never-persisted items dropped, and stacks of one
// template that are otherwise the same (equal attributes, e.g. single items an older Core granted one by one) merged
// up to MaxStackSize, the earlier stacks filled first. Items that differ (durability, level...) stay apart. Returns
// counts for the log.
export function tidyWorldStacks(tracker) {
  const counts = { removed: 0, merged: 0 };
  const groups = new Map();
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    const info = getItem(item.templateId);
    if (info?.neverPersisted) {
      tracker.removeItem(itemId);
      counts.removed++;
      continue;
    }
    if (!info || info.maxStackSize === 1) continue;
    const key = `${item.templateId.toLowerCase()}|${stableJson(item.attributes ?? {})}`;
    if (!groups.has(key)) groups.set(key, { limit: info.maxStackSize > 0 ? info.maxStackSize : Infinity, ids: [] });
    groups.get(key).ids.push(itemId);
  }
  for (const { limit, ids } of groups.values()) {
    if (ids.length < 2) continue;
    let remaining = ids.reduce((sum, itemId) => sum + tracker.profile.items[itemId].quantity, 0);
    for (const [index, itemId] of ids.entries()) {
      // Nothing is lost: what no longer fits (stacks already over their limit) stays on the last one.
      const quantity = index === ids.length - 1 ? remaining : Math.min(remaining, limit);
      remaining -= quantity;
      if (quantity === 0) {
        tracker.removeItem(itemId);
        counts.merged++;
      } else if (tracker.profile.items[itemId].quantity !== quantity) {
        tracker.setQuantity(itemId, quantity);
      }
    }
  }
  return counts;
}

export const lootEntry = ({ templateId, itemId, profileId, quantity }) => ({ itemType: templateId, itemGuid: itemId, itemProfile: profileId, quantity });

// Returns what was granted, one entry per item that was added or topped up.
export function grantItem(session, templateId, quantity, options = {}) {
  if (quantity <= 0) return [];
  const [type, name] = templateId.split(":");
  if (type.toLowerCase() === "quest") {
    const itemId = grantQuest(session.profile("profile0"), name);
    return itemId ? [{ profileId: "profile0", itemId, templateId, quantity: 1 }] : [];
  }
  if (type.toLowerCase() === "collectionbookpage") {
    if (!unlockPage(session, name)) log("Items", `No collection book page ${name}, not granted`);
    return [];
  }

  // A skill tree node or a banner is owned or not; quest rewards can grant one the player already bought.
  if (bannerTemplateId(templateId)) templateId = bannerTemplateId(templateId);
  if (type.toLowerCase() === "homebasenode" || bannerTemplateId(templateId)) {
    if (findItem(session.profile("profile0").profile, templateId)) return [];
    quantity = 1;
  }

  const info = itemInfo(templateId);
  if (!info) {
    log("Items", `No item data for ${templateId}, not granted`);
    return [];
  }
  const profileId = profileFor[info.profile];
  const tracker = session.profile(profileId);
  const granted = (itemId, amount) => ({ profileId, itemId, templateId, quantity: amount });

  // A never-persisted world item (bNeverPersisted, e.g. ability ammo and quest pickups) lives only in a zone: the theater0
  // save never adds one (ConstructBatchUpdate 0x6A9750 keeps definitions passing 0x5C53E0), so MCP never holds one.
  if (info.neverPersisted) {
    log("Items", `${templateId} is never persisted, not granted`);
    return [];
  }
  const limit = info.maxStackSize > 0 ? info.maxStackSize : Infinity;
  if (info.profile === "theater") return grantWorldStacks(session, tracker, templateId, quantity, limit, info, options).map(([itemId, amount]) => granted(itemId, amount));
  if (info.maxStackSize === 1) {
    return Array.from({ length: quantity }, () => granted(addItem(tracker, templateId, 1, info, options), 1));
  }
  const existing = findItem(tracker.profile, templateId);
  if (!existing) {
    const amount = Math.min(quantity, limit);
    return [granted(addItem(tracker, templateId, amount, info, options), amount)];
  }
  const before = tracker.profile.items[existing].quantity;
  const after = Math.min(before + quantity, limit);
  if (after !== before) tracker.setQuantity(existing, after);
  return [granted(existing, after - before)];
}
