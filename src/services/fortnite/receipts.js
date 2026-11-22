import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { currentBuild } from "../../builds/context.js";

// From Season 7 the game finishes a real-money purchase from this list, not from the purchase flow's receipt (Core-Backend
// #403). After "Purchase Flow succeeded" OnlinePurchaseMcp queries it (8.00 0x5EB790): the whole answer becomes one
// receipt whose line items are the entries {appStoreId, receiptId, receiptInfo}. The catalog helper (0xA9C930, 0xAA3290)
// skips an item whose "EPIC:<receiptId>" profile0's in_app_purchases.receipts or ignoredReceipts already holds and sends
// VerifyRealMoneyPurchase for the others; with none left the purchase fails with
// errors.com.epicgames.purchase.no_new_entitlements_found. So the page leaves the receipt out of the profile and
// VerifyRealMoneyPurchase adds it. 7.20 and 7.40 have the same code; earlier builds still get the empty list they had.
const receiptsBuild = 4629139;

export function receiptRoutes({ tokens, receipts }) {
  const router = express.Router();

  router.get("/fortnite/api/receipts/v1/account/:accountId/receipts", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json(Number(currentBuild()) >= receiptsBuild ? receipts?.list(req.params.accountId) ?? [] : []);
  });

  return router;
}
