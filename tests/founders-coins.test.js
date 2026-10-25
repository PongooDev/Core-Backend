import { test } from "node:test";
import assert from "node:assert/strict";
import { rollContents } from "../src/cardpacks/contents.js";
import { getQuest, questIds } from "../src/gamedata/quests.js";
import { post, startBackend, userLogin } from "./helpers.js";

// Founder's Coins: "Found by completing quests and in other llamas." (EventCurrency_Founders, Core-Backend #38)
const coins = "AccountResource:eventcurrency_founders";
const coinsIn = (contents) => contents.filter((item) => item.templateId === coins).reduce((sum, item) => sum + item.quantity, 0);
const command = (accountId, name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;

test("every daily quest rewards 20 Founder's Coins", () => {
  const dailies = questIds().filter((id) => getQuest(id).type === "DailyQuest");
  assert.equal(dailies.length, 27);
  for (const id of dailies) assert.deepEqual(getQuest(id).rewards.filter((reward) => reward.templateId === coins).map((reward) => reward.quantity), [20], id);
});

test("the llamas other than the founders event llamas hold Founder's Coins, more the better the llama", () => {
  assert.equal(coinsIn(rollContents("CardPack:cardpack_basic")), 5);
  assert.equal(coinsIn(rollContents("CardPack:cardpack_basic_silver")), 10);
  assert.equal(coinsIn(rollContents("CardPack:cardpack_bronze")), 10);
  assert.equal(coinsIn(rollContents("CardPack:cardpack_bronze_melee")), 10);
  assert.equal(coinsIn(rollContents("CardPack:cardpack_event_2017_winter_1")), 10);
  assert.equal(coinsIn(rollContents("CardPack:cardpack_silver")), 15);
  assert.equal(coinsIn(rollContents("CardPack:cardpack_silver_melee")), 15);
  assert.equal(coinsIn(rollContents("CardPack:cardpack_gold")), 20);
  // The llamas the coins buy, and packs that aren't llamas, hold none.
  assert.equal(coinsIn(rollContents("CardPack:cardpack_event_founders")), 0);
  assert.equal(coinsIn(rollContents("CardPack:cardpack_event_founders_nonexclusive")), 0);
  assert.equal(coinsIn(rollContents("CardPack:cardpack_worker_vr")), 0);
  assert.equal(coinsIn(rollContents("CardPack:zcp_heroxp_t01")), 0);
});

test("claiming a daily quest and opening an Upgrade Llama add Founder's Coins to the account", async () => {
  const backend = await startBackend();
  try {
    const login = await userLogin(backend.port, "CoreTest");
    const run = (name, body) => post(backend.port, command(login.accountId, name), login.token, body);
    const admin = (route, body) => post(backend.port, `/admin/api/accounts/${login.accountId}/${route}`, undefined, body);
    const items = async () => (await run("QueryProfile", {})).body.profileChanges[0].profile.items;
    const find = async (templateId) => Object.entries(await items()).find(([, item]) => item.templateId === templateId);

    await admin("grant", { templateId: "Quest:daily_destroygnomes", quantity: 1 });
    const [questId] = await find("Quest:daily_destroygnomes");
    assert.equal((await admin("quests", { itemId: questId, action: "complete" })).status, 200);
    const claim = await run("ClaimQuestReward", { questId, selectedRewardIndex: -1 });
    assert.equal(claim.status, 200);
    assert.deepEqual(claim.body.notifications[0].loot.items.map((item) => [item.itemType, item.quantity]),
      [["Currency:mtxgiveaway", 50], [coins, 20]]);
    assert.equal((await find(coins))[1].quantity, 20);

    await admin("grant", { templateId: "CardPack:cardpack_bronze", quantity: 1 });
    const [packId] = await find("CardPack:cardpack_bronze");
    const random = Math.random;
    Math.random = () => 0.99;
    let opened;
    try {
      opened = await run("OpenCardPack", { cardPackItemId: packId, selectionIdx: 0 });
    } finally {
      Math.random = random;
    }
    const loot = opened.body.notifications[0].lootGranted.items.filter((item) => item.itemType === coins);
    assert.deepEqual(loot.map((item) => item.quantity), [10]);
    const [coinsId, held] = await find(coins);
    assert.equal(held.quantity, 30);
    assert.equal(loot[0].itemGuid, coinsId);
  } finally {
    backend.close();
  }
});
