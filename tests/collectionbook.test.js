import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { slotXp } from "../src/collectionbook/book.js";
import { slotFor } from "../src/collectionbook/pages.js";
import { recyclingRefunds } from "../src/profiles/upgrades.js";
import { post, startBackend, userLogin } from "./helpers.js";

async function bookAccount(backend, name) {
  const { token, accountId } = await userLogin(backend.port, name);
  const route = (command, profileId = "profile0") => `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`;
  const run = (command, body = {}, profileId = "profile0") => post(backend.port, route(command, profileId), token, body);
  const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
  const profile = async (profileId = "profile0") => (await run("QueryProfile", {}, profileId)).body.profileChanges[0].profile;
  const itemsOf = async (templateId, profileId = "profile0") => Object.entries((await profile(profileId)).items)
    .filter(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase());
  const page = async (pageId, profileId) => (await itemsOf(`CollectionBookPage:${pageId}`, profileId)).map(([, item]) => item);
  return { accountId, run, give, profile, itemsOf, page };
}

test("a slotted item's XP follows the client's formula", () => {
  // Hero weights: 3500 + rarity factor (R = 25) x 64 + rating x 325; rating of a level 1 R tier 1 hero.
  const hero = { templateId: "Hero:hid_commando_007_r_t01", attributes: { level: 1 } };
  const xp = slotXp(hero);
  assert.ok(xp > 3500 + 25 * 64, `${xp}`);
  assert.equal((xp - 3500 - 25 * 64) % 325, 0);
});

test("survivors go in the slot of their personality", () => {
  const survivor = (personality) => ({ templateId: "Worker:workerbasic_c_t01", attributes: { personality } });
  assert.equal(slotFor(survivor("Homebase.Worker.Personality.IsCurious")), "worker_C_Curious");
  assert.equal(slotFor(survivor("Homebase.Worker.Personality.IsDreamer")), "worker_C_Dreamer");
  assert.equal(slotFor({ templateId: "Hero:hid_commando_007_r_t01", attributes: {} }), "HID.Commando.007.R.T01");
});

test("unlocking a page gives its book profile the page item the client builds the book from", async () => {
  const backend = await startBackend();
  try {
    const book = await bookAccount(backend, "BookPages");
    assert.deepEqual(await book.page("pageHeroes_Commando", "collection_book_people0"), []);
    await book.give("CollectionBookPage:pageheroes_commando");
    await book.give("CollectionBookPage:pageRanged_Assault_Weapons");
    await book.give("CollectionBookPage:pageheroes_commando");
    assert.deepEqual(await book.page("pageHeroes_Commando", "collection_book_people0"), [{
      templateId: "CollectionBookPage:pageHeroes_Commando", attributes: { sectionStates: [], state: "Active" }, quantity: 1
    }]);
    assert.equal((await book.page("pageRanged_Assault_Weapons", "collection_book_schematics0")).length, 1);
    assert.deepEqual((await book.profile()).stats.attributes.collection_book.pages, ["pageHeroes_Commando", "pageRanged_Assault_Weapons"]);
  } finally {
    backend.close();
  }
});

