import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { getItem } from "../src/gamedata/items.js";
import { activeAlterations, alterationSlots, convertLegacy, convertedAlterations, hasAlterationData, hasLegacyAlterations,
  respecOptions, rollAlterations, upgradeRecipe } from "../src/profiles/alterations.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// 4.2's Perk Recombobulator (Core-Backend #270).
const v41 = "4053532";
const v42 = "4072250";
const rifle = "Schematic:sid_assault_auto_vr_ore_t01";
const at42 = (fn) => inBuild(v42, fn);

test("4.2's perk tables give a schematic its crafted weapon's loadout; 4.1 has none", () => {
  assert.equal(inBuild(v41, () => hasAlterationData()), false);
  assert.equal(inBuild(v41, () => alterationSlots(rifle)), undefined);
  const slots = at42(() => alterationSlots(rifle));
  assert.deepEqual(slots.map((slot) => [slot.slotDefinition, slot.unlockLevel, slot.unlockRarity, slot.respeccable]), [
    ["Slot.Att.Ranged.Damage.A", 5, "Handmade", true], ["Slot.Att.Ranged.Handling", 10, "Ordinary", true],
    ["Slot.Att.Elemental", 15, "Sturdy", true], ["Slot.Att.Ranged.Damage.B", 15, "Sturdy", true],
    ["Slot.Att.Conditional.A", 20, "Quality", true], ["Slot.Gameplay.Generic", 25, "Fine", false]]);
  // The elemental slot's respec costs 1,500 RE-PERK!; an element perk adds its own resource.
  assert.deepEqual(slots[2].respecCosts, [{ quantity: 1500, templateId: "AccountResource:reagent_alteration_generic" }]);
  assert.deepEqual(at42(() => getItem("Alteration:aid_ele_fire_t01")).respecCosts, [{ quantity: 1200, templateId: "AccountResource:reagent_alteration_ele_fire" }]);
  // Every rolled perk is one the slot's group holds.
  const rolled = at42(() => rollAlterations(rifle));
  assert.equal(rolled.length, 6);
  rolled.forEach((alteration, i) => assert.ok(Object.values(slots[i].group).flat().some((entry) => entry.alteration === alteration), alteration));
});

test("respec options, upgrade recipes and the working perks follow 4.2's client", () => {
  const item = { templateId: rifle, attributes: { level: 16, alterations: ["Alteration:aid_att_damage_t01", "Alteration:aid_att_magazinesize_t02",
    "Alteration:aid_ele_fire_t02", "Alteration:aid_att_critdamage_t03", "Alteration:aid_conditional_slowed_dmgbonus_t03", "Alteration:aid_g_weapon_stun_v2"] } };
  at42(() => {
    // Slot 0: the group's other Common perks at the slot's 1,000 RE-PERK!.
    const options = respecOptions(item, 0);
    assert.deepEqual(options.map((option) => option.alteration), ["Alteration:aid_att_critchance_t01", "Alteration:aid_att_critdamage_t01", "Alteration:aid_att_firerate_ranged_t01"]);
    assert.deepEqual(options[0].costs, [{ quantity: 1000, templateId: "AccountResource:reagent_alteration_generic" }]);
    // Slot 2, the element: Uncommon water costs 1,500 RE-PERK! and its FROST-UP!.
    const water = respecOptions(item, 2).find((option) => option.alteration === "Alteration:aid_ele_water_t02");
    assert.deepEqual(water.costs.map((cost) => cost.templateId), ["AccountResource:reagent_alteration_generic", "AccountResource:reagent_alteration_ele_water"]);
    // The gameplay slot isn't respeccable.
    assert.deepEqual(respecOptions(item, 5), []);
    assert.deepEqual(upgradeRecipe(item, 1).costs, [{ quantity: 65, templateId: "AccountResource:reagent_alteration_generic" },
      { quantity: 150, templateId: "AccountResource:reagent_alteration_upgrade_r" }]);
    assert.equal(upgradeRecipe(item, 1).results[0].templateId, "Alteration:aid_att_magazinesize_t03");
    // A level 16 Epic rifle: slots up to 15 work (the Epic schematic meets the Rare ones).
    assert.deepEqual(activeAlterations(item), item.attributes.alterations.slice(0, 4));
  });
});

test("a legacy schematic converts through the migration mapping", () => {
  const legacy = { templateId: rifle, attributes: { alterations: ["Alteration:AID_Att_Ranged_Damage_Alt1", "Alteration:AID_Att_Ranged_CritChance"] } };
  at42(() => {
    assert.equal(hasLegacyAlterations(legacy), true);
    assert.equal(hasLegacyAlterations({ templateId: rifle, attributes: { alterations: rollAlterations(rifle) } }), false);
    const converted = convertedAlterations(legacy);
    assert.equal(converted.length, 6);
    assert.equal(converted[0], "Alteration:aid_att_damage_t02");
    assert.ok(converted.includes("Alteration:aid_att_critchance_t01"));
    assert.ok(converted.every(Boolean));
    const items = { s: structuredClone(legacy) };
    const tracker = { profile: { items }, setItemAttribute: (itemId, name, value) => { items[itemId].attributes[name] = value; } };
    convertLegacy(tracker, "s");
    assert.deepEqual(items.s.attributes.legacy_alterations, legacy.attributes.alterations);
    assert.equal(hasLegacyAlterations(items.s), false);
    assert.throws(() => convertLegacy(tracker, "s"), /no legacy perks/);
  });
  assert.equal(inBuild(v41, () => hasLegacyAlterations(legacy)), false);
});

