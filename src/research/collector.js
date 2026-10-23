import crypto from "node:crypto";
import { McpError } from "../errors.js";
import { nodeTemplateId } from "../gamedata/homebase.js";
import { getQuest } from "../gamedata/quests.js";
import { caseInsensitive, readGameData } from "../gamedata/read.js";
import { heldQuantity, ownsNode } from "../profiles/homebase.js";
import { lootEntry } from "../profiles/items.js";
import { grant } from "../profiles/progress.js";
import { isDone, questIdOf } from "../profiles/quests.js";

// Research points come from a resource collector, the profile0 item CollectedResource:Token_collectionresource_nodegatetoken01
// (UFortCollectedResourceItem; every one shares the UFortCollectedResourceItemDefinition CDO, sub_5A46A0, so no asset
// ships). It holds stored_value (double) and last_updated (ISO 8601 UTC). The client's research collector widget
// (WarehouseCollectorSubWidget, on the skill tree's Research pages) shows
//   min(max_capacity, int(stored_value + whole seconds since last_updated x rate))     (sub_5C00D0 -> sub_5ADA90)
// with the rate and capacity from the homebase attributes rate_per_second_collector_<X> / max_capacity_collector_<X>
// (<X> = the template id after ':', sub_5C03D0), which skill tree nodes raise (research.json), and only enables Collect
// while the research points held are below ResearchPointMaxBonus. Collect sends ClaimCollectedResources
// {collectorsToClaim: [item ids]} (UFortMcpContext::ClaimAllResourceCollectors, sub_63D0B0 -> sub_63D1B0) and reads
// the primary notification as FFortCollectedResourceNotification {loot: FMcpLootResult} (sub_653DF0), finding each
// loot item by itemGuid in profile0.
// 🟡 Epic's server side isn't in the client. Core: the collector appears once the profile owns a node that gives it a
// rate (T1_Main_FABC7C290, Unlock Research: Tier 1), empty; a node or buff that changes its rate or capacity first
// banks what it gathered so far (stored_value, last_updated = now), so the client's estimate never jumps back; a claim
// grants the whole points gathered, up to the wallet cap, and keeps the rest (fractions and anything over the cap).
// The client counts from UtcNow (GetSystemTime, sub_1152B90) whether or not the game ran in between, so the time a
// player is away fills the collector up to its capacity; the backend only touches last_updated when it banks or claims.
// Profiles that owned the node before Core had collectors (issue #20) get one that has been filling since the node was
// bought, as far as the profile shows (rateSince); the empty ones Core gave them before that start then too, once.
const { collectors = {}, nodes = {}, buffs = {} } = readGameData("research", {});
const collectorsById = caseInsensitive(collectors);
const nodeEffects = Object.entries(nodes);
const buffEffects = Object.entries(buffs);
const affectsResearch = new Set([...nodeEffects.map(([id]) => `homebasenode:${id}`), ...buffEffects.map(([id]) => id)]
  .map((templateId) => templateId.toLowerCase()));

const isCollector = (item) => item.templateId.toLowerCase().startsWith("collectedresource:");
const secondsOf = (time) => Math.floor(time / 1000);
// The client compares whole seconds, so Core writes whole seconds.
const timestamp = (now) => new Date(secondsOf(now.getTime()) * 1000).toISOString();

// A FortHomebaseSet attribute as the homebase's ability system has it: the owned nodes' additive effect rows, times
// the held account buffs' multipliers (GAS: (base + sum of adds) x (1 + sum of (factor - 1)); base 0), in float.
export function homebaseAttribute(profile, attribute) {
  let added = 0;
  for (const [nodeId, effects] of nodeEffects) {
    if (effects[attribute] && ownsNode(profile, nodeId)) added = Math.fround(added + effects[attribute]);
  }
  let factor = 1;
  for (const [buff, effects] of buffEffects) {
    if (effects[attribute] && heldQuantity(profile, buff) > 0) factor += effects[attribute] - 1;
  }
  return Math.fround(added * factor);
}

// The rate per second, the capacity (the client truncates it to an int) and the payout's wallet cap (Infinity without one).
export function collectorRates(profile, templateId) {
  const collector = collectorsById.get(templateId.toLowerCase());
  if (!collector) return { rate: 0, capacity: 0, walletCap: Infinity };
  return {
    rate: homebaseAttribute(profile, collector.rateAttribute),
    capacity: Math.trunc(homebaseAttribute(profile, collector.capacityAttribute)),
    walletCap: collector.walletAttribute ? Math.trunc(homebaseAttribute(profile, collector.walletAttribute)) : Infinity
  };
}

// What the collector holds now, unrounded: the client's estimate is this, truncated.
export function gathered(profile, item, now = new Date()) {
  const stored = Number(item.attributes?.stored_value) || 0;
  const { rate, capacity } = collectorRates(profile, item.templateId);
  const elapsed = secondsOf(now.getTime()) - secondsOf(Date.parse(item.attributes?.last_updated));
  if (!(rate > 0) || capacity <= 0 || !(elapsed > 0)) return stored;
  return Math.min(stored + elapsed * rate, capacity);
}

function bank(tracker, itemId, value, now) {
  tracker.setItemAttribute(itemId, "stored_value", value);
  tracker.setItemAttribute(itemId, "last_updated", timestamp(now));
}

