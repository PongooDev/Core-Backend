import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readGameData } from "../src/gamedata/read.js";
import { rollContents, rollOptions, upgradedPack } from "../src/cardpacks/contents.js";
import { post, startBackend, userLogin } from "./helpers.js";

const items = new Set(Object.keys(readGameData("items", {})).map((id) => id.toLowerCase()));
const command = (accountId, name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;

async function account(backend) {
  const login = await userLogin(backend.port, "CoreTest");
  const run = (name, body) => post(backend.port, command(login.accountId, name), login.token, body);
  const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${login.accountId}/grant`, undefined, { templateId, quantity });
  const profile = async () => (await run("QueryProfile", {})).body.profileChanges[0].profile;
  const find = async (templateId) => Object.entries((await profile()).items).find(([, item]) => item.templateId === templateId);
  return { ...login, run, give, profile, find };
}

test("the packs players can get roll real items, and the descriptions decide what kind", () => {
  const roll = (id) => rollContents(id).map((item) => item.templateId);
  for (const id of ["CardPack:cardpack_bronze", "CardPack:cardpack_worker_vr", "CardPack:cardpack_defender_r", "CardPack:cardpack_trapwalldarts_uc",
    "CardPack:cardpack_custom_firecracker_r", "CardPack:cardpack_event_founders", "CardPack:zcp_heroxp_t01", "CardPack:zcp_reagent_c_t02_high"]) {
    const rolled = roll(id);
    assert.ok(rolled.length > 0, id);
    for (const templateId of rolled) assert.ok(items.has(templateId.toLowerCase()), `${id} -> ${templateId}`);
  }
  assert.match(roll("CardPack:cardpack_worker_vr")[0], /^Worker:worker.*_vr_t01$/);
  assert.match(roll("CardPack:cardpack_trapwalldarts_uc")[0], /^Schematic:sid_wall_darts_/);
  assert.match(roll("CardPack:cardpack_custom_firecracker_r")[0], /firecracker/);
  assert.deepEqual(rollContents("CardPack:zcp_heroxp_t01"), [{ templateId: "AccountResource:heroxp", quantity: 100 }]);
  assert.deepEqual(rollContents("CardPack:zcp_reagent_c_t02_high"), [{ templateId: "AccountResource:reagent_c_t02", quantity: 2 }]);
  assert.deepEqual(roll("CardPack:cardpack_founders_banners_t01"),
    ["FounderTier1Banner1", "FounderTier1Banner2", "FounderTier1Banner3", "FounderTier1Banner4"].map((row) => `HomebaseBannerIcon:${row}`));
  const options = rollOptions("CardPack:cardpack_choice_hero_r");
  assert.equal(options.length, 2);
  for (const option of options) assert.match(option.itemType, /^Hero:hid_.*_r_t01$/);
});

test("OpenCardPack takes the pack, grants what it held and reports it for the llama store", async () => {
  const backend = await startBackend();
  try {
    const user = await account(backend);
    await user.give("CardPack:cardpack_bronze");
    const [packId, pack] = await user.find("CardPack:cardpack_bronze");
    assert.equal(pack.attributes.pack_source, "Store");

    // A roll past the upgrade chances keeps the llama bronze.
    const random = Math.random;
    Math.random = () => 0.99;
    let opened;
    try {
      opened = await user.run("OpenCardPack", { cardPackItemId: packId, selectionIdx: 0 });
    } finally {
      Math.random = random;
    }
    assert.equal(opened.status, 200);
    const [notification] = opened.body.notifications;
    assert.deepEqual([notification.type, notification.primary, notification.lootGranted.tierGroupName, notification.displayLevel], ["cardPackResult", true, "CardPack_Bronze", 0]);
    const after = await user.profile();
    assert.equal(after.items[packId], undefined);
    assert.ok(notification.lootGranted.items.length > 0);
    for (const loot of notification.lootGranted.items) {
      if (loot.itemProfile === "profile0") assert.equal(after.items[loot.itemGuid].templateId, loot.itemType);
    }

    assert.equal((await user.run("OpenCardPack", { cardPackItemId: packId, selectionIdx: 0 })).status, 400);
  } finally {
    backend.close();
  }
});

test("store llamas can turn silver or gold, from the silver and gold llama definitions that ship", () => {
  const upgrade = (templateId, roll) => upgradedPack(templateId, roll).templateId;
  assert.equal(upgrade("CardPack:cardpack_bronze", 0.99), "CardPack:cardpack_bronze");
  assert.equal(upgrade("CardPack:cardpack_bronze", 0.1), "CardPack:cardpack_silver");
  assert.equal(upgrade("CardPack:cardpack_bronze", 0.01), "CardPack:cardpack_gold");
  assert.equal(upgrade("CardPack:cardpack_bronze_melee", 0.01), "CardPack:cardpack_gold_melee");
  assert.equal(upgrade("CardPack:cardpack_bronze_personnel", 0.1), "CardPack:cardpack_silver_personnel");
  assert.equal(upgrade("CardPack:cardpack_event_2017_winter_1", 0.01), "CardPack:cardpack_gold");
  // The Mini Reward Llama only has a silver version.
  assert.equal(upgrade("CardPack:cardpack_basic", 0.01), "CardPack:cardpack_basic_silver");
  assert.equal(upgrade("CardPack:cardpack_basic", 0.99), "CardPack:cardpack_basic");
  assert.equal(upgrade("CardPack:cardpack_worker_vr", 0.01), "CardPack:cardpack_worker_vr");

  for (const id of ["CardPack:cardpack_silver", "CardPack:cardpack_gold", "CardPack:cardpack_silver_melee", "CardPack:cardpack_basic_silver"]) {
    const rolled = rollContents(id);
    assert.ok(rolled.length >= 3, id);
    for (const item of rolled) assert.ok(items.has(item.templateId.toLowerCase()), `${id} -> ${item.templateId}`);
  }
  // Six items and the gold llama's Founder's Coins.
  assert.equal(rollContents("CardPack:cardpack_gold").length, 7);
});

test("a gold Upgrade Llama reports displayLevel 2 and the gold group, and still counts as the llama opened", async () => {
  const backend = await startBackend();
  try {
    const user = await account(backend);
    await user.give("Quest:homebaseonboardingafteroutpost");
    await user.give("CardPack:cardpack_bronze");
    await user.give("CardPack:cardpack_basic");
    const [bronzeId] = await user.find("CardPack:cardpack_bronze");
    const [basicId] = await user.find("CardPack:cardpack_basic");

    const random = Math.random;
    Math.random = () => 0.01;
    let gold;
    let silver;
    try {
      gold = await user.run("OpenCardPack", { cardPackItemId: bronzeId, selectionIdx: 0 });
      silver = await user.run("OpenCardPack", { cardPackItemId: basicId, selectionIdx: 0 });
    } finally {
      Math.random = random;
    }
    const [goldResult] = gold.body.notifications;
    assert.deepEqual([goldResult.displayLevel, goldResult.lootGranted.tierGroupName, goldResult.lootGranted.items.length], [2, "CardPack_Gold", 7]);
    assert.deepEqual(goldResult.lootGranted.items.filter((item) => item.itemType === "AccountResource:eventcurrency_founders").map((item) => item.quantity), [20]);
    const [silverResult] = silver.body.notifications;
    assert.deepEqual([silverResult.displayLevel, silverResult.lootGranted.tierGroupName], [1, "CardPack_Basic_Silver"]);

    const quest = Object.values(await user.profile().then((profile) => profile.items))
      .find((item) => item.templateId === "Quest:homebaseonboardingafteroutpost");
    assert.equal(quest.attributes.completion_open_card_pack, 1);
  } finally {
    backend.close();
  }
});

test("a choice pack gives the option picked", async () => {
  const backend = await startBackend();
  try {
    const user = await account(backend);
    await user.give("CardPack:cardpack_choice_hero_r");
    const [packId, pack] = await user.find("CardPack:cardpack_choice_hero_r");
    assert.equal(pack.attributes.options.length, 2);

    assert.equal((await user.run("OpenCardPack", { cardPackItemId: packId, selectionIdx: 5 })).status, 400);
    const opened = await user.run("OpenCardPack", { cardPackItemId: packId, selectionIdx: 1 });
    const [loot] = opened.body.notifications[0].lootGranted.items;
    assert.equal(loot.itemType, pack.attributes.options[1].itemType);
    assert.equal((await user.profile()).items[loot.itemGuid].templateId, loot.itemType);
  } finally {
    backend.close();
  }
});

test("the rewards screen opens several packs at once, and packs granted before pack_source get one", async () => {
  const backend = await startBackend();
  try {
    const user = await account(backend);
    await user.give("CardPack:zcp_heroxp_t01", 2);
    const packs = Object.entries((await user.profile()).items).filter(([, item]) => item.templateId === "CardPack:zcp_heroxp_t01").map(([id]) => id);
    const batch = await user.run("OpenCardPackBatch", { cardPackItemIds: [...packs, "missing"] });
    assert.equal(batch.status, 200);
    assert.deepEqual(batch.body.notifications[0].lootGranted.items.map((item) => [item.itemType, item.quantity]),
      [["AccountResource:heroxp", 100], ["AccountResource:heroxp", 100]]);

    const file = path.join(backend.dataDir, "accounts", user.accountId, "profiles", "profile0.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.items["old-pack"] = { templateId: "CardPack:cardpack_choice_all_r", attributes: { level: 1 }, quantity: 1 };
    fs.writeFileSync(file, JSON.stringify(saved));
    const old = (await user.profile()).items["old-pack"];
    assert.equal(old.attributes.pack_source, "Store");
    assert.equal(old.attributes.options.length, 2);
  } finally {
    backend.close();
  }
});

// Core-Backend #40: the llama store reads an opened pack's cardPackResult, and with no items in it shows "Oh no! Your
// pack didn't contain anything" (FortStoreContext's OpenCardPack callback, 1.2 sub_142C1CA80 / Cert sub_2C21850).
test("a Founders Banners pack whose banners the account already has opens to those banners (#40)", async () => {
  const backend = await startBackend();
  try {
    const user = await account(backend);
    const packTemplate = "CardPack:cardpack_founders_banners_t01";
    await user.give(packTemplate, 2);
    const packs = Object.entries((await user.profile()).items).filter(([, item]) => item.templateId === packTemplate).map(([id]) => id);
    assert.equal(packs.length, 2);

    const first = await user.run("OpenCardPack", { cardPackItemId: packs[0], selectionIdx: 0 });
    const banners = first.body.notifications[0].lootGranted.items;
    assert.deepEqual(banners.map((loot) => loot.itemType),
      ["FounderTier1Banner1", "FounderTier1Banner2", "FounderTier1Banner3", "FounderTier1Banner4"].map((row) => `HomebaseBannerIcon:${row}`));

    // A banner is owned once, so the second pack adds none: it reports the banners the account holds.
    const second = await user.run("OpenCardPack", { cardPackItemId: packs[1], selectionIdx: 0 });
    assert.equal(second.status, 200);
    const [result] = second.body.notifications;
    assert.equal(result.type, "cardPackResult");
    assert.deepEqual(result.lootGranted.items.map((loot) => [loot.itemType, loot.itemGuid, loot.itemProfile, loot.quantity]),
      banners.map((loot) => [loot.itemType, loot.itemGuid, "profile0", 1]));
    const after = await user.profile();
    assert.equal(after.items[packs[1]], undefined, "the pack is used up");
    assert.equal(Object.values(after.items).filter((item) => item.templateId.startsWith("HomebaseBannerIcon:FounderTier1")).length, 4);
  } finally {
    backend.close();
  }
});

test("a pack that gives nothing is refused and kept, opened alone or with the mission rewards (#40)", async () => {
  const backend = await startBackend();
  try {
    const user = await account(backend);
    // Accounts are shared by builds: a choice pack rolled where its options' template exists, opened on a build without it.
    await user.give("CardPack:cardpack_choice_hero_r");
    const [packId] = await user.find("CardPack:cardpack_choice_hero_r");
    const file = path.join(backend.dataDir, "accounts", user.accountId, "profiles", "profile0.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const option of saved.items[packId].attributes.options) option.itemType = "Hero:hid_no_such_hero_r_t01";
    fs.writeFileSync(file, JSON.stringify(saved));

    const opened = await user.run("OpenCardPack", { cardPackItemId: packId, selectionIdx: 0 });
    assert.equal(opened.status, 400);
    assert.equal(opened.body.errorCode, "errors.com.epicgames.fortnite.card_pack_empty");
    assert.ok((await user.profile()).items[packId], "the pack is kept");

    for (const cardPackItemIds of [[packId], ["missing"], [packId, "missing"]]) {
      const batch = await user.run("OpenCardPackBatch", { cardPackItemIds });
      assert.equal(batch.status, 400, JSON.stringify(cardPackItemIds));
    }
    assert.ok((await user.profile()).items[packId], "the pack is still kept");

    // With a pack that does open, the batch reports that one and keeps the other.
    await user.give("CardPack:zcp_heroxp_t01");
    const [heroXpPack] = await user.find("CardPack:zcp_heroxp_t01");
    const batch = await user.run("OpenCardPackBatch", { cardPackItemIds: [packId, heroXpPack] });
    assert.equal(batch.status, 200);
    assert.deepEqual(batch.body.notifications[0].lootGranted.items.map((item) => [item.itemType, item.quantity]), [["AccountResource:heroxp", 100]]);
    const after = await user.profile();
    assert.ok(after.items[packId]);
    assert.equal(after.items[heroXpPack], undefined);
  } finally {
    backend.close();
  }
});
