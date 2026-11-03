import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { getItem } from "../src/gamedata/items.js";
import { upgradeData } from "../src/gamedata/upgrades.js";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// The Save the World backpack's Craft, CraftWorldItem {targetSchematicItemId, numTimesToCraft} on theater0 (#197).
const v25 = "3889387";
const rifle = "Schematic:sid_assault_auto_vr_ore_t01";
const route = (accountId, side, name, profileId) => `/fortnite/api/game/v2/profile/${accountId}/${side}/${name}?profileId=${profileId}&rvn=-1`;
function as(changelist, port, urlPath, token, body) {
  const text = JSON.stringify(body);
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-2.5-CL-${changelist}`, Authorization: `bearer ${token}`,
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) };
  return send({ host: "127.0.0.1", port, method: "POST", path: urlPath, headers }, text);
}
const held = (items, templateId) => Object.values(items).filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase())
  .reduce((sum, item) => sum + item.quantity, 0);

test("2.1 to 3.0's schematics name their CraftingRecipes_New row", () => {
  for (const changelist of ["3825894", "3841827", "3847564", "3858292", "3870737", v25, "3901517"]) inBuild(changelist, () => {
    const row = getItem(rifle)?.craftingRecipe;
    assert.equal(row, "Ranged.Assault.Auto.VR.Ore.T01", changelist);
    assert.equal(upgradeData().craftingRecipes[row].results[0].templateId, "Weapon:wid_assault_auto_vr_ore_t01", changelist);
  });
});

test("CraftWorldItem takes the recipe's costs from the backpack, crafting short ingredients first, and adds the item", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "CraftPlayer");
    const dedicated = await dedicatedServerToken(backend.port);
    const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, { templateId, quantity });
    await give(rifle);
    await give("Schematic:ingredient_blastpowder");
    await give("Schematic:ammo_bulletslight");
    const account = (await as(v25, backend.port, route(player.accountId, "client", "QueryProfile", "profile0"), player.token, {})).body.profileChanges[0].profile;
    const id = (templateId) => Object.keys(account.items).find((itemId) => account.items[itemId].templateId === templateId);

    await post(backend.port, route(player.accountId, "dedicated_server", "BatchUpdatePlayer", "theater0"), dedicated, {
      theaterItemUpdate: { addRequests: [
        ["Ingredient:ingredient_blastpowder", 2], ["Ingredient:ingredient_mechanical_parts_t01", 30], ["Ingredient:ingredient_rare_mechanism", 3],
        ["Ingredient:ingredient_ore_copper", 8], ["Ingredient:ingredient_ore_alloy", 10], ["Ingredient:ingredient_ore_coal", 2],
        ["WorldItem:wooditemdata", 25], ["WorldItem:metalitemdata", 10], ["Ingredient:ingredient_nuts_bolts", 2], ["Ammo:ammodatabulletslight", 40]
      ].map(([templateId, quantity], index) => ({ itemId: `bbbbbbbb-0000-0000-0000-${String(index).padStart(12, "0")}`, templateId, quantity, attributes: {} })) },
      outpostItemUpdate: {}, questObjectiveUpdates: []
    });
    const craft = (body, profileId = "theater0") => as(v25, backend.port, route(player.accountId, "client", "CraftWorldItem", profileId), player.token, body);

    // The rifle needs 12 blast powder: the 10 missing are two crafts of the blast powder schematic (5 each, for 4 alloy
    // and 1 coal).
    const response = await craft({ targetSchematicItemId: id(rifle).replace(/-/g, "").toUpperCase(), numTimesToCraft: 1 });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    let items = response.body.profileChanges[0].profile.items;
    for (const [templateId, quantity] of [["Ingredient:ingredient_blastpowder", 0], ["Ingredient:ingredient_mechanical_parts_t01", 6],
      ["Ingredient:ingredient_rare_mechanism", 0], ["Ingredient:ingredient_ore_copper", 0], ["Ingredient:ingredient_ore_alloy", 2], ["Ingredient:ingredient_ore_coal", 0]]) {
      assert.equal(held(items, templateId), quantity, templateId);
    }
    const weapons = Object.values(items).filter((item) => item.templateId === "Weapon:wid_assault_auto_vr_ore_t01");
    assert.equal(weapons.length, 1);
    assert.deepEqual(weapons[0].attributes, { level: 1, durability: inBuild(v25, () => getItem("Weapon:wid_assault_auto_vr_ore_t01").maxDurability) });

    // Short of the costs and with nothing to craft them from: refused, nothing taken.
    const refused = await craft({ targetSchematicItemId: id(rifle), numTimesToCraft: 1 });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.errorCode, "errors.com.epicgames.fortnite.item_consumption_failed");

    // Ammo joins the stack held: 60 light bullets for 10 wood, 4 metal and 2 nuts and bolts.
    const ammo = await craft({ targetSchematicItemId: id("Schematic:ammo_bulletslight"), numTimesToCraft: 1 });
    assert.equal(ammo.status, 200);
    items = ammo.body.profileChanges[0].profile.items;
    assert.equal(held(items, "Ammo:ammodatabulletslight"), 100);
    assert.equal(Object.values(items).filter((item) => item.templateId === "Ammo:ammodatabulletslight").length, 1);
    assert.equal(held(items, "WorldItem:wooditemdata"), 15);
    assert.equal(held(items, "Ingredient:ingredient_nuts_bolts"), 0);

    for (const [body, profileId, code] of [
      [{ targetSchematicItemId: "bbbbbbbb-0000-0000-0000-00000000dead", numTimesToCraft: 1 }, "theater0", "errors.com.epicgames.fortnite.item_not_found"],
      [{ targetSchematicItemId: id("Schematic:ammo_bulletslight"), numTimesToCraft: 0 }, "theater0", "errors.com.epicgames.validation.validation_failed"],
      [{ targetSchematicItemId: id("Schematic:ammo_bulletslight"), numTimesToCraft: 1 }, "profile0", "errors.com.epicgames.modules.profiles.invalid_command"]
    ]) {
      const wrong = await craft(body, profileId);
      assert.equal(wrong.status, 400);
      assert.equal(wrong.body.errorCode, code);
    }
  } finally {
    backend.close();
  }
});
