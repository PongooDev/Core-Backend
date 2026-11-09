import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { bookData } from "../src/collectionbook/pages.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Update v4.50's collection book (Core-Backend #297): unslotting for 20 V-Bucks (UnslotItemFromCollectionBook) and
// research and recruitment (ResearchItemFromCollectionBook), both from 4.5's own book data (CollectionBookData's
// UnslotCost, CollectionBookRecipes by each slot's PurchaseCosts).
const v450 = "4159770";
const v45 = "4166199";
const v442 = "4132537";

test("4.5's and 5.0's book data have the unslot cost and the recipes; 4.4.2's and Cert's have neither", () => {
  for (const build of [v450, v45, "4204761", "4214610"]) {
    const { unslotCost, recipes, slots } = inBuild(build, bookData);
    assert.deepEqual(unslotCost, [{ templateId: "Currency:mtxcomplimentary", quantity: 20 }]);
    assert.equal(Object.keys(recipes).length, 15);
    assert.deepEqual(recipes["Creation.CollectionBook.Hero.R"].costs, [
      { templateId: "AccountResource:reagent_people", quantity: 80 }, { templateId: "AccountResource:reagent_evolverarity_r", quantity: 100 }]);
    assert.deepEqual(recipes["Creation.CollectionBook.Weapon.C"].costs, [{ templateId: "AccountResource:reagent_weapons", quantity: 25 }]);
    assert.equal(slots["HID.Commando.007.R.T01"].purchase, "Creation.CollectionBook.Hero.R");
    assert.equal(slots["SID.Assault.Auto.C.Ore.T01"].purchase, "Creation.CollectionBook.Weapon.C");
    // "Event Items, Survivors, and Defenders CANNOT be obtained using this feature."
    assert.equal(slots["DID.DefenderAssault.Basic.R.T01"].purchase, undefined);
    assert.equal(slots.worker_C_Curious.purchase, undefined);
  }
  for (const build of [v442, "3532353"]) {
    const { unslotCost, recipes } = inBuild(build, bookData);
    assert.deepEqual([unslotCost, recipes], [[], {}]);
  }
});

