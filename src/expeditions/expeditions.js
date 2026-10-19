import crypto from "node:crypto";
import { rollContents } from "../cardpacks/contents.js";
import { McpError } from "../errors.js";
import { getSquad, slotUnlockNode } from "../gamedata/homebase.js";
import { readGameData } from "../gamedata/read.js";
import { ownsNode } from "../profiles/homebase.js";
import { lootEntry } from "../profiles/items.js";
import { itemRating } from "../profiles/rating.js";
import { grant, hasTag } from "../profiles/progress.js";
import { characterType, unassign } from "../profiles/squads.js";
import { unlockedTags } from "../profiles/unlocks.js";

// Expeditions, from the game data (Expeditions/*, ExpeditionRecipes, ExpeditionSlots, UFortExpeditionItem):
//  - The board has a slot per ExpeditionSlots row whose tag (Expedition.Generation.Land.T01_0, ...) the skill tree has
//    unlocked; each slot offers one expedition until it expires (ExpeditionExpirationDuration_Minutes).
//  - An expedition squad (Squad_Expedition_*) can run a recipe needing Expedition.<Vehicle> once a node has granted
//    <SquadName>.Expedition.<Vehicle> (ExpeditionSquadOne.Expedition.Land); the recipe's costs are paid on start.
//  - The client shows the chance as 5% at expedition_min_target_power rising linearly to 100% at
//    expedition_max_target_power (sub_2BEE7F0), from the squad's rating; nothing below the minimum can start.
// Core's rules where Epic decided on its servers: the slot generators (ZCP_ExpeditionGenerator_<Vehicle>_T0N) offer an
// expedition of that vehicle and tier; the target power is BaseTargetPowerRating (clamped) and the minimum is
// TierFactor percent below it; a squad's rating is its members' BaseItemRating at their level, added up; rewards are
// the recipe's packs, opened on collection.
const { expeditions = {}, recipes = {}, slots = {} } = readGameData("expeditions", {});

const fail = (code, message) => {
  throw new McpError(`errors.com.epicgames.fortnite.${code}`, message);
};
const minutesFrom = (start, minutes) => new Date(start.getTime() + minutes * 60 * 1000).toISOString();

function vehicleOf(recipe) {
  return recipe?.catalysts.find((tag) => tag.startsWith("Expedition."))?.slice("Expedition.".length);
}

function candidates(generator) {
  const match = generator.match(/^ZCP_ExpeditionGenerator_([A-Za-z]+)_T(\d\d)$/);
  if (!match) return [];
  const [, kind, tier] = match;
  if (tier === "00") return Object.keys(expeditions).filter((id) => id.toLowerCase() === `expedition:expedition_${kind.toLowerCase()}_t00`);
  return Object.keys(expeditions).filter((id) => {
    const lower = id.toLowerCase();
    return !lower.includes("test") && lower.endsWith(`_t${tier}`) && vehicleOf(recipes[expeditions[id].recipe]) === kind;
  });
}

function powerRange(definition) {
  const target = Math.min(definition.basePower, definition.powerClamp || definition.basePower);
  return { min: Math.floor(target * (1 - Math.min(definition.tierFactor, 100) / 100)), max: target };
}

export function successChance(rating, min, max) {
  if (rating < min) return 0;
  const progress = max > min ? Math.min(Math.max((rating - min) / (max - min), 0), 1) : 1;
  return 0.05 * (1 - progress) + progress;
}

const isExpedition = (item) => item.templateId.toLowerCase().startsWith("expedition:");

function findExpedition(tracker, itemId) {
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  if (!item || !isExpedition(item)) fail("item_not_found", `No expedition ${itemId}`);
  return item;
}

// RefreshExpeditions: every unlocked slot holds an expedition; offers that expired unstarted are replaced.
export function refreshExpeditions(session, now = new Date()) {
  const tracker = session.profile("profile0");
  const owned = unlockedTags(tracker.profile);
  for (const [slotId, slot] of Object.entries(slots)) {
    if (!hasTag(owned, slot.tag)) continue;
    const held = Object.entries(tracker.profile.items).find(([, item]) => isExpedition(item) && item.attributes.expedition_slot_id === slotId);
    if (held) {
      const [heldId, { attributes }] = held;
      if (attributes.expedition_start_time || Date.parse(attributes.expedition_expiration_end_time) > now.getTime()) continue;
      tracker.removeItem(heldId);
    }
    const choices = candidates(slot.generator);
    if (!choices.length) continue;
    const templateId = choices[crypto.randomInt(choices.length)];
    const definition = expeditions[templateId];
    const { min, max } = powerRange(definition);
    tracker.addItem(crypto.randomUUID(), {
      templateId,
      attributes: {
        expedition_slot_id: slotId,
        expedition_criteria: [],
        expedition_min_target_power: min,
        expedition_max_target_power: max,
        expedition_expiration_start_time: now.toISOString(),
        expedition_expiration_end_time: minutesFrom(now, definition.expirationMinutes),
        level: 1,
        item_seen: 0
      },
      quantity: 1
    });
  }
}

