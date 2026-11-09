import { McpError } from "../errors.js";
import { getItem } from "../gamedata/items.js";
import { isMtxCurrency, lootEntry, spendMtx } from "../profiles/items.js";
import { grant, itemEvent, refreshHeldItems } from "../profiles/progress.js";
import { itemRating } from "../profiles/rating.js";
import { hasUnlocked } from "../profiles/unlocks.js";
import { pay, recyclingRefunds } from "../profiles/upgrades.js";
import { bookData, findPageItem, isUnlocked, pageId, refreshPage, slotFor, slottedItems } from "./pages.js";

export { bookProfiles, isBookPage } from "./pages.js";

// The book's XP is what the client works out (UFortCollectionBookManager::CalculateBookXp sub_466FC0; 2.4's
// sub_4F3710): for every page it has a page item for, for every section, the rounded sum of its slots' XP, each
//   ConstantWeight + level x ItemLevelWeight + RarityFactor(rarity) x RarityWeight + rating x ItemRatingWeight
// (FortCollectionBookSlotData.cpp, 2.4's sub_5292E0). Its level is the higher of the XP's level and profile0's
// collection_book.maxBookXpLevelAchieved (sub_4671F0); levels (CollectionBookXPLevelData) are claimed one at a time.
//
// The rarity is the item definition's GetRarity (UFortItem::GetRarity, 2.4's sub_6C3F40 → vtable +0x280): the
// definition's Rarity (UFortItemDefinition::GetRarity sub_6C3F70), and for a schematic its result item's
// (UFortSchematicItemDefinition::GetRarity sub_6C3FC0 → GetResultWorldItemDefinition). The template's rarity token is
// not it: lead survivors are a rarity above theirs (managerdoctor_sr is Elegant, workerbasic_sr Fine) and mythic
// heroes are Elegant, so reading the token gave them too little XP. The client then offered a level the backend
// refused ("The book has X of Y XP", Core-Backend #194).
const rarityNames = ["Handmade", "Ordinary", "Sturdy", "Quality", "Fine", "Elegant", "Masterwork", "Epic", "Badass", "Legendary"];
const rarityTokens = ["c", "uc", "r", "vr", "sr"];
const tokenRarity = (templateId) => {
  const tokens = templateId.split(":")[1].toLowerCase().split("_");
  const rarity = [...tokens].reverse().find((token) => rarityTokens.includes(token));
  return rarity ? rarityTokens.indexOf(rarity) : 0;
};
const definitionRarity = (definition) => rarityNames.indexOf(definition?.rarity ?? "");

// 🟡 The game data holds no schematic's Result, so its result is found by name (sid_X crafts wid_X or tid_X), and a
// schematic whose result isn't found takes its token's rarity, which every result found by name shares.
function rarityIndex(templateId) {
  const definition = getItem(templateId);
  if (definition?.class === "FortSchematicItemDefinition") {
    const name = templateId.split(":")[1].replace(/^sid_/i, "");
    const result = getItem(`Weapon:wid_${name}`) ?? getItem(`Trap:tid_${name}`);
    return result && definitionRarity(result) >= 0 ? definitionRarity(result) : tokenRarity(templateId);
  }
  return definitionRarity(definition) >= 0 ? definitionRarity(definition) : tokenRarity(templateId);
}

const fail = (message) => {
  throw new McpError("errors.com.epicgames.fortnite.collection_book_slot_failed", message);
};

