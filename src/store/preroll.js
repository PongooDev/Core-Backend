import crypto from "node:crypto";
import { packAtLevel, rollContents, upgradedPack } from "../cardpacks/contents.js";
import { lootEntry } from "../profiles/items.js";
import { prerollOffers } from "./catalog.js";

// X-Ray llamas (7.30+, store/catalog.js prerollOffers): the X-RAY page shows what a llama holds before it is bought.
// The client (8.20 UFortStoreRootBase::PopulatePrerollOffers, 0x34FBED0) takes an offer whose metaInfo "Preroll" is true
// as an X-Ray offer and looks for its UFortPrerollDataItem (EFortItemType::PrerollData) in the campaign profile, the one
// whose OfferId is the offer's. When one is missing or past its Expiration it sends PopulatePrerolledOffers and reads the
// profile again. The tile shows the item's Items (FMcpLootEntry) and plays its silver or gold upgrade from
// Highest_Rarity (StoreOffer_2's ShowRarity / UpgradeRarity: 1 silver, 2 gold).
//
// Epic's service rolled the preview and gave exactly it when the llama was bought. Here the llama is rolled the way an
// opened one is (cardpacks/contents.js: its silver or gold upgrade, then its contents), and buying it gives that roll's
// items at once: the client's purchase handler (FortStorefront, 8.20 0x32D8310) takes a "Preroll" offer's lootResult
// as the rewards it shows, and only a non-Preroll offer's card packs go on to OpenCardPack (Core-Backend #413). Both offers of one llama (V-Bucks and token) show the
// same roll, each in its own item whose linked_offer names the other, and buying either rolls the next one for both.
// "Your X-Ray Llamas refresh daily" (Epic): a roll expires at the next 00:00 UTC (🟡 the hour is Core's).
export const prerollTemplate = "PrerollData:preroll_basic";

const sameId = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const isPreroll = (item) => sameId(item.templateId, prerollTemplate);
export const nextRefresh = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

// The offers that share one roll: those of the same llama.
const groupOf = (offer) => prerollOffers().filter((other) => sameId(other.templateId, offer.templateId));

function rollPreview(templateId) {
  const pack = upgradedPack(templateId);
  const items = rollContents(pack.templateId).map(({ templateId: itemType, quantity }) => ({
    ...lootEntry({ templateId: itemType, itemId: crypto.randomUUID(), profileId: "profile0", quantity }), attributes: {}
  }));
  return { items, level: pack.displayRarityLevel ?? 0 };
}

const prerollsOf = (tracker, offerId) => Object.entries(tracker.profile.items)
  .filter(([, item]) => isPreroll(item) && sameId(item.attributes?.offerId, offerId));

// The offer's roll, while it hasn't expired: {itemId, items, level}.
export function currentPreroll(tracker, offerId, now = new Date()) {
  const [itemId, item] = prerollsOf(tracker, offerId)[0] ?? [];
  if (!item || !(Date.parse(item.attributes.expiration) > now.getTime()) || !item.attributes.items?.length) return undefined;
  return { itemId, items: item.attributes.items, level: item.attributes.highest_rarity ?? 0 };
}

function rollGroup(tracker, group, now) {
  for (const offer of group) for (const [itemId] of prerollsOf(tracker, offer.offerId)) tracker.removeItem(itemId);
  const { items, level } = rollPreview(group[0].templateId);
  if (!items.length) return;
  const expiration = nextRefresh(now).toISOString();
  for (const offer of group) {
    const linked = group.find((other) => other !== offer);
    tracker.addItem(crypto.randomUUID(), {
      templateId: prerollTemplate,
      attributes: { offerId: offer.offerId, fulfillmentId: "", expiration, items, expended_streakbreakers: {}, linked_offer: linked?.offerId ?? "",
        static_streakbreaker_refund_multiplier: 0, item_seen: false, highest_rarity: level },
      quantity: 1
    });
  }
}

// PopulatePrerolledOffers: every X-Ray offer on sale gets a roll (a group with any offer missing or expired is rolled
// again as a whole), and rolls of offers no longer sold are removed.
export function populatePrerolledOffers(tracker, now = new Date()) {
  const offers = prerollOffers();
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (isPreroll(item) && !offers.some((offer) => sameId(offer.offerId, item.attributes?.offerId))) tracker.removeItem(itemId);
  }
  const done = new Set();
  for (const offer of offers) {
    if (done.has(offer.offerId)) continue;
    const group = groupOf(offer);
    group.forEach((member) => done.add(member.offerId));
    if (group.some((member) => !currentPreroll(tracker, member.offerId, now))) rollGroup(tracker, group, now);
  }
}

// Buying an X-Ray offer: the items its roll shows, [{templateId, quantity}], and the next roll for its llama. Undefined
// when the offer has no current roll (the client then populates again).
export function takePreroll(tracker, offer, now = new Date()) {
  const preroll = currentPreroll(tracker, offer.offerId, now);
  if (!preroll) return undefined;
  rollGroup(tracker, groupOf(offer), now);
  return preroll.items.map(({ itemType, quantity }) => ({ templateId: itemType, quantity }));
}

// A card pack bought as an X-Ray llama before Core-Backend #413 holds its roll as attributes.prerolled: what it holds and
// the llama it turned into, for OpenCardPack.
export function prerolledContents(pack) {
  const prerolled = pack.attributes?.prerolled;
  if (!prerolled?.items?.length) return undefined;
  return { info: packAtLevel(pack.templateId, prerolled.level), contents: prerolled.items };
}
