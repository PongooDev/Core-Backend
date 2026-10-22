import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`;
const hero = "Hero:hid_constructor_rushbase_uc_t01";

async function skippedAccount(backend) {
  const login = await userLogin(backend.port, "CoreTest");
  await post(backend.port, command(login.accountId, "SkipTutorial"), login.token, {});
  const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${login.accountId}/grant`, undefined, { templateId, quantity });
  const run = (name, body) => post(backend.port, command(login.accountId, name), login.token, body);
  const items = async () => (await run("QueryProfile", {})).body.profileChanges[0].profile.items;
  const find = async (templateId) => Object.entries(await items()).find(([, item]) => item.templateId === templateId);
  return { ...login, give, run, items, find };
}

test("buying a skill tree node pays for it, adds it and completes the quest that waits on it", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    assert.ok(await account.find("HomebaseNode:startnode_commandcenter"));

    assert.equal((await account.run("PurchaseHomebaseNode", { nodeId: "T1_Main_8D2C3C4D0" })).status, 400);
    await account.give("Token:homebasepoints", 1);
    const bought = await account.run("PurchaseHomebaseNode", { nodeId: "T1_Main_8D2C3C4D0" });
    assert.equal(bought.status, 200);

    assert.equal(await account.find("Token:homebasepoints"), undefined);
    assert.ok(await account.find("HomebaseNode:t1_main_8d2c3c4d0"));
    const [questId, quest] = await account.find("Quest:heroquest_constructorleadership");
    assert.equal(quest.attributes.quest_state, "Completed");
    assert.equal(quest.attributes.completion_unlock_skill_tree_constructor_leadership, 1);

    const again = await account.run("PurchaseHomebaseNode", { nodeId: "t1_main_8d2c3c4d0" });
    assert.equal(again.status, 400);
    assert.equal(again.body.errorCode, "errors.com.epicgames.fortnite.homebase_node_purchase_failed");

    await account.give("Token:homebasepoints", 5);
    const blocked = await account.run("PurchaseHomebaseNode", { nodeId: "T1_Main_BA01A2361" });
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.errorMessage, /stonewoodquest_closegate_d1/);

    const claim = await account.run("ClaimQuestReward", { questId, selectedRewardIndex: -1 });
    assert.equal(claim.status, 200);
    const [notification] = claim.body.notifications;
    assert.deepEqual({ type: notification.type, primary: notification.primary, questId: notification.questId }, { type: "questClaim", primary: true, questId });
    assert.deepEqual(notification.loot.items.map((item) => [item.itemType, item.itemProfile, item.quantity]), [
      ["WorldItem:wooditemdata", "theater0", 150], ["WorldItem:stoneitemdata", "theater0", 150], ["WorldItem:metalitemdata", "theater0", 150]
    ]);
    const [theater] = claim.body.multiUpdate;
    assert.equal(theater.profileId, "theater0");
    assert.equal((await account.find("Quest:heroquest_constructorleadership"))[1].attributes.quest_state, "Claimed");
    assert.equal((await account.find("Quest:stonewoodquest_closegate_d1"))[1].attributes.quest_state, "Active");

    const twice = await account.run("ClaimQuestReward", { questId, selectedRewardIndex: -1 });
    assert.deepEqual(twice.body.notifications[0].loot.items, []);
  } finally {
    backend.close();
  }
});

test("a first match's score reaches account level 2, whose skill point buys Constructor Leadership", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    const dedicated = await dedicatedServerToken(backend.port);
    const earned = await post(backend.port, `/fortnite/api/game/v2/profile/${account.accountId}/dedicated_server/EarnScore?profileId=profile0&rvn=-1`,
      dedicated, { playersAndScores: [{ accountId: account.accountId, totalScore: 1000000, bCriticalMatchBonus: false }] });
    assert.deepEqual(earned.body.notifications.filter((entry) => entry.type === "levelUp").map((entry) => entry.level), [2]);
    assert.equal((await account.find("Token:homebasepoints"))[1].quantity, 1);

    assert.equal((await account.run("PurchaseHomebaseNode", { nodeId: "T1_Main_8D2C3C4D0" })).status, 200);
    assert.equal(await account.find("Token:homebasepoints"), undefined);
    assert.equal((await account.find("Quest:heroquest_constructorleadership"))[1].attributes.quest_state, "Completed");
  } finally {
    backend.close();
  }
});

test("a quest granted for a node the player already owns completes straight away", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    assert.equal((await account.give("HomebaseNode:t1_main_7064c2440", 3)).body.granted, 1);
    const duplicate = await account.give("HomebaseNode:t1_main_7064c2440");
    assert.equal(duplicate.body.granted, 0);
    assert.equal(Object.values(await account.items()).filter((item) => item.templateId === "HomebaseNode:t1_main_7064c2440").length, 1);
    await account.give("Quest:homebasequest_unlocksquads");
    const [, quest] = await account.find("Quest:homebasequest_unlocksquads");
    assert.equal(quest.attributes.quest_state, "Completed");
  } finally {
    backend.close();
  }
});

