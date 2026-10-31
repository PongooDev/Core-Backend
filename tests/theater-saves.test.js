import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

const serverCommand = (accountId, name, profileId = "theater0") =>
  `/fortnite/api/game/v2/profile/${accountId}/dedicated_server/${name}?profileId=${profileId}&rvn=-1`;
const clientCommand = (accountId, name, profileId) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`;
const emptyUpdate = { baseCommandRevision: 0, addRequests: [], removeRequests: [], changeQuantityRequests: [], changeAttributesRequests: [], changeStatRequests: [] };

test("a locked world profile's responses carry lockExpiration until the server unlocks it", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "LockTest");
    const server = await dedicatedServerToken(backend.port);
    assert.equal((await post(backend.port, serverCommand(accountId, "QueryProfile"), server, {})).body.lockExpiration, undefined, "not locked yet");

    const locked = await post(backend.port, serverCommand(accountId, "LockProfiles"), server, {});
    assert.equal(locked.status, 200);
    assert.ok(Date.parse(locked.body.lockExpiration) > Date.now());

    // UMcpProfile drops its write lock on a response without lockExpiration, and only saves while locked.
    const save = await post(backend.port, serverCommand(accountId, "BatchUpdatePlayer"), server, {
      theaterItemUpdate: { ...emptyUpdate, addRequests: [{ itemId: "0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9", templateId: "WorldItem:wooditemdata", quantity: 10, attributes: {} }] },
      outpostItemUpdate: { ...emptyUpdate, addRequests: [{ itemId: "11111111-2222-3333-4444-555555555555", templateId: "WorldItem:stoneitemdata", quantity: 3, attributes: {} }] },
      questObjectiveUpdates: []
    });
    assert.equal(save.status, 200);
    assert.ok(Date.parse(save.body.lockExpiration) > Date.now());
    const outpost = save.body.multiUpdate.find((update) => update.profileId === "outpost0");
    assert.ok(Date.parse(outpost.lockExpiration) > Date.now(), "the outpost0 part of the reply too");

    const player = await post(backend.port, clientCommand(accountId, "QueryProfile", "theater0"), token, {});
    assert.equal(player.body.lockExpiration, undefined, "the player's own requests never hold the lock");

    const unlocked = await post(backend.port, serverCommand(accountId, "UnlockProfiles"), server, {});
    assert.equal(unlocked.body.lockExpiration, undefined);
    assert.equal((await post(backend.port, serverCommand(accountId, "QueryProfile"), server, {})).body.lockExpiration, undefined);
  } finally {
    backend.close();
  }
});

test("BatchUpdatePlayer saves the backpack the way the server sends it", async () => {
  const backend = await startBackend();
  try {
    const { accountId } = await userLogin(backend.port, "SaveTest");
    const server = await dedicatedServerToken(backend.port);
    const batch = (theaterItemUpdate) => post(backend.port, serverCommand(accountId, "BatchUpdatePlayer"), server,
      { theaterItemUpdate: { ...emptyUpdate, ...theaterItemUpdate }, outpostItemUpdate: emptyUpdate, questObjectiveUpdates: [] });
    const items = async () => (await post(backend.port, serverCommand(accountId, "QueryProfile"), server, {})).body.profileChanges[0].profile;

    const wood = "0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9";
    assert.equal((await batch({ addRequests: [
      { itemId: wood, templateId: "WorldItem:wooditemdata", quantity: 10, attributes: { level: 1, loadedAmmo: 0, favorite: false } },
      { itemId: "AAAAAAAA-0000-0000-0000-000000000001", templateId: "Weapon:wid_assault_auto_c_ore_t00", quantity: 1, attributes: { durability: 1 } }
    ] })).status, 200);

    // The same item again (any case) replaces it; quantity, attribute and stat changes find it whatever the case.
    const second = await batch({
      addRequests: [{ itemId: wood.toLowerCase(), templateId: "WorldItem:wooditemdata", quantity: 12, attributes: { level: 1, loadedAmmo: 0, favorite: false } }],
      changeQuantityRequests: [{ itemId: wood.toLowerCase(), deltaQuantity: 3 }],
      changeAttributesRequests: [{ itemId: wood, attributes: { favorite: null, level: 2 } }],
      changeStatRequests: [{ statName: "last_save_time", statValue: "2026-10-20T00:00:00.000Z" }],
      removeRequests: [{ itemId: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" }]
    });
    assert.equal(second.status, 200, "an unknown remove doesn't fail the save");

    let profile = await items();
    const woods = Object.entries(profile.items).filter(([, item]) => item.templateId === "WorldItem:wooditemdata");
    assert.equal(woods.length, 1, "not duplicated");
    assert.equal(woods[0][1].quantity, 15);
    assert.deepEqual(woods[0][1].attributes, { level: 2, loadedAmmo: 0 }, "null removes the attribute");
    assert.equal(profile.stats.attributes.last_save_time, "2026-10-20T00:00:00.000Z");

    // Crafting used the rifle up: the server removes it by id.
    await batch({ removeRequests: [{ itemId: "aaaaaaaa-0000-0000-0000-000000000001" }] });
    profile = await items();
    assert.ok(!Object.values(profile.items).some((item) => item.templateId.startsWith("Weapon:")));
  } finally {
    backend.close();
  }
});

test("1.10's BatchUpdatePlayers saves every player in the batch to their own theater and outpost", async () => {
  const backend = await startBackend();
  try {
    const first = await userLogin(backend.port, "BatchOne");
    const second = await userLogin(backend.port, "BatchTwo");
    const server = await dedicatedServerToken(backend.port);
    const wood = (itemId, quantity) => ({ ...emptyUpdate, addRequests: [{ itemId, templateId: "WorldItem:wooditemdata", quantity, attributes: {} }] });

    const save = await post(backend.port, serverCommand(first.accountId, "BatchUpdatePlayers"), server, { updates: [
      { accountId: first.accountId, theaterNum: 0, theaterItemUpdate: wood("0A1B2C3D-0000-0000-0000-000000000001", 10), outpostNum: 0, outpostItemUpdate: emptyUpdate, questObjectiveUpdates: [] },
      { accountId: second.accountId, theaterNum: 0, theaterItemUpdate: wood("0A1B2C3D-0000-0000-0000-000000000002", 7), outpostNum: 0, outpostItemUpdate: wood("0A1B2C3D-0000-0000-0000-000000000003", 3), questObjectiveUpdates: [] }
    ] });
    assert.equal(save.status, 200);

    const query = async (accountId, profileId) => (await post(backend.port, serverCommand(accountId, "QueryProfile", profileId), server, {})).body.profileChanges[0].profile.items;
    assert.equal((await query(first.accountId, "theater0"))["0A1B2C3D-0000-0000-0000-000000000001"]?.quantity, 10);
    assert.equal((await query(second.accountId, "theater0"))["0A1B2C3D-0000-0000-0000-000000000002"]?.quantity, 7, "the other player's own theater");
    assert.equal((await query(second.accountId, "outpost0"))["0A1B2C3D-0000-0000-0000-000000000003"]?.quantity, 3);
  } finally {
    backend.close();
  }
});
