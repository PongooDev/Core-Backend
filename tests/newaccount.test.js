import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getQuest } from "../src/gamedata/quests.js";
import { readGameData } from "../src/gamedata/read.js";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`;
const heroes = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId.startsWith("Hero:"));

test("the default hero is the one DefaultGameData names", () => {
  assert.deepEqual(readGameData("newaccount"), { defaultHero: "Hero:hid_commando_grenadegun_uc_t01" });
});

test("a new account's first login changes nothing after its first QueryProfile", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "FirstLogin");
    const first = await post(backend.port, command(accountId, "QueryProfile"), token, {});
    const rvn = first.body.profileRevision;
    const { profile } = first.body.profileChanges[0];
    const quest = Object.values(profile.items).find((item) => item.templateId === "Quest:homebaseonboarding");
    assert.equal(quest.attributes.quest_state, "Active");
    for (const objective of getQuest("homebaseonboarding").objectives) assert.equal(quest.attributes[`completion_${objective.name}`], 0);

    // What the client sends next, with the revision it holds (2026-10-19 crash: these came back as full profile updates).
    for (const name of ["ClientQuestLogin", "RefreshExpeditions", "QueryProfile"]) {
      const reply = await post(backend.port, command(accountId, name, rvn), token, {});
      assert.equal(reply.status, 200, name);
      assert.equal(reply.body.profileRevision, rvn, name);
      assert.deepEqual(reply.body.profileChanges, [], name);
    }
  } finally {
    backend.close();
  }
});

test("a new account starts with Ramirez as the lead hero of the default hero squad", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "NewHero");
    const { profile } = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0];
    const [[heroId, hero], ...others] = heroes(profile);
    assert.equal(others.length, 0);
    assert.equal(hero.templateId, "Hero:hid_commando_grenadegun_uc_t01");
    assert.equal(hero.attributes.level, 1);
    assert.equal(hero.attributes.squad_id, profile.stats.attributes.default_hero_squad_id);
    assert.equal(hero.attributes.squad_id, "Squad_Combat_AdventureSquadOne");
    assert.equal(hero.attributes.squad_slot_idx, 0);
    assert.match(heroId, /^[0-9a-f-]{36}$/);
  } finally {
    backend.close();
  }
});

test("a profile left with no hero gets the default one back when it next loads", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "NoHero");
    const { profile } = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0];
    const [[heroId]] = heroes(profile);
    assert.equal((await post(backend.port, `/admin/api/accounts/${accountId}/items/remove`, undefined, { itemId: heroId })).status, 200);

    const after = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0].profile;
    const [[newId, hero], ...others] = heroes(after);
    assert.equal(others.length, 0);
    assert.notEqual(newId, heroId);
    assert.equal(hero.attributes.squad_slot_idx, 0);
  } finally {
    backend.close();
  }
});

const heroTemplate = { xp: 0, favorite: 0, max_level_bonus: 0, portrait: "", hero_name: "DefaultHeroName", equipped_cosmetics: ["", "", "", "", "", "", "", ""], mode_loadouts: [] };

test("heroes carry what the client's hero template has, with their hero type's gender", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "HeroAttributes");
    await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: "Hero:hid_constructor_rushbase_uc_t01", quantity: 1 });
    const { profile } = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0];
    const byTemplate = Object.fromEntries(heroes(profile).map(([, item]) => [item.templateId, item.attributes]));
    // Ramirez's definition saves no Gender, so it keeps UFortWorkerType's default, Female (2); RushBASE saves Male.
    assert.deepEqual(byTemplate["Hero:hid_commando_grenadegun_uc_t01"], { level: 1, item_seen: 0, squad_id: "Squad_Combat_AdventureSquadOne",
      squad_slot_idx: 0, slotted_building_id: "", building_slot_used: -1, ...heroTemplate, gender: 2 });
    assert.deepEqual(byTemplate["Hero:hid_constructor_rushbase_uc_t01"], { level: 1, item_seen: 0, squad_id: "", squad_slot_idx: -1,
      slotted_building_id: "", building_slot_used: -1, ...heroTemplate, gender: 1 });
  } finally {
    backend.close();
  }
});

test("existing heroes get the missing attributes, and an empty lead slot gets the first free hero", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "OldHeroes");
    const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      profileId: "profile0", accountId, rvn: 9, wipeNumber: 1, version: "core", commandRevision: 8,
      stats: { attributes: { level: 3, default_hero_squad_id: "Squad_Combat_AdventureSquadOne" } },
      items: {
        away: { templateId: "Hero:hid_commando_grenadegun_uc_t01", quantity: 1,
          attributes: { level: 4, item_seen: 1, squad_id: "Squad_Expedition_ExpeditionSquadOne", squad_slot_idx: 0, gender: 0 } },
        free: { templateId: "Hero:hid_constructor_rushbase_uc_t01", quantity: 1,
          attributes: { level: 2, item_seen: 1, squad_id: "", squad_slot_idx: -1, slotted_building_id: "", building_slot_used: -1, hero_name: "Hype" } },
        quest: { templateId: "Quest:homebaseonboarding", quantity: 1, attributes: { quest_state: "Claimed" } }
      }
    }));

    const first = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body;
    assert.ok(first.profileRevision > 9);
    const { away, free } = first.profileChanges[0].profile.items;
    assert.deepEqual(free.attributes, { level: 2, item_seen: 1, squad_id: "Squad_Combat_AdventureSquadOne", squad_slot_idx: 0, slotted_building_id: "",
      building_slot_used: -1, ...heroTemplate, hero_name: "Hype", gender: 1 });
    assert.equal(away.attributes.squad_id, "Squad_Expedition_ExpeditionSquadOne", "a hero on an expedition stays there");
    assert.equal(away.attributes.gender, 2, "an Invalid gender becomes the hero type's");
    assert.equal(away.attributes.level, 4);

    const again = await post(backend.port, command(accountId, "QueryProfile", first.profileRevision), token, {});
    assert.deepEqual(again.body.profileChanges, [], "once filled, nothing more changes");
  } finally {
    backend.close();
  }
});

test("a new account has the tutorial's tier 0 weapon schematics, and they aren't given back after the tutorial", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "Crafter");
    const query = async () => (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0].profile;
    const schematics = (profile) => Object.entries(profile.items).filter(([, item]) => /_t00$/.test(item.templateId) && item.templateId.startsWith("Schematic:"));
    const first = schematics(await query());
    assert.deepEqual(first.map(([, item]) => item.templateId).sort(), ["Schematic:sid_assault_auto_c_ore_t00", "Schematic:sid_assault_semiauto_c_ore_t00",
      "Schematic:sid_edged_sword_medium_c_ore_t00", "Schematic:sid_pistol_semiauto_c_ore_t00"]);
    assert.ok(first.every(([, item]) => item.attributes.level === 1 && item.quantity === 1));

    await post(backend.port, `/admin/api/accounts/${accountId}/skip-tutorial`, undefined, {});
    const [rifleId] = first.find(([, item]) => item.templateId === "Schematic:sid_assault_auto_c_ore_t00");
    await post(backend.port, `/admin/api/accounts/${accountId}/items/remove`, undefined, { itemId: rifleId });
    assert.equal(schematics(await query()).length, 3, "recycled after the tutorial: stays gone");
  } finally {
    backend.close();
  }
});

test("accounts made before the starter schematics get them once, tutorial done or not", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "Veteran");
    const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      profileId: "profile0", accountId, rvn: 12, wipeNumber: 1, version: "core", commandRevision: 11, stats: { attributes: { level: 5 } },
      items: {
        hero: { templateId: "Hero:hid_commando_grenadegun_uc_t01", quantity: 1, attributes: { level: 5, squad_id: "Squad_Combat_AdventureSquadOne", squad_slot_idx: 0 } },
        sword: { templateId: "Schematic:sid_edged_sword_medium_c_ore_t00", quantity: 1, attributes: { level: 1, item_seen: 1 } },
        ...Object.fromEntries(["homebaseonboarding", "homebaseonboardinggrantschematics", "outpostquest_t1_l1", "homebaseonboardingafteroutpost"]
          .map((questId) => [questId, { templateId: `Quest:${questId}`, quantity: 1, attributes: { quest_state: "Claimed" } }]))
      }
    }));
    const query = async (rvn = -1) => (await post(backend.port, command(accountId, "QueryProfile", rvn), token, {})).body;
    const schematics = (profile) => Object.values(profile.items).map((item) => item.templateId).filter((id) => /^Schematic:.*_t00$/.test(id)).sort();

    const first = await query();
    assert.ok(first.profileRevision > 12);
    const { profile } = first.profileChanges[0];
    assert.deepEqual(schematics(profile), ["Schematic:sid_assault_auto_c_ore_t00", "Schematic:sid_assault_semiauto_c_ore_t00",
      "Schematic:sid_edged_sword_medium_c_ore_t00", "Schematic:sid_pistol_semiauto_c_ore_t00"], "the three missing ones, the sword kept");
    assert.equal(profile.coreMigrations, undefined, "Core's bookkeeping isn't sent to the client");
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).coreMigrations, ["starterSchematics", "ammoSchematics"]);

    const [rifleId] = Object.entries(profile.items).find(([, item]) => item.templateId === "Schematic:sid_assault_auto_c_ore_t00");
    await post(backend.port, `/admin/api/accounts/${accountId}/items/remove`, undefined, { itemId: rifleId });
    const after = await query();
    assert.equal(schematics(after.profileChanges[0].profile).length, 3, "once only: a recycled one stays gone");
    assert.deepEqual((await query(after.profileRevision)).profileChanges, []);
  } finally {
    backend.close();
  }
});
