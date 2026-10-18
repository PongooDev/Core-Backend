import crypto from "node:crypto";
import { getItem } from "../gamedata/items.js";
import { log } from "../log.js";
import { grantQuest } from "./quests.js";

const profileFor = { profile: "profile0", theater: "theater0" };

function itemInfo(templateId) {
  // Homebase nodes are built from data tables rather than assets; their class derives from FortAccountItemDefinition.
  if (templateId.toLowerCase().startsWith("homebasenode:")) return { profile: "profile", maxStackSize: 1 };
  return getItem(templateId);
}

function findItem(profile, templateId) {
  return Object.keys(profile.items).find((itemId) => profile.items[itemId].templateId.toLowerCase() === templateId.toLowerCase());
}

function addItem(tracker, templateId, quantity, info) {
  const attributes = info.profile === "profile" ? { level: 1, item_seen: 0 } : {};
  tracker.addItem(crypto.randomUUID(), { templateId, attributes, quantity });
}

function unlockCollectionBookPage(tracker, page) {
  const book = tracker.profile.stats.attributes.collection_book;
  if (book.pages.some((known) => known.toLowerCase() === page.toLowerCase())) return;
  tracker.setStat("collection_book", { ...book, pages: [...book.pages, page] });
}

export function grantItem(session, templateId, quantity) {
  if (quantity <= 0) return;
  const [type, name] = templateId.split(":");
  if (type.toLowerCase() === "quest") return void grantQuest(session.profile("profile0"), name);
  if (type.toLowerCase() === "collectionbookpage") return unlockCollectionBookPage(session.profile("profile0"), name);

  const info = itemInfo(templateId);
  if (!info) return log("Items", `No item data for ${templateId}, not granted`);
  const tracker = session.profile(profileFor[info.profile]);

  if (info.maxStackSize === 1) {
    for (let i = 0; i < quantity; i++) addItem(tracker, templateId, 1, info);
    return;
  }
  const limit = info.maxStackSize > 0 ? info.maxStackSize : Infinity;
  const existing = findItem(tracker.profile, templateId);
  if (existing) tracker.setQuantity(existing, Math.min(tracker.profile.items[existing].quantity + quantity, limit));
  else addItem(tracker, templateId, Math.min(quantity, limit), info);
}
