import { test } from "node:test";
import assert from "node:assert/strict";
import { fabricatorValue, settleFabricator } from "../src/profiles/fabricator.js";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

const route = (accountId, name, profileId) => `/fortnite/api/game/v2/profile/${accountId}/dedicated_server/${name}?profileId=${profileId}&rvn=-1`;
const byTemplate = (items, templateId) => Object.entries(items).find(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase());

test("goo values come from the item templates' disintegration and fabrication values", () => {
  const planks = fabricatorValue("Ingredient:Ingredient_Planks");
  assert.deepEqual([planks.id, planks.disintegration, planks.fabrication], ["Ingredient:ingredient_planks", 10, 30]);
  assert.ok(fabricatorValue("Trap:tid_floor_spikes_r_t01").disintegration > 0);
  assert.equal(fabricatorValue("Hero:hid_commando_007_r_t01"), undefined);
});

test("goo still to process finishes one unit per production time from the start, keeping the unfinished unit's start", () => {
  const start = Date.parse("2026-10-22T10:00:00.000Z");
  const info = { disintegrationStartTime: new Date(start).toISOString(), quantumGooCompleted: 5, quantumGooStillToProcess: 10 };
  assert.deepEqual(settleFabricator(info, start + 35_000), {
    disintegrationStartTime: new Date(start + 30_000).toISOString(), quantumGooCompleted: 8, quantumGooStillToProcess: 7
  });
  assert.deepEqual(settleFabricator(info, start + 500_000), {
    disintegrationStartTime: new Date(start + 500_000).toISOString(), quantumGooCompleted: 15, quantumGooStillToProcess: 0
  });
  assert.equal(settleFabricator({}, start).quantumGooStillToProcess, 0);
});

test("the gameserver disintegrates items, aborts, fabricates from finished goo and deposits P.O.S.T. resources on theater0", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "FabricatorPlayer");
    const dedicated = await dedicatedServerToken(backend.port);
    const gameserver = (name, body, profileId = "theater0") => post(backend.port, route(player.accountId, name, profileId), dedicated, body);
    const theater = async () => (await gameserver("QueryProfile", {})).body.profileChanges[0].profile.items;
    await gameserver("BatchUpdatePlayer", { theaterItemUpdate: { addRequests: [
      { itemId: "AAAAAAAA-0000-0000-0000-000000000001", templateId: "Ingredient:ingredient_planks", quantity: 50, attributes: {} },
      { itemId: "AAAAAAAA-0000-0000-0000-000000000002", templateId: "Ingredient:ingredient_nuts_bolts", quantity: 20, attributes: {} }
    ] }, outpostItemUpdate: {}, questObjectiveUpdates: [] });

    assert.equal((await gameserver("DisintegrateItems", { itemsToDisintegrateIds: ["aaaaaaaa-0000-0000-0000-000000000001"], itemCountsToDisintegrate: [20] }, "profile0")).status, 400);
    const disintegrated = await gameserver("DisintegrateItems", { itemsToDisintegrateIds: ["aaaaaaaa-0000-0000-0000-000000000001"], itemCountsToDisintegrate: [20] });
    assert.equal(disintegrated.status, 200);
    let items = await theater();
    assert.equal(items["AAAAAAAA-0000-0000-0000-000000000001"].quantity, 30);
    const [fabricatorId, fabricator] = byTemplate(items, "Outpost:outpost_fabricator");
    assert.equal(fabricator.attributes.fabricator_info.quantumGooStillToProcess, 200);
    assert.equal(fabricator.attributes.fabricator_info.quantumGooCompleted, 0);
    assert.ok(Number.isFinite(Date.parse(fabricator.attributes.fabricator_info.disintegrationStartTime)));

    // An abort stops processing: what isn't finished is gone.
    assert.equal((await gameserver("AbortDisintegration", {})).status, 200);
    assert.equal((await theater())[fabricatorId].attributes.fabricator_info.quantumGooStillToProcess, 0);

    // Not enough finished goo is a refusal (400, never 401/403 for the gameserver); with it the item is made.
    assert.equal((await gameserver("FabricateItem", { templateId: "Ingredient:ingredient_planks" })).status, 400);
    await gameserver("BatchUpdatePlayer", { theaterItemUpdate: { changeAttributesRequests: [{ itemId: fabricatorId, attributes: {
      fabricator_info: { disintegrationStartTime: new Date().toISOString(), quantumGooCompleted: 100, quantumGooStillToProcess: 0 } } }] },
    outpostItemUpdate: {}, questObjectiveUpdates: [] });
    assert.equal((await gameserver("FabricateItem", { templateId: "Ingredient:Ingredient_Planks" })).status, 200);
    items = await theater();
    assert.equal(items[fabricatorId].attributes.fabricator_info.quantumGooCompleted, 70);
    assert.equal(items["AAAAAAAA-0000-0000-0000-000000000001"].quantity, 31);

    const deposit = (count) => gameserver("DepositPostResources", { itemsToDepositIds: ["AAAAAAAA-0000-0000-0000-000000000002"], itemCountsToDeposit: [count] });
    assert.equal((await deposit(5)).status, 200);
    assert.equal((await deposit(50)).status, 200);
    items = await theater();
    assert.equal(items["AAAAAAAA-0000-0000-0000-000000000002"], undefined);
    const [, post_] = byTemplate(items, "Outpost:outpost_post");
    assert.deepEqual(post_.attributes.post_info, { depositedPostItems: [{ templateId: "Ingredient:ingredient_nuts_bolts", quantity: 20 }] });
  } finally {
    backend.close();
  }
});

test("the storm shield vault is outpost0: the server's save moves items between theater0 and outpost0", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "VaultPlayer");
    const dedicated = await dedicatedServerToken(backend.port);
    const gameserver = (name, body, profileId = "theater0") => post(backend.port, route(player.accountId, name, profileId), dedicated, body);
    await gameserver("BatchUpdatePlayer", { theaterItemUpdate: { addRequests: [
      { itemId: "BBBBBBBB-0000-0000-0000-000000000001", templateId: "Ingredient:ingredient_planks", quantity: 40, attributes: {} }
    ] }, outpostItemUpdate: {}, questObjectiveUpdates: [] });
    const stored = await gameserver("BatchUpdatePlayer", {
      theaterItemUpdate: { changeQuantityRequests: [{ itemId: "BBBBBBBB-0000-0000-0000-000000000001", deltaQuantity: -15 }] },
      outpostItemUpdate: { addRequests: [{ itemId: "CCCCCCCC-0000-0000-0000-000000000001", templateId: "Ingredient:ingredient_planks", quantity: 15, attributes: {} }] },
      questObjectiveUpdates: []
    });
    assert.equal(stored.status, 200);
    const vault = (await gameserver("QueryProfile", {}, "outpost0")).body.profileChanges[0].profile.items;
    assert.equal(vault["CCCCCCCC-0000-0000-0000-000000000001"].quantity, 15);
    const backpack = (await gameserver("QueryProfile", {})).body.profileChanges[0].profile.items;
    assert.equal(backpack["BBBBBBBB-0000-0000-0000-000000000001"].quantity, 25);
  } finally {
    backend.close();
  }
});