// StartExpedition {expeditionId, squadId, itemIds, slotIndices}.
export function startExpedition(session, { expeditionId, squadId, itemIds = [], slotIndices = [] }, now = new Date()) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const expedition = findExpedition(tracker, expeditionId);
  const { attributes } = expedition;
  if (attributes.expedition_start_time) fail("expedition_already_started", "That expedition is under way");
  if (Date.parse(attributes.expedition_expiration_end_time) <= now.getTime()) fail("expedition_expired", "That expedition is no longer on offer");

  const squad = getSquad(String(squadId ?? ""));
  if (!squad || squad.type !== "ExpeditionSquad") fail("invalid_squad_assignment", `No expedition squad ${squadId}`);
  if (Object.values(profile.items).some((item) => isExpedition(item) && item.attributes.expedition_squad_id === squad.id)) {
    fail("invalid_squad_assignment", `${squad.id} is already out on an expedition`);
  }
  const definition = expeditions[expedition.templateId];
  const recipe = recipes[definition?.recipe];
  const vehicle = vehicleOf(recipe);
  const squadName = squad.id.replace(/^Squad_Expedition_/, "");
  if (vehicle && !hasTag(unlockedTags(profile), `${squadName}.Expedition.${vehicle}`)) {
    fail("invalid_squad_assignment", `${squad.id} has no ${vehicle} vehicle`);
  }

  if (!Array.isArray(itemIds) || !itemIds.length || itemIds.length !== slotIndices.length) fail("invalid_squad_assignment", "Choose who goes");
  let rating = 0;
  itemIds.forEach((itemId, index) => {
    const item = profile.items[itemId];
    const slotIndex = slotIndices[index];
    const slot = Number.isInteger(slotIndex) ? squad.slots[slotIndex] : undefined;
    if (!item || !characterType(item)) fail("invalid_squad_assignment", `${itemId} can't go on an expedition`);
    if (!slot || !slot.types.includes(characterType(item))) fail("invalid_squad_assignment", `${squad.id} slot ${slotIndex} doesn't take ${item.templateId}`);
    const node = slotUnlockNode(squad.id, slotIndex);
    if (!node || !ownsNode(profile, node)) fail("invalid_squad_assignment", `${squad.id} slot ${slotIndex} is locked`);
    if (item.attributes.squad_id) fail("invalid_squad_assignment", `${item.templateId} is already in ${item.attributes.squad_id}`);
    rating += itemRating(item);
  });
  if (new Set(slotIndices).size !== slotIndices.length || new Set(itemIds).size !== itemIds.length) fail("invalid_squad_assignment", "One slot each");

  const chance = successChance(rating, attributes.expedition_min_target_power, attributes.expedition_max_target_power);
  if (chance <= 0) fail("expedition_power_too_low", `This squad's rating ${rating} is below ${attributes.expedition_min_target_power}`);

  for (const cost of recipe?.costs ?? []) {
    const stacks = Object.entries(profile.items).filter(([, held]) => held.templateId.toLowerCase() === cost.templateId.toLowerCase());
    const have = stacks.reduce((sum, [, held]) => sum + held.quantity, 0);
    if (have < cost.quantity) fail("item_consumption_failed", `Not enough ${cost.templateId}: ${have} of ${cost.quantity}`);
    let left = cost.quantity;
    for (const [stackId, held] of stacks) {
      const used = Math.min(left, held.quantity);
      left -= used;
      if (held.quantity > used) tracker.setQuantity(stackId, held.quantity - used);
      else tracker.removeItem(stackId);
      if (!left) break;
    }
  }

  itemIds.forEach((itemId, index) => {
    tracker.setItemAttribute(itemId, "squad_id", squad.id);
    tracker.setItemAttribute(itemId, "squad_slot_idx", slotIndices[index]);
  });
  tracker.setItemAttribute(expeditionId, "expedition_squad_id", squad.id);
  tracker.setItemAttribute(expeditionId, "expedition_start_time", now.toISOString());
  tracker.setItemAttribute(expeditionId, "expedition_end_time", minutesFrom(now, definition.durationMinutes));
  tracker.setItemAttribute(expeditionId, "expedition_success_chance", chance);
}

function bringHome(tracker, expeditionId, squadId) {
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (characterType(item) && item.attributes.squad_id === squadId) unassign(tracker, itemId);
  }
  tracker.removeItem(expeditionId);
}

// CollectExpedition {expeditionId}: after its end time; on success the recipe's packs are opened into the profile.
// The client is told as expeditionResult {bExpeditionSucceeded, expeditionRewards} (FFortExpeditionResultNotification).
export function collectExpedition(session, expeditionId, notifications, now = new Date(), roll = Math.random()) {
  const tracker = session.profile("profile0");
  const expedition = findExpedition(tracker, expeditionId);
  const { attributes } = expedition;
  if (!attributes.expedition_start_time) fail("expedition_not_started", "That expedition hasn't started");
  if (Date.parse(attributes.expedition_end_time) > now.getTime()) fail("expedition_in_progress", "That expedition isn't back yet");

  const succeeded = roll < (attributes.expedition_success_chance ?? 0);
  const rewards = [];
  if (succeeded) {
    const recipe = recipes[expeditions[expedition.templateId]?.recipe];
    for (const { templateId, quantity } of recipe?.results ?? []) {
      for (let opened = 0; opened < quantity; opened++) {
        for (const content of rollContents(templateId)) rewards.push(...grant(session, content.templateId, content.quantity).map(lootEntry));
      }
    }
  }
  bringHome(tracker, expeditionId, attributes.expedition_squad_id);
  notifications.push({ type: "expeditionResult", primary: true, bExpeditionSucceeded: succeeded, expeditionRewards: rewards });
  refreshExpeditions(session, now);
}

// AbandonExpedition {expeditionId}: the squad comes home with nothing.
export function abandonExpedition(session, expeditionId, now = new Date()) {
  const tracker = session.profile("profile0");
  const expedition = findExpedition(tracker, expeditionId);
  if (!expedition.attributes.expedition_start_time) fail("expedition_not_started", "That expedition hasn't started");
  bringHome(tracker, expeditionId, expedition.attributes.expedition_squad_id);
  refreshExpeditions(session, now);
}
