import crypto from "node:crypto";
import { rollContents } from "../cardpacks/contents.js";
import { McpError } from "../errors.js";
import { getSquad, slotUnlockNode } from "../gamedata/homebase.js";
import { getCharacter, getItem } from "../gamedata/items.js";
import { readGameData } from "../gamedata/read.js";
import { ownsNode } from "../profiles/homebase.js";
import { lootEntry } from "../profiles/items.js";
import { itemRating } from "../profiles/rating.js";
import { grant, hasTag, refreshHeldItems, statEvent } from "../profiles/progress.js";
import { characterType, unassign } from "../profiles/squads.js";
import { hasUnlocked, unlockedTags } from "../profiles/unlocks.js";

// Expeditions, from the game data (Expeditions/*, ExpeditionRecipes, ExpeditionSlots, ExpeditionCriteriaRequirements)
// and the client (UFortExpeditionItem, UFortExpeditionUtilities, UFortExpeditionBuildSquadWidget):
//  - The board has a slot per ExpeditionSlots row whose tag (Expedition.Generation.Land.T01_0, ...) the skill tree has
//    unlocked; each slot offers one expedition until it expires (ExpeditionExpirationDuration_Minutes).
//  - An expedition squad (Squad_Expedition_*) can run a recipe needing Expedition.<Vehicle> once a node has granted
//    <SquadName>.Expedition.<Vehicle> (ExpeditionSquadOne.Expedition.Land); the recipe's costs are paid on start.
//  - The client builds the squad in the front end only and sends StartExpedition {expeditionId, squadId, itemIds,
//    slotIndices}; its hero picker lets a hero leave another squad unless it is out on an expedition or holds the
//    combat squad's lead slot (EFortSquadSlottingRestrictionReason), or lacks its class unlock.
//  - The squad's rating (CalculateTotalPower) is (ExpeditionSquad<N>_Power + sum of each hero's rating times its
//    multiplier) times the global multiplier; each bonus criterion (expedition_criteria, rows of
//    ExpeditionCriteriaRequirements) goes to the highest rated hero that has its class tag and rarity and hasn't
//    taken that same criterion, adding ModValue - 1 to that hero's multiplier (or the global one for bGlobalMod).
//  - The chance (sub_2BEE7F0) is 5% at expedition_min_target_power rising linearly to 100% at
//    expedition_max_target_power; nothing below the minimum can start.
// Core's rules where Epic decided on its servers: the slot generators (ZCP_ExpeditionGenerator_<Vehicle>_T0N) offer an
// expedition of that vehicle and tier; the target power is BaseTargetPowerRating (clamped) and the minimum is 5% of it,
// rounded down, as every expedition Epic's servers handed out had it (so the chance shown is about rating / target;
// issue #30: Core used to put the minimum TierFactor percent below the target, so the chance jumped from 0 to 100%);
// the criteria (CriteriaRequirementsLootTier Expeditions_Criteria_T0N) are drawn from the
// class rows of the tier's rarities; no Cert asset raises the ExpeditionSquad<N>_Power attribute, so it counts as 0;
// rewards are the recipe's packs, opened on collection.
const { expeditions = {}, recipes = {}, slots = {}, criteria = {} } = readGameData("expeditions", {});

const rarities = ["Handmade", "Ordinary", "Sturdy", "Quality", "Fine", "Elegant", "Masterwork", "Epic", "Badass", "Legendary"];
const rarityRank = (rarity) => Math.max(rarities.indexOf(rarity ?? ""), 0);

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

// The least rating that can start an expedition aiming at target: 5% of it, rounded down (Epic's offers: 20 -> 1,
// 95 -> 4, 330 -> 16, 1540 -> 77). The client's chance is 5% there, so it comes to rating / target.
export const minTargetPower = (target) => Math.floor((Math.max(Number(target) || 0, 0) * 5) / 100);

export function powerRange(definition) {
  const target = Math.min(definition.basePower, definition.powerClamp || definition.basePower);
  return { min: minTargetPower(target), max: target };
}

// Core's criteria tiers (inferred): which rarities' class rows each Expeditions_Criteria_T0N draws from, and at most
// how many criteria it gives.
const criteriaTiers = {
  1: { rarities: [""], most: 1 },
  2: { rarities: ["", "Sturdy"], most: 2 },
  3: { rarities: ["Sturdy", "Quality"], most: 2 },
  4: { rarities: ["Quality", "Fine"], most: 3 },
  5: { rarities: ["Fine"], most: 3 }
};

export function rollCriteria(definition, randomInt = crypto.randomInt) {
  const tier = criteriaTiers[Number(definition?.criteriaTier?.match(/^Expeditions_Criteria_T(\d+)$/)?.[1])];
  if (!tier) return [];
  const pool = Object.entries(criteria)
    .filter(([, row]) => row.tag !== "None" && tier.rarities.includes(row.rarity))
    .map(([name]) => name)
    .sort();
  const picked = [];
  for (let count = 1 + randomInt(tier.most); count > 0 && pool.length; count--) picked.push(pool.splice(randomInt(pool.length), 1)[0]);
  return picked;
}

