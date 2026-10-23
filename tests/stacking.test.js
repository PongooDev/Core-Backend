import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getItem } from "../src/gamedata/items.js";
import { trackChanges } from "../src/profiles/changes.js";
import { grantItem } from "../src/profiles/items.js";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

function memorySession() {
  const trackers = {};
  return {
    trackers,
    profile(profileId) {
      trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: {} }, items: {} });
      return trackers[profileId];
    }
  };
}

const stacks = (session, templateId) => Object.values(session.trackers.theater0.profile.items)
  .filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase()).map((item) => item.quantity);

test("world items fill their stacks up to MaxStackSize, then start new ones", () => {
  const session = memorySession();
  assert.equal(getItem("Ingredient:ingredient_ore_copper").maxStackSize, 99);
  grantItem(session, "Ingredient:ingredient_ore_copper", 150);
  assert.deepEqual(stacks(session, "Ingredient:ingredient_ore_copper"), [99, 51]);
  const granted = grantItem(session, "Ingredient:ingredient_ore_copper", 60);
  assert.deepEqual(stacks(session, "Ingredient:ingredient_ore_copper"), [99, 99, 12]);
  assert.deepEqual(granted.map((entry) => entry.quantity), [48, 12], "one entry per stack topped up or made");
  for (let i = 0; i < 5; i++) grantItem(session, "Ingredient:ingredient_ore_copper", 1);
  assert.deepEqual(stacks(session, "Ingredient:ingredient_ore_copper"), [99, 99, 17], "single grants join the open stack");

  grantItem(session, "Weapon:wid_shotgun_standard_uc_ore_t01", 3);
  assert.deepEqual(stacks(session, "Weapon:wid_shotgun_standard_uc_ore_t01"), [1, 1, 1], "MaxStackSize 1: an item each");
});

test("never-persisted world items are not granted into a profile", () => {
  const session = memorySession();
  assert.equal(getItem("Ammo:AmmoDataBotTurret").neverPersisted, true);
  assert.equal(getItem("WorldItem:questitem_huskdna").neverPersisted, true);
  assert.equal(getItem("Ammo:ammodatashells").neverPersisted, undefined);
  assert.deepEqual(grantItem(session, "Ammo:AmmoDataBotTurret", 3000), []);
  assert.deepEqual(session.trackers.theater0?.profile.items ?? {}, {});
});

test("the admin panel neither offers nor gives never-persisted items", async () => {
  const backend = await startBackend();
  try {
    const { accountId } = await userLogin(backend.port, "StackPanel");
    const catalog = (await get(backend.port, "/admin/api/catalog?search=bot%20turret&limit=500")).body.items;
    assert.equal(catalog.some((entry) => entry.templateId.toLowerCase() === "ammo:ammodatabotturret"), false);
    const refused = await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: "Ammo:AmmoDataBotTurret", quantity: 1 });
    assert.equal(refused.status, 400);

    for (let i = 0; i < 3; i++) await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: "Ingredient:ingredient_ore_copper", quantity: 40 });
    const details = (await get(backend.port, `/admin/api/accounts/${accountId}`)).body;
    assert.deepEqual(details.worldItems.filter((item) => item.templateId === "Ingredient:ingredient_ore_copper").map((item) => item.quantity).sort(), [21, 99]);
  } finally {
    backend.close();
  }
});

test("a theater0 bloated by single grants is tidied once, as the gameserver loads it", async () => {
  const backend = await startBackend();
  try {
    const { accountId } = await userLogin(backend.port, "Bloated");
    const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "theater0.json");
    const items = {
      worn: { templateId: "Trap:tid_floor_spikes_r_t01", quantity: 1, attributes: { durability: 12 } },
      fresh: { templateId: "Trap:tid_floor_spikes_r_t01", quantity: 1, attributes: { durability: 30 } },
      fresh2: { templateId: "Trap:tid_floor_spikes_r_t01", quantity: 1, attributes: { durability: 30 } },
      shotgun: { templateId: "Weapon:wid_shotgun_standard_uc_ore_t01", quantity: 1, attributes: { durability: 125 } },
      over: { templateId: "WorldItem:wooditemdata", quantity: 1500, attributes: {} },
      wood: { templateId: "WorldItem:wooditemdata", quantity: 600, attributes: {} }
    };
    for (let i = 0; i < 3000; i++) items[`turret${i}`] = { templateId: "Ammo:ammodatabotturret", quantity: 1, attributes: {} };
    for (let i = 0; i < 300; i++) items[`copper${i}`] = { templateId: "Ingredient:ingredient_ore_copper", quantity: 1, attributes: {} };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      profileId: "theater0", accountId, rvn: 3, wipeNumber: 1, version: "core", commandRevision: 2, coreMigrations: ["itemDurability"],
      stats: { attributes: { player_loadout: { bPlayerIsNew: false, pinnedSchematicInstances: [], zonesCompleted: 1 } } }, items
    }));

    const server = await dedicatedServerToken(backend.port);
    const query = async () => (await post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/dedicated_server/QueryProfile?profileId=theater0&rvn=-1`, server, {})).body;
    const { profile } = (await query()).profileChanges[0];
    const byTemplate = (templateId) => Object.entries(profile.items).filter(([, item]) => item.templateId === templateId)
      .map(([itemId, item]) => [itemId, item.quantity]);
    assert.deepEqual(byTemplate("Ammo:ammodatabotturret"), []);
    assert.deepEqual(byTemplate("Ingredient:ingredient_ore_copper"), [["copper0", 99], ["copper1", 99], ["copper2", 99], ["copper3", 3]]);
    assert.deepEqual(byTemplate("Trap:tid_floor_spikes_r_t01"), [["worn", 1], ["fresh", 2]], "only equal stacks merge");
    assert.deepEqual(byTemplate("WorldItem:wooditemdata"), [["over", 999], ["wood", 1101]], "nothing is lost");
    assert.deepEqual(byTemplate("Weapon:wid_shotgun_standard_uc_ore_t01"), [["shotgun", 1]]);
    assert.equal(Object.keys(profile.items).length, 9);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).coreMigrations, ["itemDurability", "worldStacks"]);
  } finally {
    backend.close();
  }
});
