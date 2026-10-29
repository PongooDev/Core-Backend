import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, startBackend, userLogin } from "./helpers.js";

// Core-Backend #109: Give listed Cert's items only, so 1.8's Fortnitemares heroes (Hazard the 13th, Marine Corps Ramirez)
// couldn't be given, and there was no way to give a template by id.
const hazard = "Hero:hid_constructor_007hw_sr_t01";
const admin = (backend, path, body) => (body === undefined ? get(backend.port, `/admin/api${path}`) : post(backend.port, `/admin/api${path}`, undefined, body));

test("Give lists and gives items only a later build's data has, with the builds that have them", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "GivePlayer");
    const catalog = (await admin(backend, "/catalog?search=hazard&category=heroes")).body;
    const entry = catalog.items.find((item) => item.templateId === hazard);
    assert.deepEqual([entry?.name, entry?.category, entry?.single, entry?.builds], ["Hazard the 13th", "heroes", true, "1.8+"]);
    assert.ok((await admin(backend, "/catalog?search=marine%20corpse%20ramirez")).body.items.some((item) => item.templateId === "Hero:hid_commando_007hw_sr_t01"));
    // Cert's items show no chip.
    assert.equal((await admin(backend, "/catalog?search=hid_commando_007_r_t01")).body.items[0].builds, null);
    assert.ok((await admin(backend, "/items")).body.includes(hazard));

    const lookup = (await admin(backend, `/catalog/lookup?templateId=${encodeURIComponent(hazard.toUpperCase())}`)).body;
    assert.deepEqual([lookup.known, lookup.item.templateId, lookup.item.name], [true, hazard, "Hazard the 13th"]);

    const given = await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: hazard, quantity: 2 });
    assert.equal(given.status, 200);
    assert.equal(given.body.granted, 2);
    const heroes = given.body.items.filter((item) => item.templateId === hazard);
    assert.deepEqual(heroes.map((item) => [item.name, item.quantity]), [["Hazard the 13th", 1], ["Hazard the 13th", 1]]);
    // A single item still has its cap, from the data of the build that has it.
    assert.equal((await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: hazard, quantity: 501 })).status, 400);
  } finally {
    backend.close();
  }
});

test("Give by id refuses an unknown id without force, gives it with force, and refuses a malformed id", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ByIdPlayer");
    const grantPath = `/accounts/${player.accountId}/grant`;
    const unknown = "Hero:hid_core_not_in_any_build";

    assert.deepEqual((await admin(backend, `/catalog/lookup?templateId=${unknown}`)).body, { known: false, templateId: unknown, profileId: "profile0" });
    const refused = await admin(backend, grantPath, { templateId: unknown, quantity: 3 });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage, /no build's game data has it/);
    assert.ok(!refused.body.items, "a refused grant gives nothing");

    const forced = await admin(backend, grantPath, { templateId: unknown, quantity: 3, force: true });
    assert.equal(forced.status, 200);
    assert.deepEqual(forced.body.items.filter((item) => item.templateId === unknown).map((item) => item.quantity), [3]);
    assert.equal(forced.body.forced.profileId, "profile0");

    // A world item's type goes to the backpack (theater0).
    const weapon = "Weapon:wid_core_not_in_any_build";
    assert.equal((await admin(backend, `/catalog/lookup?templateId=${weapon}`)).body.profileId, "theater0");
    const world = await admin(backend, grantPath, { templateId: weapon, quantity: 1, force: true });
    assert.equal(world.status, 200);
    assert.ok(world.body.worldItems.some((item) => item.templateId === weapon));

    // A Battle Royale cosmetic some build has goes to the locker without force; an unknown one only with it.
    const cosmetic = "AthenaCharacter:cid_029_athena_commando_f_halloween";
    assert.equal((await admin(backend, `/catalog/lookup?templateId=${cosmetic}`)).body.known, true);
    assert.equal((await admin(backend, grantPath, { templateId: cosmetic })).body.granted, 1);
    assert.equal((await admin(backend, grantPath, { templateId: "AthenaCharacter:cid_core_unknown" })).status, 400);
    assert.equal((await admin(backend, grantPath, { templateId: "AthenaCharacter:cid_core_unknown", force: true })).body.granted, 1);
    const locker = (await admin(backend, `/accounts/${player.accountId}/cosmetics?search=halloween`)).body;
    assert.ok(locker.items.find((item) => item.templateId === cosmetic).owned);

    for (const templateId of ["nocolon", "Hero:", ":name", "Hero:two words", "Hero:a:b", ""]) {
      const malformed = await admin(backend, grantPath, { templateId, quantity: 1, force: true });
      assert.equal(malformed.status, 400, templateId);
      assert.match(malformed.body.errorMessage, /Type:name/);
      assert.equal((await admin(backend, `/catalog/lookup?templateId=${encodeURIComponent(templateId)}`)).status, 400, templateId);
    }
  } finally {
    backend.close();
  }
});
