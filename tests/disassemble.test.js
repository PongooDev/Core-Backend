import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { getItem } from "../src/gamedata/items.js";
import { disassemblyResults } from "../src/services/mcp/commands/DisassembleWorldItems.js";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// 1.11's (and 2.1's) backpack recycle, DisassembleWorldItems on theater0.
const v111 = "3807424";
const v21 = "3825894";
const rifle = "Weapon:wid_assault_auto_sr_ore_t01";
const spikes = "Trap:tid_floor_spikes_r_t01";
const route = (accountId, side, name, profileId) => `/fortnite/api/game/v2/profile/${accountId}/${side}/${name}?profileId=${profileId}&rvn=-1`;
function as(changelist, port, urlPath, token, body) {
  const text = JSON.stringify(body);
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`, Authorization: `bearer ${token}`,
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) };
  return send({ host: "127.0.0.1", port, method: "POST", path: urlPath, headers }, text);
}
const held = (items, templateId) => Object.values(items).filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase())
  .reduce((sum, item) => sum + item.quantity, 0);

test("a world item gives back its DisassembleRecipe's results, scaled between its min and max loot percent by durability", () => {
  for (const changelist of [v111, v21]) inBuild(changelist, () => {
    const info = getItem(rifle);
    assert.equal(info.disassembleRecipe, "Disassemble.Ranged.Assault.SR.Ore.T01");
    assert.deepEqual(info.disassembleLootPercent, [0.1, 0.4]);
    // At full durability, 40% of 15 blast powder, 30 mechanical parts, 1 power cell and 10 copper ore.
    const full = disassemblyResults({ templateId: rifle, attributes: { durability: info.maxDurability } });
    assert.deepEqual(full, [
      { templateId: "Ingredient:ingredient_blastpowder", quantity: 6 },
      { templateId: "Ingredient:ingredient_mechanical_parts_t01", quantity: 12 },
      { templateId: "Ingredient:ingredient_rare_powercell", quantity: 0 },
      { templateId: "Ingredient:ingredient_ore_copper", quantity: 4 }
    ]);
    // Broken, 10%; without durability data the item counts as whole.
    assert.deepEqual(disassemblyResults({ templateId: rifle, attributes: { durability: 0 } }).map((r) => r.quantity), [1, 3, 0, 1]);
    assert.deepEqual(disassemblyResults({ templateId: rifle, attributes: {} }), full);
    // Items without a recipe don't disassemble.
    assert.equal(disassemblyResults({ templateId: "Ingredient:ingredient_blastpowder", attributes: {} }), undefined);
  });
  // Before 1.11 there is no backpack recycle.
  inBuild("3790078", () => assert.equal(disassemblyResults({ templateId: rifle, attributes: {} }), undefined));
});

test("1.11's DisassembleWorldItems takes the backpack items and gives back what they disassemble into", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "RecyclePlayer");
    const dedicated = await dedicatedServerToken(backend.port);
    const maxDurability = inBuild(v111, () => getItem(rifle).maxDurability);
    await post(backend.port, route(player.accountId, "dedicated_server", "BatchUpdatePlayer", "theater0"), dedicated, {
      theaterItemUpdate: { addRequests: [
        { itemId: "aaaaaaaa-0000-0000-0000-000000000001", templateId: rifle, quantity: 1, attributes: { durability: maxDurability } },
        { itemId: "aaaaaaaa-0000-0000-0000-000000000002", templateId: spikes, quantity: 5, attributes: {} },
        { itemId: "aaaaaaaa-0000-0000-0000-000000000003", templateId: "Ingredient:ingredient_blastpowder", quantity: 2, attributes: {} }
      ] }, outpostItemUpdate: {}, questObjectiveUpdates: []
    });
    await as(v111, backend.port, route(player.accountId, "client", "ModifyQuickbar", "theater0"), player.token,
      { primaryQuickbarChoices: ["aaaaaaaa-0000-0000-0000-000000000001"], secondaryQuickbarChoice: "aaaaaaaa-0000-0000-0000-000000000002" });
    const disassemble = (pairs, changelist = v111) =>
      as(changelist, backend.port, route(player.accountId, "client", "DisassembleWorldItems", "theater0"), player.token, { targetItemIdAndQuantityPairs: pairs });

    // Nothing is taken when any pair is wrong: an unknown item, more than the stack, a bad quantity, an item that
    // doesn't disassemble.
    for (const [pairs, code] of [
      [[{ itemId: "aaaaaaaa-0000-0000-0000-00000000dead", quantity: 1 }], "errors.com.epicgames.fortnite.item_not_found"],
      [[{ itemId: "aaaaaaaa-0000-0000-0000-000000000002", quantity: 3 }, { itemId: "AAAAAAAA-0000-0000-0000-000000000002", quantity: 3 }], "errors.com.epicgames.validation.validation_failed"],
      [[{ itemId: "aaaaaaaa-0000-0000-0000-000000000001", quantity: 0 }], "errors.com.epicgames.validation.validation_failed"],
      [[{ itemId: "aaaaaaaa-0000-0000-0000-000000000003", quantity: 1 }], "errors.com.epicgames.validation.validation_failed"],
      [[], "errors.com.epicgames.validation.validation_failed"]
    ]) {
      const refused = await disassemble(pairs);
      assert.equal(refused.status, 400, JSON.stringify(pairs));
      assert.equal(refused.body.errorCode, code);
    }

    const response = await disassemble([
      { itemId: "AAAAAAAA-0000-0000-0000-000000000001", quantity: 1 },
      { itemId: "aaaaaaaa-0000-0000-0000-000000000002", quantity: 2 }
    ]);
    assert.equal(response.status, 200);
    assert.equal(response.body.profileId, "theater0");
    const items = response.body.profileChanges[0].profile.items;
    assert.equal(items["aaaaaaaa-0000-0000-0000-000000000001"], undefined);
    assert.equal(items["aaaaaaaa-0000-0000-0000-000000000002"].quantity, 3);
    // The rifle's 6 blast powder joins the 2 held; the spikes give their recipe's share twice over.
    const each = inBuild(v111, () => disassemblyResults({ templateId: spikes, attributes: {} }));
    assert.ok(each.some((result) => result.quantity > 0));
    const expected = new Map([["Ingredient:ingredient_blastpowder", 8], ["Ingredient:ingredient_mechanical_parts_t01", 12], ["Ingredient:ingredient_ore_copper", 4]]);
    for (const { templateId, quantity } of each) expected.set(templateId, (expected.get(templateId) ?? 0) + quantity * 2);
    for (const [templateId, quantity] of expected) assert.equal(held(items, templateId), quantity, templateId);
    // The recycled rifle leaves its quickbar slot; the spikes, still held, keep theirs.
    const loadout = response.body.profileChanges[0].profile.stats.attributes.player_loadout;
    assert.deepEqual(loadout.primaryQuickBarRecord.slots[1].items, []);
    assert.deepEqual(loadout.secondaryQuickBarRecord.slots[4].items, ["AAAAAAAA000000000000000000000002"]);

    // 2.1 recycles the same way; the last of a stack goes.
    const rest = await disassemble([{ itemId: "aaaaaaaa-0000-0000-0000-000000000002", quantity: 3 }], v21);
    assert.equal(rest.status, 200);
    const after = rest.body.profileChanges[0].profile.items;
    assert.equal(after["aaaaaaaa-0000-0000-0000-000000000002"], undefined);
    assert.deepEqual(rest.body.profileChanges[0].profile.stats.attributes.player_loadout.secondaryQuickBarRecord.slots[4].items, []);
    for (const { templateId, quantity } of each) assert.equal(held(after, templateId), expected.get(templateId) + quantity * 3, templateId);

    // It is a theater profile command.
    const wrong = await as(v111, backend.port, route(player.accountId, "client", "DisassembleWorldItems", "profile0"), player.token,
      { targetItemIdAndQuantityPairs: [{ itemId: "aaaaaaaa-0000-0000-0000-000000000003", quantity: 1 }] });
    assert.equal(wrong.body.errorCode, "errors.com.epicgames.modules.profiles.invalid_command");
  } finally {
    backend.close();
  }
});
