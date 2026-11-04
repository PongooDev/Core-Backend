// The client's check of a real-money purchase's receipt (FMcpCatalogHelper, 3.1 0x7D0670: {appStore, appStoreId,
// receiptId, receiptInfo} for each receipt its purchase interface holds), after the purchase flow completed. The Store
// tab's V-Bucks packs (Core-Backend #223) were given when the player completed the purchase page
// (services/fortnite/purchase.js), which also sent the client the profile change, so there is nothing left to give: the
// answer is the profile as it is.
export function verifyRealMoneyPurchase() {}
