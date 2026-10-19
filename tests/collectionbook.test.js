import { test } from "node:test";
import assert from "node:assert/strict";
import { slotXp } from "../src/collectionbook/book.js";
import { post, startBackend, userLogin } from "./helpers.js";

test("a slotted item's XP follows the client's formula", () => {
  // Hero weights: 3500 + rarity factor (R = 25) x 64 + rating x 325; rating of a level 1 R tier 1 hero.
  const hero = { templateId: "Hero:hid_commando_007_r_t01", attributes: { level: 1 } };
  const xp = slotXp(hero);
  assert.ok(xp > 3500 + 25 * 64, `${xp}`);
  assert.equal((xp - 3500 - 25 * 64) % 325, 0);
});

test("items move into the book on an unlocked page, and book levels are claimed in order for their rewards", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "BookTest");
    const route = (name, profileId = "profile0") => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`;
    const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
    const items = async (profileId = "profile0") => Object.entries((await post(backend.port, route("QueryProfile", profileId), token, {})).body.profileChanges[0].profile.items);
    const heroId = async () => (await items()).find(([, item]) => item.templateId === "Hero:hid_commando_007_r_t01")?.[0];

    await give("Hero:hid_commando_007_r_t01", 2);
    const first = await heroId();
    const lockedPage = await post(backend.port, route("SlotItemInCollectionBook"), token, { itemId: first });
    assert.equal(lockedPage.status, 400);
    assert.match(lockedPage.body.errorMessage, /isn't unlocked/);

    await give("CollectionBookPage:pageheroes_commando");
    const slotted = await post(backend.port, route("SlotItemInCollectionBook"), token, { itemId: first });
    assert.equal(slotted.status, 200);
    assert.deepEqual(slotted.body.multiUpdate.map((update) => update.profileId), ["collection_book_people0"]);
    assert.ok((await items("collection_book_people0")).some(([id]) => id === first));
    assert.equal((await items()).some(([id]) => id === first), false);

    const second = await heroId();
    assert.match((await post(backend.port, route("SlotItemInCollectionBook"), token, { itemId: second })).body.errorMessage, /already filled/);

    // One rare hero is well over level 1 (1500 XP) and short of level 3 (6900).
    assert.equal((await post(backend.port, route("ClaimCollectionBookRewards"), token, { requiredXp: 3800, selectedRewardIndex: 0 })).status, 400);
    assert.equal((await post(backend.port, route("ClaimCollectionBookRewards"), token, { requiredXp: 1500, selectedRewardIndex: 0 })).status, 200);
    assert.equal((await post(backend.port, route("ClaimCollectionBookRewards"), token, { requiredXp: 1500, selectedRewardIndex: 0 })).status, 400);
    const profile = (await post(backend.port, route("QueryProfile"), token, {})).body.profileChanges[0].profile;
    assert.equal(profile.stats.attributes.collection_book.maxBookXpLevelAchieved, 1);
    assert.equal(Object.values(profile.items).find((item) => item.templateId === "AccountResource:heroxp").quantity, 500);

    // Slotted items still level up, paid from profile0.
    const upgrade = await post(backend.port, route("UpgradeSlottedItem", "collection_book_people0"), token, { targetItemId: first });
    assert.equal(upgrade.status, 200);
    assert.equal((await items("collection_book_people0")).find(([id]) => id === first)[1].attributes.level, 2);
    assert.equal((await post(backend.port, route("UpgradeSlottedItem"), token, { targetItemId: first })).status, 400);

    const nothing = await post(backend.port, route("ClaimCollectionBookPageRewards", "collection_book_people0"), token,
      { pageTemplateId: "pageHeroes_Commando", sectionId: "", selectedRewardIndex: 0 });
    assert.match(nothing.body.errorMessage, /nothing to claim/);
  } finally {
    backend.close();
  }
});
