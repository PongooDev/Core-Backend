import { anyBattlePassOffer, battlePassOffers } from "../battlepass/season2.js";
import { currentBuild } from "../builds/context.js";
import { currentEventsConfig, fortnitemares, isEventActive, mutantStorms, mutantStorms2018, winter2017 } from "../events/events.js";
import { candy } from "../events/fortnitemares.js";
import { stormLlama2018, stormTickets } from "../events/mutantstorms.js";
import { holidayLlama, snowflakeTickets } from "../events/winter2017.js";
import { getCardPack, itemIds } from "../gamedata/items.js";
import { perBuild } from "../gamedata/read.js";
import { eventStoreOffers } from "./eventstore.js";
import { itemShopOffers } from "./itemshop.js";
import { seasonShopOffers, seasonStorefront } from "./seasonshop.js";

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
//
// 1.10 (CL-3790078): "Multiple-in-one Upgrade Llamas now sell 25% off!" From 1.10 the store also has ten Upgrade Llamas in
// one offer (one grant of 10, FCatalogItemGrant Quantity) for 375 V-Bucks, a quarter off ten singles. 🟡 Epic's
// multi-llama offers were in its catalog, not the paks; the size of Core's is its choice. 2.4's notes take four of Epic's
// out of the store ("Removed a few llamas from the store rotation: Double Llama, Fiver Llama, Six Pack Llama, Niner
// Llama"; their CardPack_Bronze_02x/05x/06x/09x are still in 2.4's data): Core never sold them, so nothing changes.
const mtxOffers = [
  { offerId: "core_cardpack_bronze", templateId: "CardPack:cardpack_bronze", title: "Upgrade Llama", currencyType: "MtxCurrency", currencySubType: "", price: 50 },
  { offerId: "core_cardpack_bronze_x10", templateId: "CardPack:cardpack_bronze", quantity: 10, title: "10 Upgrade Llamas", currencyType: "MtxCurrency",
    currencySubType: "", price: 375, firstBuild: 3790078 }
];
const inThisBuild = (offer) => !offer.firstBuild || Number(currentBuild()) >= offer.firstBuild;
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
//
// The Vindertech Llama (CardPack_Event_Vindertech, "Guarantees at least one Epic or better limited time Vindertech
// weapon!") is bought with Storm Tickets (EventCurrency_StormZone, bIsEventItem, "Can be traded for special llamas"),
// which the Mutant Storms' storm alerts give (world/theaters.js), while they run (1.9.1, events/events.js). 1.9.1's
// StoreRoot has no Storm Ticket case in GetCustomStoreOfferCost (Voucher_BasicPack 1, Candy 2, Snowballs 4, Founders 5),
// so the offer takes its default cost widget, 3, and shows among the event packs (ShouldShowOffer: an event item's
// price → ShowEventPacks). No shipped data prices it; Core's price is 1,000 Storm Tickets (🟡: a few Twine Peaks storms,
// ten Stonewood ones).
//
// The Holiday Survival Llama (CardPack_Event_2017_Winter, "Guarantees at least one Epic or better limited time Vacuum
// Tube weapon or Hero!") is bought with Snowflake Tickets (EventCurrency_Snowballs, bIsEventItem), which Survive the
// Holidays' Mini-Boss alerts and quests give, while it runs (1.11, events/winter2017.js): "Holiday Survival Llamas are
// available for purchase (1000 Snowflake Tickets.)" StoreRoot's GetCustomStoreOfferCost has had a Snowballs cost widget
// (4) since 1.9.1, so the offer shows that price among the event packs.
//
// The Storm Llama (CardPack_Event_FirstStorm, "Guarantees at least one Epic or better limited time Hydraulic weapon or
// Hero!") is bought with Storm Tickets while 2.3's storms run (events/mutantstorms.js mutantStorms2018): "Hydraulic
// Weapons and Storm Zone Heroes have returned, and are available in the Storm Llamas." At the Vindertech Llama's 1,000
// Storm Tickets (🟡), with the same default cost widget.
const eventOffers = [
  { offerId: "core_event_founders_llama", templateId: "CardPack:cardpack_event_founders_nonexclusive", title: "Launch Event Llama",
    currencyType: "GameItem", currencySubType: "AccountResource:eventcurrency_founders", price: 100, always: true },
  { offerId: "core_event_fortnitemares_llama", templateId: "CardPack:cardpack_event_2017_halloween", title: "Fortnitemares Llama",
    currencyType: "GameItem", currencySubType: candy, price: 500, always: true, event: fortnitemares },
  { offerId: "core_event_vindertech_llama", templateId: "CardPack:cardpack_event_vindertech", title: "Vindertech Llama",
    currencyType: "GameItem", currencySubType: stormTickets, price: 1000, always: true, event: mutantStorms },
  { offerId: "core_event_winter_llama", templateId: holidayLlama, title: "Holiday Survival Llama",
    currencyType: "GameItem", currencySubType: snowflakeTickets, price: 1000, always: true, event: winter2017 },
  { offerId: "core_event_storm_llama", templateId: stormLlama2018, title: "Storm Llama",
    currencyType: "GameItem", currencySubType: stormTickets, price: 1000, always: true, event: mutantStorms2018 }
];

