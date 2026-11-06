import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// 1.11's (and 2.1's, 2.2's) storm shield storage in the Save the World lobby: StorageTransfer on theater0.
const v111 = "3807424";
const v21 = "3825894";
const v22 = "3841827";
const v42 = "4072250";
const rifle = "Weapon:wid_assault_auto_sr_ore_t01";
const spikes = "Trap:tid_floor_spikes_r_t01";
const storageNodes = ["T1_Main_1B6486FC0", "T1_Main_849930D55"];

const admin = (backend, path, body) => (body === undefined ? get(backend.port, `/admin/api${path}`) : post(backend.port, `/admin/api${path}`, undefined, body));
function as(changelist, backend, player, command, profileId, body) {
  const text = JSON.stringify(body);
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`, Authorization: `bearer ${player.token}`,
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) };
  return send({ host: "127.0.0.1", port: backend.port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${command}?profileId=${profileId}&rvn=-1`, headers }, text);
}
const items = (backend, player, profileId) => as(v111, backend, player, "QueryProfile", profileId, {}).then((r) => r.body.profileChanges[0].profile.items);
const ofTemplate = (all, templateId) => Object.entries(all).filter(([, item]) => item.templateId === templateId);

test("StorageTransfer moves backpack items into the storm shield's storage and back, within both capacities", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StoragePlayer");
    await admin(backend, `/accounts/${player.accountId}/skip-tutorial`, {});
    await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: rifle, quantity: 1 });
    await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: spikes, quantity: 20 });
    let backpack = await items(backend, player, "theater0");
    const [[rifleId]] = ofTemplate(backpack, rifle);
    const [[spikesId, spikesItem]] = ofTemplate(backpack, spikes);
    assert.equal(spikesItem.quantity, 20);
    await as(v111, backend, player, "ModifyQuickbar", "theater0", { primaryQuickbarChoices: [rifleId], secondaryQuickbarChoice: spikesId });
    const transfer = (body, changelist = v111) => as(changelist, backend, player, "StorageTransfer", "theater0", body);

    // Without a storage node the storage holds nothing; the transfer is refused whole.
    let refused = await transfer({ theaterToOutpostItems: [{ itemId: spikesId, quantity: 5 }], outpostToTheaterItems: [] });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.errorCode, "errors.com.epicgames.fortnite.storage_full");
    assert.equal((await items(backend, player, "theater0"))[spikesId].quantity, 20);
    for (const node of storageNodes) await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: `HomebaseNode:${node.toLowerCase()}`, quantity: 1 });

    // Wrong pairs move nothing.
    for (const [body, code] of [
      [{ theaterToOutpostItems: [{ itemId: "aaaaaaaa-0000-0000-0000-00000000dead", quantity: 1 }] }, "errors.com.epicgames.fortnite.item_not_found"],
      [{ theaterToOutpostItems: [{ itemId: spikesId, quantity: 15 }, { itemId: spikesId.toUpperCase(), quantity: 6 }] }, "errors.com.epicgames.validation.validation_failed"],
      [{ theaterToOutpostItems: [{ itemId: spikesId, quantity: 0 }] }, "errors.com.epicgames.validation.validation_failed"],
      [{ outpostToTheaterItems: [{ itemId: spikesId, quantity: 1 }] }, "errors.com.epicgames.fortnite.item_not_found"],
      [{ theaterToOutpostItems: [], outpostToTheaterItems: [] }, "errors.com.epicgames.validation.validation_failed"]
    ]) {
      const response = await transfer(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(response.body.errorCode, code);
    }

    // Part of a stack: the rest stays, the part becomes a storage item; outpost0 comes along in multiUpdate.
    let response = await transfer({ theaterToOutpostItems: [{ itemId: spikesId, quantity: 5 }], outpostToTheaterItems: [] });
    assert.equal(response.status, 200);
    assert.equal(response.body.profileId, "theater0");
    assert.equal(response.body.profileChanges[0].profile.items[spikesId].quantity, 15);
    const outpostUpdate = response.body.multiUpdate.find((update) => update.profileId === "outpost0");
    assert.deepEqual(outpostUpdate.profileChanges.map((change) => change.changeType), ["itemAdded"]);
    let storage = await items(backend, player, "outpost0");
    let stored = ofTemplate(storage, spikes);
    assert.equal(stored.length, 1);
    assert.equal(stored[0][1].quantity, 5);
    assert.notEqual(stored[0][0], spikesId);

    // The rest of the stack, in FGuid text: it joins the stored stack, leaves the backpack and its quickbar slot.
    // The rifle goes whole and keeps its id.
    response = await transfer({ theaterToOutpostItems: [{ itemId: spikesId.replace(/-/g, "").toUpperCase(), quantity: 15 }, { itemId: rifleId, quantity: 1 }] }, v21);
    assert.equal(response.status, 200);
    backpack = response.body.profileChanges[0].profile.items;
    assert.equal(backpack[spikesId], undefined);
    assert.equal(backpack[rifleId], undefined);
    const loadout = response.body.profileChanges[0].profile.stats.attributes.player_loadout;
    assert.deepEqual(loadout.primaryQuickBarRecord.slots[1].items, []);
    assert.deepEqual(loadout.secondaryQuickBarRecord.slots[4].items, []);
    storage = await items(backend, player, "outpost0");
    stored = ofTemplate(storage, spikes);
    assert.deepEqual(stored.map(([, item]) => item.quantity), [20]);
    assert.equal(storage[rifleId].templateId, rifle);

    // Storage holds 10 items; filling it past that is refused.
    await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: rifle, quantity: 9 });
    const rifles = ofTemplate(await items(backend, player, "theater0"), rifle).map(([itemId]) => itemId);
    assert.equal(rifles.length, 9);
    response = await transfer({ theaterToOutpostItems: rifles.slice(0, 8).map((itemId) => ({ itemId, quantity: 1 })) });
    assert.equal(response.status, 200);
    refused = await transfer({ theaterToOutpostItems: [{ itemId: rifles[8], quantity: 1 }] });
    assert.equal(refused.body.errorCode, "errors.com.epicgames.fortnite.storage_full");
    // A swap that keeps the count is fine.
    response = await transfer({ theaterToOutpostItems: [{ itemId: rifles[8], quantity: 1 }], outpostToTheaterItems: [{ itemId: rifleId, quantity: 1 }] }, v22);
    assert.equal(response.status, 200);
    assert.equal(response.body.profileChanges[0].profile.items[rifleId].templateId, rifle);

    // Back to the backpack: part of the stored traps.
    response = await transfer({ outpostToTheaterItems: [{ itemId: stored[0][0], quantity: 7 }] });
    assert.equal(response.status, 200);
    assert.deepEqual(ofTemplate(response.body.profileChanges[0].profile.items, spikes).map(([, item]) => item.quantity), [7]);
    assert.equal(response.body.multiUpdate.find((update) => update.profileId === "outpost0").profileChanges
      .find((change) => change.itemId === stored[0][0]).quantity, 13);

    // A full backpack takes nothing more from storage.
    const { limit, count } = (await admin(backend, `/accounts/${player.accountId}`)).body.backpack;
    await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: rifle, quantity: limit - count });
    refused = await transfer({ outpostToTheaterItems: [{ itemId: rifleId === rifles[8] ? rifles[0] : rifles[8], quantity: 1 }] });
    assert.equal(refused.body.errorCode, "errors.com.epicgames.fortnite.inventory_full");
    // The traps join their backpack stack, which makes no new one.
    response = await transfer({ outpostToTheaterItems: [{ itemId: stored[0][0], quantity: 13 }] });
    assert.equal(response.status, 200);
    assert.deepEqual(ofTemplate(response.body.profileChanges[0].profile.items, spikes).map(([, item]) => item.quantity), [20]);

    // It is a world profile command.
    const wrong = await as(v111, backend, player, "StorageTransfer", "profile0", { theaterToOutpostItems: [{ itemId: rifles[0], quantity: 1 }] });
    assert.equal(wrong.body.errorCode, "errors.com.epicgames.modules.profiles.invalid_command");
  } finally {
    backend.close();
  }
});