test("a quest that waits on another quest completes when granted after that quest is done", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    await account.give("Quest:foundersquest_chooseherobundle");
    const [, quest] = await account.find("Quest:foundersquest_chooseherobundle");
    assert.equal(quest.attributes.completion_questcomplete_homebaseonboardingafteroutpost, 1);
    assert.equal(quest.attributes.quest_state, "Completed");
  } finally {
    backend.close();
  }
});

test("heroes go into unlocked hero slots and replace whoever was there", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    const [heroId, item] = await account.find(hero);
    assert.deepEqual([item.attributes.squad_id, item.attributes.squad_slot_idx], ["", -1]);

    const assigned = await account.run("AssignWorkerToSquad", { characterId: heroId, squadId: "squad_combat_adventuresquadone", slotIndex: 0 });
    assert.equal(assigned.status, 200);
    let [, slotted] = await account.find(hero);
    assert.deepEqual([slotted.attributes.squad_id, slotted.attributes.squad_slot_idx], ["Squad_Combat_AdventureSquadOne", 0]);

    assert.match((await account.run("AssignWorkerToSquad", { characterId: heroId, squadId: "Squad_Combat_AdventureSquadOne", slotIndex: 1 })).body.errorMessage, /locked/);
    assert.match((await account.run("AssignWorkerToSquad", { characterId: heroId, squadId: "Squad_Attribute_Medicine_EMTSquad", slotIndex: 1 })).body.errorMessage, /doesn't take a Hero/);

    await account.give("Hero:hid_commando_007_r_t01");
    const [commandoId] = await account.find("Hero:hid_commando_007_r_t01");
    await account.run("AssignWorkerToSquad", { characterId: commandoId, squadId: "Squad_Combat_AdventureSquadOne", slotIndex: 0 });
    [, slotted] = await account.find(hero);
    assert.deepEqual([slotted.attributes.squad_id, slotted.attributes.squad_slot_idx], ["", -1]);

    await account.run("AssignWorkerToSquad", { characterId: commandoId, squadId: "", slotIndex: 0 });
    const [, commando] = await account.find("Hero:hid_commando_007_r_t01");
    assert.deepEqual([commando.attributes.squad_id, commando.attributes.squad_slot_idx], ["", -1]);
    assert.equal((await account.run("AssignWorkerToSquad", { characterId: "recycled-already", squadId: "", slotIndex: 0 })).status, 200);
  } finally {
    backend.close();
  }
});

test("survivor slots follow the lead rule, and assigning one completes the quest that asks for it", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    await account.give("Quest:homebasequest_slotemtworker");
    await account.give("HomebaseNode:t1_main_7064c2440");
    await account.give("Worker:workerbasic_c_t01");
    await account.give("Worker:managerdoctor_c_t01");
    const [workerId] = await account.find("Worker:workerbasic_c_t01");
    const [managerId] = await account.find("Worker:managerdoctor_c_t01");
    const emt = "Squad_Attribute_Medicine_EMTSquad";

    assert.equal((await account.run("AssignWorkerToSquad", { characterId: workerId, squadId: emt, slotIndex: 0 })).status, 400);
    assert.equal((await account.run("AssignWorkerToSquad", { characterId: managerId, squadId: emt, slotIndex: 1 })).status, 400);
    assert.equal((await account.run("AssignWorkerToSquad", { characterId: managerId, squadId: emt, slotIndex: 0 })).status, 200);

    let [, quest] = await account.find("Quest:homebasequest_slotemtworker");
    assert.equal(quest.attributes.completion_assign_worker_to_emt_squadone, 0);
    await account.run("AssignWorkerToSquad", { characterId: workerId, squadId: emt, slotIndex: 1 });
    [, quest] = await account.find("Quest:homebasequest_slotemtworker");
    assert.equal(quest.attributes.completion_assign_worker_to_emt_squadone, 1);
    assert.equal(quest.attributes.quest_state, "Completed");
  } finally {
    backend.close();
  }
});

test("SetPinnedQuests keeps only real quest ids, once each", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    const [questId] = await account.find("Quest:heroquest_constructorleadership");
    const [heroId] = await account.find(hero);
    const pinned = await account.run("SetPinnedQuests", { pinnedQuestIds: [questId, questId, heroId, "missing"] });
    const change = pinned.body.profileChanges[0].profile.stats.attributes.client_settings;
    assert.deepEqual(change.pinnedQuestInstances, [questId]);
  } finally {
    backend.close();
  }
});
