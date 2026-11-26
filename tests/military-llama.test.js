import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { militaryLlama, summerTickets } from "../src/events/talesofbeyond.js";
import { storefronts } from "../src/store/catalog.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #437: 9.00's (CL-6337466) Summer Tickets buy the Military Llama.
const v900 = "6337466";
const v851 = "6165369";
const offerId = "core_event_military2019_llama";
const front = (cl, name) => inBuild(cl, () => storefronts(null)).find((storefront) => storefront.name === name)?.catalogEntries ?? [];

function as(port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-9.00-CL-6337466", Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}
// 9.00 buys on common_core and keeps the llamas and tickets on campaign (Core's profile0, profiles/common.js).
const mcp = (port, { accountId, token }, name, profileId, body = {}) =>
  as(port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`, token, body);
const campaignOf = (response) => response.body.profileChanges.find((change) => change.changeType === "fullProfileUpdate").profile;
const held = (profile, templateId) => Object.values(profile.items).filter((item) => item.templateId === templateId)
  .reduce((sum, item) => sum + item.quantity, 0);

test("9.00's Loot tab sells the Military Llama for 500 Summer Tickets; 8.51's doesn't", () => {
  const offer = front(v900, "CardPackStoreGameplay").find((entry) => entry.offerId === offerId);
  assert.deepEqual(offer.prices.map(({ currencyType, currencySubType, finalPrice }) => [currencyType, currencySubType, finalPrice]),
    [["GameItem", summerTickets, 500]]);
  assert.deepEqual(offer.itemGrants, [{ templateId: militaryLlama, quantity: 1 }]);
  assert.equal(offer.displayAssetPath, "/Game/Items/CardPacks/Events/Release/CardPack_Event_2019_Military.CardPack_Event_2019_Military");
  assert.equal(offer.catalogGroup, "");
  assert.ok(!front(v900, "CardPackStorePreroll").some((entry) => entry.offerId === offerId));
  for (const name of ["CardPackStore", "CardPackStoreGameplay"]) assert.ok(!front(v851, name).some((entry) => entry.offerId === offerId), name);
});

test("a Military Llama holds an Upgrade Llama's items and one Epic or Legendary Military weapon or hero", () => {
  const military = /^(Schematic:sid_\w*military\w*|Hero:hid_\w+_4thjuly)_(vr|sr)(_ore)?_t01$/;
  for (let roll = 0; roll < 30; roll += 1) {
    const contents = inBuild(v900, () => rollContents(militaryLlama));
    assert.equal(contents.filter(({ templateId }) => military.test(templateId)).length >= 1, true, JSON.stringify(contents));
  }
  const [inner] = inBuild(v900, () => rollContents("CardPack:cardpack_event_2019_military_sr"));
  assert.match(inner.templateId, /_sr(_ore)?_t01$/);
});

test("buying the Military Llama on 9.00 spends 500 Summer Tickets", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Military900");
    const purchase = { offerId, purchaseQuantity: 1, currency: "GameItem", currencySubType: summerTickets, expectedPrice: 500 };
    await mcp(backend.port, player, "QueryProfile", "campaign");
    await mcp(backend.port, player, "QueryProfile", "common_core");
    const poor = await mcp(backend.port, player, "PurchaseCatalogEntry", "common_core", purchase);
    assert.equal(poor.body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed");

    const file = path.join(backend.dataDir, "accounts", player.accountId, "profiles", "profile0.json");
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    stored.items["summer-tickets"] = { templateId: summerTickets, attributes: { level: 1, item_seen: 0 }, quantity: 1200 };
    fs.writeFileSync(file, JSON.stringify(stored));

    const bought = await mcp(backend.port, player, "PurchaseCatalogEntry", "common_core", purchase);
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    assert.deepEqual(bought.body.notifications[0].lootResult.items.map((item) => item.itemType), [militaryLlama]);
    const profile = campaignOf(await mcp(backend.port, player, "QueryProfile", "campaign"));
    assert.equal(held(profile, summerTickets), 700);
    assert.equal(held(profile, militaryLlama), 1);

    const [packId] = Object.entries(profile.items).find(([, item]) => item.templateId === militaryLlama);
    const opened = await mcp(backend.port, player, "OpenCardPack", "campaign", { cardPackItemId: packId, selectionIdx: 0 });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const looted = opened.body.notifications[0].lootGranted.items.map((item) => item.itemType);
    assert.ok(looted.some((templateId) => /military|4thjuly/i.test(templateId)), JSON.stringify(looted));
  } finally {
    backend.close();
  }
});
