import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/cardpacks/pools.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { readGameData } from "../src/gamedata/read.js";
import { upgradeItems } from "../src/profiles/defaults.js";
import { rollWorkerAttributes } from "../src/profiles/workers.js";
import { post, startBackend, userLogin } from "./helpers.js";

const { personalities, setBonuses } = readGameData("workers");
const personalityTags = personalities.map((entry) => entry.tag);
const setBonusTags = setBonuses.map((entry) => entry.tag);

// "Homebase.Worker.Personality.IsAdventurous" + gender 1 → an "IconDef-WorkerPortrait-Adventurous-M0n" portrait.
function portraitMatches({ personality, gender, portrait }) {
  const word = personality.split(".").pop().slice(2);
  return new RegExp(`^/Game/UI/Icons/Icon-Worker/IconDefinitions/IconDef-WorkerPortrait-${word}-${gender === 2 ? "F" : "M"}0\\d\\.IconDef-WorkerPortrait-${word}-${gender === 2 ? "F" : "M"}0\\d$`).test(portrait);
}

test("a survivor gets a gender, a personality, a portrait of that personality and gender, and a set bonus", () => {
  for (let i = 0; i < 40; i++) {
    const attributes = rollWorkerAttributes("Worker:workerbasic_c_t01");
    assert.ok([1, 2].includes(attributes.gender));
    assert.ok(personalityTags.includes(attributes.personality), attributes.personality);
    assert.ok(portraitMatches(attributes), attributes.portrait);
    assert.ok(setBonusTags.includes(attributes.set_bonus), attributes.set_bonus);
    assert.equal(attributes.managerSynergy, undefined);
  }
});

test("a lead keeps its synergy and has no set bonus; fixed portraits and genders stay", () => {
  const lead = rollWorkerAttributes("Worker:managergadgeteer_r_t01");
  assert.equal(lead.managerSynergy, "Homebase.Manager.IsGadgeteer");
  assert.equal(lead.set_bonus, undefined);
  assert.ok(portraitMatches(lead));

  const husk = rollWorkerAttributes("Worker:workerhalloween_c_t01");
  assert.equal(husk.gender, 1);
  assert.equal(husk.portrait, "/Game/UI/Icons/Icon-Worker/IconDefinitions/IconDef-WorkerPortrait-Husk.IconDef-WorkerPortrait-Husk");
  assert.ok(personalityTags.includes(husk.personality));
});

test("llamas don't hand out the Halloween event's Husk survivors", () => {
  for (const rarity of ["c", "uc", "r", "vr", "sr"]) {
    assert.ok(pool("worker", null, rarity).every((templateId) => !templateId.includes("halloween")), rarity);
  }
  for (let i = 0; i < 30; i++) {
    for (const { templateId } of rollContents("CardPack:cardpack_basic")) assert.ok(!templateId.includes("halloween"), templateId);
  }
});

test("survivors saved without these attributes get them when the profile loads", () => {
  const profile = { profileId: "profile0", items: {
    a: { templateId: "Worker:workerbasic_r_t01", attributes: { level: 3, squad_id: "", squad_slot_idx: -1 }, quantity: 1 },
    b: { templateId: "Worker:managerdoctor_vr_t01", attributes: { level: 1, personality: "Homebase.Worker.Personality.IsDreamer" }, quantity: 1 }
  }, stats: { attributes: {} } };
  assert.equal(upgradeItems(profile), true);
  const { a, b } = profile.items;
  assert.ok(personalityTags.includes(a.attributes.personality) && setBonusTags.includes(a.attributes.set_bonus) && portraitMatches(a.attributes));
  assert.equal(a.attributes.level, 3, "nothing set is changed");
  assert.equal(b.attributes.personality, "Homebase.Worker.Personality.IsDreamer");
  assert.equal(b.attributes.managerSynergy, "Homebase.Manager.IsDoctor");
  assert.equal(upgradeItems(profile), false, "once filled, nothing more to do");
});

test("survivors from an opened llama arrive with their attributes", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "SurvivorTest");
    await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: "Worker:workerbasic_uc_t01", quantity: 1 });
    const command = (name, body) => post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`, token, body);
    const items = Object.values((await command("QueryProfile", {})).body.profileChanges[0].profile.items);
    const survivor = items.find((item) => item.templateId === "Worker:workerbasic_uc_t01");
    assert.ok(portraitMatches(survivor.attributes));
    assert.ok(setBonusTags.includes(survivor.attributes.set_bonus));
  } finally {
    backend.close();
  }
});
