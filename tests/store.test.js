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

test("reward vouchers buy their llamas in the store, which then opens them", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "VoucherTest");
    const command = (name, body) => post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`, token, body);
    const give = (templateId, quantity) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
    const offers = async () => (await get(backend.port, "/fortnite/api/storefront/v2/catalog", token)).body.storefronts
      .find((storefront) => storefront.name === "CardPackStore").catalogEntries;

    // The Mini Reward Llama a mission or daily reward gives is a voucher (ZCP_Voucher_BasicPack → Voucher_BasicPack).
    const mini = (await offers()).find((offer) => offer.itemGrants[0].templateId === "CardPack:cardpack_basic");
    assert.deepEqual([mini.title, mini.prices[0].currencyType, mini.prices[0].currencySubType, mini.prices[0].finalPrice],
      ["Mini Reward Llama", "GameItem", "AccountResource:voucher_basicpack", 1]);
    assert.equal(mini.metaAssetInfo.payload.packDefinition, "/Game/Items/CardPacks/CardPack_Basic.CardPack_Basic");

    const claim = (quantity = 1) => command("PurchaseCatalogEntry", { offerId: mini.offerId, purchaseQuantity: quantity, currency: "GameItem",
      currencySubType: "AccountResource:voucher_basicpack", expectedPrice: quantity });
    assert.equal((await claim()).status, 400, "no voucher yet");
    await give("AccountResource:voucher_basicpack", 2);
    assert.equal((await command("PurchaseCatalogEntry", { offerId: mini.offerId, purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: 1 })).status, 400);

    const claimed = await claim();
    assert.equal(claimed.status, 200);
    const [{ itemGuid, itemType }] = claimed.body.notifications[0].lootResult.items;
    const items = claimed.body.profileChanges[0].profile.items;
    assert.equal(itemType, "CardPack:cardpack_basic");
    assert.equal(items[itemGuid].attributes.pack_source, "Store");
    assert.equal(Object.values(items).find((item) => item.templateId === "AccountResource:voucher_basicpack").quantity, 1);

    const opened = await command("OpenCardPack", { cardPackItemId: itemGuid, selectionIdx: 0 });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.notifications[0].type, "cardPackResult");
    assert.ok(opened.body.notifications[0].lootGranted.items.length > 0);

    // Other vouchers get their offer while the player holds one.
    assert.equal((await offers()).some((offer) => offer.prices[0].currencySubType === "AccountResource:voucher_founders_ninja_bundle"), false);
    await give("AccountResource:voucher_founders_ninja_bundle", 1);
    assert.ok((await offers()).some((offer) => offer.prices[0].currencySubType === "AccountResource:voucher_founders_ninja_bundle"));
  } finally {
    backend.close();
  }
});

test("buying and opening llamas in the store advances the Loot Llamas quest", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "LootLlamasTest");
    const command = (name, body) => post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`, token, body);
    const give = (templateId, quantity) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
    const quest = async () => Object.values((await command("QueryProfile", {})).body.profileChanges[0].profile.items)
      .find((item) => item.templateId === "Quest:homebaseonboardingafteroutpost").attributes;
    const offers = (await get(backend.port, "/fortnite/api/storefront/v2/catalog", token)).body.storefronts
      .find((storefront) => storefront.name === "CardPackStore").catalogEntries;
    const offerFor = (templateId) => offers.find((offer) => offer.itemGrants[0].templateId === templateId);

    await give("Quest:homebaseonboardingafteroutpost", 1);
    await give("AccountResource:voucher_basicpack", 1);
    await give("Currency:mtxpurchased", 50);

    const mini = offerFor("CardPack:cardpack_basic");
    const redeemed = await command("PurchaseCatalogEntry", { offerId: mini.offerId, purchaseQuantity: 1, currency: "GameItem",
      currencySubType: "AccountResource:voucher_basicpack", expectedPrice: 1 });
    assert.equal(redeemed.status, 200);
    assert.deepEqual([(await quest()).completion_open_card_pack, (await quest()).completion_purchase_card_pack], [0, 0]);
    const [{ itemGuid }] = redeemed.body.notifications[0].lootResult.items;
    assert.equal((await command("OpenCardPack", { cardPackItemId: itemGuid, selectionIdx: 0 })).status, 200);
    assert.equal((await quest()).completion_open_card_pack, 1);

    const upgrade = offerFor("CardPack:cardpack_bronze");
    const bought = await command("PurchaseCatalogEntry", { offerId: upgrade.offerId, purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: 50 });
    assert.equal(bought.status, 200);
    assert.equal((await quest()).completion_purchase_card_pack, 1);
    assert.equal((await quest()).quest_state, "Active");

    await command("UpdateQuestClientObjectives", { advance: [{ statName: "hbonboarding_watchoutpostunlock", count: 1 }] });
    assert.notEqual((await quest()).quest_state, "Active");
  } finally {
    backend.close();
  }
});

test("Founder's Coins buy the Launch Event Llama, offered always", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "FoundersCoinsTest");
    const command = (name, body) => post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`, token, body);
    const give = (templateId, quantity) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
    const offers = (await get(backend.port, "/fortnite/api/storefront/v2/catalog", token)).body.storefronts
      .find((storefront) => storefront.name === "CardPackStore").catalogEntries;

    // Shown with no coins held: the client lists it among its event packs and greys the price out.
    const llama = offers.find((offer) => offer.prices[0].currencySubType === "AccountResource:eventcurrency_founders");
    assert.deepEqual([llama.title, llama.prices[0].currencyType, llama.prices[0].finalPrice, llama.itemGrants, llama.dailyLimit, llama.weeklyLimit],
      ["Launch Event Llama", "GameItem", 100, [{ templateId: "CardPack:cardpack_event_founders_nonexclusive", quantity: 1 }], -1, -1]);
    assert.equal(llama.metaAssetInfo.payload.packDefinition,
      "/Game/Items/CardPacks/Events/Release/CardPack_Event_Founders_NonExclusive.CardPack_Event_Founders_NonExclusive");

    const buy = (quantity) => command("PurchaseCatalogEntry", { offerId: llama.offerId, purchaseQuantity: quantity, currency: "GameItem",
      currencySubType: "AccountResource:eventcurrency_founders", expectedPrice: 100 * quantity });
    await give("AccountResource:eventcurrency_founders", 140);
    const short = await buy(2);
    assert.equal(short.status, 400);
    assert.equal(short.body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed");

    const bought = await buy(1);
    assert.equal(bought.status, 200);
    const [{ itemGuid, itemType }] = bought.body.notifications[0].lootResult.items;
    const items = bought.body.profileChanges[0].profile.items;
    assert.equal(itemType, "CardPack:cardpack_event_founders_nonexclusive");
    assert.equal(items[itemGuid].attributes.pack_source, "Store");
    assert.equal(Object.values(items).find((item) => item.templateId === "AccountResource:eventcurrency_founders").quantity, 40);

    const opened = await command("OpenCardPack", { cardPackItemId: itemGuid, selectionIdx: 0 });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.notifications[0].lootGranted.tierGroupName, "CardPack_Event_2017_Founders");
    assert.ok(opened.body.notifications[0].lootGranted.items.length > 0);
  } finally {
    backend.close();
  }
});
