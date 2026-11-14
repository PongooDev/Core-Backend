import crypto from "node:crypto";
import { currentBuild, inBuild } from "../builds/context.js";
import { grantCosmetic, lockerCosmeticId } from "../profiles/athena.js";
import { foundersEditionOf, foundersEditions, setFoundersEdition } from "../profiles/founders.js";
import { grantItem } from "../profiles/items.js";
import { buildOfSeason, namesAthenaBuild, seasonNumber } from "../profiles/seasons.js";
import { seasonMoment } from "./itemshop.js";

// The Store tab's V-Bucks packs (Core-Backend #223): Epic's four real-money packs, which a player "buys" in a simulated
// purchase that gives the pack's V-Bucks for nothing. From 1.8 the lobby's Store tab is StoreMain_Root
// (UFortMtxStoreRootBase), whose StorefrontNames are ["FoundersPack", "CurrencyStorefront"] (2.5's and 3.1's alike).
// UFortMcpContext::ListMtxPackages (3.1 0xD39180) freshens the catalog and makes an FMtxPackage of each offer of those
// storefronts (0xD3E4F0): its Title and Description are the offer's, its TotalAmount and BonusAmount the offer's
// metaInfo MtxQuantity and MtxBonus, its DisplayAssetPath the offer's (DA_MtxPack<total>, a FortMtxOfferData of the
// pack's art), and its Price the price the catalog service gives the offer's app store id. The details screen
// (StoreMain_OfferDetails) shows "2,500 + 300 BONUS" from those amounts, as the reporter's screenshot of Epic's has it.
//
// Every offer priced in RealMoney goes to the purchasing service by its AppStoreId[EpicPurchasingService] (EAppStore 1,
// FCatalogOffer +0x108): the catalog refresh (0x7CEA60) gathers them and asks the catalog service for them
// (IOnlineStoreV2::QueryOffersById: GET <catalog>/api/shared/bulk/offers?id=..&returnItemDetails=false, 0x3C2A80),
// whose answer, an object of offers by id ({id, title, description, currencyCode, price, basePrice, ...}, 0x3E4AC0 and
// 0x3E5D20), prices them (services/fortnite/purchase.js). Buying one (StoreMain_OfferDetails' purchase button:
// PurchaseRealMoneyCatalogEntry, 0xD43700 -> 0x7CC900) checks out through the purchase flow (the PurchaseFlow plugin,
// 0x6A6880): an in-game browser opens [EpicPurchaseFlow] <environment>= of the game config, the Prod one, with
// "?showNavigation=true&namespace=fn&offers=<app store id>&analyticsSessionId=.." after it (0x6A2790), and the page's
// window.ue.purchaseflow.receipt({TransactionState, TransactionId, Offers}) (UPurchaseFlowJSBridge RECEIPT) completes
// the purchase. The client then sends the receipt to MCP (VerifyRealMoneyPurchase).
//
// The app store id is the pack and the account it was offered to, signed by this backend: the purchase page knows the
// buyer from it, as the client gives the page no other way that works on Core's plain-HTTP backends (the purchase flow
// sets its access token as a Secure EPIC_BEARER_TOKEN cookie, which a page over HTTP never gets; one that does is
// checked against it, services/fortnite/purchase.js). The key is made at start-up, so a catalog older than this run of
// the backend no longer buys (the Store tab refreshes it each time it opens).
//
// Each pack gives its V-Bucks as Epic's did: the base amount as Currency:MtxPurchased, the bonus as
// Currency:MtxPurchaseBonus. Prices are Epic's in US dollars (cents), from the screenshot. More real-money offers (the
// Starter Packs) are entries of the same list, with their own grants.
//
// The Battle Royale Starter Pack (Core-Backend #248) is Season 3's: the Rogue Agent outfit (CID_090_Athena_Commando_M_Tactical)
// and the Catalyst back bling (BID_030_TacticalRogue) with 600 V-Bucks (500 + 100 bonus) for $4.99, one per account. It is
// offered only on a Season 3 build whose cosmetics have both (3.1 on: 3.0's paks lack them), through the same purchase flow.
// Its art is the Rogue Agent's featured display asset (no starter pack display asset is in the paks). Its cosmetics go to
// the athena profile, its V-Bucks to profile0 (common_core on 3.5.1) like the packs'.
export const currencyStorefront = "CurrencyStorefront";
const firstBuild = 3724489;
const displayAsset = (name) => `/Game/Catalog/DisplayAssets/${name}.${name}`;
const pack = (total, bonus, price) => ({
  offerId: `core_mtx_${total}`,
  title: bonus ? `Fortnite - ${(total - bonus).toLocaleString("en-US")} (+${bonus.toLocaleString("en-US")} Bonus) V-Bucks`
    : `Fortnite - ${total.toLocaleString("en-US")} V-Bucks`,
  description: `${total.toLocaleString("en-US")} V-Bucks`,
  price,
  currencyCode: "USD",
  displayAssetPath: displayAsset(`DA_MtxPack${total}`),
  metaInfo: { MtxQuantity: String(total), MtxBonus: String(bonus) },
  grants: [{ templateId: "Currency:MtxPurchased", quantity: total - bonus }, { templateId: "Currency:MtxPurchaseBonus", quantity: bonus }]
    .filter(({ quantity }) => quantity > 0)
});
const starterPack = {
  ...pack(600, 100, 499),
  offerId: "core_starter_br_s3",
  title: "Battle Royale Starter Pack",
  description: "Rogue Agent outfit, Catalyst back bling and 600 V-Bucks",
  displayAssetPath: displayAsset("DA_Featured_CID_090_Athena_Commando_M_Tactical"),
  season: 3,
  oncePerAccount: true,
  cosmetics: ["AthenaCharacter:CID_090_Athena_Commando_M_Tactical", "AthenaBackpack:BID_030_TacticalRogue"]
};
// The Wingman Starter Pack (Core-Backend #267) is Season 4's: the Wingman outfit (CID_139_Athena_Commando_M_FighterPilot)
// and the Bogey Bag back bling (BID_056_FighterPilot), both tagged Cosmetics.Source.StarterPack, with 600 V-Bucks for
// $4.99, one per account, as the Rogue Agent's. Epic sold it from later in Season 4: 4.0's and 4.1's paks (CL-4039451,
// CL-4053532) end at CID_126 and BID_049 and hold neither, so like the Rogue Agent's on 3.0 it is offered only on a
// Season 4 build whose cosmetics have both. Its art is Wingman's featured display asset (8.30 has
// DA_Featured_CID_139_Athena_Commando_M_FighterPilot).
const wingmanPack = {
  ...pack(600, 100, 499),
  offerId: "core_starter_br_s4",
  title: "Wingman Starter Pack",
  description: "Wingman outfit, Bogey Bag back bling and 600 V-Bucks",
  displayAssetPath: displayAsset("DA_Featured_CID_139_Athena_Commando_M_FighterPilot"),
  season: 4,
  oncePerAccount: true,
  cosmetics: ["AthenaCharacter:CID_139_Athena_Commando_M_FighterPilot", "AthenaBackpack:BID_056_FighterPilot"]
};
// The Ace Pack (Core-Backend #323) is Season 5's: The Ace outfit (CID_195_Athena_Commando_F_Bling, "Stack the deck.") and
// the Swag Bag back bling (BID_101_BlingFemale), both Epic rarity of the Bling (heist) set, with 600 V-Bucks for $4.99, one
// per account, as the two before it. Epic put it on sale with Content Update v5.30 (28 August 2018), in place of the
// Wingman pack, and sold it on until the Summit Striker pack took its place on 7 November 2018 (6.22). 5.21's paks
// (CL-4288479) hold neither cosmetic, 5.30's (CL-4305896) are the first with both, and 5.40's (CL-4352937) tag The Ace
// Cosmetics.Source.StarterPack, so like the Wingman's it is offered on a Season 5 build whose cosmetics have both: 5.30 on
// (5.41's paks have them too). It is in the Store tab's CurrencyStorefront with the V-Bucks packs (StoreMain_Root's
// StorefrontNames are still ["FoundersPack", "CurrencyStorefront"] on 5.30, 5.40 and 5.41). Its art is The Ace's featured
// display asset (DA_Featured_CID_195_Athena_Commando_F_Bling, a FortMtxOfferData in each of those builds' paks; none of
// them has a starter pack display asset).
const acePack = {
  ...pack(600, 100, 499),
  offerId: "core_starter_br_s5",
  title: "The Ace Pack",
  description: "The Ace outfit, Swag Bag back bling and 600 V-Bucks",
  displayAssetPath: displayAsset("DA_Featured_CID_195_Athena_Commando_F_Bling"),
  season: 5,
  // Core-Backend #356: Epic sold it on into Season 6, its last day 5 November 2018 ("Today is the LAST CHANCE to grab the
  // Ace Starter Pack!", Epic's tweet that day), so a Season 6 build offers it up to that day of the season's replay.
  sold: [{ season: 5 }, { season: 6, until: Date.UTC(2018, 10, 6) }],
  oncePerAccount: true,
  cosmetics: ["AthenaCharacter:CID_195_Athena_Commando_F_Bling", "AthenaBackpack:BID_101_BlingFemale"]
};
// The Summit Striker Pack (Core-Backend #356) is Season 6's: the Summit Striker outfit
// (CID_253_Athena_Commando_M_MilitaryFashion2, "Always first to the top.") and the Top Notch back bling
// (BID_134_MilitaryFashion), both Epic rarity, with 600 V-Bucks for $4.99, one per account, as the three before it. Epic put
// it in the store on 6 November 2018 (Update v6.22's day; the wiki's Item Shop History of that day), in The Ace Pack's
// place, and sold it until 29 January 2019, past Season 6's end. 6.20's paks (CL-4497486) are the first with both
// cosmetics and its featured display asset (DA_Featured_CID_253_Athena_Commando_M_MilitaryFashion2, its art here as the
// packs' before it); 6.00's to 6.10's have neither. So a Season 6 build whose cosmetics have both offers it from 6 November
// on the season's replay (store/itemshop.js seasonMoment), The Ace Pack before that day.
const summitStrikerPack = {
  ...pack(600, 100, 499),
  offerId: "core_starter_br_s6",
  title: "The Summit Striker Pack",
  description: "Summit Striker outfit, Top Notch back bling and 600 V-Bucks",
  displayAssetPath: displayAsset("DA_Featured_CID_253_Athena_Commando_M_MilitaryFashion2"),
  season: 6,
  sold: [{ season: 6, from: Date.UTC(2018, 10, 6) }],
  oncePerAccount: true,
  cosmetics: ["AthenaCharacter:CID_253_Athena_Commando_M_MilitaryFashion2", "AthenaBackpack:BID_134_MilitaryFashion"]
};
// The Founder's Packs' sale (Core-Backend #300). Update v5.00's notes: from 17 July the Super Deluxe and Limited Founders
// packs go on sale again. They are the Store tab's other storefront, FoundersPack (StoreMain_Root's StorefrontNames, 5.0's
// still ["FoundersPack", "CurrencyStorefront"]), real-money offers bought through the same purchase flow as the V-Bucks
// packs. 5.0's paks have each offer's art as a FortMtxOfferData: DA_FoundersPack_<n> for an edition bought outright and
// DA_FoundersPack_<from>_<to> for an upgrade (1_3, 2_3, 1_4, 2_4, 3_4), whose details list what the upgrade adds. So the
// account is offered the two editions above its own (profiles/founders.js foundersEditionOf): outright without one, else
// as the upgrade from its edition. Buying one raises the edition as the admin panel does (setFoundersEdition, on 5.0's
// data, whose quests give Legendary Troll Stash Llama tokens instead of friend codes). Only on 5.0 and later.
// 🟡 Prices: Epic's list prices in US dollars (Standard 39.99, Deluxe 59.99, Super Deluxe 89.99, Limited 149.99), an
// upgrade the difference; the sale's own discounts aren't recorded.
export const foundersStorefront = "FoundersPack";
export const foundersSaleBuild = 4204761;
const foundersDataBuild = "4214610";
const foundersListPrice = { 0: 0, 1: 3999, 2: 5999, 3: 8999, 4: 14999 };
const foundersOnSale = [3, 4];
const foundersPackOffer = (from, to) => {
  const name = foundersEditions[to - 1].name;
  return {
    offerId: `core_founders_${from}_${to}`,
    title: from ? `Founder's Pack: ${foundersEditions[from - 1].name} to ${name} Upgrade` : `Founder's Pack: ${name} Edition`,
    description: from ? `Upgrades your Founder's Pack to the ${name} Edition` : `The ${name} Edition Founder's Pack`,
    price: foundersListPrice[to] - foundersListPrice[from],
    currencyCode: "USD",
    displayAssetPath: displayAsset(from ? `DA_FoundersPack_${from}_${to}` : `DA_FoundersPack_${to}`),
    metaInfo: {},
    grants: [],
    foundersFrom: from,
    foundersEdition: to
  };
};
const foundersPackOffers = foundersOnSale.flatMap((to) => [0, 1, 2, 3].filter((from) => from < to).map((from) => foundersPackOffer(from, to)));

