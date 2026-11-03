import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { getItem } from "../src/gamedata/items.js";
import { upgradeData } from "../src/gamedata/upgrades.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Flux's rarity upgrade, UpgradeItemRarity {targetItemId} on profile0 (#199).
const v242 = "3870737";
const v25 = "3889387";
const hawk = "Hero:hid_commando_007_uc_t01";
const route = (accountId, name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;
function as(port, urlPath, token, body) {
  const text = JSON.stringify(body);
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-2.5-CL-${v25}`, Authorization: `bearer ${token}`,
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) };
  return send({ host: "127.0.0.1", port, method: "POST", path: urlPath, headers }, text);
}

test("heroes name their EvolveRarity row, and 2.5's rows are its notes' reworked costs", () => {
  const costs = (changelist, row) => inBuild(changelist, () => upgradeData().recipes[row].costs);
  for (const changelist of [v242, v25]) assert.equal(inBuild(changelist, () => getItem(hawk).rarityUpgrade), "EvolveRarity.HID.Commando.007.R.T01");
  // 2.4.2's early rows cost Training Manuals at every star; 2.5's cost evolution materials by star.
  assert.deepEqual(costs(v242, "EvolveRarity.HID.Commando.007.R.T02").map((cost) => cost.templateId),
    ["AccountResource:reagent_evolverarity_r", "AccountResource:reagent_people"]);
  assert.deepEqual(costs(v25, "EvolveRarity.HID.Commando.007.R.T02").map((cost) => [cost.templateId, cost.quantity]),
    [["AccountResource:reagent_evolverarity_r", 100], ["AccountResource:reagent_c_t01", 3], ["AccountResource:reagent_people", 1]]);
});

test("UpgradeItemRarity spends the Flux and the level-relative XP, and keeps the item's id and level", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "RarityPlayer");
    const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, { templateId, quantity });
    const run = (name, body) => as(backend.port, route(player.accountId, name), player.token, body);
    const profile = async () => (await run("QueryProfile", {})).body.profileChanges[0].profile;
    const amount = (items, templateId) => Object.values(items).filter((item) => item.templateId === templateId).reduce((sum, item) => sum + item.quantity, 0);
    await give(hawk);
    await give("AccountResource:heroxp", 1000);
    const items0 = (await profile()).items;
    const hero = Object.keys(items0).find((itemId) => items0[itemId].templateId === hawk);
    assert.ok(hero);
    // Level 3: 150 + 300 XP as Uncommon.
    for (let i = 0; i < 2; i++) assert.equal((await run("UpgradeItem", { targetItemId: hero })).status, 200);

    // Without the skill tree's Unlocks.RarityUpgrade.Hero.Soldier, and then without the Flux: refused.
    let refused = await run("UpgradeItemRarity", { targetItemId: hero });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.errorCode, "errors.com.epicgames.fortnite.item_consumption_failed");
    await give("HomebaseNode:t1_main_bf8f555f0");
    refused = await run("UpgradeItemRarity", { targetItemId: hero });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage, /reagent_evolverarity_r/);

    // Rare's levels 1 and 2 cost 200 + 400, Uncommon's 150 + 300: 150 XP and 100 Rare Flux.
    await give("AccountResource:reagent_evolverarity_r", 120);
    const response = await run("UpgradeItemRarity", { targetItemId: hero });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const items = response.body.profileChanges[0].profile.items;
    assert.equal(items[hero].templateId, "Hero:hid_commando_007_r_t01");
    assert.equal(items[hero].attributes.level, 3);
    assert.equal(amount(items, "AccountResource:heroxp"), 1000 - 450 - 150);
    assert.equal(amount(items, "AccountResource:reagent_evolverarity_r"), 20);
    assert.deepEqual(response.body.notifications, [{ type: "upgradeItemRarity", primary: true,
      itemsGranted: [{ itemType: "Hero:hid_commando_007_r_t01", itemGuid: hero, itemProfile: "profile0", quantity: 1 }] }]);

    // The Rare hero's next row needs Epic Flux.
    refused = await run("UpgradeItemRarity", { targetItemId: hero });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage, /reagent_evolverarity_vr/);
    assert.equal((await run("UpgradeItemRarity", { targetItemId: "missing" })).body.errorCode, "errors.com.epicgames.fortnite.item_not_found");
  } finally {
    backend.close();
  }
});