// The collectors the profile has a rate for but doesn't hold yet.
export function missingCollectors(profile) {
  return [...collectorsById.values()].map((collector) => collector.id)
    .filter((templateId) => collectorRates(profile, templateId).rate > 0
      && !Object.values(profile.items).some((item) => item.templateId.toLowerCase() === templateId.toLowerCase()));
}

// Adds the missing collectors, empty as of now, or (since: true) as of when the profile first had their rate.
export function addCollectors(session, now = new Date(), { since = false } = {}) {
  const tracker = session.profile("profile0");
  for (const templateId of missingCollectors(tracker.profile)) {
    const start = since ? Math.min(now.getTime(), rateSince(tracker.profile, templateId) ?? Infinity) : now.getTime();
    tracker.addItem(crypto.randomUUID(), { templateId, attributes: { stored_value: 0, last_updated: timestamp(new Date(start)) }, quantity: 1 });
  }
}

// 🟡 When the profile began to have the collector's rate, as far as it shows (Epic's collector existed from the node's
// purchase; the node item holds no date): the earliest last_state_change_time of a done quest that waits on acquiring an
// owned node that gives the rate (HomebaseQuest_UnlockResearch: Acquire HomebaseNode:t1_main_fabc7c290). That is when the
// quest completed or was claimed, so never before the node was bought. Undefined without one.
function rateSince(profile, templateId) {
  const collector = collectorsById.get(templateId.toLowerCase());
  if (!collector) return undefined;
  const rateNodes = new Set(nodeEffects.filter(([nodeId, effects]) => effects[collector.rateAttribute] && ownsNode(profile, nodeId))
    .map(([nodeId]) => nodeTemplateId(nodeId).toLowerCase()));
  let earliest;
  for (const item of Object.values(profile.items)) {
    const questId = questIdOf(item);
    if (!questId || !isDone(item)) continue;
    const waitsOnNode = getQuest(questId)?.objectives
      .some((objective) => objective.itemEvent === "Acquire" && rateNodes.has(String(objective.item).toLowerCase()));
    const time = Date.parse(item.attributes.last_state_change_time);
    if (waitsOnNode && Number.isFinite(time) && !(time >= earliest)) earliest = time;
  }
  return earliest;
}

// Core's one-time change for issue #20 (coreMigrations collectorStart): collectors added to profiles that already owned
// the node (0f36ae9) started empty at that load, losing the time since the node was bought. One still untouched
// (stored_value exactly 0: every claim or bank since leaves a fraction, as the rate isn't a whole number) starts from
// rateSince instead, when that is earlier. A collector added at the purchase starts within a second of it, so stays.
const startMigration = "collectorStart";
const migrated = (profile) => (profile.coreMigrations ?? []).includes(startMigration);

const hasCollector = (profile) => Object.values(profile.items).some(isCollector);

export const collectorsNeedSetUp = (profile) => missingCollectors(profile).length > 0 || (hasCollector(profile) && !migrated(profile));

// On profile load (profiles/setup.js): the missing collectors, filling since the rate began, then the one-time start
// fix. Only profiles holding a collector are marked; one added later starts at its purchase or from rateSince already.
export function setUpCollectors(session, now = new Date()) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  addCollectors(session, now, { since: true });
  if (hasCollector(profile) && !migrated(profile)) {
    for (const [itemId, item] of Object.entries(profile.items)) {
      if (!isCollector(item) || item.attributes?.stored_value !== 0) continue;
      const since = rateSince(profile, item.templateId);
      if (since !== undefined && secondsOf(since) < secondsOf(Date.parse(item.attributes.last_updated))) {
        tracker.setItemAttribute(itemId, "last_updated", timestamp(new Date(since)));
      }
    }
    profile.coreMigrations = [...(profile.coreMigrations ?? []), startMigration];
  }
}

export const changesResearch = (templateId) => affectsResearch.has(String(templateId).toLowerCase());

// Runs a change to the homebase (a node or buff grant) with the collectors banked at their old rates first, and adds
// any collector the change unlocks.
export function updatingCollectors(session, change, now = new Date()) {
  const tracker = session.profile("profile0");
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (isCollector(item)) bank(tracker, itemId, gathered(tracker.profile, item, now), now);
  }
  const result = change();
  addCollectors(session, now);
  return result;
}

export function claimCollectedResources(session, collectorIds, notifications, now = new Date()) {
  const tracker = session.profile("profile0");
  const ids = [...new Set((Array.isArray(collectorIds) ? collectorIds : []).map(String))];
  for (const itemId of ids) {
    const item = tracker.profile.items[itemId];
    if (!item || !isCollector(item)) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No resource collector ${itemId}`);
  }

  const loot = [];
  for (const itemId of ids) {
    const item = tracker.profile.items[itemId];
    const collector = collectorsById.get(item.templateId.toLowerCase());
    const total = gathered(tracker.profile, item, now);
    let amount = collector ? Math.floor(total) : 0;
    if (collector) {
      const { walletCap } = collectorRates(tracker.profile, item.templateId);
      amount = Math.min(amount, Math.max(0, walletCap - heldQuantity(tracker.profile, collector.payout)));
    }
    bank(tracker, itemId, total - amount, now);
    if (amount > 0) loot.push(...grant(session, collector.payout, amount).map(lootEntry));
  }
  notifications.push({ type: "collectedResourceResult", primary: true, loot: { tierGroupName: "", items: loot } });
}
