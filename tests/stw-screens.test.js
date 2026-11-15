import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { slotUnlockNode } from "../src/gamedata/homebase.js";
import { getItem } from "../src/gamedata/items.js";
import { buildGameData } from "../src/gamedata/read.js";
import { upgradeData } from "../src/gamedata/upgrades.js";
import { transmogTier } from "../src/transmog/transmog.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// 6.31's (CL-4573279) Save the World Command screens, for issue #368: the reporter's client offered no survivor squads,
// no schematic Upgrade and no transform sacrifices. Each screen's action is a client command here: AssignWorkerToSquad,
// UpgradeItem and TransmogItem. The client only sends one when its own rules allow it, so these tests pin the commands'
// rules for the build, and a screen that stays empty with no request in the backend log is the client's side.
const v631 = "4573279";
const agent631 = `Fortnite/++Fortnite+Release-6.31-CL-${v631} Windows/10.0.19045.1.256.64bit`;

function client(port, token, accountId) {
  let revision = -1;
  const mcp = (name, body, rvn = revision) => {
    const text = JSON.stringify(body);
    return send({ host: "127.0.0.1", port, method: "POST",
      path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=campaign&rvn=${rvn}`,
      headers: { "User-Agent": agent631, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
  };
  // The profile reads are full ones (-1); each command goes at the current revision, since the admin panel's grants
  // move it.
  const profile = async () => (await mcp("QueryProfile", {}, -1)).body.profileChanges[0].profile;
  const call = async (name, body = {}) => {
    revision = (await mcp("QueryProfile", {}, -1)).body.profileRevision;
    return mcp(name, body);
  };
  const held = async (templateId) => Object.values((await profile()).items)
    .filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase()).reduce((sum, item) => sum + item.quantity, 0);
  const give = (templateId, quantity) => post(port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
  const heldItems = async (templateId) => Object.entries((await profile()).items)
    .filter(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase());
  return { call, profile, held, heldItems, give };
}

async function signIn(backend, name) {
  const { token, accountId } = await userLogin(backend.port, name);
  const account = client(backend.port, token, accountId);
  await account.profile();
  return account;
}

// The survivor squads' slots are unlocked by the Storm Shield Defense quest rewards, and a basic survivor only fits the
// slots after a squad's lead: EMTSquad's slot 1 is one of the four its Stonewood SSD5 node unlocks.
const survivorSquad = "Squad_Attribute_Medicine_EMTSquad";
const survivorNode = inBuild(v631, () => slotUnlockNode(survivorSquad, 1));
const lockedNode = inBuild(v631, () => slotUnlockNode(survivorSquad, 7));

test("6.31's survivor squads: a survivor slots once its squad slot's node is owned, and the profile keeps it", async () => {
  const backend = await startBackend();
  try {
    const { call, profile, give, heldItems } = await signIn(backend, "Squads631");
    let p = await profile();
    // The lead hero the lobby and the server spawn come from is the default hero squad's first slot.
    assert.equal(p.stats.attributes.default_hero_squad_id, "Squad_Combat_AdventureSquadOne");
    const [[, hero]] = Object.entries(p.items).filter(([, item]) => item.templateId.startsWith("Hero:"));
    assert.equal(hero.attributes.squad_id, "Squad_Combat_AdventureSquadOne");
    assert.equal(hero.attributes.squad_slot_idx, 0);

    await give(`HomebaseNode:${survivorNode}`, 1);
    await give("Worker:workerbasic_c_t01", 1);
    p = await profile();
    const [workerId] = Object.keys(p.items).filter((itemId) => p.items[itemId].templateId === "Worker:workerbasic_c_t01");

    const assigned = await call("AssignWorkerToSquad", { characterId: workerId, squadId: survivorSquad, slotIndex: 1 });
    assert.equal(assigned.status, 200);
    const changes = Object.fromEntries(assigned.body.profileChanges
      .filter((change) => change.changeType === "itemAttrChanged" && change.itemId === workerId)
      .map((change) => [change.attributeName, change.attributeValue]));
    assert.deepEqual(changes, { squad_id: survivorSquad, squad_slot_idx: 1 });

    // The next profile read carries it, which is what the Command screen builds its squads from.
    const [after] = await heldItems("Worker:workerbasic_c_t01");
    assert.equal(after[1].attributes.squad_id, survivorSquad);
    assert.equal(after[1].attributes.squad_slot_idx, 1);

    // A slot whose Storm Shield Defense node the profile doesn't own is refused, so the client's picker can't fill it.
    const locked = await call("AssignWorkerToSquad", { characterId: workerId, squadId: survivorSquad, slotIndex: 7 });
    assert.equal(locked.status, 400);
    assert.match(locked.body.errorMessage, /locked/);
    const [stays] = await heldItems("Worker:workerbasic_c_t01");
    assert.equal(stays[1].attributes.squad_slot_idx, 1, "a refused assignment changes nothing");
    assert.ok(lockedNode, "the slot has an unlocking node");
  } finally {
    backend.close();
  }
});

test("6.31's schematics: the tier 0 starters are at their highest level, a rare schematic levels on schematic XP", async () => {
  const backend = await startBackend();
  try {
    const { call, profile, held, give, heldItems } = await signIn(backend, "SchematicUpgrade631");
    const p = await profile();
    const starter = Object.entries(p.items).find(([, item]) => item.templateId === "Schematic:sid_assault_auto_c_ore_t00");
    assert.ok(starter, "the tutorial's starter schematic is there");
    // The starter tier's data has a single level (XPAccountItemLevels Common has level 1 only), so a new account's
    // Armory has no Upgrade for anything it starts with; a rare schematic levels once it has schematic XP.
    const refused = await call("UpgradeItem", { targetItemId: starter[0] });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage, /already at its highest level/);

    await give("Schematic:sid_assault_auto_r_ore_t01", 1);
    await give("AccountResource:schematicxp", 5000);
    const [[rareId]] = await heldItems("Schematic:sid_assault_auto_r_ore_t01");
    const cost = inBuild(v631, () => upgradeData().levelCosts.Rare[1]);
    const upgraded = await call("UpgradeItem", { targetItemId: rareId });
    assert.equal(upgraded.status, 200);
    assert.equal((await profile()).items[rareId].attributes.level, 2);
    assert.equal(await held("AccountResource:schematicxp"), 5000 - cost);
  } finally {
    backend.close();
  }
});

test("6.31's transform: squad-slotted survivors are sacrifices, and they leave their squad with the item", async () => {
  const backend = await startBackend();
  try {
    const { call, profile, held, give, heldItems } = await signIn(backend, "TransmogSquad631");
    // The permanent People key: unlocked by the skill tree node with Unlocks.DirectedAcquisition.People.Worker,
    // which 6.31's data names QuestReward_Transformation (1.1's t1_main_266068670 is not a 6.31 row), paid in People
    // (transmog.json's RequiredItem).
    await give("HomebaseNode:QuestReward_Transformation", 1);
    await give("AccountResource:peopleresource", 25);
    await give(`HomebaseNode:${survivorNode}`, 1);
    await give("Worker:workerbasic_c_t01", 2);
    const [w1, w2] = (await heldItems("Worker:workerbasic_c_t01")).map(([itemId]) => itemId);
    for (const [workerId, slotIndex] of [[w1, 1], [w2, 2]]) {
      const reply = await call("AssignWorkerToSquad", { characterId: workerId, squadId: survivorSquad, slotIndex });
      assert.equal(reply.status, 200, `${workerId} into slot ${slotIndex}: ${reply.body?.errorMessage}`);
    }
    const before = await profile();
    assert.equal(before.items[w1].attributes.squad_id, survivorSquad);
    assert.equal(before.items[w2].attributes.squad_slot_idx, 2);

    // What the key takes: the two survivors' sacrifice points pick its tier, and that tier's RequiredItemQuantity of
    // People is spent (transmog.js, from the key's data).
    const peopleCost = inBuild(v631, () => {
      const [, key] = Object.entries(buildGameData(v631, "transmog", {}))
        .find(([templateId]) => templateId.toLowerCase() === "conversioncontrol:cck_worker_core_unlimited");
      return key.tiers[transmogTier(key, 2 * getItem("Worker:workerbasic_c_t01").transmogPoints)].quantity;
    });
    const transformed = await call("TransmogItem", { transmogKeyTemplateId: "ConversionControl:CCK_Worker_Core_Unlimited",
      sacrificeItemIds: [w1, w2] });
    assert.equal(transformed.status, 200, transformed.body?.errorMessage);
    const [result] = transformed.body.notifications;
    assert.equal(result.type, "transmogResult");
    assert.match(result.transmoggedItems[0].itemType, /^Worker:/);
    const after = await profile();
    assert.equal(after.items[w1], undefined, "the sacrificed survivor is gone from the squad");
    assert.equal(after.items[w2], undefined);
    assert.equal(await held("AccountResource:peopleresource"), 25 - peopleCost);
  } finally {
    backend.close();
  }
});
