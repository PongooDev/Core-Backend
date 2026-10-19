import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, startBackend, userLogin } from "./helpers.js";

test("the llama store sells the Upgrade Llama for V-Bucks, spending the stacks it has", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "StoreTest");
    const command = (name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;
    const give = (templateId, quantity) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });

    const catalog = await get(backend.port, "/fortnite/api/storefront/v2/catalog", token);
    const [offer] = catalog.body.storefronts.find((storefront) => storefront.name === "CardPackStore").catalogEntries;
    assert.deepEqual([offer.offerType, offer.prices[0].currencyType, offer.prices[0].finalPrice, offer.itemGrants],
      ["StaticPrice", "MtxCurrency", 50, [{ templateId: "CardPack:cardpack_bronze", quantity: 1 }]]);
    assert.deepEqual(offer.metaAssetInfo, { structName: "FortCatalogMeta", payload: { chaseItems: [], packDefinition: "/Game/Items/CardPacks/CardPack_Bronze.CardPack_Bronze" } });

    const broke = await post(backend.port, command("PurchaseCatalogEntry"), token, { offerId: offer.offerId, purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: 50 });
    assert.equal(broke.status, 400);
    assert.equal(broke.body.errorCode, "errors.com.epicgames.currency.mtx.insufficient");

    await give("Currency:mtxgiveaway", 30);
    await give("Currency:mtxpurchased", 100);
    const bought = await post(backend.port, command("PurchaseCatalogEntry"), token, { offerId: offer.offerId, purchaseQuantity: 2, currency: "MtxCurrency", currencySubType: "", expectedPrice: 100 });
    assert.equal(bought.status, 200);
    const [notification] = bought.body.notifications;
    assert.equal(notification.type, "CatalogPurchase");
    assert.equal(notification.lootResult.items.length, 2);
    const items = bought.body.profileChanges[0].profile.items;
    for (const { itemGuid, itemType } of notification.lootResult.items) {
      assert.equal(itemType, "CardPack:cardpack_bronze");
      assert.equal(items[itemGuid].attributes.pack_source, "Store");
    }
    const mtx = Object.values(items).filter((item) => item.templateId.startsWith("Currency:mtx"));
    assert.deepEqual(mtx.map((item) => [item.templateId, item.quantity]), [["Currency:mtxpurchased", 30]]);

    assert.equal((await post(backend.port, command("PurchaseCatalogEntry"), token, { offerId: "nope", purchaseQuantity: 1 })).status, 400);
  } finally {
    backend.close();
  }
});
