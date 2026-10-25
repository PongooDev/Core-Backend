import { getCardPack, itemIds } from "../gamedata/items.js";

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

const voucherOffers = itemIds()
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
  });

// Founder's Coins: AccountResource:eventcurrency_founders (EventCurrency_Founders, bIsEventItem; "Can be traded for special
// llamas, only available during Founder's Month!"), 20 from every daily quest and five Twitch quests. The store shows an
// offer priced in an event item with its event packs (StoreRoot ShouldShowOffer → ShowEventPacks, on except while the
// store tutorial's StoreShowOnlyBasic / StoreShowOnlyRewardLlama events hold it) and the Founder's Coins cost widget
// (GetCustomStoreOfferCost → 5). This build has no calendar or event flag service, so Founder's Month was only which
// offers Epic's catalog held; Core keeps the offer always (Core's choice). Which llama and the price are inferred / Core's:
// the Launch Event Llama (CardPack_Event_Founders_NonExclusive), the Founder's Llama's twin (same loot tier group and
// art) that nothing in the game data grants, for 100 coins (five daily quests), with no purchase limit.
const eventOffers = [
  { offerId: "core_event_founders_llama", templateId: "CardPack:cardpack_event_founders_nonexclusive", title: "Launch Event Llama",
    currencyType: "GameItem", currencySubType: "AccountResource:eventcurrency_founders", price: 100, always: true }
];

const allOffers = [...mtxOffers, ...eventOffers, ...voucherOffers];

function offerJson(offer, sortPriority) {
  const { offerId, templateId, title, currencyType, currencySubType, price } = offer;
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
    metaAssetInfo: { structName: "FortCatalogMeta", payload: { chaseItems: [], packDefinition: getCardPack(templateId)?.path ?? "" } },
    displayAssetPath: "",
    itemGrants: [{ templateId, quantity: 1 }],
    requirements: [],
    denyItemTemplateIds: []
  };
}

const holds = (profile, templateId) => Object.values(profile?.items ?? {})
  .some((item) => item.templateId.toLowerCase() === templateId.toLowerCase() && item.quantity > 0);

// profile: the viewer's profile0, for the vouchers only shown to players who have one.
export function storefronts(profile) {
  const shown = allOffers.filter((offer) => offer.currencyType !== "GameItem" || offer.always
    || listedVouchers.some((voucher) => voucher.toLowerCase() === offer.currencySubType.toLowerCase())
    || holds(profile, offer.currencySubType));
  return [
    { name: "CardPackStore", catalogEntries: shown.map((offer, index) => offerJson(offer, -index)) },
    { name: "CardPackStorePromo", catalogEntries: [] }
  ];
}

export const findOffer = (offerId) => allOffers.find((offer) => offer.offerId === offerId);
