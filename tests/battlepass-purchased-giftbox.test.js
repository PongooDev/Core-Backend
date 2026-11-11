import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { battlePassPurchaseGiftBox, isBattlePassGiftBox } from "../src/profiles/giftboxes.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #326: from Season 5 the Battle Pass purchase animation (BP_BattlePassUnlockAnim) plays only before a
// GiftBox:GB_BattlePassPurchased's screen; a GB_BattlePass is the list of rewards alone. Season 3 and 4 keep GB_BattlePass,
// whose ItemReceived_Base plays the animation for their tier 1 (profiles/giftboxes.js).
const agentOf = (version, changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-${version}-CL-${changelist}`;
const purchasedBox = "giftbox:gb_battlepasspurchased";
const tierBox = "giftbox:gb_battlepass";

function command(port, { accountId, token }, name, profileId, body, agent) {
  const text = JSON.stringify(body ?? {});
  return send({
    host: "127.0.0.1", port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}
const profileOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);
const queryProfile = async (port, player, profileId, agent) =>
  profileOf((await command(port, player, "QueryProfile", profileId, {}, agent)).body, profileId).profileChanges[0].profile;
const giftBoxesOf = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId.toLowerCase().startsWith("giftbox:"));
const lootTypes = (box) => box.attributes.lootList.map((loot) => loot.itemType.toLowerCase());

async function newPlayer(port, name, agent) {
  const player = await userLogin(port, name);
  await queryProfile(port, player, "athena", agent);
  assert.equal((await post(port, `/admin/api/accounts/${player.accountId}/currency`, undefined, { key: "vbucks", quantity: 10000 })).status, 200);
  return player;
}

async function buy(port, player, profileId, offerId, expectedPrice, agent, purchaseQuantity = 1) {
  const bought = await command(port, player, "PurchaseCatalogEntry", profileId,
    { offerId, purchaseQuantity, currency: "MtxCurrency", expectedPrice }, agent);
  assert.equal(bought.status, 200, JSON.stringify(bought.body));
  assert.equal(bought.body.notifications[0].type, "CatalogPurchase");
  return bought.body.notifications[0].lootResult.items;
}

test("#326: the Battle Pass's own purchase is a GB_BattlePassPurchased from 5.0 on, a GB_BattlePass before; tiers stay GB_BattlePass", () => {
  for (const build of ["3901517", "4039451", "4166199"]) assert.equal(inBuild(build, battlePassPurchaseGiftBox), "GiftBox:gb_battlepass", build);
  for (const build of ["4204761", "4214610", "4288479", "4363240", "4395664", "4402180"]) {
    assert.equal(inBuild(build, battlePassPurchaseGiftBox), "GiftBox:gb_battlepasspurchased", build);
  }
  assert.ok(isBattlePassGiftBox("GiftBox:GB_BattlePass") && isBattlePassGiftBox("GiftBox:GB_BattlePassPurchased"));
  assert.ok(!isBattlePassGiftBox("GiftBox:gb_battlepasspromise"));
});

test("#326: 6.00's Battle Pass comes in a GB_BattlePassPurchased of DJ Yonder, Calamity and the rest, which RemoveGiftBox takes", async () => {
  const backend = await startBackend();
  try {
    for (const changelist of ["4395664", "4402180"]) {
      const agent = agentOf("6.00", changelist);
      const player = await newPlayer(backend.port, `Pass600_${changelist}`, agent);
      const before = new Set(giftBoxesOf(await queryProfile(backend.port, player, "common_core", agent)).map(([id]) => id));
      const loot = await buy(backend.port, player, "common_core", "core_br_season6_battlepass", 950, agent);
      const boxes = giftBoxesOf(await queryProfile(backend.port, player, "common_core", agent)).filter(([id]) => !before.has(id));
      assert.equal(boxes.length, 1, changelist);
      const [boxId, box] = boxes[0];
      assert.equal(box.templateId.toLowerCase(), purchasedBox, "the box whose GiftBoxPreMessageWidget is BP_BattlePassUnlockAnim");
      assert.deepEqual(box.attributes.lootList, loot, "after the animation, the screen lists what the purchase gave");
      for (const outfit of ["athenacharacter:cid_233_athena_commando_m_fortnitedj", "athenacharacter:cid_237_athena_commando_f_cowgirl"]) {
        assert.ok(lootTypes(box).includes(outfit), outfit);
      }
      assert.equal(giftBoxesOf(await queryProfile(backend.port, player, "athena", agent)).length, 0, "gift boxes are common_core's");
      const removed = await command(backend.port, player, "RemoveGiftBox", "common_core", { giftBoxItemIds: [boxId] }, agent);
      assert.equal(removed.status, 200);
      assert.equal((await queryProfile(backend.port, player, "common_core", agent)).items[boxId], undefined);

      // Tiers bought afterwards are the tiers-reached screen, a GB_BattlePass, as before.
      const tiers = await buy(backend.port, player, "common_core", "A6FE59C497B844068E1B5D84396F19BA", 150, agent, 2);
      const tierBoxes = giftBoxesOf(await queryProfile(backend.port, player, "common_core", agent));
      assert.deepEqual(tierBoxes.map(([, item]) => item.templateId.toLowerCase()), [tierBox]);
      assert.deepEqual(tierBoxes[0][1].attributes.lootList, tiers);
    }
  } finally {
    backend.close();
  }
});

test("#326: 6.00's Battle Bundle and Season 5's pass are GB_BattlePassPurchased too; Season 4's pass keeps GB_BattlePass with Carbide", async () => {
  const backend = await startBackend();
  try {
    const cases = [
      { version: "6.00", changelist: "4402180", offerId: "core_br_season6_battlebundle", price: 2800, box: purchasedBox },
      { version: "5.0", changelist: "4204761", offerId: "core_br_season5_battlepass", price: 950, box: purchasedBox },
      { version: "5.21", changelist: "4288479", offerId: "core_br_season5_battlepass", price: 950, box: purchasedBox },
      { version: "4.0", changelist: "4039451", offerId: "core_br_season4_battlepass", price: 950, box: tierBox,
        holds: "athenacharacter:cid_115_athena_commando_m_carbideblue" }
    ];
    for (const { version, changelist, offerId, price, box, holds } of cases) {
      const agent = agentOf(version, changelist);
      const player = await newPlayer(backend.port, `Box${changelist}`, agent);
      const profileId = Number(changelist) >= 4000805 ? "common_core" : "profile0";
      const before = new Set(giftBoxesOf(await queryProfile(backend.port, player, profileId, agent)).map(([id]) => id));
      const loot = await buy(backend.port, player, profileId, offerId, price, agent);
      const boxes = giftBoxesOf(await queryProfile(backend.port, player, profileId, agent)).filter(([id]) => !before.has(id));
      assert.deepEqual(boxes.map(([, item]) => item.templateId.toLowerCase()), [box], `${version} ${offerId}`);
      assert.deepEqual(boxes[0][1].attributes.lootList, loot);
      if (holds) assert.ok(lootTypes(boxes[0][1]).includes(holds), "Season 4's ItemReceived_Base plays its animation for Carbide");
    }
  } finally {
    backend.close();
  }
});

test("#326: the admin panel's Battle Pass reset takes an unopened GB_BattlePassPurchased with the pass", async () => {
  const backend = await startBackend();
  try {
    const agent = agentOf("6.00", "4402180");
    const player = await newPlayer(backend.port, "Reset600", agent);
    await buy(backend.port, player, "common_core", "core_br_season6_battlepass", 950, agent);
    const held = async () => giftBoxesOf(await queryProfile(backend.port, player, "common_core", agent))
      .map(([, item]) => item.templateId.toLowerCase());
    assert.ok((await held()).includes(purchasedBox));
    const done = await post(backend.port, `/admin/api/accounts/${player.accountId}/battle-pass/reset`, undefined, {});
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.battlePassReset.season, 6);
    assert.ok(!(await held()).includes(purchasedBox));
  } finally {
    backend.close();
  }
});
