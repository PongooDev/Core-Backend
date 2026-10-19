import { McpError } from "../../../errors.js";
import { lootEntry } from "../../../profiles/items.js";
import { grant } from "../../../profiles/progress.js";
import { findOffer } from "../../../store/catalog.js";

// V-Bucks are spread over these stacks; the cheapest kinds go first.
const mtxCurrencies = ["Currency:mtxcomplimentary", "Currency:mtxgiveaway", "Currency:mtxpurchasebonus", "Currency:mtxpurchased"];

function spendMtx(tracker, amount) {
  const stacks = mtxCurrencies.flatMap((templateId) => Object.entries(tracker.profile.items)
    .filter(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase()));
  const held = stacks.reduce((sum, [, item]) => sum + item.quantity, 0);
  if (held < amount) throw new McpError("errors.com.epicgames.currency.mtx.insufficient", `This costs ${amount} V-Bucks and you have ${held}`);
  let left = amount;
  for (const [itemId, item] of stacks) {
    if (!left) break;
    const used = Math.min(left, item.quantity);
    left -= used;
    if (item.quantity > used) tracker.setQuantity(itemId, item.quantity - used);
    else tracker.removeItem(itemId);
  }
}

// FCatalogPurchaseInfo {offerId, purchaseQuantity, currency, currencySubType, expectedPrice}; the client is told what
// it got as CatalogPurchase {lootResult} (FCatalogPurchaseNotification).
export function purchaseCatalogEntry({ req, session, notifications }) {
  const { offerId, purchaseQuantity = 1, currency, expectedPrice } = req.body ?? {};
  const offer = findOffer(offerId);
  if (!offer) throw new McpError("errors.com.epicgames.modules.gamesubcatalog.catalog_out_of_date", `Offer ${offerId} isn't in the store`);
  if (!Number.isInteger(purchaseQuantity) || purchaseQuantity < 1 || purchaseQuantity > 100) {
    throw new McpError("errors.com.epicgames.common.invalid_parameter", `Can't buy ${purchaseQuantity} of that`);
  }
  if (currency !== undefined && currency !== "MtxCurrency") throw new McpError("errors.com.epicgames.common.invalid_parameter", `${offerId} is sold for V-Bucks`);
  const total = offer.price * purchaseQuantity;
  if (Number.isInteger(expectedPrice) && expectedPrice !== total && expectedPrice !== offer.price) {
    throw new McpError("errors.com.epicgames.modules.gamesubcatalog.price_mismatch", `The price is ${total}, not ${expectedPrice}`);
  }

  const tracker = session.profile("profile0");
  spendMtx(tracker, total);
  const items = grant(session, offer.templateId, purchaseQuantity, { packSource: "Store" }).map(lootEntry);
  notifications.push({ type: "CatalogPurchase", primary: true, lootResult: { items } });
}
