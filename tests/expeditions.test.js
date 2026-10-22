import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abandonExpedition, collectExpedition, refreshExpeditions, rollCriteria, squadRating, startExpedition, successChance
} from "../src/expeditions/expeditions.js";
import { readGameData } from "../src/gamedata/read.js";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
import { assignToSquad } from "../src/profiles/squads.js";
import { post, startBackend, userLogin } from "./helpers.js";

function memorySession() {
  const trackers = {};
  return {
    trackers,
    profile(profileId) {
      trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: defaultStats(profileId) }, items: {} });
      return trackers[profileId];
    }
  };
}

const expeditionsOf = (tracker) => Object.entries(tracker.profile.items).filter(([, item]) => item.templateId.startsWith("Expedition:"));
const inSlot = (tracker, slot) => expeditionsOf(tracker).find(([, item]) => item.attributes.expedition_slot_id === slot);
const now = new Date("2026-10-19T10:00:00Z");
const later = (minutes) => new Date(now.getTime() + minutes * 60 * 1000);
const squadOne = "Squad_Expedition_ExpeditionSquadOne";
const hero = (templateId, level = 1, squadId = "", slot = -1) => ({ templateId, attributes: { level, squad_id: squadId, squad_slot_idx: slot }, quantity: 1 });

// The node that opens expeditions (the T01 land, lumberyard and quarry slots, and squad one's first slot and truck),
// the constructor class, and a constructor hero.
function withExpeditions() {
  const session = memorySession();
  const tracker = session.profile("profile0");
  tracker.addItem("node", { templateId: "HomebaseNode:t1_main_ad1499e010", attributes: { level: 1 }, quantity: 1 });
  tracker.addItem("constructors", { templateId: "HomebaseNode:t1_main_8d2c3c4d0", attributes: { level: 1 }, quantity: 1 });
  tracker.addItem("hero", hero("Hero:hid_constructor_rushbase_uc_t01"));
  return { session, tracker };
}

test("the chance is 5% at the minimum power rising to 100% at the target, and nothing below the minimum", () => {
  assert.equal(successChance(9, 10, 20), 0);
  assert.equal(successChance(10, 10, 20), 0.05);
  assert.equal(successChance(15, 10, 20), 0.525);
  assert.equal(successChance(30, 10, 20), 1);
});

test("expeditions keep their criteria tier and the criteria table holds the client's rows", () => {
  const { expeditions, criteria } = readGameData("expeditions", {});
  assert.equal(expeditions["Expedition:expedition_supplyrun_long_t03"].criteriaTier, "Expeditions_Criteria_T03");
  assert.equal(expeditions["Expedition:expedition_choppingwood_t00"].criteriaTier, "None");
  assert.deepEqual(criteria.RequiresRareNinja, { global: false, mod: 1.625, rarity: "Sturdy", tag: "Homebase.Class.IsNinja" });
  assert.deepEqual(criteria.RequiresCommando, { global: false, mod: 1.5, rarity: "", tag: "Homebase.Class.IsCommando" });
});

test("criteria come from the tier's class rows, none for expeditions without a criteria tier", () => {
  const { expeditions, criteria } = readGameData("expeditions", {});
  assert.deepEqual(rollCriteria(expeditions["Expedition:expedition_choppingwood_t00"]), []);
  const first = (n) => n - 1;
  assert.deepEqual(rollCriteria({ criteriaTier: "Expeditions_Criteria_T01" }, first), ["RequiresOutlander"]);
  assert.equal(rollCriteria({ criteriaTier: "Expeditions_Criteria_T04" }, first).length, 3);
  for (let i = 0; i < 50; i++) {
    const t03 = rollCriteria({ criteriaTier: "Expeditions_Criteria_T03" });
    assert.ok(t03.length >= 1 && t03.length <= 2 && new Set(t03).size === t03.length);
    for (const name of t03) assert.ok(["Sturdy", "Quality"].includes(criteria[name].rarity), name);
  }
});

