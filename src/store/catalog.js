import { fortnitemares, isEventActive } from "../events/events.js";
import { candy } from "../events/fortnitemares.js";
import { getCardPack, itemIds } from "../gamedata/items.js";
import { perBuild } from "../gamedata/read.js";
import { itemShopOffers } from "./itemshop.js";

// The llama store. The client's store reads the CardPackStore and CardPackStorePromo storefronts (FortStorefront);
// each offer is FCatalogOffer, its card pack art and featured items coming from metaAssetInfo FortCatalogMeta
// {chaseItems, packDefinition}. A price in MtxCurrency is shown in V-Bucks; a price in GameItem is shown in the account
// item its currencySubType names (UFortStoreContext offer builder sub_2BED310 → sub_2C012B0, a template id lookup).
// What is on sale for V-Bucks and how much is Core's choice: the Upgrade Llama for 50.
//
// Vouchers are how reward llamas work: daily rewards, quests and the mission rewards' Mini Reward Llama
// (ZCP_Voucher_BasicPack, "Claim your free reward llama at the store") give an AccountResource:voucher_* item, which the
// store turns into the llama it names. Voucher_BasicPack is MyTownData's VoucherItemDefinition and buys the Mini Reward
// Llama (CardPack_Basic). The two vouchers rewards hand out always have their offer; any other voucher (founders,
// generic) gets one while the player holds it.
const mtxOffers = [
  { offerId: "core_cardpack_bronze", templateId: "CardPack:cardpack_bronze", title: "Upgrade Llama", currencyType: "MtxCurrency", currencySubType: "", price: 50 }
];
const listedVouchers = ["AccountResource:voucher_basicpack", "AccountResource:voucher_cardpack_bronze"];

// The llama a voucher buys: voucher_<name> → CardPack_<name> or <name> itself (voucher_cardpack_bronze), or the
// CardPack_Generic_<name> loot group; voucher_basicpack → CardPack_Basic.
function voucherPack(voucherId) {
  const name = voucherId.split(":")[1].toLowerCase().slice("voucher_".length);
  const direct = getCardPack(`CardPack:cardpack_${name === "basicpack" ? "basic" : name}`) ?? getCardPack(`CardPack:${name}`);
  if (direct) return direct;
  return itemIds().map((templateId) => getCardPack(templateId))
    .find((pack) => pack?.lootTierGroup.toLowerCase() === `cardpack_${name}`);
}

// The requesting build's vouchers.
const voucherOffers = perBuild(() => itemIds()
  .filter((templateId) => templateId.toLowerCase().startsWith("accountresource:voucher_"))
  .flatMap((voucherId) => {
    const pack = voucherPack(voucherId);
    if (!pack) return [];
    return [{
      offerId: `core_${voucherId.split(":")[1].toLowerCase()}`,
      templateId: pack.templateId,
      title: pack.displayName,
      currencyType: "GameItem",
      currencySubType: voucherId,
      price: 1
    }];
  }));

// Founder's Coins: AccountResource:eventcurrency_founders (EventCurrency_Founders, bIsEventItem; "Can be traded for special
// llamas, only available during Founder's Month!"), 20 from every daily quest and five Twitch quests. The store shows an
// offer priced in an event item with its event packs (StoreRoot ShouldShowOffer → ShowEventPacks, on except while the
// store tutorial's StoreShowOnlyBasic / StoreShowOnlyRewardLlama events hold it) and the Founder's Coins cost widget
// (GetCustomStoreOfferCost → 5). This build has no calendar or event flag service, so Founder's Month was only which
// offers Epic's catalog held; Core keeps the offer always (Core's choice). Which llama and the price are inferred / Core's:
// the Launch Event Llama (CardPack_Event_Founders_NonExclusive), the Founder's Llama's twin (same loot tier group and
// art) that nothing in the game data grants, for 100 coins (five daily quests), with no purchase limit.
//
// The Fortnitemares Llama (CardPack_Event_2017_Halloween, "Guarantees at least one Epic or better limited time
// Fortnitemares Survivor or Hero!") is bought with Candy (EventCurrency_Candy, bIsEventItem, "Candy found during the
// Fortnitemares Event."), while the event runs (events/events.js). The store shows a Candy price with the Candy cost
// widget (1.8 StoreRoot GetCustomStoreOfferCost: EventCurrency_Candy → 2) among the event packs (ShouldShowOffer: an
// event item's offer shows with ShowEventPacks). It cost 500 Candy (the Fortnite wiki's Fortnitemares Llama, Core-Backend
// #66).
const eventOffers = [
  { offerId: "core_event_founders_llama", templateId: "CardPack:cardpack_event_founders_nonexclusive", title: "Launch Event Llama",
    currencyType: "GameItem", currencySubType: "AccountResource:eventcurrency_founders", price: 100, always: true },
  { offerId: "core_event_fortnitemares_llama", templateId: "CardPack:cardpack_event_2017_halloween", title: "Fortnitemares Llama",
    currencyType: "GameItem", currencySubType: candy, price: 500, always: true, event: fortnitemares }
];

