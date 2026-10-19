import { test } from "node:test";
import assert from "node:assert/strict";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`;

async function setup(backend) {
  const login = await userLogin(backend.port, "UpgradeTest");
  const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${login.accountId}/grant`, undefined, { templateId, quantity });
  const profile = async () => (await post(backend.port, command(login.accountId, "QueryProfile"), login.token, {})).body.profileChanges[0].profile;
  const run = (name, body) => post(backend.port, command(login.accountId, name), login.token, body);
  const find = async (templateId) => Object.entries((await profile()).items).find(([, item]) => item.templateId === templateId);
  const amount = async (templateId) => (await find(templateId))?.[1].quantity ?? 0;
  return { login, give, profile, run, find, amount };
}

test("UpgradeItem spends the item's XP type per its level curve, up to its max level", async () => {
  const backend = await startBackend();
  try {
    const { give, run, find, amount } = await setup(backend);
    await give("Hero:hid_constructor_rushbase_uc_t01");
    await give("AccountResource:heroxp", 1000);
    const [heroId] = await find("Hero:hid_constructor_rushbase_uc_t01");

    // Uncommon costs 150 per level: 150 at level 1, 300 at level 2.
    assert.equal((await run("UpgradeItem", { targetItemId: heroId })).status, 200);
    assert.equal((await run("UpgradeItem", { targetItemId: heroId })).status, 200);
    assert.equal((await find("Hero:hid_constructor_rushbase_uc_t01"))[1].attributes.level, 3);
    assert.equal(await amount("AccountResource:heroxp"), 550);

    // Level 3 costs 450, level 4 costs 600: the second can't be paid and changes nothing.
    assert.equal((await run("UpgradeItem", { targetItemId: heroId })).status, 200);
    const short = await run("UpgradeItem", { targetItemId: heroId });
    assert.equal(short.status, 400);
    assert.equal(short.body.errorCode, "errors.com.epicgames.fortnite.item_consumption_failed");
    assert.equal(await amount("AccountResource:heroxp"), 100);
    assert.equal((await find("Hero:hid_constructor_rushbase_uc_t01"))[1].attributes.level, 4);

    assert.equal((await run("UpgradeItem", { targetItemId: "missing" })).status, 400);

    // Tier I tops out at level 10.
    await give("AccountResource:heroxp", 10000);
    for (let level = 4; level < 10; level++) assert.equal((await run("UpgradeItem", { targetItemId: heroId })).status, 200);
    assert.equal((await find("Hero:hid_constructor_rushbase_uc_t01"))[1].attributes.level, 10);
    assert.equal((await run("UpgradeItem", { targetItemId: heroId })).status, 400);
  } finally {
    backend.close();
  }
});

test("ConvertItem evolves the item in place for its recipe's costs", async () => {
  const backend = await startBackend();
  try {
    const { give, run, find, amount } = await setup(backend);
    await give("Hero:hid_constructor_rushbase_uc_t01");
    await give("AccountResource:heroxp", 1200);
    await give("AccountResource:reagent_c_t01", 7);
    const [heroId] = await find("Hero:hid_constructor_rushbase_uc_t01");
    await run("UpgradeItem", { targetItemId: heroId });

    assert.equal((await run("ConvertItem", { targetItemId: heroId, conversionIndex: 0 })).status, 200);
    const [evolvedId, evolved] = await find("Hero:hid_constructor_rushbase_uc_t02");
    assert.deepEqual([evolvedId, evolved.attributes.level], [heroId, 2]);
    assert.equal(await find("Hero:hid_constructor_rushbase_uc_t01"), undefined);
    assert.equal(await amount("AccountResource:heroxp"), 50);
    assert.equal(await amount("AccountResource:reagent_c_t01"), 0);

    assert.equal((await run("ConvertItem", { targetItemId: heroId, conversionIndex: 5 })).status, 400);
  } finally {
    backend.close();
  }
});

test("RecycleItem gives back the item's recycle XP for its level, and won't take a squad member", async () => {
  const backend = await startBackend();
  try {
    const { login, give, run, find, amount } = await setup(backend);
    await give("Hero:hid_constructor_rushbase_uc_t01", 2);
    const [first] = await find("Hero:hid_constructor_rushbase_uc_t01");
    assert.equal((await run("RecycleItem", { targetItemId: first })).status, 200);
    assert.equal(await amount("AccountResource:heroxp"), 400);

    const [second] = await find("Hero:hid_constructor_rushbase_uc_t01");
    await post(backend.port, command(login.accountId, "AssignWorkerToSquad"), login.token,
      { characterId: second, squadId: "Squad_Combat_AdventureSquadOne", slotIndex: 0 });
    assert.equal((await run("RecycleItemBatch", { targetItemIds: [second] })).status, 400);
    assert.ok(await find("Hero:hid_constructor_rushbase_uc_t01"));
  } finally {
    backend.close();
  }
});