test("each criterion boosts the highest rated hero that has its class and rarity, once per hero", () => {
  const rare = { item: hero("Hero:hid_commando_007_r_t01", 1) }; // rating 10
  const rareHigher = { item: hero("Hero:hid_commando_007_r_t01", 2) }; // rating 11
  const uncommon = { item: hero("Hero:hid_constructor_rushbase_uc_t01", 1) }; // rating 5
  assert.equal(squadRating([], [rare, uncommon]), 15);
  assert.equal(squadRating(["RequiresConstructor"], [rare, uncommon]), 10 + 5 * 1.5);
  assert.equal(squadRating(["RequiresCommando"], [rare, rareHigher]), 10 + 11 * 1.5);
  assert.equal(squadRating(["RequiresCommando", "RequiresCommando"], [rare, rareHigher]), 10 * 1.5 + 11 * 1.5);
  assert.equal(squadRating(["RequiresCommando", "RequiresRareCommando"], [rare]), 10 * (1 + 0.5 + 0.625));
  assert.equal(squadRating(["RequiresEpicCommando", "RequiresNinja", "NoCriteria"], [rare, uncommon]), 15, "rarity and class must match");
});

test("the board fills the slots the skill tree has opened, keeps them, and replaces offers that expired", () => {
  const session = memorySession();
  refreshExpeditions(session, now);
  assert.equal(expeditionsOf(session.profile("profile0")).length, 0);

  const { session: open, tracker } = withExpeditions();
  refreshExpeditions(open, now);
  const board = Object.fromEntries(expeditionsOf(tracker).map(([, item]) => [item.attributes.expedition_slot_id, item]));
  assert.deepEqual(Object.keys(board).sort(), ["ChoppingWood", "Land1_0", "Land1_1", "MiningOre"]);
  assert.match(board.Land1_0.templateId, /^Expedition:expedition_(?!air|sea)[a-z_]+_t01$/);
  assert.equal(board.Land1_0.attributes.expedition_criteria.length, 1);
  assert.equal(board.ChoppingWood.templateId, "Expedition:expedition_miningore_t00", "the slot's own generator, as Epic's data has it");
  assert.deepEqual(board.ChoppingWood.attributes.expedition_criteria, []);
  assert.deepEqual([board.MiningOre.attributes.expedition_min_target_power, board.MiningOre.attributes.expedition_max_target_power], [0, 5]);
  assert.equal(board.Land1_0.attributes.expedition_expiration_end_time, "2026-10-19T11:30:00.000Z");

  const [firstId] = inSlot(tracker, "Land1_0");
  refreshExpeditions(open, later(30));
  assert.equal(inSlot(tracker, "Land1_0")[0], firstId);
  refreshExpeditions(open, later(91));
  assert.notEqual(inSlot(tracker, "Land1_0")[0], firstId);
});