// An event's offers are on sale while the requesting build runs the event and has their llama.
const onSale = (offer) => !offer.event || (isEventActive(offer.event) && Boolean(getCardPack(offer.templateId)));

const allOffers = () => [...mtxOffers, ...eventOffers.filter(onSale), ...voucherOffers()];

// An item shop offer has no title: 1.8's offer info then takes the tile's name, the type line under it and the details
// screen's description from the first grant's item definition (UFortDirectAcquisitionOfferInfo GetName 0x2E2A1A0,
// GetShortDescription 0x2E2DCD0, GetDescription 0x2E22CF0: the offer's own Title, ShortDescription and Description
// unless Title is empty, then the definition's virtuals +0x230, +0x2A8 and +0x2B8; in UAthenaCharacterItemDefinition's
// vtable 0x4164888 those are sub_5171C0 (GetDisplayName), sub_68C9C0 (ShortDescription, +0x70; the one
// UFortItemDefinition::execGetShortDescription 0xB04430 calls) and sub_3CDA4C0 (Description, +0x88)). A cosmetic's
// ShortDescription is its type ("Outfit", "Harvesting Tool", "Glider"), which AthenaDirectAcquisitionOfferWidget's
// OfferSet puts in ShortDescriptionText under the name; all three come localized from the game's own text.
function offerJson(offer, sortPriority) {
  const { offerId, templateId, currencyType, currencySubType, price } = offer;
  const title = offer.athena ? "" : offer.title;
  return {
    offerId,
    offerType: "StaticPrice",
    prices: [{ currencyType, currencySubType, regularPrice: price, finalPrice: price, saleType: "NotOnSale",
      saleExpiration: "9999-12-31T23:59:59.999Z" }],
    metaInfo: [],
    dailyLimit: -1,
    weeklyLimit: -1,
    categories: [],
    catalogGroup: "",
    catalogGroupPriority: 0,
    sortPriority,
    title,
    shortDescription: "",
    description: "",
    appStoreId: "",
    metaAssetInfo: { structName: "FortCatalogMeta", payload: { chaseItems: [], packDefinition: offer.athena ? "" : getCardPack(templateId)?.path ?? "" } },
    displayAssetPath: "",
    itemGrants: [{ templateId, quantity: 1 }],
    requirements: [],
    denyItemTemplateIds: []
  };
}

const holds = (profile, templateId) => Object.values(profile?.items ?? {})
  .some((item) => item.templateId.toLowerCase() === templateId.toLowerCase() && item.quantity > 0);

// profile: the viewer's profile0, for the vouchers only shown to players who have one. Battle Royale's storefronts
// (store/itemshop.js) hold the day's offers in 1.8 and later, nothing before.
export function storefronts(profile, now = new Date()) {
  const shown = allOffers().filter((offer) => offer.currencyType !== "GameItem" || offer.always
    || listedVouchers.some((voucher) => voucher.toLowerCase() === offer.currencySubType.toLowerCase())
    || holds(profile, offer.currencySubType));
  const itemShop = Object.entries(itemShopOffers(now))
    .map(([name, offers]) => ({ name, catalogEntries: offers.map((offer, index) => offerJson(offer, -index)) }));
  return [
    { name: "CardPackStore", catalogEntries: shown.map((offer, index) => offerJson(offer, -index)) },
    { name: "CardPackStorePromo", catalogEntries: [] },
    ...itemShop.filter(({ catalogEntries }) => catalogEntries.length)
  ];
}

// An offer on sale now: the llama store's, or one of the item shop's of the day.
export const findOffer = (offerId, now = new Date()) => [...allOffers(), ...Object.values(itemShopOffers(now)).flat()]
  .find((offer) => offer.offerId === offerId);