export const realMoneyOffers = [pack(1000, 0, 999), pack(2800, 300, 2499), pack(7500, 1500, 5999), pack(13500, 3500, 9999), starterPack,
  wingmanPack, acePack, summitStrikerPack, ...foundersPackOffers];

export const hasCurrencyStore = (changelist = currentBuild()) => Number(changelist) >= firstBuild;
export const findRealMoneyOffer = (offerId) => realMoneyOffers.find((offer) => offer.offerId === offerId);

const key = crypto.randomBytes(32);
const signature = (offerId, accountId) => crypto.createHmac("sha256", key).update(`${offerId}\n${accountId}`).digest("base64url").slice(0, 32);
const tokenPattern = /^(core_[a-z0-9_]+)\.([A-Za-z0-9-]{1,64})\.([A-Za-z0-9_-]{32})$/;

// The offer's app store id for an account: "<offerId>.<accountId>.<signature>", URL-safe as it goes into the purchase
// page's address unescaped ("&offers=%s").
export const appStoreIdOf = (offerId, accountId) => `${offerId}.${accountId}.${signature(offerId, accountId)}`;

// {offer, accountId} of an app store id this backend made, else null.
export function parseAppStoreId(appStoreId) {
  const match = tokenPattern.exec(String(appStoreId ?? ""));
  if (!match) return null;
  const [, offerId, accountId, given] = match;
  const offer = findRealMoneyOffer(offerId);
  const expected = Buffer.from(signature(offerId, accountId));
  if (!offer || !crypto.timingSafeEqual(expected, Buffer.from(given))) return null;
  return { offer, accountId };
}

