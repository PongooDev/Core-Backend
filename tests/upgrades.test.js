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

test("UpgradeItem levels a defender with hero XP, as the client's GetUpgradeXPBalance does", async () => {
  const backend = await startBackend();
  try {
    const { give, run, find, amount } = await setup(backend);
    await give("Defender:did_defenderassault_basic_c_t01");
    await give("AccountResource:heroxp", 1000);
    await give("AccountResource:personnelxp", 1000);
    const [defenderId] = await find("Defender:did_defenderassault_basic_c_t01");

    // Common costs 100 at level 1 and 200 at level 2.
    assert.equal((await run("UpgradeItem", { targetItemId: defenderId })).status, 200);
    assert.equal((await run("UpgradeItem", { targetItemId: defenderId })).status, 200);
    assert.equal((await find("Defender:did_defenderassault_basic_c_t01"))[1].attributes.level, 3);
    assert.equal(await amount("AccountResource:heroxp"), 700);
    assert.equal(await amount("AccountResource:personnelxp"), 1000);
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

    // Evolving to tier 2 needs Evolution.Hero.Constructor.Tier2a from the skill tree.
    const locked = await run("ConvertItem", { targetItemId: heroId, conversionIndex: 0 });
    assert.equal(locked.status, 400);
    assert.match(locked.body.errorMessage, /Evolution\.Hero\.Constructor\.Tier2a/);
    await give("HomebaseNode:t1_main_5faa4c765");

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
    // Uncommon heroes need the second recycler upgrade (Unlocks.Recycler.Upgrade2).
    assert.equal((await run("RecycleItem", { targetItemId: first })).status, 400);
    await give("HomebaseNode:t1_main_0abacb4e2");
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

test("levelling and evolving items advances the quests that wait on it, by item type, tags and level", async () => {
  const backend = await startBackend();
  try {
    const { give, profile, run, find } = await setup(backend);
    const quest = async (questId) => Object.values((await profile()).items).find((item) => item.templateId === `Quest:${questId}`)?.attributes;
    await give("AccountResource:heroxp", 100000);
    await give("AccountResource:schematicxp", 100000);
    await give("AccountResource:personnelxp", 100000);

    // Hero Training - Stage 1 ("Level Up a Hero") is only advanced by a hero; on completion it grants Weapon Enhancement.
    await give("Quest:challenge_herotraining_1");
    await give("Hero:hid_commando_007_uc_t01");
    await give("Defender:did_defenderassault_basic_c_t01");
    const [defenderId] = await find("Defender:did_defenderassault_basic_c_t01");
    await run("UpgradeItem", { targetItemId: defenderId });
    assert.equal((await quest("challenge_herotraining_1")).completion_upgrade_any_hero, 0);
    const [heroId] = await find("Hero:hid_commando_007_uc_t01");
    assert.equal((await run("UpgradeItem", { targetItemId: heroId })).status, 200);
    assert.equal((await quest("challenge_herotraining_1")).completion_upgrade_any_hero, 1);
    assert.equal((await quest("challenge_herotraining_1")).quest_state, "Completed");
    const [stageOneId] = await find("Quest:challenge_herotraining_1");
    assert.equal((await run("ClaimQuestReward", { questId: stageOneId })).status, 200);
    assert.equal((await quest("challenge_weaponupgrade_1")).quest_state, "Active");

    // upgrade_any_weapon: a schematic with the Trap or Weapon tag.
    await give("Schematic:sid_floor_spikes_wood_c_t01");
    const [trapId] = await find("Schematic:sid_floor_spikes_wood_c_t01");
    await run("UpgradeItem", { targetItemId: trapId });
    assert.equal((await quest("challenge_weaponupgrade_1")).completion_upgrade_any_weapon, 1);

    // upgrade_any_worker (Homebase.Worker or Homebase.Manager) and upgrade_any_defender.
    await give("Quest:challenge_workertraining_1");
    await give("Quest:challenge_defendertraining_1");
    await give("Worker:managerdoctor_c_t01");
    const [managerId] = await find("Worker:managerdoctor_c_t01");
    await run("UpgradeItem", { targetItemId: managerId });
    await run("UpgradeItem", { targetItemId: defenderId });
    assert.equal((await quest("challenge_workertraining_1")).completion_upgrade_any_worker, 1);
    assert.equal((await quest("challenge_defendertraining_1")).completion_upgrade_any_defender, 1);

    // "Level Up a Ninja to Level 3": a ninja reaching level 3, or one already there when the quest is granted.
    await give("Quest:heroquest_ninja_2");
    await give("Hero:hid_ninja_007_r_t01");
    const [ninjaId] = await find("Hero:hid_ninja_007_r_t01");
    await run("UpgradeItem", { targetItemId: heroId });
    await run("UpgradeItem", { targetItemId: ninjaId });
    assert.equal((await quest("heroquest_ninja_2")).completion_upgrade_ninja_lvl_3, 0);
    await run("UpgradeItem", { targetItemId: ninjaId });
    assert.equal((await quest("heroquest_ninja_2")).completion_upgrade_ninja_lvl_3, 1);
    await give("Quest:heroquest_outlander_2");
    assert.equal((await quest("heroquest_outlander_2")).completion_upgrade_outlander_lvl_3, 0);
    await give("Quest:heroquest_soldier_1");
    assert.equal((await quest("heroquest_soldier_1")).completion_upgrade_soldier, 1);

    // Hero Training - Stage 2 ("Evolve a Hero").
    await give("Quest:challenge_herotraining_2");
    await give("Hero:hid_constructor_rushbase_uc_t01");
    await give("AccountResource:reagent_c_t01", 7);
    await give("HomebaseNode:t1_main_5faa4c765");
    const [constructorId] = await find("Hero:hid_constructor_rushbase_uc_t01");
    assert.equal((await run("ConvertItem", { targetItemId: constructorId, conversionIndex: 0 })).status, 200);
    assert.equal((await quest("challenge_herotraining_2")).completion_convert_any_hero, 1);
  } finally {
    backend.close();
  }
});
