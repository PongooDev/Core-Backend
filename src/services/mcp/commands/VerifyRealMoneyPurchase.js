// The client's check of a real-money purchase's receipt (FMcpCatalogHelper, 3.1 0x7D0670: {appStore, appStoreId,
// receiptId, receiptInfo} for each receipt its purchase interface holds), after the purchase flow completed. The Store
// tab's V-Bucks packs (Core-Backend #223) were given when the player completed the purchase page
// (services/fortnite/purchase.js), which also sent the client the profile change. What is left is Epic's record of the
// receipt: "EPIC:<receiptId>" in profile0's in_app_purchases.receipts, for a receipt the receipts service holds for the
// account (store/receipts.js). From then on the client counts it as redeemed (Core-Backend #403).
export function verifyRealMoneyPurchase({ req, session, context }) {
  const receiptId = String(req.body?.receiptId ?? "");
  if (!receiptId || !context.receipts?.find(session.accountId, receiptId)) return;
  const tracker = session.profile("profile0");
  const current = tracker.profile.stats.attributes.in_app_purchases ?? {};
  const receipt = `EPIC:${receiptId}`;
  if ((current.receipts ?? []).includes(receipt)) return;
  tracker.setStat("in_app_purchases", { ...current, receipts: [...(current.receipts ?? []), receipt] });
}