// How many times the account's profile0 has had the offer fulfilled (its in_app_purchases).
export const purchaseCount = (profile0, offerId) => profile0?.stats?.attributes?.in_app_purchases?.fulfillmentCounts?.[offerId] ?? 0;

// Whether the offer is on sale to the account on the requesting build: a season's offer only on that season's builds that
// have its cosmetics, a one-per-account offer until it is bought. An offer with sale windows ({season, from, until}, Epic's
// moments, UTC ms) is on sale on a build of a window's season while the season's replay stands inside the window.
const onSale = (offer, now) => {
  if (!offer.season) return true;
  if (!namesAthenaBuild()) return false;
  const season = seasonNumber();
  return (offer.sold ?? [{ season: offer.season }]).some((window) => {
    if (window.season !== season) return false;
    if (window.from === undefined && window.until === undefined) return true;
    const moment = seasonMoment(now, null, season).getTime();
    return (window.from === undefined || moment >= window.from) && (window.until === undefined || moment < window.until);
  });
};
export const isOffered = (offer, profile0, now = new Date()) => onSale(offer, now)
  && (offer.cosmetics ?? []).every((templateId) => lockerCosmeticId(templateId))
  && (!offer.foundersEdition || Number(currentBuild()) >= foundersSaleBuild)
  && !offerBlocked(offer, profile0);