export function successChance(rating, min, max) {
  if (rating < min) return 0;
  const progress = max > min ? Math.min(Math.max((rating - min) / (max - min), 0), 1) : 1;
  return 0.05 * (1 - progress) + progress;
}

// FortCriteriaRequirementData against a hero (sub_2BF5B10): its rarity at least the required one when bRequireRarity,
// and its definition's gameplay tags holding RequiredTag (a child tag counts).
function meetsCriterion(item, row) {
  if (!row || row.tag === "None") return false;
  const definition = getItem(item.templateId);
  if (row.rarity && rarityRank(definition?.rarity) < rarityRank(row.rarity)) return false;
  return hasTag(getCharacter(item.templateId)?.tags ?? definition?.tags ?? [], row.tag);
}

// CalculateTotalPower with the squad power attribute at 0: members is [{ item }] in slot order.
export function squadRating(expeditionCriteria, members) {
  const multipliers = members.map(() => 1);
  const taken = members.map(() => new Set());
  let global = 1;
  for (const name of expeditionCriteria ?? []) {
    const row = criteria[name];
    if (!row) continue;
    let best = -1;
    let bestRating = 0;
    members.forEach(({ item }, index) => {
      if (taken[index].has(name) || !meetsCriterion(item, row)) return;
      const rating = itemRating(item);
      if (rating > bestRating) [best, bestRating] = [index, rating];
    });
    if (best < 0) continue;
    taken[best].add(name);
    if (row.global) global += row.mod - 1;
    else multipliers[best] += row.mod - 1;
  }
  return members.reduce((total, { item }, index) => total + itemRating(item) * multipliers[index], 0) * global;
}

const isExpedition = (item) => item.templateId.toLowerCase().startsWith("expedition:");
const sameSquad = (a, b) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

function findExpedition(tracker, itemId) {
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  if (!item || !isExpedition(item)) fail("item_not_found", `No expedition ${itemId}`);
  return item;
}

// Whether a hero is out with an expedition squad (EFortSquadSlottingRestrictionReason::ItemIsOnActiveExpedition).
export function onExpedition(item) {
  return Boolean(item?.attributes.squad_id) && getSquad(item.attributes.squad_id)?.type === "ExpeditionSquad";
}

// Core's one-time change for issue #30 (coreMigrations expeditionPower): offers made before it have their minimum
// TierFactor percent below the target. Each gets Epic's 5%; one under way also gets the chance its squad has against
// that minimum when that is higher (a lower minimum only raises it), so what it brings back follows the new rule.
const powerMigration = "expeditionPower";

export const expeditionsNeedSetUp = (profile) => !(profile.coreMigrations ?? []).includes(powerMigration);

