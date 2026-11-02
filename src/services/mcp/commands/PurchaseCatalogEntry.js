import { McpError } from "../../../errors.js";
import { bundleTiers } from "../../../battlepass/season2.js";
import { grantCosmetic, ownsCosmetic, seasonRewardFunctions } from "../../../profiles/athena.js";
import { buyBattlePass, buyTiers, tiersLeft } from "../../../profiles/seasons.js";
import { lootEntry } from "../../../profiles/items.js";
import { grant, itemEvent } from "../../../profiles/progress.js";
import { findOffer } from "../../../store/catalog.js";
import { eventPurchases, recordEventPurchase } from "../../../store/eventstore.js";

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

// A GameItem price: the account item it names, from its stacks.
function spendItem(tracker, templateId, amount) {
  const stacks = Object.entries(tracker.profile.items).filter(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase());
  const held = stacks.reduce((sum, [, item]) => sum + item.quantity, 0);
  if (held < amount) throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", `This costs ${amount} ${templateId} and you have ${held}`);
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
  const { offerId, purchaseQuantity = 1, currency, currencySubType, expectedPrice } = req.body ?? {};
  const offer = findOffer(offerId);
  if (!offer) throw new McpError("errors.com.epicgames.modules.gamesubcatalog.catalog_out_of_date", `Offer ${offerId} isn't in the store`);
  if (!Number.isInteger(purchaseQuantity) || purchaseQuantity < 1 || purchaseQuantity > 100) {
    throw new McpError("errors.com.epicgames.common.invalid_parameter", `Can't buy ${purchaseQuantity} of that`);
  }
  const sameSubType = !currencySubType || String(currencySubType).toLowerCase() === offer.currencySubType.toLowerCase();
  if ((currency !== undefined && currency !== offer.currencyType) || (offer.currencyType === "GameItem" && !sameSubType)) {
    const priceName = offer.currencyType === "GameItem" ? offer.currencySubType : "V-Bucks";
    throw new McpError("errors.com.epicgames.common.invalid_parameter", `${offerId} is sold for ${priceName}`);
  }
  const total = offer.price * purchaseQuantity;
  if (Number.isInteger(expectedPrice) && expectedPrice !== total && expectedPrice !== offer.price) {
    throw new McpError("errors.com.epicgames.modules.gamesubcatalog.price_mismatch", `The price is ${total}, not ${expectedPrice}`);
  }

  const tracker = session.profile("profile0");
  // A Battle Pass offer (battlepass/season2.js): the pass, the pass with 25 tiers, or tiers, one a purchase quantity
  // (1.11's tier modal buys 1 to 10). Paid in profile0's V-Bucks; the pass's stats and the rewards of the tiers reached go
  // to the athena profile (profiles/seasons.js), the cosmetics among them to the locker.
  if (offer.battlePass) {
    const athena = session.profile("athena").profile;
    const owns = athena.stats.attributes.book_purchased === true;
    if (offer.battlePass !== "tier" && purchaseQuantity !== 1) {
      throw new McpError("errors.com.epicgames.common.invalid_parameter", `Can't buy ${purchaseQuantity} of ${offer.title}`);
    }
    if (offer.battlePass !== "tier" && owns) {
      throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", "You already own the Battle Pass");
    }
    const tiers = offer.battlePass === "tier" ? purchaseQuantity : offer.battlePass === "bundle" ? bundleTiers : 0;
    if (tiers > tiersLeft(athena)) {
      throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed",
        `Only ${tiersLeft(athena)} Battle Pass tiers are left to buy`);
    }
    spendMtx(tracker, total);
    const items = [];
    if (offer.battlePass !== "tier") items.push(...buyBattlePass(session, seasonRewardFunctions()));
    if (tiers) items.push(...buyTiers(session, tiers, seasonRewardFunctions()));
    notifications.push({ type: "CatalogPurchase", primary: true, lootResult: { items: items.map(lootEntry) } });
    return;
  }
  // An item shop offer (store/itemshop.js) is a Battle Royale cosmetic, owned or not: one the player has isn't sold
  // again and costs nothing (the client shows it as owned and offers no purchase). It is paid in profile0's V-Bucks,
  // the balance 1.8's store shows, and goes to the athena profile's locker.
  if (offer.athena) {
    if (purchaseQuantity !== 1) throw new McpError("errors.com.epicgames.common.invalid_parameter", `Can't buy ${purchaseQuantity} of ${offer.title}`);
    if (ownsCosmetic(session, offer.templateId)) {
      throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", `You already own ${offer.title}`);
    }
    // A Season Shop offer (store/seasonshop.js) unlocks at its season level, the athena profile's level, as the client
    // locks it.
    const level = session.profile("athena").profile.stats.attributes.level ?? 1;
    if (offer.seasonLevel && level < offer.seasonLevel) {
      throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed",
        `${offer.title} unlocks at season level ${offer.seasonLevel}, and you are level ${level}`);
    }
    spendMtx(tracker, total);
    const item = grantCosmetic(session, offer.templateId);
    notifications.push({ type: "CatalogPurchase", primary: true, lootResult: { items: [lootEntry(item)] } });
    return;
  }
  // An Event Store offer (store/eventstore.js) sells as many as its limit, counted in the account's tracker.
  if (offer.eventLimit) {
    const bought = eventPurchases(tracker.profile, offer);
    if (bought + purchaseQuantity > offer.eventLimit) {
      throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed",
        `${offerId} sells ${offer.eventLimit} and you have bought ${bought}`);
    }
  }
  if (offer.currencyType === "GameItem") spendItem(tracker, offer.currencySubType, total);
  else spendMtx(tracker, total);
  if (offer.eventLimit) recordEventPurchase(tracker, offer, purchaseQuantity);
  // An offer of several (1.10's ten Upgrade Llamas, store/catalog.js) grants its quantity for each one bought.
  const count = purchaseQuantity * (offer.quantity ?? 1);
  const items = grant(session, offer.templateId, count, { packSource: "Store" }).map(lootEntry);
  if (offer.templateId.toLowerCase().startsWith("cardpack:")) itemEvent(session, ["PurchaseCardPack"], offer.templateId, count);
  notifications.push({ type: "CatalogPurchase", primary: true, lootResult: { items } });
}
