import { test } from "node:test";
import assert from "node:assert/strict";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
import { transmogItem, transmogTier } from "../src/transmog/transmog.js";
import { post, startBackend, userLogin } from "./helpers.js";

function memorySession() {
  const trackers = {};
  return {
    profile(profileId) {
      trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: defaultStats(profileId) }, items: {} });
      return trackers[profileId];
    }
  };
}

const key = "ConversionControl:cck_hero_ninja_consumable";

test("the result's rarity is the highest tier whose cost the points reach", () => {
  const tiers = [-1, 64, 160, 400, 1000, -1, -1, -1, -1, -1].map((cost) => ({ cost, quantity: 1 }));
  assert.equal(transmogTier({ tiers }, 63), -1);
  assert.equal(transmogTier({ tiers }, 64), 1);
  assert.equal(transmogTier({ tiers }, 399), 2);
  assert.equal(transmogTier({ tiers }, 5000), 4);
});

test("a key turns sacrificed items into an item of its kind, spending its resource and itself", () => {
  const session = memorySession();
  const tracker = session.profile("profile0");
  tracker.addItem("recycler", { templateId: "HomebaseNode:t1_main_609c8a9a8", attributes: {}, quantity: 1 }); // Unlocks.Recycler.Upgrade3
  tracker.addItem("key", { templateId: key, attributes: {}, quantity: 2 });
  tracker.addItem("reagents", { templateId: "AccountResource:reagent_people", attributes: {}, quantity: 5 });
  tracker.addItem("a", { templateId: "Hero:hid_commando_007_r_t01", attributes: { level: 1, squad_id: "" }, quantity: 1 });
  tracker.addItem("b", { templateId: "Hero:hid_ninja_007_r_t01", attributes: { level: 1, squad_id: "" }, quantity: 1 });
  tracker.addItem("worker", { templateId: "Worker:workerbasic_c_t01", attributes: { level: 1, squad_id: "" }, quantity: 1 });
  tracker.addItem("heroxp", { templateId: "AccountResource:heroxp", attributes: {}, quantity: 100 });

  const notifications = [];
  assert.throws(() => transmogItem(session, key, ["worker"], notifications), /isn't enough/);
  assert.throws(() => transmogItem(session, "ConversionControl:cck_hero_ninja_unlimited", ["a"], notifications), /don't have/);

  // Two rare heroes: 80 + 80 = 160 points, Sturdy (rare), 4 people reagents.
  transmogItem(session, key, ["a", "b"], notifications);
  const [result] = notifications;
  assert.equal(result.type, "transmogResult");
  assert.equal(result.primary, true);
  // Each level 1 rare hero gives back its 750 hero XP (XPAccountItemRewards Rare), into the stack the player has.
  assert.deepEqual(result.recycledItems, [{ itemType: "AccountResource:heroxp", itemGuid: "heroxp", itemProfile: "profile0", quantity: 1500 }]);
  assert.equal(result.transmoggedItems.length, 1);
  assert.match(result.transmoggedItems[0].itemType, /^Hero:hid_ninja_.*_r_t01$/);
  const { items } = tracker.profile;
  assert.equal(items.a, undefined);
  assert.equal(items.b, undefined);
  assert.equal(items.reagents.quantity, 1);
  assert.equal(items.key.quantity, 1);
  assert.equal(items.heroxp.quantity, 1600);
  assert.ok(items[result.transmoggedItems[0].itemGuid]);
});

// Issue #26: the confirmation promised "+400 Hero XP" (ItemTransformResultItems.CalculateRecycleXP) and none came.
test("the sacrifices give back the recycle XP the confirmation lists, each type into its own balance", () => {
  const session = memorySession();
  const tracker = session.profile("profile0");
  const keyFor = "ConversionControl:cck_hero_core_consumable";
  tracker.addItem("recycler2", { templateId: "HomebaseNode:t1_main_0abacb4e2", attributes: {}, quantity: 1 }); // Upgrade2
  tracker.addItem("key", { templateId: keyFor, attributes: {}, quantity: 1 });
  tracker.addItem("reagents", { templateId: "AccountResource:reagent_people", attributes: {}, quantity: 2 });
  const add = (itemId, templateId, level) => tracker.addItem(itemId, { templateId, attributes: { level, squad_id: "" }, quantity: 1 });
  add("hero3", "Hero:hid_ninja_007_uc_t01", 3); // Uncommon row at level 3: 805 hero XP
  add("hero1", "Hero:hid_constructor_007_uc_t01", 1); // 400 hero XP
  add("defender", "Defender:did_defenderassault_basic_c_t01", 2); // defenders level on hero XP: Common at 2, 290
  add("worker", "Worker:workerbasic_c_t01", 1); // 200 survivor XP
  add("schematic", "Schematic:sid_assault_auto_c_ore_t01", 5); // 1100 schematic XP
  const notifications = [];
  // 32 + 32 + 10 + 3 + 8 = 85 points: the Ordinary tier (64), two Training Manuals.
  transmogItem(session, keyFor, ["hero3", "hero1", "defender", "worker", "schematic"], notifications);

  const { items } = tracker.profile;
  const balance = (templateId) => Object.values(items).find((item) => item.templateId === templateId)?.quantity;
  assert.equal(balance("AccountResource:heroxp"), 1495);
  assert.equal(balance("AccountResource:personnelxp"), 200);
  assert.equal(balance("AccountResource:schematicxp"), 1100);
  // No Training Manuals back: the confirmation doesn't list the SacrificeRecipe's results.
  assert.equal(items.reagents, undefined);
  const recycled = Object.fromEntries(notifications[0].recycledItems.map((entry) => [entry.itemType, entry]));
  assert.deepEqual(Object.keys(recycled).sort(), ["AccountResource:heroxp", "AccountResource:personnelxp", "AccountResource:schematicxp"]);
  for (const entry of Object.values(recycled)) {
    assert.equal(items[entry.itemGuid].templateId, entry.itemType);
    assert.equal(entry.quantity, items[entry.itemGuid].quantity);
  }

  // The profile changes carry the new balances, so the client's resource counts update.
  for (const xp of ["AccountResource:heroxp", "AccountResource:personnelxp", "AccountResource:schematicxp"]) {
    assert.ok(tracker.changes.some((change) => change.changeType === "itemAdded" && change.item.templateId === xp), xp);
  }
});

// UFortInventoryContext::IsRecyclable decides what the transform screen's picker offers, and the screen sends
// TransmogItem without unassigning squad members first.
test("the sacrifices are what the client's picker offers: squad members leave their squad, the hero squad stays", () => {
  const session = memorySession();
  const tracker = session.profile("profile0");
  const keyFor = "ConversionControl:cck_hero_core_consumable";
  tracker.addItem("key", { templateId: keyFor, attributes: {}, quantity: 5 });
  tracker.addItem("reagents", { templateId: "AccountResource:reagent_people", attributes: {}, quantity: 50 });
  const hero = (itemId, templateId, squadId, slot = 0) => tracker.addItem(itemId, {
    templateId, attributes: { level: 1, squad_id: squadId, squad_slot_idx: squadId ? slot : -1 }, quantity: 1
  });
  hero("lead", "Hero:hid_commando_007_uc_t01", "Squad_Combat_AdventureSquadOne");
  hero("support", "Hero:hid_ninja_007_uc_t01", "Squad_Combat_AdventureSquadOne", 2);
  hero("medic", "Hero:hid_constructor_007_uc_t01", "Squad_Attribute_Medicine_EMTSquad");
  hero("away", "Hero:hid_outlander_007_uc_t01", "Squad_Expedition_ExpeditionSquadOne");
  hero("rare", "Hero:hid_commando_007_r_t01", "");
  const notifications = [];

  // The uncommon heroes' SacrificeRecipe (Recycle.Hero.UC) needs Recycler Upgrade2, the rare one's Upgrade3.
  assert.throws(() => transmogItem(session, keyFor, ["medic"], notifications), /Unlocks\.Recycler\.Upgrade2/);
  tracker.addItem("recycler2", { templateId: "HomebaseNode:t1_main_0abacb4e2", attributes: {}, quantity: 1 });
  assert.throws(() => transmogItem(session, keyFor, ["rare"], notifications), /Unlocks\.Recycler\.Upgrade3/);

  // "Cannot retire slotted hero": every hero in default_hero_squad_id, in any slot.
  assert.throws(() => transmogItem(session, keyFor, ["lead"], notifications), /hero squad/);
  assert.throws(() => transmogItem(session, keyFor, ["support"], notifications), /hero squad/);
  tracker.setStat("default_hero_squad_id", "Squad_Combat_AdventureSquadTwo");
  assert.throws(() => transmogItem(session, keyFor, ["medic", "away"], notifications), /expedition/);

  transmogItem(session, keyFor, ["support", "medic"], notifications);
  assert.equal(tracker.profile.items.support, undefined);
  assert.equal(tracker.profile.items.medic, undefined);
  assert.deepEqual(notifications[0].recycledItems.map(({ itemType, quantity }) => [itemType, quantity]), [["AccountResource:heroxp", 800]]);
  assert.ok(tracker.profile.items.lead);
});

test("TransmogItem works through the client route", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "TransmogTest");
    const give = (templateId, quantity) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
    const command = (name, body) => post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`, token, body);
    await give(key, 1);
    await give("AccountResource:reagent_people", 2);
    await give("Hero:hid_commando_007_r_t01", 1);
    await give("HomebaseNode:t1_main_609c8a9a8", 1); // Recycler Upgrade3, which rare heroes' SacrificeRecipe needs
    let items = Object.entries((await command("QueryProfile", {})).body.profileChanges[0].profile.items);
    const [heroId] = items.find(([, item]) => item.templateId === "Hero:hid_commando_007_r_t01");
    const transformed = await command("TransmogItem", { transmogKeyTemplateId: key, sacrificeItemIds: [heroId] });
    assert.equal(transformed.status, 200);
    assert.match(transformed.body.notifications[0].transmoggedItems[0].itemType, /^Hero:hid_ninja_.*_uc_t01$/);
    // The rare hero's 750 hero XP comes back in the same response's profile (issue #26).
    const [xp] = transformed.body.notifications[0].recycledItems;
    assert.deepEqual([xp.itemType, xp.quantity], ["AccountResource:heroxp", 750]);
    assert.equal(transformed.body.profileChanges[0].profile.items[xp.itemGuid].quantity, 750);

    // A permanent key: no item, unlocked by its skill tree node (Unlocks.DirectedAcquisition.People.Worker), paid in
    // People. The client names the key by its definition's persistent name.
    await give("HomebaseNode:t1_main_266068670", 1);
    await give("AccountResource:peopleresource", 25);
    await give("Worker:workerbasic_c_t01", 2);
    items = Object.entries((await command("QueryProfile", {})).body.profileChanges[0].profile.items);
    const workers = items.filter(([, item]) => item.templateId === "Worker:workerbasic_c_t01").map(([itemId]) => itemId);
    const permanent = await command("TransmogItem", { transmogKeyTemplateId: "ConversionControl:CCK_Worker_Core_Unlimited", sacrificeItemIds: workers });
    assert.equal(permanent.status, 200);
    const [result] = permanent.body.notifications;
    assert.equal(result.type, "transmogResult");
    assert.equal(result.primary, true);
    assert.match(result.transmoggedItems[0].itemType, /^Worker:/);
    const after = (await command("QueryProfile", {})).body.profileChanges[0].profile.items;
    assert.equal(Object.values(after).find((item) => item.templateId === "AccountResource:peopleresource").quantity, 5);
    assert.ok(workers.every((itemId) => !after[itemId]));
  } finally {
    backend.close();
  }
});