test("an expedition sends a squad out, brings rewards back on success, frees the squad and counts for quests", () => {
  const { session, tracker } = withExpeditions();
  tracker.addItem("quest", { templateId: "Quest:homebasequest_completeexpedition", attributes: { quest_state: "Active", completion_collectexpedition: 0 }, quantity: 1 });
  refreshExpeditions(session, now);
  const [woodId] = inSlot(tracker, "MiningOre");

  assert.throws(() => startExpedition(session, { expeditionId: woodId, squadId: squadOne, itemIds: ["hero"], slotIndices: [1] }, now), /locked/);
  startExpedition(session, { expeditionId: woodId, squadId: squadOne, itemIds: ["hero"], slotIndices: [0] }, now);
  const { attributes } = tracker.profile.items[woodId];
  assert.deepEqual([attributes.expedition_squad_id, attributes.expedition_end_time], [squadOne, "2026-10-19T14:00:00.000Z"]);
  assert.equal(attributes.expedition_success_chance, 1, "rating 5 against a 0-5 range");
  assert.deepEqual([tracker.profile.items.hero.attributes.squad_id, tracker.profile.items.hero.attributes.squad_slot_idx], [squadOne, 0]);
  assert.throws(() => assignToSquad(session, "hero", "", 0), /out on an expedition/);
  assert.throws(() => assignToSquad(session, "hero", "Squad_Combat_AdventureSquadOne", 1), /out on an expedition/);

  const notifications = [];
  assert.throws(() => collectExpedition(session, woodId, notifications, later(60)), /isn't back yet/);
  collectExpedition(session, woodId, notifications, later(240), 0);
  const [result] = notifications;
  assert.equal(result.type, "expeditionResult");
  assert.equal(result.bExpeditionSucceeded, true);
  assert.deepEqual(result.expeditionRewards.map((entry) => [entry.itemType, entry.quantity, entry.itemProfile]), [["WorldItem:wooditemdata", 30, "theater0"]]);
  assert.equal(tracker.profile.items[woodId], undefined);
  assert.equal(tracker.profile.items.hero.attributes.squad_id, "");
  assert.notEqual(tracker.profile.items.quest.attributes.quest_state, "Active", "Complete an Expedition is done");
  assert.ok(inSlot(tracker, "MiningOre"), "the slot gets a new offer");
});

test("a hero can leave another squad for an expedition, but not lead the combat squad, be out already or lack its class", () => {
  const { session, tracker } = withExpeditions();
  refreshExpeditions(session, now);
  const [stoneId] = inSlot(tracker, "ChoppingWood");
  const start = (itemId) => startExpedition(session, { expeditionId: stoneId, squadId: squadOne, itemIds: [itemId], slotIndices: [0] }, now);

  tracker.addItem("lead", hero("Hero:hid_constructor_rushbase_uc_t01", 1, "Squad_Combat_AdventureSquadOne", 0));
  assert.throws(() => start("lead"), /leads Squad_Combat_AdventureSquadOne/);
  tracker.addItem("ninja", hero("Hero:hid_ninja_007_vr_t01"));
  assert.throws(() => start("ninja"), /class isn't unlocked/);
  tracker.addItem("away", hero("Hero:hid_constructor_rushbase_uc_t01", 1, "Squad_Expedition_ExpeditionSquadTwo", 0));
  assert.throws(() => start("away"), /out on an expedition/);

  tracker.addItem("support", hero("Hero:hid_constructor_rushbase_uc_t01", 1, "Squad_Combat_AdventureSquadOne", 2));
  start("support");
  assert.deepEqual([tracker.profile.items.support.attributes.squad_id, tracker.profile.items.support.attributes.squad_slot_idx], [squadOne, 0]);
  assert.throws(() => start("hero"), /under way/);
});

test("the success chance counts the expedition's bonus criteria like the client", () => {
  const { session, tracker } = withExpeditions();
  refreshExpeditions(session, now);
  const [expeditionId] = inSlot(tracker, "Land1_0");
  tracker.setItemAttribute(expeditionId, "expedition_min_target_power", 5);
  tracker.setItemAttribute(expeditionId, "expedition_max_target_power", 10);
  tracker.setItemAttribute(expeditionId, "expedition_criteria", ["RequiresConstructor"]);
  tracker.addItem("people", { templateId: "AccountResource:peopleresource", attributes: {}, quantity: 100 });
  tracker.addItem("tokens", { templateId: "Token:collectionresource_nodegatetoken01", attributes: {}, quantity: 100 });
  startExpedition(session, { expeditionId, squadId: squadOne, itemIds: ["hero"], slotIndices: [0] }, now);
  assert.equal(tracker.profile.items[expeditionId].attributes.expedition_success_chance, successChance(7.5, 5, 10));
});

test("an abandoned expedition brings the squad home with nothing", () => {
  const { session, tracker } = withExpeditions();
  refreshExpeditions(session, now);
  const [stoneId] = inSlot(tracker, "ChoppingWood");
  startExpedition(session, { expeditionId: stoneId, squadId: squadOne, itemIds: ["hero"], slotIndices: [0] }, now);
  abandonExpedition(session, stoneId, later(10));
  assert.equal(tracker.profile.items[stoneId], undefined);
  assert.equal(tracker.profile.items.hero.attributes.squad_id, "");
  assert.equal(session.trackers.theater0, undefined);
});

test("RefreshExpeditions and StartExpedition work through the client route", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "ExpeditionTest");
    const command = (name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;
    for (const templateId of ["HomebaseNode:t1_main_ad1499e010", "HomebaseNode:t1_main_8d2c3c4d0", "Hero:hid_constructor_rushbase_uc_t01"]) {
      await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity: 1 });
    }
    const refreshed = await post(backend.port, command("RefreshExpeditions"), token, {});
    const items = Object.entries(refreshed.body.profileChanges[0].profile.items);
    const [expeditionId] = items.find(([, item]) => item.attributes.expedition_slot_id === "MiningOre");
    const [heroId] = items.find(([, item]) => item.templateId === "Hero:hid_constructor_rushbase_uc_t01" && !item.attributes.squad_id);
    const started = await post(backend.port, command("StartExpedition"), token,
      { expeditionId, squadId: squadOne, itemIds: [heroId], slotIndices: [0] });
    assert.equal(started.status, 200);
    const collect = await post(backend.port, command("CollectExpedition"), token, { expeditionId });
    assert.equal(collect.status, 400);
    assert.equal((await post(backend.port, command("AbandonExpedition"), token, { expeditionId })).status, 200);
  } finally {
    backend.close();
  }
});
