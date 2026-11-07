import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { grantCosmetic, grantFullLocker, lockerCosmeticId, lockerCosmetics } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// The locker's Random entries (Core-Backend #278): from 4.0 the client equips a random customization selector by its
// template id (no profile item has it), the slot keeps it as it came, and the client picks at match time. Builds without
// selectors see the slot's default while they have the profile, and the random comes back on 4.0 and later.
const agentOf = (version, changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-${version}-CL-${changelist}`;
const agent42 = agentOf("4.2", 4072250);
const agent40 = agentOf("4.0", 4039451);
const agent36 = agentOf("3.6", 4019403);
const agent18 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489";

function command(port, { accountId, token }, agent, name, body = {}) {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=athena&rvn=-1`,
    headers: { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}
const statsOf = (response) => response.body.profileChanges[0].profile.stats.attributes;
const equip = (port, player, agent, slotName, itemToSlot) => command(port, player, agent, "EquipBattleRoyaleCustomization",
  { slotName, itemToSlot, indexWithinSlot: 0, variantUpdates: [] });

test("4.2's Random entries go in every slot that offers one, and the slot keeps the id as it came (#278)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "RandomLocker");
    await command(backend.port, player, agent42, "QueryProfile");
    for (const [slotName, itemToSlot, stat] of [["Character", "AthenaCharacter:cid_random", "favorite_character"],
      ["LoadingScreen", "AthenaLoadingScreen:lsid_random", "favorite_loadingscreen"], ["Backpack", "AthenaBackpack:bid_random", "favorite_backpack"],
      ["Glider", "AthenaGlider:glider_random", "favorite_glider"], ["Pickaxe", "AthenaPickaxe:pickaxe_random", "favorite_pickaxe"],
      ["SkyDiveContrail", "AthenaSkyDiveContrail:trails_random", "favorite_skydivecontrail"]]) {
      const response = await equip(backend.port, player, agent42, slotName, itemToSlot);
      assert.equal(response.status, 200, `${slotName}: ${JSON.stringify(response.body)}`);
      const full = await command(backend.port, player, agent42, "QueryProfile");
      assert.equal(statsOf(full)[stat], itemToSlot, slotName);
      // Never a profile item: the client makes its own.
      assert.equal(full.body.profileChanges[0].profile.items[itemToSlot], undefined, slotName);
    }

    // A random of another kind, or one the build has none of, is still refused.
    const wrongKind = await equip(backend.port, player, agent42, "Character", "AthenaGlider:glider_random");
    assert.equal(wrongKind.status, 400);
    assert.equal(wrongKind.body.errorCode, "errors.com.epicgames.fortnite.item_not_found");
    assert.equal((await equip(backend.port, player, agent42, "Dance", "AthenaDance:eid_random")).status, 400);

    // 4.0 has the selectors too.
    assert.equal((await equip(backend.port, player, agent40, "Character", "AthenaCharacter:cid_random")).status, 200);
  } finally {
    backend.close();
  }
});

test("builds without random selectors refuse them, show the slot's default, and 4.2 gets the random back (#278)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "RandomOldBuilds");
    // 3.6's data has CID_Random, but its client has no selectors.
    await command(backend.port, player, agent36, "QueryProfile");
    assert.equal((await equip(backend.port, player, agent36, "Character", "AthenaCharacter:cid_random")).status, 400);

    await command(backend.port, player, agent42, "QueryProfile");
    assert.equal((await equip(backend.port, player, agent42, "Glider", "AthenaGlider:glider_random")).status, 200);
    assert.equal((await equip(backend.port, player, agent42, "Character", "AthenaCharacter:cid_random")).status, 200);
    assert.equal((await equip(backend.port, player, agent42, "Pickaxe", "AthenaPickaxe:pickaxe_random")).status, 200);

    // 1.8: a null glider crashed it (#74), so the glider slot holds the default glider, the character slot "".
    const old = statsOf(await command(backend.port, player, agent18, "QueryProfile"));
    assert.match(old.favorite_glider, /^AthenaGlider:defaultglider$/i);
    assert.equal(old.favorite_character, "");
    assert.match(old.favorite_pickaxe, /^AthenaPickaxe:defaultpickaxe$/i);
    // The pickaxe is changed on 1.8: that choice stays.
    await post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, { templateId: "AthenaPickaxe:halloweenscythe", quantity: 1 });
    await command(backend.port, player, agent18, "QueryProfile");
    assert.equal((await equip(backend.port, player, agent18, "Pickaxe", "AthenaPickaxe:halloweenscythe")).status, 200);

    const back = statsOf(await command(backend.port, player, agent42, "QueryProfile"));
    assert.equal(back.favorite_glider, "AthenaGlider:glider_random");
    assert.equal(back.favorite_character, "AthenaCharacter:cid_random");
    assert.match(back.favorite_pickaxe, /^AthenaPickaxe:halloweenscythe$/i);
  } finally {
    backend.close();
  }
});

// CoreV2 #306 (and #298's crash at +0xA5161C): a Random entry held as a profile item crashed 4.1 on loading into a match,
// the client's own local item for it failing to be made. The full locker gave them. They are never locker items now, and
// a locker holding one loses the item on its next load, whatever gave it; a slot holding the id keeps it.
test("the Random entries are never profile items: the full locker leaves them out, and held ones go, keeping the slots (CoreV2 #306)", () => {
  const randoms = ["AthenaCharacter:cid_random", "AthenaBackpack:bid_random", "AthenaGlider:glider_random", "AthenaPickaxe:pickaxe_random",
    "AthenaLoadingScreen:lsid_random", "AthenaSkyDiveContrail:trails_random"];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-random-"));
  try {
    inBuild("4053532", () => {
      for (const id of randoms) assert.equal(lockerCosmeticId(id), undefined, id);
      assert.ok(!lockerCosmetics().some((id) => /_random$/i.test(id)));
      // An account the full locker gave them before, with the Random pickaxe equipped.
      const accountId = "heldrandoms";
      const file = path.join(dataDir, "accounts", accountId, "profiles", "athena.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const items = Object.fromEntries([...randoms, "AthenaGlider:defaultglider", "AthenaPickaxe:defaultpickaxe"]
        .map((templateId) => [templateId, { templateId, attributes: { level: 1, item_seen: 1, favorite: 0 }, quantity: 1 }]));
      fs.writeFileSync(file, JSON.stringify({ profileId: "athena", accountId, rvn: 3, wipeNumber: 1, version: "core", commandRevision: 2, items,
        stats: { attributes: { level: 1, xp: 0, favorite_pickaxe: "AthenaPickaxe:pickaxe_random", favorite_glider: "AthenaGlider:defaultglider",
          favorite_character: "AthenaCharacter:cid_random" } } }));
      const session = openSession(createProfileStore(dataDir), accountId);
      const { profile } = session.profile("athena");
      for (const id of randoms) assert.equal(profile.items[id], undefined, id);
      assert.equal(profile.stats.attributes.favorite_pickaxe, "AthenaPickaxe:pickaxe_random");
      assert.equal(profile.stats.attributes.favorite_character, "AthenaCharacter:cid_random");
      grantFullLocker(session);
      for (const id of randoms) assert.equal(session.profile("athena").profile.items[id], undefined, id);
      assert.equal(grantCosmetic(session, "AthenaPickaxe:pickaxe_random"), null);
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
