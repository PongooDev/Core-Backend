import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { grantItem } from "../profiles/items.js";

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
export const realMoneyOffers = [pack(1000, 0, 999), pack(2800, 300, 2499), pack(7500, 1500, 5999), pack(13500, 3500, 9999)];

export const hasCurrencyStore = (changelist = currentBuild()) => Number(changelist) >= firstBuild;
export const findRealMoneyOffer = (offerId) => realMoneyOffers.find((offer) => offer.offerId === offerId);

const key = crypto.randomBytes(32);
const signature = (offerId, accountId) => crypto.createHmac("sha256", key).update(`${offerId}\n${accountId}`).digest("base64url").slice(0, 32);
const tokenPattern = /^(core_mtx_\d+)\.([A-Za-z0-9-]{1,64})\.([A-Za-z0-9_-]{32})$/;

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

// The CurrencyStorefront's offers for the account (store/catalog.js offerJson); none before 1.8 or without an account.
export function currencyOffers(accountId) {
  if (!hasCurrencyStore() || !accountId) return [];
  return realMoneyOffers.map((offer) => ({
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
    itemGrants: []
  }));
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
