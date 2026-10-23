import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { post, startBackend, userLogin } from "./helpers.js";

// Quests whose objectives the frontend completes (squads, levelling, owning things), not the gameserver.
const command = (accountId, name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;
const lead = "Squad_Combat_AdventureSquadOne";

async function skippedAccount(backend) {
  const login = await userLogin(backend.port, "CoreTest");
  await post(backend.port, command(login.accountId, "SkipTutorial"), login.token, {});
  const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${login.accountId}/grant`, undefined, { templateId, quantity });
  const run = (name, body) => post(backend.port, command(login.accountId, name), login.token, body);
  const items = async () => (await run("QueryProfile", {})).body.profileChanges[0].profile.items;
  const find = async (prefix) => Object.entries(await items()).find(([, item]) => item.templateId.toLowerCase().startsWith(prefix.toLowerCase()));
  const quest = async (questId) => (await find(`Quest:${questId}`))?.[1].attributes;
  const file = path.join(backend.dataDir, "accounts", login.accountId, "profiles", "profile0.json");
  const edit = (change) => {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    change(saved);
    fs.writeFileSync(file, JSON.stringify(saved));
  };
  return { ...login, give, run, find, quest, edit };
}

test("Back Against the Wall (#23): a Constructor in the Primary Hero slot counts, and stays counted when it leaves", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    const [commandoId] = await account.find("Hero:hid_commando");
    const [constructorId] = await account.find("Hero:hid_constructor");
    await account.give("Quest:heroquest_constructor_1");
    assert.equal((await account.quest("heroquest_constructor_1")).completion_assign_hero_constructor, 0);

    await account.run("AssignWorkerToSquad", { characterId: constructorId, squadId: lead, slotIndex: 0 });
    assert.equal((await account.quest("heroquest_constructor_1")).completion_assign_hero_constructor, 1);

    // Back to the commando (or the constructor off on an expedition): the client would show stage 0 again at 0/1.
    await account.run("AssignWorkerToSquad", { characterId: commandoId, squadId: lead, slotIndex: 0 });
    await account.run("ClientQuestLogin", {});
    const quest = await account.quest("heroquest_constructor_1");
    assert.equal(quest.completion_assign_hero_constructor, 1);
    assert.equal(quest.quest_state, "Active"); // stages 1 and 2: level it up, then a mission as a Constructor
  } finally {
    backend.close();
  }
});

test("a Constructor already leading counts when the quest arrives; one in another slot doesn't", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    const [constructorId] = await account.find("Hero:hid_constructor");
    await account.run("AssignWorkerToSquad", { characterId: constructorId, squadId: lead, slotIndex: 0 });
    await account.give("Quest:heroquest_constructor_1");
    assert.equal((await account.quest("heroquest_constructor_1")).completion_assign_hero_constructor, 1);
  } finally {
    backend.close();
  }

  const other = await startBackend();
  try {
    const account = await skippedAccount(other);
    await account.give("HomebaseNode:t1_main_9fdb916e6");
    await account.give("HomebaseNode:t1_main_3ffc8e9d7");
    const [constructorId] = await account.find("Hero:hid_constructor");
    await account.give("Quest:heroquest_constructor_1");
    // The stat row asks for Squad.Slot == 0 ("Select the Primary Hero slot").
    assert.equal((await account.run("AssignWorkerToSquad", { characterId: constructorId, squadId: lead, slotIndex: 1 })).status, 200);
    assert.equal((await account.quest("heroquest_constructor_1")).completion_assign_hero_constructor, 0);
  } finally {
    other.close();
  }
});

test("quest login catches up quests that missed what the account already holds", async () => {
  const backend = await startBackend();
  try {
    const account = await skippedAccount(backend);
    await account.give("Quest:heroquest_constructor_1");
    const [constructorId] = await account.find("Hero:hid_constructor");
    const [questId] = await account.find("Quest:heroquest_constructorleadership");
    // A levelled Constructor (HasUpgraded) and the Constructor Leadership node (Acquire) that reached the profile
    // without the quests hearing of it.
    account.edit((saved) => {
      saved.items[constructorId].attributes.level = 2;
      saved.items["leadership-node"] = { templateId: "HomebaseNode:t1_main_8d2c3c4d0", attributes: { item_seen: false }, quantity: 1 };
    });
    assert.equal((await account.quest("heroquest_constructor_1")).completion_upgrade_constructor, 0);

    await account.run("ClientQuestLogin", {});
    assert.equal((await account.quest("heroquest_constructor_1")).completion_upgrade_constructor, 1);
    const leadership = await account.quest("heroquest_constructorleadership");
    assert.equal(leadership.completion_unlock_skill_tree_constructor_leadership, 1);
    assert.notEqual(leadership.quest_state, "Active", questId);
  } finally {
    backend.close();
  }
});