async function account45(backend, name, build = v45) {
  const { token, accountId } = await userLogin(backend.port, name);
  const run = async (command, body = {}, profileId = "campaign") => send({
    host: "127.0.0.1", port: backend.port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-4.5-CL-${build}`, Authorization: `bearer ${token}`, "Content-Type": "application/json" }
  }, JSON.stringify(body));
  const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
  const profile = async (profileId = "campaign") => (await run("QueryProfile", {}, profileId)).body.profileChanges[0].profile;
  const itemsOf = async (templateId, profileId = "campaign") => Object.entries((await profile(profileId)).items)
    .filter(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase());
  const count = async (templateId, profileId = "common_core") => (await itemsOf(templateId, profileId)).reduce((sum, [, item]) => sum + item.quantity, 0);
  return { run, give, profile, itemsOf, count };
}

test("4.5 unslots a slotted item for 20 V-Bucks: the same item comes back, its XP leaves the book and the level stays", async () => {
  const backend = await startBackend();
  try {
    const book = await account45(backend, "Unslot45");
    await book.give("CollectionBookPage:pageHeroes_Commando");
    await book.give("Hero:hid_commando_007_r_t01");
    const [[heroId]] = await book.itemsOf("Hero:hid_commando_007_r_t01");
    assert.equal((await book.run("SlotItemInCollectionBook", { itemId: heroId })).status, 200);
    const slotted = (await book.itemsOf("Hero:hid_commando_007_r_t01", "collection_book_people0"))[0][1];
    assert.equal((await book.run("ClaimCollectionBookRewards", { requiredXp: 1500, selectedRewardIndex: 0 })).status, 200);

    // Without V-Bucks nothing moves.
    const poor = await book.run("UnslotItemFromCollectionBook", { itemId: heroId, specific: "", templateId: "Hero:hid_commando_007_r_t01" });
    assert.equal(poor.status, 400);
    assert.match(poor.body.errorMessage, /20 V-Bucks/);

    const vbucksBefore = await book.count("Currency:mtxpurchased");
    await book.give("Currency:mtxcomplimentary", 15);
    await book.give("Currency:mtxpurchased", 10);
    const unslotted = await book.run("UnslotItemFromCollectionBook", { itemId: heroId, specific: "", templateId: "Hero:hid_commando_007_r_t01" });
    assert.equal(unslotted.status, 200, JSON.stringify(unslotted.body));
    assert.deepEqual(unslotted.body.notifications, [{ type: "collectionBookUnslotItem", primary: true, unslottedItemId: heroId }]);
    // 15 complimentary first, then 5 of the purchased.
    assert.equal(await book.count("Currency:mtxcomplimentary"), 0);
    assert.equal(await book.count("Currency:mtxpurchased"), vbucksBefore + 5);
    // The same item, id, level and all, back in the account; the book's slot is empty.
    const [[backId, back]] = await book.itemsOf("Hero:hid_commando_007_r_t01");
    assert.equal(backId, heroId);
    assert.equal(back.attributes.level, slotted.attributes.level);
    assert.deepEqual(await book.itemsOf("Hero:hid_commando_007_r_t01", "collection_book_people0"), []);
    // The level claimed stays; level 2 needs its whole XP again (the XP debt).
    const stats = (await book.profile()).stats.attributes.collection_book;
    assert.equal(stats.maxBookXpLevelAchieved, 1);
    const next = await book.run("ClaimCollectionBookRewards", { requiredXp: 3800, selectedRewardIndex: 0 });
    assert.equal(next.status, 400);
    assert.match(next.body.errorMessage, /has 0 of 3800 XP/);

    // An item that isn't slotted can't be unslotted.
    assert.equal((await book.run("UnslotItemFromCollectionBook", { itemId: heroId })).status, 400);
  } finally {
    backend.close();
  }
});

test("4.5 researches a schematic and recruits a hero from the book for their recipes' Flux and manuals or designs", async () => {
  const backend = await startBackend();
  try {
    const book = await account45(backend, "Research45", v450);
    // The page must be unlocked.
    const locked = await book.run("ResearchItemFromCollectionBook", { templateId: "Hero:hid_commando_007_r_t01" });
    assert.equal(locked.status, 400);
    assert.match(locked.body.errorMessage, /isn't unlocked/);
    await book.give("CollectionBookPage:pageHeroes_Commando");
    await book.give("CollectionBookPage:pageRanged_Assault_Weapons");

    // Not enough training manuals: nothing is taken.
    await book.give("AccountResource:reagent_people", 79);
    await book.give("AccountResource:reagent_evolverarity_r", 100);
    const short = await book.run("ResearchItemFromCollectionBook", { templateId: "Hero:hid_commando_007_r_t01" });
    assert.equal(short.status, 400);
    assert.equal(await book.count("AccountResource:reagent_people", "campaign"), 79);

    await book.give("AccountResource:reagent_people", 1);
    const recruited = await book.run("ResearchItemFromCollectionBook", { templateId: "Hero:hid_commando_007_r_t01" });
    assert.equal(recruited.status, 200, JSON.stringify(recruited.body));
    const [[heroId, hero]] = await book.itemsOf("Hero:hid_commando_007_r_t01");
    assert.deepEqual(recruited.body.notifications, [{ type: "collectionBookResearchedItem", primary: true, researchedItemId: heroId, researchedTemplateId: "Hero:hid_commando_007_r_t01" }]);
    assert.equal(hero.attributes.level, 1);
    assert.equal(await book.count("AccountResource:reagent_people", "campaign"), 0);
    assert.equal(await book.count("AccountResource:reagent_evolverarity_r", "campaign"), 0);

    // A common assault rifle schematic: 25 weapon designs, the template sent back as the client wrote it.
    await book.give("AccountResource:reagent_weapons", 30);
    const researched = await book.run("ResearchItemFromCollectionBook", { templateId: "Schematic:SID_Assault_Auto_C_Ore_T01" });
    assert.equal(researched.status, 200, JSON.stringify(researched.body));
    assert.equal(researched.body.notifications[0].researchedTemplateId, "Schematic:SID_Assault_Auto_C_Ore_T01");
    assert.equal(await book.count("AccountResource:reagent_weapons", "campaign"), 5);
    assert.equal((await book.itemsOf("Schematic:sid_assault_auto_c_ore_t01")).length, 1);

    // Defenders and survivors aren't for sale.
    await book.give("CollectionBookPage:pagePeople_Defenders");
    assert.equal((await book.run("ResearchItemFromCollectionBook", { templateId: "Defender:did_defenderassault_basic_r_t01" })).status, 400);
  } finally {
    backend.close();
  }
});

test("4.4.2's book refuses both 4.5 commands: its data has no unslot cost or recipes", async () => {
  const backend = await startBackend();
  try {
    const book = await account45(backend, "Book442", v442);
    await book.give("CollectionBookPage:pageHeroes_Commando");
    await book.give("AccountResource:reagent_people", 500);
    await book.give("AccountResource:reagent_evolverarity_r", 500);
    assert.equal((await book.run("ResearchItemFromCollectionBook", { templateId: "Hero:hid_commando_007_r_t01" })).status, 400);
    assert.equal((await book.run("UnslotItemFromCollectionBook", { itemId: "nope" })).status, 400);
  } finally {
    backend.close();
  }
});