test("4.2: schematics get perks, and RespecAlteration and UpgradeAlteration change them (#270)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "PerkPlayer");
    const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, { templateId, quantity });
    const run = async (name, body, changelist = v42, label = "4.2") => {
      const text = JSON.stringify(body);
      return send({ host: "127.0.0.1", port: backend.port, method: "POST",
        path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${name}?profileId=campaign&rvn=-1`, headers: {
          "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-${label}-CL-${changelist}`, Authorization: `bearer ${player.token}`,
          "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    };
    const amount = (items, templateId) => Object.values(items).filter((item) => item.templateId === templateId).reduce((sum, item) => sum + item.quantity, 0);
    // A schematic granted outside 4.2 has no perks; 4.2's profile query gives it a perk per slot.
    await give(rifle);
    const before = (await run("QueryProfile", {}, v41, "4.1")).body.profileChanges[0].profile.items;
    const itemId = Object.keys(before).find((id) => before[id].templateId === rifle);
    assert.equal(before[itemId].attributes.alterations, undefined);
    let items = (await run("QueryProfile", {})).body.profileChanges[0].profile.items;
    assert.equal(items[itemId].attributes.alterations.length, 6);
    assert.deepEqual(items[itemId].attributes.legacy_alterations, []);
    // 4.1 refuses the commands.
    assert.equal((await run("UpgradeAlteration", { targetItemId: itemId, alterationSlot: 0 }, v41, "4.1")).status, 400);

    // Slot 0 unlocks at level 5.
    const option = inBuild(v42, () => respecOptions(items[itemId], 0))[0];
    await give("AccountResource:reagent_alteration_generic", 1200);
    let refused = await run("RespecAlteration", { targetItemId: itemId, alterationSlot: 0, alterationId: option.alteration });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage, /locked/);
    await give("AccountResource:schematicxp", 100000);
    for (let i = 0; i < 4; i++) assert.equal((await run("UpgradeItem", { targetItemId: itemId })).status, 200);
    // Not a choice of the slot: refused.
    refused = await run("RespecAlteration", { targetItemId: itemId, alterationSlot: 0, alterationId: "Alteration:aid_g_weapon_stun_v2" });
    assert.equal(refused.status, 400);
    let response = await run("RespecAlteration", { targetItemId: itemId, alterationSlot: 0, alterationId: option.alteration });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    items = response.body.profileChanges[0].profile.items;
    assert.equal(items[itemId].attributes.alterations[0], option.alteration);
    assert.equal(amount(items, "AccountResource:reagent_alteration_generic"), 200);

    // Upgrading it needs its recipe's RE-PERK! and PERK-UP!.
    const recipe = inBuild(v42, () => upgradeRecipe(items[itemId], 0));
    refused = await run("UpgradeAlteration", { targetItemId: itemId, alterationSlot: 0 });
    assert.equal(refused.status, 400);
    for (const cost of recipe.costs) await give(cost.templateId, cost.quantity);
    response = await run("UpgradeAlteration", { targetItemId: itemId, alterationSlot: "0" });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    items = response.body.profileChanges[0].profile.items;
    assert.equal(items[itemId].attributes.alterations[0], recipe.results[0].templateId);
    assert.equal(amount(items, "AccountResource:reagent_alteration_generic"), 200);
    // Slot 9 doesn't exist.
    assert.equal((await run("UpgradeAlteration", { targetItemId: itemId, alterationSlot: 9 })).status, 400);
  } finally {
    backend.close();
  }
});

test("4.2: a Plankerton SSD 2 claimed before 4.2 gives its RE-PERK! with the missed Recombobulator quest", async () => {
  const { missedStormShieldQuests, missedStormShieldResources } = await import("../src/profiles/outposts.js");
  const profile = { items: { ssd: { templateId: "Quest:outpostquest_t2_l2", attributes: { quest_state: "Claimed" }, quantity: 1 } } };
  at42(() => {
    const missed = missedStormShieldQuests(profile);
    assert.ok(missed.includes("challenge_replacealteration"));
    assert.deepEqual(missedStormShieldResources(profile, missed), [{ quantity: 1200, templateId: "AccountResource:reagent_alteration_generic" }]);
    assert.deepEqual(missedStormShieldResources(profile, missed.filter((questId) => questId !== "challenge_replacealteration")), []);
  });
});
