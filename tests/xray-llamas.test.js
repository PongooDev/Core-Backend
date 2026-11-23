import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { configureEvents } from "../src/events/events.js";
import { springTickets } from "../src/events/spring2019.js";
import { storefronts } from "../src/store/catalog.js";
import { eventStoreEnds, eventStoreOffers } from "../src/store/eventstore.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #406 / #407: 8.20's (CL-5625478) Loot tab: the X-RAY page, the llamas' art and Yarrr!'s store.
const v820 = "5625478";
const v800 = "5203069";
const v720 = "4727874";
const front = (cl, name) => inBuild(cl, () => storefronts(null)).find((storefront) => storefront.name === name)?.catalogEntries;
const withEvents = (config, run) => {
  configureEvents({ mode: "auto", ...config });
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};

test("a llama offer's display asset is its card pack from 7.10, which gives each tile its own art", () => {
  for (const offer of front(v820, "CardPackStoreGameplay")) {
    assert.match(offer.displayAssetPath, /^\/Game\/Items\/CardPacks\/.+\.CardPack_[A-Za-z0-9_]+$/, offer.offerId);
  }
  const mini = front(v820, "CardPackStoreGameplay").find(({ offerId }) => offerId === "core_voucher_basicpack");
  assert.equal(mini.displayAssetPath, "/Game/Items/CardPacks/CardPack_Basic.CardPack_Basic");
  for (const offer of front("4629139", "CardPackStore")) assert.equal(offer.displayAssetPath, "", "7.00 has no LlamaStoreRoot");
});

test("from 7.30 the Upgrade Llamas are X-Ray llamas on CardPackStorePreroll, in the Upgrade and Shared groups", () => {
  const xray = front(v820, "CardPackStorePreroll");
  // The page's groups match catalogGroup, not categories (Core-Backend #412).
  assert.deepEqual(xray.map(({ offerId, catalogGroup }) => [offerId, catalogGroup]),
    [["core_xray_cardpack_bronze", "Upgrade"], ["core_xray_voucher_cardpack_bronze", "Shared"]]);
  // The LOOT page shows up to five offers of no group.
  for (const offer of front(v820, "CardPackStoreGameplay")) assert.equal(offer.catalogGroup, "", offer.offerId);
  for (const offer of xray) {
    assert.deepEqual(offer.metaInfo, [{ key: "Preroll", value: "true" }]);
    assert.equal(offer.displayAssetPath, "/Game/Items/CardPacks/CardPack_Bronze.CardPack_Bronze");
  }
  assert.deepEqual(xray[0].prices[0].finalPrice, 50);
  assert.equal(front(v720, "CardPackStorePreroll"), undefined);
  assert.ok(front(v720, "CardPackStoreGameplay").some(({ offerId }) => offerId === "core_cardpack_bronze"));
});

