import crypto from "node:crypto";
import { perBuild } from "../gamedata/read.js";

// The collection book's layout (CollectionBook/Data/CollectionBookData) and its pages as the client reads them.
//
// The client builds the book from the page items in the two book profiles, not from profile0: UFortCollectionBookManager
// (sub_4706C0) lists every UFortCollectionBookPage item of collection_book_people0 / collection_book_schematics0, and a
// page row (CollectionBookPages) only gets a page object, its category entry and its XP when its profile holds exactly
// one item CollectionBookPage:<row> (sub_478D70). A page item's attributes are UFortCollectionBookPage's: sectionStates
// (FFortCollectionBookSectionState {section, state}) and state (EFortCollectionBookState Active, Completed, Claimed),
// read by name (ProcessAttributeChange sub_483940); a section with no entry is Active (sub_4795B0).
// A slot's item is the page profile's item whose template is one of the slot's AllowedItems and, for survivors, whose
// personality is one of the slot's AllowedWorkerPersonalities (sub_472B20).
export const bookData = perBuild((read) => {
  const { pages = {}, sections = {}, slots = {}, weights = {}, rarityFactor = [], levels = [] } = read("collectionbook", {});
  const slotsOf = new Map();
  for (const [slotId, slot] of Object.entries(slots)) {
    for (const templateId of slot.items) {
      const key = templateId.toLowerCase();
      if (!slotsOf.has(key)) slotsOf.set(key, []);
      slotsOf.get(key).push(slotId);
    }
  }
  const pageOfSlot = new Map();
  const sectionOfSlot = new Map();
  for (const [id, page] of Object.entries(pages)) {
    for (const sectionId of page.sections) {
      for (const slotId of sections[sectionId]?.slots ?? []) {
        pageOfSlot.set(slotId, id);
        sectionOfSlot.set(slotId, sectionId);
      }
    }
  }
  return {
    pages, sections, slots, weights, rarityFactor, levels, slotsOf, pageOfSlot, sectionOfSlot,
    bookProfiles: [...new Set(Object.values(pages).map((page) => page.profile))],
    pageIds: new Map(Object.keys(pages).map((id) => [id.toLowerCase(), id]))
  };
});

export const bookProfiles = () => bookData().bookProfiles;

export const pageId = (name) => bookData().pageIds.get(String(name ?? "").replace(/^CollectionBookPage:/i, "").toLowerCase());
export const isBookPage = (name) => Boolean(pageId(name));
export const pageTemplateId = (id) => `CollectionBookPage:${id}`;
const isPageItem = (item) => item.templateId.toLowerCase().startsWith("collectionbookpage:");

// The slot an item goes in: the first whose allowed items hold its template and whose personalities, if it has any,
// hold the survivor's.
export function slotFor(item) {
  const { slotsOf, slots } = bookData();
  return (slotsOf.get(item.templateId.toLowerCase()) ?? []).find((slotId) => {
    const personalities = slots[slotId].personalities ?? [];
    return !personalities.length || personalities.some((tag) => tag.toLowerCase() === String(item.attributes?.personality ?? "").toLowerCase());
  });
}

export function findPageItem(tracker, id) {
  const templateId = pageTemplateId(id).toLowerCase();
  return Object.entries(tracker.profile.items).find(([, item]) => item.templateId.toLowerCase() === templateId)?.[0];
}

// The slotted items of every book profile, by slot.
export function slottedItems(session) {
  const filled = new Map();
  for (const profileId of bookProfiles()) {
    for (const [itemId, item] of Object.entries(session.profile(profileId).profile.items)) {
      if (isPageItem(item)) continue;
      const slotId = slotFor(item);
      if (slotId && !filled.has(slotId)) filled.set(slotId, { itemId, item, profileId, slotId });
    }
  }
  return filled;
}

// 🟡 Core's rule (the states Epic's MCP wrote aren't seen): a section is Completed once every slot is filled and a page
// once every section is; Claimed (a page or section reward claimed) stays.
export function refreshPage(session, id, filled = slottedItems(session)) {
  const page = bookData().pages[id];
  const tracker = session.profile(page.profile);
  const itemId = findPageItem(tracker, id);
  if (!itemId) return;
  const { attributes } = tracker.profile.items[itemId];
  const before = Array.isArray(attributes.sectionStates) ? attributes.sectionStates : [];
  const stateOf = (sectionId) => before.find((entry) => String(entry.section).toLowerCase() === sectionId.toLowerCase())?.state ?? "Active";

  const sectionStates = page.sections.flatMap((sectionId) => {
    const state = stateOf(sectionId) === "Claimed" ? "Claimed"
      : (bookData().sections[sectionId]?.slots ?? []).every((slotId) => filled.has(slotId)) ? "Completed" : "Active";
    return state === "Active" ? [] : [{ section: sectionId, state }];
  });
  const complete = sectionStates.length === page.sections.length;
  const state = attributes.state === "Claimed" ? "Claimed" : complete ? "Completed" : "Active";

  if (JSON.stringify(sectionStates) !== JSON.stringify(before)) tracker.setItemAttribute(itemId, "sectionStates", sectionStates);
  if (state !== attributes.state) tracker.setItemAttribute(itemId, "state", state);
}

// A CollectionBookPage grant (homebaseonboarding's hidden rewards unlock every page): the page joins profile0's
// collection_book.pages and gets its page item in its book profile.
export function unlockPage(session, name) {
  const id = pageId(name);
  if (!id) return false;
  const account = session.profile("profile0");
  const book = account.profile.stats.attributes.collection_book ?? { pages: [], maxBookXpLevelAchieved: 0 };
  if (!book.pages.some((known) => known.toLowerCase() === id.toLowerCase())) account.setStat("collection_book", { ...book, pages: [...book.pages, id] });
  addPageItem(session, id);
  return true;
}

export function addPageItem(session, id) {
  const tracker = session.profile(bookData().pages[id].profile);
  if (findPageItem(tracker, id)) return;
  tracker.addItem(crypto.randomUUID(), { templateId: pageTemplateId(id), attributes: { sectionStates: [], state: "Active" }, quantity: 1 });
  refreshPage(session, id);
}

export const isUnlocked = (session, id) => Boolean(findPageItem(session.profile(bookData().pages[id].profile), id));
