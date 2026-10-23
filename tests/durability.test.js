import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getItem } from "../src/gamedata/items.js";
import { trackChanges } from "../src/profiles/changes.js";
import { grantItem } from "../src/profiles/items.js";
import { post, startBackend, userLogin } from "./helpers.js";

const theater = (accountId) => `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=theater0&rvn=-1`;

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

test("world item templates carry their static max durability at level 0", () => {
  const maxDurability = (templateId) => getItem(templateId).maxDurability;
  assert.equal(maxDurability("Weapon:wid_pistol_semiauto_c_ore_t00"), 125, "Default_Ranged, Handmade");
  assert.equal(maxDurability("Weapon:wid_shotgun_standard_uc_ore_t01"), 125, "Default_Ranged, Ordinary");
  assert.equal(maxDurability("Weapon:wid_assault_auto_r_ore_t01"), 190, "Default_Ranged, Sturdy");
  assert.equal(maxDurability("Weapon:wid_launcher_rocket_r_ore_t01"), 9, "Ranged_NoAmmo_Explosive_Medium, Sturdy");
  assert.equal(maxDurability("Trap:tid_floor_spikes_r_t01"), 30, "TrapDurability_Medium, Sturdy");
  assert.equal(maxDurability("Weapon:wid_harvest_pickaxe_c_t01"), undefined, "bItemHasDurability false");
  assert.equal(maxDurability("Weapon:edittool"), undefined, "bItemHasDurability false");
  assert.equal(getItem("Ammo:ammodatabulletslight").maxDurability, undefined);
});

test("granted world items start at their template's max durability", () => {
  const session = memorySession();
  const granted = (templateId) => {
    const [{ profileId, itemId }] = grantItem(session, templateId, 1);
    return session.trackers[profileId].profile.items[itemId];
  };
  assert.deepEqual(granted("Weapon:wid_sniper_auto_uc_ore_t01").attributes, { durability: 125 });
  assert.deepEqual(granted("Weapon:wid_edged_sword_medium_r_ore_t01").attributes, { durability: 190 });
  assert.deepEqual(granted("Trap:tid_floor_spikes_r_t01").attributes, { durability: 30 });
  assert.deepEqual(granted("Weapon:wid_harvest_pickaxe_c_t01").attributes, {});
  assert.deepEqual(granted("Ammo:ammodatabulletslight").attributes, {});
  assert.deepEqual(Object.keys(session.trackers), ["theater0"]);
});

test("an admin grant puts a weapon in theater0 with its durability", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "DurabilityGrant");
    const reply = await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: "Weapon:wid_launcher_rocket_r_ore_t01", quantity: 1 });
    assert.equal(reply.status, 200);
    const { profile } = (await post(backend.port, theater(accountId), token, {})).body.profileChanges[0];
    const launchers = Object.values(profile.items).filter((item) => item.templateId === "Weapon:wid_launcher_rocket_r_ore_t01");
    assert.deepEqual(launchers.map((item) => item.attributes), [{ durability: 9 }]);
  } finally {
    backend.close();
  }
});

test("theater0 items saved without durability get their template's, once", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "DurabilityMigration");
    const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "theater0.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      profileId: "theater0", accountId, rvn: 7, wipeNumber: 1, version: "core", commandRevision: 6,
      stats: { attributes: { player_loadout: { bPlayerIsNew: false, pinnedSchematicInstances: [], zonesCompleted: 1 } } },
      items: {
        shotgun: { templateId: "Weapon:wid_shotgun_standard_uc_ore_t01", quantity: 1, attributes: {} },
        sniper: { templateId: "Weapon:wid_sniper_auto_r_ore_t01", quantity: 1, attributes: { level: 1, loadedAmmo: 3 } },
        worn: { templateId: "Weapon:wid_assault_auto_r_ore_t01", quantity: 1, attributes: { durability: 42, level: 1 } },
        trap: { templateId: "Trap:tid_floor_spikes_r_t01", quantity: 2, attributes: {} },
        pickaxe: { templateId: "Weapon:wid_harvest_pickaxe_c_t01", quantity: 1, attributes: {} },
        wood: { templateId: "WorldItem:wooditemdata", quantity: 30, attributes: {} }
      }
    }));
    const query = async () => (await post(backend.port, theater(accountId), token, {})).body;

    const first = await query();
    assert.ok(first.profileRevision > 7);
    const { items } = first.profileChanges[0].profile;
    assert.deepEqual(items.shotgun.attributes, { durability: 125 });
    assert.deepEqual(items.sniper.attributes, { level: 1, loadedAmmo: 3, durability: 190 });
    assert.deepEqual(items.worn.attributes, { durability: 42, level: 1 }, "a worn weapon keeps its durability");
    assert.deepEqual(items.trap.attributes, { durability: 30 });
    assert.deepEqual(items.pickaxe.attributes, {});
    assert.deepEqual(items.wood.attributes, {});
    assert.equal(first.profileChanges[0].profile.coreMigrations, undefined, "Core's bookkeeping isn't sent to the client");
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).coreMigrations, ["worldStacks", "itemDurability"]);

    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.items.shotgun.attributes = {};
    fs.writeFileSync(file, JSON.stringify(saved));
    const second = await query();
    assert.equal(second.profileRevision, saved.rvn);
    assert.deepEqual(second.profileChanges[0].profile.items.shotgun.attributes, {}, "once only");
  } finally {
    backend.close();
  }
});