test("slotting fills the page's sections, replaces a slotted item and earns book levels in order", async () => {
  const backend = await startBackend();
  try {
    const book = await bookAccount(backend, "BookSlots");
    const heroes = async () => (await book.itemsOf("Hero:hid_commando_007_r_t01")).map(([id]) => id);

    await book.give("Hero:hid_commando_007_r_t01", 2);
    const [first, second] = await heroes();
    const locked = await book.run("SlotItemInCollectionBook", { itemId: first });
    assert.equal(locked.status, 400);
    assert.match(locked.body.errorMessage, /isn't unlocked/);

    await book.give("CollectionBookPage:pageHeroes_Commando");
    const slotted = await book.run("SlotItemInCollectionBook", { itemId: first });
    assert.equal(slotted.status, 200);
    assert.deepEqual(slotted.body.notifications, [{ type: "collectionBookSlotItem", primary: true, slottedItemId: first }]);
    assert.deepEqual(slotted.body.multiUpdate.map((update) => update.profileId), ["collection_book_people0"]);
    assert.ok((await book.itemsOf("Hero:hid_commando_007_r_t01", "collection_book_people0")).some(([id]) => id === first));
    assert.deepEqual(await heroes(), [second]);

    // The second copy takes the slot; the first is recycled for its refunds.
    const refunds = recyclingRefunds("Hero:hid_commando_007_r_t01");
    assert.ok(refunds.length > 0);
    const replaced = await book.run("SlotItemInCollectionBook", { itemId: second });
    assert.equal(replaced.status, 200);
    assert.deepEqual((await book.itemsOf("Hero:hid_commando_007_r_t01", "collection_book_people0")).map(([id]) => id), [second]);
    for (const { templateId, quantity } of refunds) {
      assert.equal((await book.itemsOf(templateId)).reduce((sum, [, item]) => sum + item.quantity, 0), quantity, templateId);
    }

    // One rare hero is well over level 1 (1500 XP) and short of level 3 (6900).
    assert.equal((await book.run("ClaimCollectionBookRewards", { requiredXp: 3800, selectedRewardIndex: 0 })).status, 400);
    const claim = await book.run("ClaimCollectionBookRewards", { requiredXp: 1500, selectedRewardIndex: 0 });
    assert.equal(claim.status, 200);
    const [heroXp] = await book.itemsOf("AccountResource:heroxp");
    assert.equal(heroXp[1].quantity, 500);
    assert.deepEqual(claim.body.notifications, [{
      type: "collectionBookClaimReward", primary: true, page: "", section: "",
      loot: { tierGroupName: "", items: [{ itemType: "AccountResource:heroxp", itemGuid: heroXp[0], itemProfile: "profile0", quantity: 500 }] }
    }]);
    assert.equal((await book.run("ClaimCollectionBookRewards", { requiredXp: 1500, selectedRewardIndex: 0 })).status, 400);
    assert.equal((await book.profile()).stats.attributes.collection_book.maxBookXpLevelAchieved, 1);

    // Slotted items still level up, paid from profile0.
    assert.equal((await book.run("UpgradeSlottedItem", { targetItemId: second }, "collection_book_people0")).status, 200);
    assert.equal((await book.itemsOf("Hero:hid_commando_007_r_t01", "collection_book_people0"))[0][1].attributes.level, 2);
    assert.equal((await book.run("UpgradeSlottedItem", { targetItemId: second })).status, 400);

    // A full section is Completed; the page is too once every section is.
    const defenders = ["c", "uc", "r", "vr", "sr"].map((rarity) => `Defender:did_defenderassault_basic_${rarity}_t01`);
    await book.give("CollectionBookPage:pagePeople_Defenders");
    for (const templateId of defenders) {
      await book.give(templateId);
      const [[itemId]] = await book.itemsOf(templateId);
      assert.equal((await book.run("SlotItemInCollectionBook", { itemId })).status, 200, templateId);
    }
    const [people] = await book.page("pagePeople_Defenders", "collection_book_people0");
    assert.deepEqual(people.attributes, { sectionStates: [{ section: "people_Defenders_1", state: "Completed" }], state: "Active" });
    const empty = await book.run("ClaimCollectionBookPageRewards",
      { pageTemplateId: "CollectionBookPage:pagePeople_Defenders", sectionId: "people_Defenders_2", selectedRewardIndex: 0 }, "collection_book_people0");
    assert.match(empty.body.errorMessage, /Fill every slot/);
  } finally {
    backend.close();
  }
});

test("a completed section's and page's rewards are claimed once each", async () => {
  const backend = await startBackend();
  try {
    const book = await bookAccount(backend, "BookClaims");
    // Epic's test page is the only one with rewards: one section, one slot (the tier 0 sword every profile has).
    await book.give("CollectionBookPage:test_TestPage");
    const [[sword]] = await book.itemsOf("Schematic:sid_edged_sword_medium_c_ore_t00");
    const claim = (sectionId) => book.run("ClaimCollectionBookPageRewards",
      { pageTemplateId: "CollectionBookPage:test_TestPage", sectionId, selectedRewardIndex: 0 }, "collection_book_schematics0");
    assert.match((await claim("test_testSection")).body.errorMessage, /Fill every slot/);

    assert.equal((await book.run("SlotItemInCollectionBook", { itemId: sword })).status, 200);
    let [page] = await book.page("test_TestPage", "collection_book_schematics0");
    assert.deepEqual(page.attributes, { sectionStates: [{ section: "test_testSection", state: "Completed" }], state: "Completed" });

    const section = await claim("test_testSection");
    assert.equal(section.status, 200);
    assert.equal(section.body.notifications[0].section, "test_testSection");
    assert.equal(section.body.notifications[0].loot.items[0].quantity, 238);
    assert.match((await claim("test_testSection")).body.errorMessage, /Already claimed/);

    const whole = await claim("None");
    assert.equal(whole.status, 200);
    assert.deepEqual([whole.body.notifications[0].page, whole.body.notifications[0].section], ["test_TestPage", ""]);
    assert.equal((await book.itemsOf("AccountResource:schematicxp"))[0][1].quantity, 238 + 1337);
    [page] = await book.page("test_TestPage", "collection_book_schematics0");
    assert.deepEqual(page.attributes, { sectionStates: [{ section: "test_testSection", state: "Claimed" }], state: "Claimed" });
    assert.match((await claim("")).body.errorMessage, /Already claimed/);
    assert.equal((await book.run("ClaimCollectionBookPageRewards",
      { pageTemplateId: "CollectionBookPage:test_TestPage", sectionId: "", selectedRewardIndex: 0 })).status, 400, "only on a book profile");
  } finally {
    backend.close();
  }
});

test("book profiles saved with pages only in profile0's stat get their page items once", async () => {
  const backend = await startBackend();
  try {
    const book = await bookAccount(backend, "BookMigration");
    await book.profile();
    const file = (profileId) => path.join(backend.dataDir, "accounts", book.accountId, "profiles", `${profileId}.json`);
    const account = JSON.parse(fs.readFileSync(file("profile0"), "utf8"));
    account.stats.attributes.collection_book = { pages: ["pageheroes_commando", "pagetraps_wall"], maxBookXpLevelAchieved: 0 };
    fs.writeFileSync(file("profile0"), JSON.stringify(account));
    fs.writeFileSync(file("collection_book_people0"), JSON.stringify({
      profileId: "collection_book_people0", accountId: book.accountId, rvn: 4, wipeNumber: 1, version: "core", commandRevision: 3,
      stats: { attributes: { claimed_page_rewards: [] } },
      items: { slotted: { templateId: "Hero:hid_commando_007_r_t01", quantity: 1, attributes: { level: 1 } } }
    }));

    const people = await book.profile("collection_book_people0");
    assert.deepEqual(Object.values(people.items).map((item) => item.templateId).sort(), ["CollectionBookPage:pageHeroes_Commando", "Hero:hid_commando_007_r_t01"]);
    assert.deepEqual(people.stats.attributes, {});
    assert.equal(people.coreMigrations, undefined, "Core's bookkeeping isn't sent to the client");
    assert.equal((await book.page("pageTraps_Wall", "collection_book_schematics0")).length, 1);

    const saved = JSON.parse(fs.readFileSync(file("collection_book_people0"), "utf8"));
    assert.deepEqual(saved.coreMigrations, ["bookPages"]);
    for (const [itemId, item] of Object.entries(saved.items)) if (item.templateId.startsWith("CollectionBookPage:")) delete saved.items[itemId];
    fs.writeFileSync(file("collection_book_people0"), JSON.stringify(saved));
    assert.equal((await book.page("pageHeroes_Commando", "collection_book_people0")).length, 0, "once only");

    // The slotted hero counts once its page is there: level 1's 1500 XP can be claimed.
    await book.give("CollectionBookPage:pageHeroes_Commando");
    assert.equal((await book.run("ClaimCollectionBookRewards", { requiredXp: 1500, selectedRewardIndex: 0 })).status, 200);
  } finally {
    backend.close();
  }
});

const questOf = async (book, questId) => (await book.itemsOf(`Quest:${questId}`))[0]?.[1];

test("levelling the book completes Collections (challenge_collectionbook_1) and the test quest counts slots and levels", async () => {
  const backend = await startBackend();
  try {
    const book = await bookAccount(backend, "BookQuests");
    await book.give("Quest:challenge_collectionbook_1");
    await book.give("Quest:testquestcollectionbook");
    await book.give("CollectionBookPage:pageHeroes_Commando");
    await book.give("CollectionBookPage:pagePeople_Survivors");
    assert.equal((await questOf(book, "challenge_collectionbook_1")).attributes.quest_state, "Active");

    // A common survivor is far short of level 1 (1500 XP): slotted, but the book hasn't levelled.
    await book.give("Worker:workerbasic_c_t01");
    const [[worker]] = await book.itemsOf("Worker:workerbasic_c_t01");
    assert.equal((await book.run("SlotItemInCollectionBook", { itemId: worker })).status, 200);
    let test = await questOf(book, "testquestcollectionbook");
    assert.equal(test.attributes.completion_slot_any_collection_item_test1, 1);
    assert.equal(test.attributes["completion_slot_worker in_collection_book_test"], 1);
    assert.equal((await questOf(book, "challenge_collectionbook_1")).attributes.quest_state, "Active");

    // A rare hero takes it to level 2 (3800 XP) without a claim: the level the client shows counts.
    await book.give("Hero:hid_commando_007_r_t01");
    const [[hero]] = await book.itemsOf("Hero:hid_commando_007_r_t01");
    assert.equal((await book.run("SlotItemInCollectionBook", { itemId: hero })).status, 200);
    const quest = await questOf(book, "challenge_collectionbook_1");
    assert.equal(quest.attributes.completion_collectionbook_levelup, 1);
    assert.equal(quest.attributes.quest_state, "Completed", "its schematic XP reward waits for the rewards screen");
    test = await questOf(book, "testquestcollectionbook");
    assert.equal(test.attributes.completion_slot_any_collection_item_test1, 2);
    assert.equal(test.attributes["completion_slot_worker in_collection_book_test"], 1);
    assert.equal(test.attributes.completion_collectionbook_levelup, 2);
    assert.equal(test.attributes.quest_state, "Active", "5 survivors still to slot");
    assert.equal((await book.run("ClaimCollectionBookRewards", { requiredXp: 1500, selectedRewardIndex: 0 })).status, 200);
  } finally {
    backend.close();
  }
});

test("a book already levelled counts for Collections when it is granted and, if it was missed, at quest login", async () => {
  const backend = await startBackend();
  try {
    const book = await bookAccount(backend, "BookQuestsLater");
    await book.give("CollectionBookPage:pageHeroes_Commando");
    await book.give("Hero:hid_commando_007_r_t01");
    const [[hero]] = await book.itemsOf("Hero:hid_commando_007_r_t01");
    assert.equal((await book.run("SlotItemInCollectionBook", { itemId: hero })).status, 200);

    await book.give("Quest:challenge_collectionbook_1");
    let [questId, quest] = (await book.itemsOf("Quest:challenge_collectionbook_1"))[0];
    assert.equal(quest.attributes.quest_state, "Completed");

    // An account whose quest stayed at 0/1 (issue #22, before the book counted) catches up at its next quest login.
    const file = path.join(backend.dataDir, "accounts", book.accountId, "profiles", "profile0.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    Object.assign(saved.items[questId].attributes, { quest_state: "Active", completion_collectionbook_levelup: 0 });
    fs.writeFileSync(file, JSON.stringify(saved));
    assert.equal((await questOf(book, "challenge_collectionbook_1")).attributes.quest_state, "Active");
    assert.equal((await book.run("ClientQuestLogin")).status, 200);
    [questId, quest] = (await book.itemsOf("Quest:challenge_collectionbook_1"))[0];
    assert.equal(quest.attributes.completion_collectionbook_levelup, 1);
    assert.equal(quest.attributes.quest_state, "Completed");
  } finally {
    backend.close();
  }
});