// An event's offers are on sale while the requesting build runs the event and has their llama.
const onSale = (offer) => !offer.event || (isEventActive(offer.event) && Boolean(getCardPack(offer.templateId)));

const allOffers = () => {
  const customCandy = currentEventsConfig()?.candyPerLlama ?? 500;
  const customSnowflake = currentEventsConfig()?.snowflakePerLlama ?? 1000;
  return [
    ...mtxOffers.filter(inThisBuild),
    ...eventOffers.filter(onSale).map((offer) => {
      if (offer.offerId === "core_event_fortnitemares_llama") return { ...offer, price: customCandy };
      if (offer.offerId === "core_event_winter_llama") return { ...offer, price: customSnowflake };
      return offer;
    }),
    ...voucherOffers()
  ];
};

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
  const title = offer.athena || offer.stwEventStore ? "" : offer.title;
  return {
    offerId,
    // A Battle Pass offer's (battlepass/season2.js), as Epic's catalog named its offers.
    ...(offer.devName ? { devName: offer.devName } : {}),
    offerType: "StaticPrice",
    // An offer with a regularPrice above its price shows it struck through (the Battle Pass's 1,800, Epic's PercentOff).
    prices: [{ currencyType, currencySubType, regularPrice: offer.regularPrice ?? price, finalPrice: price,
      saleType: (offer.regularPrice ?? price) > price ? "PercentOff" : "NotOnSale", saleExpiration: "9999-12-31T23:59:59.999Z" }],
    // A Season Shop offer's season level (store/seasonshop.js); an Event Store offer's purchase limit and the tracker
    // that counts it (store/eventstore.js).
    metaInfo: offer.seasonLevel ? [{ key: "season_level", value: String(offer.seasonLevel) }]
      : offer.eventLimit ? [{ key: "EventLimit", value: String(offer.eventLimit) }, { key: "PurchaseLimitingEventId", value: offer.purchaseLimitingEventId }]
        : [],
    dailyLimit: -1,
    weeklyLimit: -1,
    categories: [],
    catalogGroup: "",
    catalogGroupPriority: 0,
    sortPriority,
    title,
    shortDescription: offer.shortDescription ?? "",
    description: offer.description ?? "",
    appStoreId: "",
    metaAssetInfo: { structName: "FortCatalogMeta", payload: { chaseItems: [], packDefinition: offer.athena || offer.battlePass ? "" : getCardPack(templateId)?.path ?? "" } },
    displayAssetPath: offer.displayAssetPath ?? "",
    itemGrants: offer.itemGrants ?? [{ templateId, quantity: offer.quantity ?? 1 }],
    requirements: [],
    denyItemTemplateIds: []
  };
}

const holds = (profile, templateId) => Object.values(profile?.items ?? {})
  .some((item) => item.templateId.toLowerCase() === templateId.toLowerCase() && item.quantity > 0);

// profile: the viewer's profile0, for the vouchers only shown to players who have one. Battle Royale's storefronts
// (store/itemshop.js) hold the day's offers in 1.8 and later, nothing before; its Season Shop (store/seasonshop.js) is
// 1.8.2's and later. Save the World's Event Store (store/eventstore.js) is 1.11's, while Survive the Holidays runs (and 2.3's to 2.4.2's storms). The
// Battle Pass's storefront (battlepass/season2.js) is 1.11's; athena, the viewer's athena profile, leaves out a pass
// they own.
export function storefronts(profile, now = new Date(), { athena } = {}) {
  const shown = allOffers().filter((offer) => offer.currencyType !== "GameItem" || offer.always
    || listedVouchers.some((voucher) => voucher.toLowerCase() === offer.currencySubType.toLowerCase())
    || holds(profile, offer.currencySubType));
  const itemShop = Object.entries(itemShopOffers(now))
    .map(([name, offers]) => ({ name, catalogEntries: offers.map((offer, index) => offerJson(offer, -index)) }));
  const seasonShop = { name: seasonStorefront, catalogEntries: seasonShopOffers().map((offer, index) => offerJson(offer, -index)) };
  const eventStore = Object.entries(eventStoreOffers(now))
    .map(([name, offers]) => ({ name, catalogEntries: offers.map((offer, index) => offerJson(offer, -index)) }));
  const passOffers = battlePassOffers({ ownsPass: athena?.stats.attributes.book_purchased === true });
  const battlePass = passOffers.length ? [{ name: passOffers[0].storefront, catalogEntries: passOffers.map((offer, index) => offerJson(offer, -index)) }] : [];
  return [
    { name: "CardPackStore", catalogEntries: shown.map((offer, index) => offerJson(offer, -index)) },
    { name: "CardPackStorePromo", catalogEntries: [] },
    ...[...itemShop, seasonShop, ...eventStore, ...battlePass].filter(({ catalogEntries }) => catalogEntries.length)
  ];
}

// An offer on sale now: the llama store's, one of the item shop's of the day, the Season Shop's, the Event Store's or the
// Battle Pass's.
export const findOffer = (offerId, now = new Date()) => [...allOffers(), ...Object.values(itemShopOffers(now)).flat(), ...seasonShopOffers(),
  ...Object.values(eventStoreOffers(now)).flat()].find((offer) => offer.offerId === offerId) ?? anyBattlePassOffer(offerId);