export function slotXp(item) {
  const { weights, slots, rarityFactor } = bookData();
  const weight = weights[slots[slotFor(item)]?.weight] ?? weights.Default;
  if (!weight) return 0;
  return weight.constant + (item.attributes.level ?? 1) * weight.level
    + (rarityFactor[Math.min(rarityIndex(item.templateId), rarityFactor.length - 1)] ?? 0) * weight.rarity
    + itemRating(item) * weight.rating;
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

// 4.5's (Update v4.50, CL 4159770 and CL 4166199) two book commands, UFortMcpProfileCampaign's UnslotItemFromCollectionBook
// and ResearchItemFromCollectionBook, which UFortCollectionBookManager's UnSlotItem (4.5 sub_BCC100) and PurchaseItem send.
// Their costs are the book data's (CollectionBook/Data/CollectionBookData UnslotCost; each slot's PurchaseCosts row of
// CollectionBookRecipes), so a build before 4.5, whose data has neither, refuses both.

// The V-Bucks of a cost list are paid from any kind (CollectionBookUnslotPanel counts MtxComplimentary, MtxGiveaway,
// MtxPurchaseBonus and MtxPurchased alike, the player's MtxBalance), the rest from their stacks. Nothing is taken unless
// everything is there.
function payCosts(account, costs) {
  const mtx = costs.filter(({ templateId }) => isMtxCurrency(templateId)).reduce((sum, { quantity }) => sum + quantity, 0);
  const held = Object.values(account.profile.items).filter((item) => isMtxCurrency(item.templateId)).reduce((sum, item) => sum + item.quantity, 0);
  if (held < mtx) throw new McpError("errors.com.epicgames.currency.mtx.insufficient", `This costs ${mtx} V-Bucks and you have ${held}`);
  pay(account, costs.filter(({ templateId }) => !isMtxCurrency(templateId)));
  if (mtx) spendMtx(account, mtx);
}

// UnslotItemFromCollectionBook {itemId, specific, templateId}: "Items can now be unslotted from the Collection Book at a
// cost of 20 V-Bucks. This will return the same item that you slotted, with the same level and perks" (Update v4.50's
// notes). The item moves back from its page profile into the account, id and attributes kept, for the book's UnslotCost.
// Its XP leaves the book (bookXp counts slotted items only) but the level stays: bookLevel is the higher of the XP's
// level and profile0's collection_book.maxBookXpLevelAchieved, and claimBookLevel wants the next level's whole XP, so
// "this XP debt will have to be paid back before you can continue to advance the Collection Book's level". Rewards
// already claimed stay claimed; a page or section that was Completed but not Claimed is Active again. The reply's
// primary notification is FFortCollectionBookUnslotItemNotification {unslottedItemId} ("collectionBookUnslotItem"),
// which the completion (4.5 sub_BB4CC0) reads to find the item in the campaign profile.
export function unslotItem(session, itemId, templateId, notifications = []) {
  const cost = bookData().unslotCost;
  if (!cost.length) fail("This build's collection book can't unslot items");
  const slotted = typeof itemId === "string" && [...slottedItems(session).values()].find((entry) => entry.itemId === itemId);
  if (!slotted) fail(`No slotted item ${itemId}`);
  if (templateId && String(templateId).toLowerCase() !== slotted.item.templateId.toLowerCase()) fail(`${itemId} is ${slotted.item.templateId}, not ${templateId}`);
  const account = session.profile("profile0");
  payCosts(account, cost);
  session.profile(slotted.profileId).removeItem(itemId);
  account.addItem(itemId, { templateId: slotted.item.templateId, attributes: { ...slotted.item.attributes, item_seen: 0 }, quantity: 1 });
  refreshPage(session, bookData().pageOfSlot.get(slotted.slotId));
  refreshHeldItems(session);
  notifications.push({ type: "collectionBookUnslotItem", primary: true, unslottedItemId: itemId });
}

// ResearchItemFromCollectionBook {templateId}: "Heroes, Trap Schematics, and Weapon Schematics can now be acquired directly
// from the Collection Book through Recruitment and Research ... This can be an item you do not have yet, or one that you
// have already collected ... Event Items, Survivors, and Defenders CANNOT be obtained using this feature. This costs Flux,
// and either Training Manuals, Weapon Designs, or Trap Designs. The resulting item will be level 1, and schematics will
// have randomized perks." The item is one of a slot's AllowedItems whose PurchaseCosts names a CollectionBookRecipes row
// (Creation.CollectionBook.<Hero|Weapon|Trap>.<rarity>: Reagent_People, _Weapons or _Traps, and from rare up the rarity's
// Reagent_EvolveRarity flux); survivors', defenders' and the event pages' slots name none. The slot's page must be
// unlocked (the book shows no other). The new item comes as any grant does (level 1, a schematic's perks rolled:
// profiles/items.js). The reply's primary notification is FFortCollectionBookResearchItemNotification {researchedItemId,
// researchedTemplateId} ("collectionBookResearchedItem"): the completion (4.5 sub_BB45E0) looks the item up only when the
// template is the one it asked for, character for character, so the request's own string is sent back.
export function researchItem(session, templateId, notifications = []) {
  if (typeof templateId !== "string" || !templateId) fail("No item to research");
  const { slotsOf, slots, recipes, pageOfSlot } = bookData();
  const slotId = (slotsOf.get(templateId.toLowerCase()) ?? []).find((id) => slots[id].purchase && recipes[slots[id].purchase]);
  if (!slotId) fail(`${templateId} can't be researched or recruited from the collection book`);
  const page = pageOfSlot.get(slotId);
  if (!page || !isUnlocked(session, page)) fail(`The ${page ?? slotId} page isn't unlocked`);
  const recipe = recipes[slots[slotId].purchase];
  const account = session.profile("profile0");
  if (!hasUnlocked(account.profile, recipe.catalysts)) fail(`Unlock ${recipe.catalysts.join(", ")} first`);
  payCosts(account, recipe.costs);
  const canonical = slots[slotId].items.find((id) => id.toLowerCase() === templateId.toLowerCase());
  const [granted] = grant(session, canonical, 1);
  if (!granted) fail(`${templateId} has no item data`);
  notifications.push({ type: "collectionBookResearchedItem", primary: true, researchedItemId: granted.itemId, researchedTemplateId: templateId });
}
