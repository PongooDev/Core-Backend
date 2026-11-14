import { giveCatalogGift } from "../../../store/gifting.js";
import { findOffer } from "../../../store/catalog.js";

// GiftCatalogEntry (6.31's, UFortMcpContext::PurchaseOfferAsGift, sent to common_core): an item shop offer bought for
// friends, FCatalogPurchaseInfoGift {offerId, currency, currencySubType, expectedTotalPrice, gameContext,
// receiverAccountIds, giftWrapTemplateId, personalMessage}. The sender pays and each receiver gets a gift box
// (store/gifting.js, where the client's side and Epic's rules are).
export function giftCatalogEntry({ req, session, sessionFor, context }) {
  giveCatalogGift({ req, session, sessionFor, context, offer: findOffer(req.body?.offerId) });
}
