import { McpError } from "../../../errors.js";
import { hasRefunds, refundPurchase } from "../../../store/refunds.js";

// RefundMtxPurchase {purchaseId} (UFortMcpProfileCommonCore's, 3.6: the purchase history's Return, store/refunds.js):
// returns an item shop purchase of the last 30 days, one of the account's three lifetime returns. The client sees the
// change in common_core's mtx_purchase_history and its V-Bucks, and the athena profile's locker.
export function refundMtxPurchase({ req, session }) {
  if (!hasRefunds()) throw new McpError("errors.com.epicgames.fortnite.operation_not_found", "This build has no cosmetic returns");
  const { purchaseId } = req.body ?? {};
  if (typeof purchaseId !== "string" || !purchaseId) throw new McpError("errors.com.epicgames.common.invalid_parameter", "purchaseId is missing");
  try {
    refundPurchase(session, purchaseId);
  } catch (error) {
    if (error.refused) throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", error.message);
    throw error;
  }
}