export function setUpExpeditions(session) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  if (!expeditionsNeedSetUp(profile)) return;
  for (const [itemId, item] of Object.entries(profile.items)) {
    if (!isExpedition(item)) continue;
    const { attributes } = item;
    const max = Number(attributes.expedition_max_target_power) || 0;
    const min = minTargetPower(max);
    if (attributes.expedition_min_target_power !== min) tracker.setItemAttribute(itemId, "expedition_min_target_power", min);
    if (!attributes.expedition_start_time || !attributes.expedition_squad_id) continue;
    const members = Object.values(profile.items)
      .filter((member) => characterType(member) && sameSquad(member.attributes.squad_id, attributes.expedition_squad_id))
      .sort((a, b) => (a.attributes.squad_slot_idx ?? 0) - (b.attributes.squad_slot_idx ?? 0))
      .map((member) => ({ item: member }));
    const chance = successChance(squadRating(attributes.expedition_criteria, members), min, max);
    if (chance > (attributes.expedition_success_chance ?? 0)) tracker.setItemAttribute(itemId, "expedition_success_chance", chance);
  }
  profile.coreMigrations = [...(profile.coreMigrations ?? []), powerMigration];
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
        expedition_criteria: rollCriteria(definition),
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
  if (Object.values(profile.items).some((item) => isExpedition(item) && sameSquad(item.attributes.expedition_squad_id, squad.id))) {
    fail("invalid_squad_assignment", `${squad.id} is already out on an expedition`);
  }
  const definition = expeditions[expedition.templateId];
  const recipe = recipes[definition?.recipe];
  const vehicle = vehicleOf(recipe);
  const squadName = squad.id.replace(/^Squad_Expedition_/, "");
  if (vehicle && !hasTag(unlockedTags(profile), `${squadName}.Expedition.${vehicle}`)) {
    fail("invalid_squad_assignment", `${squad.id} has no ${vehicle} vehicle`);
  }

  if (!Array.isArray(itemIds) || !Array.isArray(slotIndices) || !itemIds.length || itemIds.length !== slotIndices.length) {
    fail("invalid_squad_assignment", "Choose who goes");
  }
  if (new Set(slotIndices).size !== slotIndices.length || new Set(itemIds).size !== itemIds.length) fail("invalid_squad_assignment", "One slot each");
  const members = itemIds.map((itemId, index) => {
    const item = typeof itemId === "string" ? profile.items[itemId] : undefined;
    const slotIndex = slotIndices[index];
    const slot = Number.isInteger(slotIndex) ? squad.slots[slotIndex] : undefined;
    if (!item || !characterType(item)) fail("invalid_squad_assignment", `${itemId} can't go on an expedition`);
    if (!slot || !slot.types.includes(characterType(item))) fail("invalid_squad_assignment", `${squad.id} slot ${slotIndex} doesn't take ${item.templateId}`);
    const node = slotUnlockNode(squad.id, slotIndex);
    if (!node || !ownsNode(profile, node)) fail("invalid_squad_assignment", `${squad.id} slot ${slotIndex} is locked`);
    if (onExpedition(item)) fail("invalid_squad_assignment", `${item.templateId} is out on an expedition`);
    const current = item.attributes.squad_id && getSquad(item.attributes.squad_id);
    if (current?.type === "CombatSquad" && item.attributes.squad_slot_idx === 0) {
      fail("invalid_squad_assignment", `${item.templateId} leads ${current.id}`);
    }
    if (!hasUnlocked(profile, getCharacter(item.templateId)?.requiredTags ?? [])) {
      fail("invalid_squad_assignment", `${item.templateId}'s class isn't unlocked`);
    }
    return { itemId, item, slotIndex };
  });

  const rating = squadRating(attributes.expedition_criteria, members);
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

  // Heroes leave the squad they were in (the client's picker allows it) and join the expedition squad.
  for (const { itemId, slotIndex } of members) {
    tracker.setItemAttribute(itemId, "squad_id", squad.id);
    tracker.setItemAttribute(itemId, "squad_slot_idx", slotIndex);
  }
  tracker.setItemAttribute(expeditionId, "expedition_squad_id", squad.id);
  tracker.setItemAttribute(expeditionId, "expedition_start_time", now.toISOString());
  tracker.setItemAttribute(expeditionId, "expedition_end_time", minutesFrom(now, definition.durationMinutes));
  tracker.setItemAttribute(expeditionId, "expedition_success_chance", chance);
  refreshHeldItems(session);
}

function bringHome(session, expeditionId, squadId) {
  const tracker = session.profile("profile0");
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (characterType(item) && sameSquad(item.attributes.squad_id, squadId)) unassign(tracker, itemId);
  }
  tracker.removeItem(expeditionId);
  refreshHeldItems(session);
}

// CollectExpedition {expeditionId}: after its end time; on success the recipe's packs are opened into the profile.
// The client is told as expeditionResult {bExpeditionSucceeded, expeditionRewards} (FFortExpeditionResultNotification),
// and quests count it (EFortQuestObjectiveStatEvent CollectExpedition, CollectSuccessfulExpedition).
export function collectExpedition(session, expeditionId, notifications, now = new Date(), roll = Math.random()) {
  const tracker = session.profile("profile0");
  const expedition = findExpedition(tracker, expeditionId);
  const { attributes, templateId } = expedition;
  if (!attributes.expedition_start_time) fail("expedition_not_started", "That expedition hasn't started");
  if (Date.parse(attributes.expedition_end_time) > now.getTime()) fail("expedition_in_progress", "That expedition isn't back yet");

  const succeeded = roll < (attributes.expedition_success_chance ?? 0);
  const rewards = [];
  if (succeeded) {
    const recipe = recipes[expeditions[templateId]?.recipe];
    for (const { templateId: pack, quantity } of recipe?.results ?? []) {
      for (let opened = 0; opened < quantity; opened++) {
        for (const content of rollContents(pack)) rewards.push(...grant(session, content.templateId, content.quantity).map(lootEntry));
      }
    }
  }
  bringHome(session, expeditionId, attributes.expedition_squad_id);
  statEvent(session, "CollectExpedition", templateId, 1);
  if (succeeded) statEvent(session, "CollectSuccessfulExpedition", templateId, 1);
  notifications.push({ type: "expeditionResult", primary: true, bExpeditionSucceeded: succeeded, expeditionRewards: rewards });
  refreshExpeditions(session, now);
}

// AbandonExpedition {expeditionId}: the squad comes home with nothing.
export function abandonExpedition(session, expeditionId, now = new Date()) {
  const tracker = session.profile("profile0");
  const expedition = findExpedition(tracker, expeditionId);
  if (!expedition.attributes.expedition_start_time) fail("expedition_not_started", "That expedition hasn't started");
  bringHome(session, expeditionId, expedition.attributes.expedition_squad_id);
  refreshExpeditions(session, now);
}