// 3.5+ (4.2 here) send one list, transferOperations [{itemId, quantity, toStorage, newItemIdHint}] (#276).
test("StorageTransfer reads 3.5+'s transferOperations in both directions, and names the split part by newItemIdHint", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StorageOps");
    await admin(backend, `/accounts/${player.accountId}/skip-tutorial`, {});
    for (const node of storageNodes) await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: `HomebaseNode:${node.toLowerCase()}`, quantity: 1 });
    await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: rifle, quantity: 1 });
    await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: spikes, quantity: 20 });
    const backpack = await items(backend, player, "theater0");
    const [[rifleId]] = ofTemplate(backpack, rifle);
    const [[spikesId]] = ofTemplate(backpack, spikes);
    const transfer = (body) => as(v42, backend, player, "StorageTransfer", "theater0", body);
    const hint = "0123456789abcdef0123456789abcdef";

    let response = await transfer({ transferOperations: [
      { itemId: spikesId, quantity: 5, toStorage: true, newItemIdHint: hint },
      { itemId: rifleId, quantity: 1, toStorage: true, newItemIdHint: "" }
    ] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.profileChanges[0].profile.items[spikesId].quantity, 15);
    assert.equal(response.body.profileChanges[0].profile.items[rifleId], undefined);
    let storage = await items(backend, player, "outpost0");
    assert.equal(storage[hint].quantity, 5);
    assert.equal(storage[rifleId].templateId, rifle);

    // Back to the backpack: toStorage false.
    response = await transfer({ transferOperations: [{ itemId: rifleId, quantity: 1, toStorage: false, newItemIdHint: "" }] });
    assert.equal(response.status, 200);
    assert.equal(response.body.profileChanges[0].profile.items[rifleId].templateId, rifle);
    storage = await items(backend, player, "outpost0");
    assert.equal(storage[rifleId], undefined);

    response = await transfer({ transferOperations: [] });
    assert.equal(response.body.errorCode, "errors.com.epicgames.validation.validation_failed");
  } finally {
    backend.close();
  }
});