// Why the account can't buy the offer now, whatever the build (the purchase page has none), else null: a one-per-account
// offer it bought, a founder's pack whose edition it no longer starts from.
export function offerBlocked(offer, profile0) {
  if (offer.oncePerAccount && purchaseCount(profile0, offer.offerId) > 0) return "This offer can be bought once per account.";
  if (offer.foundersEdition && foundersEditionOf(profile0 ?? { items: {} }) !== offer.foundersFrom) {
    return "This Founder's Pack is for another edition than your account's.";
  }
  return null;
}

// The CurrencyStorefront's offers for the account (store/catalog.js offerJson); none before 1.8 or without an account.
// profile0: the account's, for the offers it can buy once.
export function currencyOffers(accountId, profile0) {
  if (!hasCurrencyStore() || !accountId) return [];
  return realMoneyOffers.filter((offer) => !offer.foundersEdition && isOffered(offer, profile0)).map((offer) => catalogEntry(offer, accountId));
}

// The FoundersPack storefront's offers for the account: the founder's packs on sale (5.0 and later), none without one.
export function foundersOffers(accountId, profile0) {
  if (!accountId || Number(currentBuild()) < foundersSaleBuild) return [];
  return foundersPackOffers.filter((offer) => isOffered(offer, profile0)).map((offer) => catalogEntry(offer, accountId));
}

