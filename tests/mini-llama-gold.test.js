import { test } from "node:test";
import assert from "node:assert/strict";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #289: a Mini Reward Llama bought with its voucher in 4.2's Loot tab and opened there holds Gold, which the
// open reports for the unboxing and adds to the account (campaign, 3.5.1 on).
const gold = "AccountResource:eventcurrency_scaling";
const voucher = "AccountResource:voucher_basicpack";
const agent = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.2-CL-4072250";

async function player(backend, name) {
  const { token, accountId } = await userLogin(backend.port, name);
  const headers = { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json" };
  const run = (command, body) => {
    const text = JSON.stringify(body);
    return send({ host: "127.0.0.1", port: backend.port, method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(text) },
      path: `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=campaign&rvn=-1` }, text);
  };
  const held = async (templateId) => Object.values((await run("QueryProfile", {})).body.profileChanges[0].profile.items)
    .filter((item) => item.templateId === templateId).reduce((sum, item) => sum + item.quantity, 0);
  const give = (templateId) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity: 1 });
  const catalog = () => send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/storefront/v2/catalog", headers });
  return { run, held, give, catalog };
}

for (const [label, roll, amount] of [["a Mini Reward Llama", 0.99, 25], ["a Mini Reward Llama that turns silver", 0.1, 50]]) {
  test(`4.2: opening ${label} from the Loot tab shows its Gold in the unboxing and adds it to the account (#289)`, async () => {
    const backend = await startBackend();
    try {
      const p = await player(backend, "MiniLlamaGold");
      await p.give(voucher);
      const offers = (await p.catalog()).body.storefronts.find((storefront) => storefront.name === "CardPackStore").catalogEntries;
      const mini = offers.find((offer) => offer.prices[0].currencySubType === voucher);
      const bought = await p.run("PurchaseCatalogEntry", { offerId: mini.offerId, purchaseQuantity: 1, currency: "GameItem", currencySubType: voucher, expectedPrice: 1 });
      assert.equal(bought.status, 200, JSON.stringify(bought.body));
      const [{ itemGuid, itemType }] = bought.body.notifications[0].lootResult.items;
      assert.equal(itemType, "CardPack:cardpack_basic");
      const random = Math.random;
      Math.random = () => roll;
      let opened;
      try {
        opened = await p.run("OpenCardPack", { cardPackItemId: itemGuid, selectionIdx: 0 });
      } finally {
        Math.random = random;
      }
      assert.equal(opened.status, 200, JSON.stringify(opened.body));
      const loot = opened.body.notifications[0].lootGranted.items;
      assert.deepEqual(loot.filter((item) => item.itemType === gold).map((item) => [item.quantity, item.itemProfile]), [[amount, "campaign"]]);
      assert.equal(await p.held(gold), amount);
    } finally {
      backend.close();
    }
  });
}
