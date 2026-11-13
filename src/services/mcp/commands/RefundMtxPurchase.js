import { McpError } from "../../../errors.js";
import { reverseCreatorPayout } from "../../../store/creatorpayouts.js";
import { hasRefunds, purchaseHistoryOf, refundPurchase } from "../../../store/refunds.js";

// RefundMtxPurchase {purchaseId} (UFortMcpProfileCommonCore's, 3.6: the purchase history's Return, store/refunds.js):
// returns an item shop purchase of the last 30 days, one of the account's three lifetime returns. The client sees the
// change in common_core's mtx_purchase_history and its V-Bucks, and the athena profile's locker. A Support-A-Creator
// payout the purchase made (Core-Backend #349, store/creatorpayouts.js) comes back from the creator.
export function refundMtxPurchase({ req, session, sessionFor, context }) {
  if (!hasRefunds()) throw new McpError("errors.com.epicgames.fortnite.operation_not_found", "This build has no cosmetic returns");
  const { purchaseId } = req.body ?? {};
  if (typeof purchaseId !== "string" || !purchaseId) throw new McpError("errors.com.epicgames.common.invalid_parameter", "purchaseId is missing");
  const payout = purchaseHistoryOf(session.profile("profile0").profile.stats.attributes).purchases
    .find((entry) => entry.purchaseId === purchaseId)?.coreCreatorPayout;
  try {
    refundPurchase(session, purchaseId);
  } catch (error) {
    if (error.refused) throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", error.message);
    throw error;
  }
  if (payout) reverseCreatorPayout({ payout, sessionFor, payouts: context?.creatorPayouts });
}