test("an X-Ray llama gives exactly what its tile showed, then shows a new roll", async () => {
  const backend = await startBackend();
  const agent = `Fortnite/++Fortnite+Release-8.20-CL-${v820} Windows/10.0.19041.1.256.64bit`;
  try {
    const { token, accountId } = await userLogin(backend.port, "XrayTest");
    const command = (name, body = {}, profileId = "campaign") => send({ host: "127.0.0.1", port: backend.port, method: "POST",
      path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
      headers: { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json" } }, JSON.stringify(body));
    const prerolls = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId === "PrerollData:preroll_basic");

    const populated = (await command("PopulatePrerolledOffers")).body.profileChanges[0].profile;
    const rolls = prerolls(populated);
    assert.deepEqual(rolls.map(([, item]) => item.attributes.offerId).sort(), ["core_xray_cardpack_bronze", "core_xray_voucher_cardpack_bronze"]);
    const [[, upgrade], [, token2]] = rolls.sort(([, a], [, b]) => a.attributes.offerId.localeCompare(b.attributes.offerId));
    assert.deepEqual(upgrade.attributes.items, token2.attributes.items, "the V-Bucks and token offers share one roll");
    assert.equal(upgrade.attributes.linked_offer, "core_xray_voucher_cardpack_bronze");
    assert.ok(Date.parse(upgrade.attributes.expiration) > Date.now());
    assert.ok([0, 1, 2].includes(upgrade.attributes.highest_rarity));
    assert.ok(upgrade.attributes.items.length >= 4);
    for (const entry of upgrade.attributes.items) assert.deepEqual(Object.keys(entry).sort(), ["attributes", "itemGuid", "itemProfile", "itemType", "quantity"]);
    // Asking again keeps a roll that hasn't expired.
    const again = prerolls((await command("PopulatePrerolledOffers")).body.profileChanges[0].profile);
    assert.deepEqual(again.map(([itemId]) => itemId).sort(), rolls.map(([itemId]) => itemId).sort());

    await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: `/admin/api/accounts/${accountId}/grant`,
      headers: { "Content-Type": "application/json" } }, JSON.stringify({ templateId: "Currency:mtxpurchased", quantity: 200 }));
    const buy = (purchaseQuantity) => command("PurchaseCatalogEntry", { offerId: "core_xray_cardpack_bronze", purchaseQuantity,
      currency: "MtxCurrency", currencySubType: "", expectedPrice: 50 * purchaseQuantity }, "common_core");
    assert.equal((await buy(2)).status, 400, "X-Ray llamas are bought one at a time");
    const bought = await buy(1);
    assert.equal(bought.status, 200);
    // Core-Backend #413: a "Preroll" offer's lootResult is what the client shows as the llama's rewards (it sends no
    // OpenCardPack), so it lists the roll's items, and no card pack is left in the profile.
    const loot = bought.body.notifications[0].lootResult.items;
    const shown = upgrade.attributes.items.map(({ itemType, quantity }) => `${itemType.toLowerCase()} ${quantity}`).sort();
    const got = loot.map(({ itemType, quantity }) => `${itemType.toLowerCase()} ${quantity}`).sort();
    assert.deepEqual(got, shown);
    const campaign = (await command("QueryProfile")).body.profileChanges[0].profile;
    for (const { itemGuid, itemType } of loot) assert.ok(campaign.items[itemGuid], `${itemType} is in the profile`);
    assert.ok(!Object.values(campaign.items).some(({ templateId }) => templateId.toLowerCase().startsWith("cardpack:")), "no card pack is granted");
    const next = prerolls(campaign);
    assert.equal(next.length, 2);
    assert.ok(next.every(([itemId]) => !rolls.some(([old]) => old === itemId)), "both offers are rolled again");
  } finally {
    backend.close();
  }
});

test("Yarrr! sells the Pirate Llama for 500 Spring Tickets and Hybrid in the Event Store, on 8.20 only", () => {
  withEvents({ spring2019: "on" }, () => {
    const pirate = front(v820, "CardPackStoreGameplay").find(({ offerId }) => offerId === "core_event_pirate2019_llama");
    assert.deepEqual([pirate.prices[0].currencySubType, pirate.prices[0].finalPrice], [springTickets, 500]);
    assert.equal(pirate.displayAssetPath, "/Game/Items/CardPacks/Events/Release/CardPack_Event_2019_Pirate.CardPack_Event_2019_Pirate");
    assert.ok(!front(v800, "CardPackStoreGameplay").some(({ offerId }) => offerId === "core_event_pirate2019_llama"));

    const now = new Date();
    const store = inBuild(v820, () => eventStoreOffers(now));
    assert.deepEqual(store.STWSpecialEventStoreFront.map(({ templateId, price, eventLimit, purchaseLimitingEventId }) => [templateId, price, eventLimit, purchaseLimitingEventId]),
      [["Hero:hid_ninja_026_reddragonninja_sr_t01", 2800, 1, "Spring2019.STWSpecialEventStoreFront"]]);
    assert.ok(inBuild(v820, () => eventStoreEnds(now)).stwEventStoreEnd > now);
    assert.deepEqual(inBuild(v800, () => eventStoreOffers(now)).STWSpecialEventStoreFront, []);
  });
  withEvents({ spring2019: "off" }, () => {
    assert.ok(!front(v820, "CardPackStoreGameplay").some(({ offerId }) => offerId === "core_event_pirate2019_llama"));
  });
});

test("a Pirate Llama holds an Upgrade Llama's items and one Pirate Hero, Steampunk weapon or Broadside", () => {
  const pirate = /pirate(outlander|soldier|ninja|constructor)|steampunk|wall_cannons/;
  for (let i = 0; i < 20; i++) {
    const contents = inBuild(v820, () => rollContents("CardPack:cardpack_event_2019_pirate"));
    assert.equal(contents.filter(({ templateId }) => pirate.test(templateId.toLowerCase())).length >= 1, true);
  }
});