// A one-per-account offer's requirements (Core-Backend #248): DenyOnFulfillment of its own offer id, as Epic's starter
// packs had. The bought pack used to stay in the Store tab until the game was restarted: the backend leaves it out of
// the next catalog, but the client keeps the catalog it has until its refresh is due. The client checks the requirements
// itself each time it lists the tab: ListMtxPackages' callback (4.4.2 0xE4B810) gathers each storefront's offers through
// the catalog helper (0x84B250 -> 0x848020) with the check on and unavailable offers left out (flags 01 00 00 01 01),
// and the check (0x8465C0) fails DenyOnFulfillment once the profile's in_app_purchases.fulfillmentCounts[requiredId]
// (0x849E50, or the older fulfillments list) reaches minQuantity. The purchase records that count in profile0
// (grantRealMoneyOffer; common_core from 3.5), and the client's VerifyRealMoneyPurchase right after brings it back
// (services/mcp/profile.js: the client's revision is behind, so the profile comes whole), so the pack goes on the next
// listing without a catalog refetch. FCatalogOffer::Requirements is in every build with the Store tab (1.8 on).
// Repeatable offers (the V-Bucks packs) and the founder's packs (whose edition the admin panel can set back) have none.
export const offerRequirements = (offer) => (offer.oncePerAccount
  ? [{ requirementType: "DenyOnFulfillment", requiredId: offer.offerId, minQuantity: 1 }]
  : []);

function catalogEntry(offer, accountId) {
  return {
    offerId: offer.offerId,
    devName: offer.title,
    templateId: "",
    title: offer.title,
    description: offer.description,
    currencyType: "RealMoney",
    currencySubType: "",
    price: 0,
    realMoney: true,
    appStoreId: ["", appStoreIdOf(offer.offerId, accountId), "", "", "", "", "", ""],
    metaInfo: offer.metaInfo,
    displayAssetPath: offer.displayAssetPath,
    itemGrants: [],
    requirements: offerRequirements(offer)
  };
}

// The catalog service's offer for an app store id (QueryOffersById's answer).
export function catalogServiceOffer(appStoreId, { offer }) {
  return {
    id: appStoreId,
    namespace: "fn",
    title: offer.title,
    description: offer.description,
    longDescription: offer.description,
    technicalDetails: "",
    currencyCode: offer.currencyCode,
    price: offer.price,
    basePrice: offer.price,
    recurringPrice: 0,
    freeDays: 0,
    maxBillingCycles: 0,
    vatIncluded: false,
    status: "ACTIVE",
    items: []
  };
}

// Gives the account the offer's grants, recording the purchase in profile0's in_app_purchases (Epic's: receipts and
// how many times each offer was fulfilled). Returns what was granted.
export function grantRealMoneyOffer(session, offer, transactionId) {
  const granted = offer.grants.flatMap(({ templateId, quantity }) => grantItem(session, templateId, quantity));
  // A founder's pack raises the account's edition, with 5.0's founders quests.
  if (offer.foundersEdition) {
    const result = inBuild(foundersDataBuild, () => setFoundersEdition(session, offer.foundersEdition));
    if (result.error) throw new Error(result.error);
    granted.push(...result.granted.map((templateId) => ({ templateId, quantity: 1 })));
  }
  // Cosmetics go to the athena profile, as the offer's season's newest build spells them (the purchase page has no build).
  if (offer.cosmetics) {
    inBuild(buildOfSeason(offer.season), () => {
      for (const templateId of offer.cosmetics) {
        const item = grantCosmetic(session, templateId);
        if (item) granted.push(item);
      }
    });
  }
  const tracker = session.profile("profile0");
  const current = tracker.profile.stats.attributes.in_app_purchases ?? {};
  const fulfillmentCounts = { ...(current.fulfillmentCounts ?? {}) };
  fulfillmentCounts[offer.offerId] = (fulfillmentCounts[offer.offerId] ?? 0) + 1;
  tracker.setStat("in_app_purchases", {
    receipts: [...(current.receipts ?? []), `EPIC:${transactionId}`],
    ignoredReceipts: current.ignoredReceipts ?? [],
    fulfillmentCounts
  });
  return granted;
}
