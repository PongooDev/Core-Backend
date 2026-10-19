import { McpError } from "../errors.js";
import { readGameData } from "../gamedata/read.js";
import { grant } from "../profiles/progress.js";
import { itemRating } from "../profiles/rating.js";

// The collection book (CollectionBook/Data): items are slotted into a page's sections (moving from profile0 to the
// page's profile, collection_book_people0 or collection_book_schematics0), and the book's XP is what the client works
// out (UFortCollectionBookManager::CalculateBookXp): for every section, the rounded sum of its slots' XP, each
//   ConstantWeight + level x ItemLevelWeight + RarityFactor(rarity) x RarityWeight + rating x ItemRatingWeight
// (FortCollectionBookSlotData.cpp). Book levels (CollectionBookXPLevelData) are claimed in order once the XP is there;
// profile0's collection_book stat keeps maxBookXpLevelAchieved and the unlocked pages.
const { pages = {}, sections = {}, slots = {}, weights = {}, rarityFactor = [], levels = [] } = readGameData("collectionbook", {});

const slotOf = new Map();
for (const [slotId, slot] of Object.entries(slots)) {
  for (const templateId of slot.items) if (!slotOf.has(templateId.toLowerCase())) slotOf.set(templateId.toLowerCase(), slotId);
}
const pageOfSlot = new Map();
const sectionOfSlot = new Map();
for (const [pageId, page] of Object.entries(pages)) {
  for (const sectionId of page.sections) {
    for (const slotId of sections[sectionId]?.slots ?? []) {
      pageOfSlot.set(slotId, pageId);
      sectionOfSlot.set(slotId, sectionId);
    }
  }
}
export const bookProfiles = [...new Set(Object.values(pages).map((page) => page.profile))];

const rarities = ["c", "uc", "r", "vr", "sr"];
const rarityIndex = (templateId) => {
  const tokens = templateId.split(":")[1].toLowerCase().split("_");
  const rarity = [...tokens].reverse().find((token) => rarities.includes(token));
  return rarity ? rarities.indexOf(rarity) : 0;
};

const fail = (message) => {
  throw new McpError("errors.com.epicgames.fortnite.collection_book_slot_failed", message);
};

export const slotFor = (templateId) => slotOf.get(templateId.toLowerCase());

export const isBookPage = (pageId) => Object.keys(pages).some((id) => id.toLowerCase() === String(pageId).toLowerCase());

export function slotXp(item) {
  const weight = weights[slots[slotFor(item.templateId)]?.weight] ?? weights.Default;
  if (!weight) return 0;
  return weight.constant + (item.attributes.level ?? 1) * weight.level
    + (rarityFactor[rarityIndex(item.templateId)] ?? 0) * weight.rarity + itemRating(item) * weight.rating;
}

function slottedItems(session) {
  return bookProfiles.flatMap((profileId) => Object.entries(session.profile(profileId).profile.items)
    .map(([itemId, item]) => ({ itemId, item, profileId, slotId: slotFor(item.templateId) }))
    .filter(({ slotId }) => slotId));
}

export function bookXp(session) {
  const bySection = new Map();
  for (const { item, slotId } of slottedItems(session)) {
    const sectionId = sectionOfSlot.get(slotId);
    bySection.set(sectionId, (bySection.get(sectionId) ?? 0) + slotXp(item));
  }
  return [...bySection.values()].reduce((sum, xp) => sum + Math.round(xp), 0);
}

// SlotItemInCollectionBook {itemId}: the item moves, id and attributes kept, into its slot's page profile.
export function slotItem(session, itemId) {
  const account = session.profile("profile0");
  const item = typeof itemId === "string" && account.profile.items[itemId];
  if (!item) fail(`No item ${itemId}`);
  const slotId = slotFor(item.templateId);
  if (!slotId) fail(`${item.templateId} has no place in the collection book`);
  const pageId = pageOfSlot.get(slotId);
  const unlocked = account.profile.stats.attributes.collection_book?.pages ?? [];
  if (!unlocked.some((page) => page.toLowerCase() === pageId.toLowerCase())) fail(`The ${pageId} page isn't unlocked`);
  if (item.attributes.squad_id) fail(`${item.templateId} is in a squad`);
  if (slottedItems(session).some((slotted) => slotted.slotId === slotId)) fail(`The ${slotId} slot is already filled`);

  const book = session.profile(pages[pageId].profile);
  account.removeItem(itemId);
  book.addItem(itemId, { templateId: item.templateId, attributes: { ...item.attributes }, quantity: 1 });
}

function grantRewards(session, rewards, selectedIndex) {
  const chosen = rewards.selectable.length ? rewards.selectable[selectedIndex] : [];
  if (rewards.selectable.length && !chosen) fail(`Choose one of ${rewards.selectable.length} rewards`);
  for (const { templateId, quantity } of [...rewards.standard, ...chosen, ...rewards.hidden]) {
    grant(session, templateId, quantity, { packSource: "CollectionBook" });
  }
}

// ClaimCollectionBookRewards {requiredXp, selectedRewardIndex}: the next book level, named by its total XP.
export function claimBookLevel(session, requiredXp, selectedIndex = 0) {
  const account = session.profile("profile0");
  const book = account.profile.stats.attributes.collection_book ?? { pages: [], maxBookXpLevelAchieved: 0 };
  const level = levels.find((entry) => entry.level > 0 && entry.totalXp === requiredXp);
  if (!level) fail(`No book level at ${requiredXp} XP`);
  if (level.level !== (book.maxBookXpLevelAchieved ?? 0) + 1) fail(`Book level ${level.level} isn't the next one to claim`);
  const xp = bookXp(session);
  if (xp < requiredXp) fail(`The book has ${xp} of ${requiredXp} XP`);
  grantRewards(session, level.rewards, selectedIndex);
  account.setStat("collection_book", { ...book, maxBookXpLevelAchieved: level.level });
}

// ClaimCollectionBookPageRewards {pageTemplateId, sectionId, selectedRewardIndex}: a full page's or section's rewards,
// once (kept in the page profile's claimed_page_rewards stat). In this build only a test section has any.
export function claimPageRewards(session, pageId, sectionId, selectedIndex = 0) {
  const pageKey = Object.keys(pages).find((id) => id.toLowerCase() === String(pageId ?? "").toLowerCase());
  if (!pageKey) fail(`No page ${pageId}`);
  const page = pages[pageKey];
  const target = sectionId ? sections[sectionId] : page;
  if (!target || (sectionId && !page.sections.includes(sectionId))) fail(`No section ${sectionId} on ${pageKey}`);
  const rewards = target.rewards;
  if (!rewards.standard.length && !rewards.selectable.length && !rewards.hidden.length) fail("There is nothing to claim here");

  const wanted = sectionId ? sections[sectionId].slots : page.sections.flatMap((id) => sections[id]?.slots ?? []);
  const filled = new Set(slottedItems(session).map((slotted) => slotted.slotId));
  if (!wanted.every((slotId) => filled.has(slotId))) fail("Fill every slot first");

  const tracker = session.profile(page.profile);
  const claimed = tracker.profile.stats.attributes.claimed_page_rewards ?? [];
  const key = `${pageKey}:${sectionId ?? ""}`;
  if (claimed.includes(key)) fail("Already claimed");
  grantRewards(session, rewards, selectedIndex);
  tracker.setStat("claimed_page_rewards", [...claimed, key]);
}
