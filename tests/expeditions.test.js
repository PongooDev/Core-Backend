import { test } from "node:test";
import assert from "node:assert/strict";
import { abandonExpedition, collectExpedition, refreshExpeditions, startExpedition, successChance } from "../src/expeditions/expeditions.js";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
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

// The node that opens expeditions: the T01 land, lumberyard and quarry slots, and squad one's first slot and truck.
function withExpeditions() {
  const session = memorySession();
  const tracker = session.profile("profile0");
  tracker.addItem("node", { templateId: "HomebaseNode:t1_main_ad1499e010", attributes: { level: 1 }, quantity: 1 });
  tracker.addItem("hero", { templateId: "Hero:hid_constructor_rushbase_uc_t01", attributes: { level: 1, squad_id: "", squad_slot_idx: -1 }, quantity: 1 });
  return { session, tracker };
}

test("the chance is 5% at the minimum power rising to 100% at the target, and nothing below the minimum", () => {
  assert.equal(successChance(9, 10, 20), 0);
  assert.equal(successChance(10, 10, 20), 0.05);
  assert.equal(successChance(15, 10, 20), 0.525);
  assert.equal(successChance(30, 10, 20), 1);
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
  assert.equal(board.ChoppingWood.templateId, "Expedition:expedition_miningore_t00", "the slot's own generator, as Epic's data has it");
  assert.deepEqual([board.MiningOre.attributes.expedition_min_target_power, board.MiningOre.attributes.expedition_max_target_power], [0, 5]);
  assert.equal(board.Land1_0.attributes.expedition_expiration_end_time, "2026-10-19T11:30:00.000Z");

  const [firstId] = inSlot(tracker, "Land1_0");
  refreshExpeditions(open, later(30));
  assert.equal(inSlot(tracker, "Land1_0")[0], firstId);
  refreshExpeditions(open, later(91));
  assert.notEqual(inSlot(tracker, "Land1_0")[0], firstId);
});

test("an expedition sends a squad out, brings rewards back on success and frees the squad", () => {
  const { session, tracker } = withExpeditions();
  refreshExpeditions(session, now);
  const [woodId] = inSlot(tracker, "MiningOre");
  const squadId = "Squad_Expedition_ExpeditionSquadOne";

  assert.throws(() => startExpedition(session, { expeditionId: woodId, squadId, itemIds: ["hero"], slotIndices: [1] }, now), /locked/);
  startExpedition(session, { expeditionId: woodId, squadId, itemIds: ["hero"], slotIndices: [0] }, now);
  const { attributes } = tracker.profile.items[woodId];
  assert.deepEqual([attributes.expedition_squad_id, attributes.expedition_end_time], [squadId, "2026-10-19T14:00:00.000Z"]);
  assert.ok(attributes.expedition_success_chance >= 0.05);
  assert.deepEqual([tracker.profile.items.hero.attributes.squad_id, tracker.profile.items.hero.attributes.squad_slot_idx], [squadId, 0]);

  const notifications = [];
  assert.throws(() => collectExpedition(session, woodId, notifications, later(60)), /isn't back yet/);
  collectExpedition(session, woodId, notifications, later(240), 0);
  const [result] = notifications;
  assert.equal(result.type, "expeditionResult");
  assert.equal(result.bExpeditionSucceeded, true);
  assert.deepEqual(result.expeditionRewards.map((entry) => [entry.itemType, entry.quantity, entry.itemProfile]), [["WorldItem:wooditemdata", 30, "theater0"]]);
  assert.equal(tracker.profile.items[woodId], undefined);
  assert.equal(tracker.profile.items.hero.attributes.squad_id, "");
  assert.ok(inSlot(tracker, "MiningOre"), "the slot gets a new offer");
});

test("an abandoned expedition brings the squad home with nothing", () => {
  const { session, tracker } = withExpeditions();
  refreshExpeditions(session, now);
  const [stoneId] = inSlot(tracker, "ChoppingWood");
  startExpedition(session, { expeditionId: stoneId, squadId: "Squad_Expedition_ExpeditionSquadOne", itemIds: ["hero"], slotIndices: [0] }, now);
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
    await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: "HomebaseNode:t1_main_ad1499e010", quantity: 1 });
    await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: "Hero:hid_constructor_rushbase_uc_t01", quantity: 1 });
    const refreshed = await post(backend.port, command("RefreshExpeditions"), token, {});
    const items = Object.entries(refreshed.body.profileChanges[0].profile.items);
    const [expeditionId] = items.find(([, item]) => item.attributes.expedition_slot_id === "MiningOre");
    const [heroId] = items.find(([, item]) => item.templateId === "Hero:hid_constructor_rushbase_uc_t01");
    const started = await post(backend.port, command("StartExpedition"), token,
      { expeditionId, squadId: "Squad_Expedition_ExpeditionSquadOne", itemIds: [heroId], slotIndices: [0] });
    assert.equal(started.status, 200);
    const collect = await post(backend.port, command("CollectExpedition"), token, { expeditionId });
    assert.equal(collect.status, 400);
    assert.equal((await post(backend.port, command("AbandonExpedition"), token, { expeditionId })).status, 200);
  } finally {
    backend.close();
  }
});
