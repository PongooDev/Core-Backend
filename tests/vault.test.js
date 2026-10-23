import { test } from "node:test";
import assert from "node:assert/strict";
import { getItem } from "../src/gamedata/items.js";
import { get, post, startBackend, userLogin } from "./helpers.js";

const admin = (backend, path, body) => (body === undefined ? get(backend.port, `/admin/api${path}`) : post(backend.port, `/admin/api${path}`, undefined, body));
const client = (backend, player, command, profileId = "profile0", body = {}) =>
  post(backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/client/${command}?profileId=${profileId}&rvn=-1`, player.token, body);

test("item data says what counts toward the vault and backpack limits", () => {
  const limited = (templateId) => Boolean(getItem(templateId).inventorySizeLimited);
  assert.equal(limited("Hero:hid_commando_007_r_t01"), true);
  assert.equal(limited("Schematic:sid_assault_auto_r_ore_t01"), true);
  assert.equal(limited("Schematic:sid_assault_auto_c_ore_t00"), false, "the tutorial's T00 schematics turn it off");
  assert.equal(limited("Worker:workerbasic_c_t01"), true);
  assert.equal(limited("Weapon:wid_shotgun_standard_uc_ore_t01"), true);
  assert.equal(limited("Trap:tid_floor_spikes_r_t01"), true);
  assert.equal(limited("Ingredient:ingredient_ore_copper"), true);
  assert.equal(limited("WorldItem:wooditemdata"), false, "resources");
  assert.equal(limited("Ammo:ammodatashells"), false);
  assert.equal(limited("CardPack:cardpack_bronze"), false);
  assert.equal(limited("AccountResource:heroxp"), false);
});

test("a vault past its limit puts its newest items in overflow, and room brings the oldest back", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "VaultPlayer");
    await admin(backend, `/accounts/${player.accountId}/skip-tutorial`, {});
    let details = (await admin(backend, `/accounts/${player.accountId}`)).body;
    assert.equal(details.vault.limit, 200, "StartNode_CommandCenter's GE_AccountInventorySize_Start");
    const start = details.vault.count;

    // Armory Slot tokens add one slot each.
    details = (await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: "Token:accountinventorybonus", quantity: 3 })).body;
    assert.equal(details.vault.limit, 203);

    details = (await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: "Worker:workerbasic_c_t01", quantity: 210 - start })).body;
    assert.deepEqual(details.vault, { count: 210, limit: 203, overflow: 7 });
    const profile = (await client(backend, player, "QueryProfile")).body.profileChanges[0].profile;
    const workers = Object.entries(profile.items).filter(([, item]) => item.templateId === "Worker:workerbasic_c_t01");
    assert.deepEqual(workers.map(([, item]) => Boolean(item.attributes.inventory_overflow_date)),
      [...Array(workers.length - 7).fill(false), ...Array(7).fill(true)], "the newest ones");
    assert.ok(!Number.isNaN(Date.parse(workers.at(-1)[1].attributes.inventory_overflow_date)));
    const heroes = Object.values(profile.items).filter((item) => item.templateId.startsWith("Hero:") && item.attributes.squad_id);
    assert.ok(heroes.length && heroes.every((hero) => !hero.attributes.inventory_overflow_date), "squad members stay usable");

    // What the client refuses for overflow items, MCP refuses too.
    const [overflowId] = workers.at(-1);
    assert.equal((await client(backend, player, "UpgradeItem", "profile0", { targetItemId: overflowId })).status, 400);
    assert.equal((await client(backend, player, "AssignWorkerToSquad", "profile0", { characterId: overflowId, squadId: "Squad_Attribute_Medicine_EMTSquad", slotIndex: 1 })).status, 400);
    const purchase = await client(backend, player, "PurchaseHomebaseNode", "profile0", { nodeId: "T1_Main_0011CCD10" });
    assert.equal(purchase.status, 400);
    assert.match(purchase.body.errorMessage, /vault holds 210 of 203/);

    // Room for five: the five that waited longest come back.
    for (const [itemId] of workers.slice(0, 5)) await admin(backend, `/accounts/${player.accountId}/items/remove`, { profileId: "profile0", itemId });
    details = (await admin(backend, `/accounts/${player.accountId}`)).body;
    assert.deepEqual(details.vault, { count: 205, limit: 203, overflow: 2 });
    const after = (await client(backend, player, "QueryProfile")).body.profileChanges[0].profile.items;
    assert.deepEqual(workers.slice(-7).map(([itemId]) => Boolean(after[itemId].attributes.inventory_overflow_date)), [false, false, false, false, false, true, true]);
    assert.equal(details.items.filter((item) => item.overflow).length, 2);
  } finally {
    backend.close();
  }
});

test("world items granted past the backpack's limit go to its overflow, and nothing past 512 stacks", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "BackpackPlayer");
    await admin(backend, `/accounts/${player.accountId}/skip-tutorial`, {});
    let details = (await admin(backend, `/accounts/${player.accountId}`)).body;
    assert.equal(details.backpack.limit, 50, "StartNode_CommandCenter's GE_WorldInventorySize_Start");
    const start = details.backpack.count;

    await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: "WorldItem:wooditemdata", quantity: 5000 });
    details = (await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: "Weapon:wid_shotgun_standard_uc_ore_t01", quantity: 55 - start })).body;
    assert.equal(details.backpack.count, 50, "resources don't count, the 5 past the limit are in overflow");
    const theater = (await client(backend, player, "QueryProfile", "theater0")).body.profileChanges[0].profile.items;
    const shotguns = Object.values(theater).filter((item) => item.templateId === "Weapon:wid_shotgun_standard_uc_ore_t01");
    assert.deepEqual(shotguns.slice(-5).map((item) => item.attributes.inventory_overflow_date), [true, true, true, true, true]);
    assert.equal(shotguns.at(-6).attributes.inventory_overflow_date, undefined);

    const stacks = Object.keys(theater).length;
    const refused = await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: "Ingredient:ingredient_ore_copper", quantity: 99 * (513 - stacks) });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage, /at most 512/);
    details = (await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: "Ingredient:ingredient_ore_copper", quantity: 99 * (512 - stacks) })).body;
    assert.equal(details.worldItems.length, 512);
  } finally {
    backend.close();
  }
});
