import crypto from "node:crypto";
import { isChoicePack, rollOptions } from "../cardpacks/contents.js";
import { bannerTemplateId } from "../gamedata/banners.js";
import { getItem } from "../gamedata/items.js";
import { log } from "../log.js";
import { grantQuest } from "./quests.js";

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
  FortDefenderItemDefinition: { squad_id: "", squad_slot_idx: -1 }
};

// The client's llama store only opens packs whose pack_source is Store, CollectionBook, Quest, LevelUp or Schedule;
// the after-mission rewards screen opens "Mission" packs. Choice packs need their options when granted.
export function cardPackAttributes(templateId, packSource = "Store") {
  return isChoicePack(templateId) ? { pack_source: packSource, options: rollOptions(templateId) } : { pack_source: packSource };
}

function addItem(tracker, templateId, quantity, info, options) {
  const itemId = crypto.randomUUID();
  const attributes = info.profile === "profile" ? { level: 1, item_seen: 0, ...unassigned[info.class] } : {};
  if (info.class === "FortCardPackItemDefinition") Object.assign(attributes, cardPackAttributes(templateId, options.packSource));
  tracker.addItem(itemId, { templateId, attributes, quantity });
  return itemId;
}

function unlockCollectionBookPage(tracker, page) {
  const book = tracker.profile.stats.attributes.collection_book;
  if (book.pages.some((known) => known.toLowerCase() === page.toLowerCase())) return;
  tracker.setStat("collection_book", { ...book, pages: [...book.pages, page] });
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
    unlockCollectionBookPage(session.profile("profile0"), name);
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

  if (info.maxStackSize === 1) {
    return Array.from({ length: quantity }, () => granted(addItem(tracker, templateId, 1, info, options), 1));
  }
  const limit = info.maxStackSize > 0 ? info.maxStackSize : Infinity;
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
