import { McpError } from "../errors.js";
import { lootEntry } from "../profiles/items.js";
import { grant, itemEvent, refreshHeldItems } from "../profiles/progress.js";
import { itemRating } from "../profiles/rating.js";
import { recyclingRefunds } from "../profiles/upgrades.js";
import { bookData, findPageItem, isUnlocked, pageId, refreshPage, slotFor, slottedItems } from "./pages.js";

export { bookProfiles, isBookPage } from "./pages.js";

// The book's XP is what the client works out (UFortCollectionBookManager::CalculateBookXp sub_466FC0): for every page
// it has a page item for, for every section, the rounded sum of its slots' XP, each
//   ConstantWeight + level x ItemLevelWeight + RarityFactor(rarity) x RarityWeight + rating x ItemRatingWeight
// (FortCollectionBookSlotData.cpp). Its level is the higher of the XP's level and profile0's
// collection_book.maxBookXpLevelAchieved (sub_4671F0); levels (CollectionBookXPLevelData) are claimed one at a time.
const rarities = ["c", "uc", "r", "vr", "sr"];
const rarityIndex = (templateId) => {
  const tokens = templateId.split(":")[1].toLowerCase().split("_");
  const rarity = [...tokens].reverse().find((token) => rarities.includes(token));
  return rarity ? rarities.indexOf(rarity) : 0;
};

const fail = (message) => {
  throw new McpError("errors.com.epicgames.fortnite.collection_book_slot_failed", message);
};

export function slotXp(item) {
  const { weights, slots, rarityFactor } = bookData();
  const weight = weights[slots[slotFor(item)]?.weight] ?? weights.Default;
  if (!weight) return 0;
  return weight.constant + (item.attributes.level ?? 1) * weight.level
    + (rarityFactor[rarityIndex(item.templateId)] ?? 0) * weight.rarity + itemRating(item) * weight.rating;
}

export function bookXp(session) {
  const bySection = new Map();
  for (const { item, slotId } of slottedItems(session).values()) {
    if (!isUnlocked(session, bookData().pageOfSlot.get(slotId))) continue;
    const sectionId = bookData().sectionOfSlot.get(slotId);
    bySection.set(sectionId, (bySection.get(sectionId) ?? 0) + slotXp(item));
  }
  return [...bySection.values()].reduce((sum, xp) => sum + Math.round(xp), 0);
}

// The level the client shows (sub_4671F0): the higher of the XP's level and the last one claimed.
export function bookLevel(session) {
  const xp = bookXp(session);
  const reached = bookData().levels.reduce((level, entry) => entry.totalXp <= xp ? Math.max(level, entry.level) : level, 0);
  const claimed = session.profile("profile0").profile.stats.attributes.collection_book?.maxBookXpLevelAchieved ?? 0;
  return Math.max(reached, claimed);
}

// SlotItemInCollectionBook {itemId}: the item moves, id and attributes kept, into its slot's page profile. A slot that
// already holds an item takes the new one in its place: the picker shows the old one's recycling refunds
// (CollectionBookItemPicker → CollectionBookRecycleSlotResultsWidget, UFortAccountItemDefinition::GetRecyclingRefunds)
// and Core grants them (🟡). The reply's primary notification is FFortCollectionBookSlotItemNotification
// {slottedItemId}, which the client's completion (sub_47B740) reads to find the slotted item. The quests that wait on
// the book (a level reached, items slotted) are re-counted (progress.js) and the SlotInCollection item event is fed.
export function slotItem(session, itemId, notifications = []) {
  const account = session.profile("profile0");
  const item = typeof itemId === "string" && account.profile.items[itemId];
  if (!item) fail(`No item ${itemId}`);
  const slotId = slotFor(item);
  if (!slotId) fail(`${item.templateId} has no place in the collection book`);
  const page = bookData().pageOfSlot.get(slotId);
  if (!page || !isUnlocked(session, page)) fail(`The ${page ?? slotId} page isn't unlocked`);
  if (item.attributes.squad_id) fail(`${item.templateId} is in a squad`);

  const book = session.profile(bookData().pages[page].profile);
  const replaced = slottedItems(session).get(slotId);
  if (replaced) {
    session.profile(replaced.profileId).removeItem(replaced.itemId);
    for (const { templateId, quantity } of recyclingRefunds(replaced.item.templateId)) grant(session, templateId, quantity);
  }
  account.removeItem(itemId);
  book.addItem(itemId, { templateId: item.templateId, attributes: { ...item.attributes }, quantity: 1 });
  refreshPage(session, page);
  itemEvent(session, ["SlotInCollection"], item.templateId, 1);
  refreshHeldItems(session);
  notifications.push({ type: "collectionBookSlotItem", primary: true, slottedItemId: itemId });
}

// What a claim gives, as FFortCollectionBookClaimRewardNotification {loot (FMcpLootResult), page, section}: the client's
// claim completion (sub_47B010) logs "Empty reward response received" without it and looks the loot up in profile0.
function grantRewards(session, rewards, selectedIndex, notifications, page = "", section = "") {
  const chosen = rewards.selectable.length ? rewards.selectable[selectedIndex] : [];
  if (rewards.selectable.length && !chosen) fail(`Choose one of ${rewards.selectable.length} rewards`);
  const items = [...rewards.standard, ...chosen, ...rewards.hidden]
    .flatMap(({ templateId, quantity }) => grant(session, templateId, quantity, { packSource: "CollectionBook" }).map(lootEntry));
  notifications.push({ type: "collectionBookClaimReward", primary: true, loot: { tierGroupName: "", items }, page, section });
}

// ClaimCollectionBookRewards {requiredXp, selectedRewardIndex}: the next book level, named by its total XP.
export function claimBookLevel(session, requiredXp, selectedIndex = 0, notifications = []) {
  const account = session.profile("profile0");
  const book = account.profile.stats.attributes.collection_book ?? { pages: [], maxBookXpLevelAchieved: 0 };
  const level = bookData().levels.find((entry) => entry.level > 0 && entry.totalXp === requiredXp);
  if (!level) fail(`No book level at ${requiredXp} XP`);
  if (level.level !== (book.maxBookXpLevelAchieved ?? 0) + 1) fail(`Book level ${level.level} isn't the next one to claim`);
  const xp = bookXp(session);
  if (xp < requiredXp) fail(`The book has ${xp} of ${requiredXp} XP`);
  grantRewards(session, level.rewards, selectedIndex, notifications);
  account.setStat("collection_book", { ...book, maxBookXpLevelAchieved: level.level });
  refreshHeldItems(session);
}

// ClaimCollectionBookPageRewards {pageTemplateId, sectionId, selectedRewardIndex} on the page's book profile: a
// Completed page's or section's rewards, which then become Claimed. A page claim sends no section (empty or None).
// In this build only Epic's test page and section have rewards.
export function claimPageRewards(session, pageTemplateId, sectionId, selectedIndex = 0, notifications = []) {
  const id = pageId(pageTemplateId);
  if (!id) fail(`No page ${pageTemplateId}`);
  const page = bookData().pages[id];
  const section = sectionId && String(sectionId).toLowerCase() !== "none"
    ? page.sections.find((entry) => entry.toLowerCase() === String(sectionId).toLowerCase()) ?? fail(`No section ${sectionId} on ${id}`)
    : undefined;

  const tracker = session.profile(page.profile);
  const itemId = findPageItem(tracker, id);
  if (!itemId) fail(`The ${id} page isn't unlocked`);
  refreshPage(session, id);
  const { attributes } = tracker.profile.items[itemId];
  if (section) {
    const state = attributes.sectionStates.find((entry) => entry.section.toLowerCase() === section.toLowerCase())?.state ?? "Active";
    if (state !== "Completed") fail(state === "Claimed" ? "Already claimed" : "Fill every slot first");
    grantRewards(session, bookData().sections[section].rewards, selectedIndex, notifications, id, section);
    tracker.setItemAttribute(itemId, "sectionStates", attributes.sectionStates
      .map((entry) => entry.section.toLowerCase() === section.toLowerCase() ? { ...entry, state: "Claimed" } : entry));
  } else {
    if (attributes.state !== "Completed") fail(attributes.state === "Claimed" ? "Already claimed" : "Fill every slot first");
    grantRewards(session, page.rewards, selectedIndex, notifications, id);
    tracker.setItemAttribute(itemId, "state", "Claimed");
  }
}
