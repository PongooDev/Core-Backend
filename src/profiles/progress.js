import { bookLevel } from "../collectionbook/book.js";
import { slottedItems } from "../collectionbook/pages.js";
import { getObjectiveStat } from "../gamedata/homebase.js";
import { getCharacter, getItem } from "../gamedata/items.js";
import { getQuest, startingQuests } from "../gamedata/quests.js";
import { grantItem } from "./items.js";
import { expandStormShield } from "./outposts.js";
import { grantQuest, isDone, questIdOf } from "./quests.js";
import { changesResearch, updatingCollectors } from "../research/collector.js";

const typeOf = (templateId) => templateId.split(":")[0].toLowerCase();
const sameId = (a, b) => a.toLowerCase() === b.toLowerCase();

function setState(tracker, itemId, state) {
  tracker.setItemAttribute(itemId, "quest_state", state);
  tracker.setItemAttribute(itemId, "last_state_change_time", new Date().toISOString());
}

function objectivesMet(item, quest) {
  return quest.objectives.every((objective) => (item.attributes[`completion_${objective.name}`] ?? 0) >= objective.count);
}

// The client's rewards screen only offers a claim for quests with a reward it can show; the rest are claimed at once.
function hasVisibleRewards(quest) {
  const visible = (reward) => typeOf(reward.templateId) !== "quest" && Boolean(getItem(reward.templateId));
  return (quest.rewards ?? []).some(visible) || (quest.selectableRewards ?? []).some((group) => group.some(visible));
}

function activeQuests(tracker) {
  return Object.entries(tracker.profile.items)
    .filter(([, item]) => item.attributes.quest_state === "Active" && getQuest(questIdOf(item) ?? ""))
    .map(([itemId, item]) => ({ itemId, item, quest: getQuest(questIdOf(item)) }));
}

function setObjective(session, itemId, objective, value) {
  const tracker = session.profile("profile0");
  const item = tracker.profile.items[itemId];
  if (item?.attributes.quest_state !== "Active") return;
  const key = `completion_${objective.name}`;
  const clamped = Math.max(0, Math.min(value, objective.count));
  if (item.attributes[key] !== clamped) tracker.setItemAttribute(itemId, key, clamped);
  const quest = getQuest(questIdOf(item));
  if (objectivesMet(item, quest)) completeQuest(session, itemId);
}

export function completeQuest(session, itemId) {
  const tracker = session.profile("profile0");
  const item = tracker.profile.items[itemId];
  const questId = questIdOf(item);
  const quest = getQuest(questId);
  if (isDone(item)) return;

  for (const objective of quest.objectives) {
    const key = `completion_${objective.name}`;
    if (item.attributes[key] !== objective.count) tracker.setItemAttribute(itemId, key, objective.count);
  }
  setState(tracker, itemId, "Completed");
  if (quest.expandsStormShield) expandStormShield(session, questId);
  if (!hasVisibleRewards(quest)) claimQuest(session, itemId);

  itemEvent(session, ["HasCompletedQuest", "QuestComplete"], `Quest:${questId}`, 1);
}

// Grants rewards, the chosen reward group and hidden rewards. Returns what the rewards screen shows.
export function claimQuest(session, itemId, selectedIndex = -1) {
  const tracker = session.profile("profile0");
  const quest = getQuest(questIdOf(tracker.profile.items[itemId]));
  setState(tracker, itemId, "Claimed");

  const shown = [];
  const options = { packSource: "Quest" };
  for (const reward of [...(quest.rewards ?? []), ...(quest.selectableRewards?.[selectedIndex] ?? [])]) {
    shown.push(...grant(session, reward.templateId, reward.quantity, options).filter((entry) => typeOf(entry.templateId) !== "quest"));
  }
  for (const reward of quest.hiddenRewards ?? []) grant(session, reward.templateId, reward.quantity, options);
  return shown;
}

// Every grant goes through here so quests that wait on acquiring an item, or a newly granted quest that is
// already satisfied, move on in the same command.
export function grant(session, templateId, quantity, options = {}) {
  // A node or buff that changes the research collector's rate banks what it gathered first (research/collector.js).
  const granted = changesResearch(templateId)
    ? updatingCollectors(session, () => grantItem(session, templateId, quantity, options))
    : grantItem(session, templateId, quantity, options);
  for (const entry of granted) {
    if (entry.profileId !== "profile0") continue;
    if (typeOf(entry.templateId) === "quest") refreshQuest(session, entry.itemId);
    else itemEvent(session, ["Acquire"], entry.templateId, entry.quantity);
  }
  if (granted.some((entry) => entry.profileId === "profile0" && typeOf(entry.templateId) !== "quest")) refreshHeldItems(session);
  return granted;
}

export function itemEvent(session, events, templateId, count) {
  const tracker = session.profile("profile0");
  for (const { itemId, item, quest } of activeQuests(tracker)) {
    for (const objective of quest.objectives) {
      if (!events.includes(objective.itemEvent) || !objective.item || !sameId(objective.item, templateId)) continue;
      setObjective(session, itemId, objective, (item.attributes[`completion_${objective.name}`] ?? 0) + count);
    }
  }
}

export function statEvent(session, type, templateId, count) {
  const tracker = session.profile("profile0");
  for (const { itemId, item, quest } of activeQuests(tracker)) {
    for (const objective of quest.objectives) {
      const stat = objective.stat && getObjectiveStat(objective.stat);
      if (stat?.type !== type || (stat.templateId && !sameId(stat.templateId, typeOf(templateId)))) continue;
      setObjective(session, itemId, objective, (item.attributes[`completion_${objective.name}`] ?? 0) + count);
    }
  }
}

// held (a primary mission's progress, see missions.js): objectives with requirePrimaryMissionCompletion
// (bRequirePrimaryMissionCompletion, "... in successful missions") wait there for the mission's end instead.
export function advanceObjective(session, statName, count, held = null) {
  const tracker = session.profile("profile0");
  for (const { itemId, item, quest } of activeQuests(tracker)) {
    const objective = quest.objectives.find((candidate) => candidate.name === statName.toLowerCase());
    if (!objective) continue;
    if (held && objective.requirePrimaryMissionCompletion) held.add(itemId, objective.name, count);
    else setObjective(session, itemId, objective, (item.attributes[`completion_${objective.name}`] ?? 0) + count);
  }
}

// A won primary mission's held progress, on the quests that are still active.
export function applyHeldProgress(session, held) {
  const tracker = session.profile("profile0");
  for (const { itemId, name, count } of held.entries()) {
    const item = tracker.profile.items[itemId];
    const objective = item && getQuest(questIdOf(item) ?? "")?.objectives.find((candidate) => candidate.name === name);
    if (objective) setObjective(session, itemId, objective, (item.attributes[`completion_${name}`] ?? 0) + count);
  }
}

// Gameplay tags match themselves and their children, case-insensitively.
export function hasTag(tags, wanted) {
  const target = wanted.toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === target || tag.toLowerCase().startsWith(`${target}.`));
}

// ObjectiveStatTable conditions: "Squad.Id == x", "Squad.Slot == n", "Item HasTag t", "Item.Level >= n", joined by && and ||.
// (Item.Rarity and Item.Tier only appear on Craft stats, which the gameserver counts.)
const compare = { "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b };

function conditionHolds(condition, item, tags) {
  if (!condition.trim()) return true;
  return condition.split("||").some((either) => either.split("&&").every((term) => {
    const text = term.trim();
    let match = text.match(/^Squad\.Id\s*==\s*(\S+)$/i);
    if (match) return sameId(item.attributes.squad_id ?? "", match[1]);
    match = text.match(/^Squad\.Slot\s*==\s*(-?\d+)$/i);
    if (match) return item.attributes.squad_slot_idx === Number(match[1]);
    match = text.match(/^Item\s+HasTag\s+(\S+)$/i);
    if (match) return hasTag(tags, match[1]);
    match = text.match(/^Item\.Level\s*(==|!=|>=|<=|>|<)\s*(\d+)$/i);
    if (match) return compare[match[1]](item.attributes.level ?? 1, Number(match[2]));
    return false;
  }));
}

// Whether an account item is what a stat row is about: its TemplateId (the item type), TargetTags and Condition.
// The TemplateId <any-item> (collection_slot_any_item) matches every item.
function statMatches(stat, item) {
  if (stat.templateId && stat.templateId !== "<any-item>" && typeOf(item.templateId) !== stat.templateId.toLowerCase()) return false;
  const tags = getCharacter(item.templateId)?.tags ?? getItem(item.templateId)?.tags ?? [];
  return (!stat.targetTags || hasTag(tags, stat.targetTags)) && conditionHolds(stat.condition, item, tags);
}

function assignedCount(profile, stat) {
  return Object.values(profile.items).filter((item) => item.attributes.squad_id && statMatches(stat, item)).length;
}

// HasItem: matching items held. HasUpgraded: matching items held that have been levelled at least once.
function heldCount(profile, stat) {
  const upgraded = stat.type === "HasUpgraded";
  return Object.values(profile.items).filter((item) => (!upgraded || (item.attributes.level ?? 1) > 1) && statMatches(stat, item)).length;
}

const heldStats = { HasAssignedWorker: assignedCount, HasItem: heldCount };

// The collection book's objectives (collectionbook/book.js), worked out from the book profiles: the objective
// collectionbook_levelup (no stat, no item event: Epic's MCP knew it by its backend name) is the book level reached,
// and a SlotInCollection stat counts the matching items slotted. Both only go up, so they never take progress away.
const levelUpObjective = "collectionbook_levelup";

function bookProgress(session, objective) {
  if (objective.name === levelUpObjective) return bookLevel(session);
  const stat = objective.stat && getObjectiveStat(objective.stat);
  if (stat?.type !== "SlotInCollection") return undefined;
  return [...slottedItems(session).values()].filter(({ item }) => statMatches(stat, item)).length;
}

// Objectives that describe what the player holds rather than events: owning an item, a finished quest, or a
// character assigned somewhere. They are re-counted whenever that could have changed, including when the quest is granted.
function stateProgress(session, objective) {
  const { profile } = session.profile("profile0");
  const book = bookProgress(session, objective);
  if (book !== undefined) return book;
  if (objective.itemEvent === "Acquire" && objective.item) {
    return Object.values(profile.items).filter((item) => sameId(item.templateId, objective.item)).reduce((sum, item) => sum + item.quantity, 0);
  }
  if ((objective.itemEvent === "HasCompletedQuest" || objective.itemEvent === "QuestComplete") && objective.item) {
    return Object.values(profile.items).some((item) => sameId(item.templateId, objective.item) && isDone(item)) ? 1 : 0;
  }
  const stat = objective.stat && getObjectiveStat(objective.stat);
  if (heldStats[stat?.type]) return heldStats[stat.type](profile, stat);
  if (stat?.type === "HasUpgraded") return heldCount(profile, stat);
  return undefined;
}

function refreshQuest(session, itemId) {
  const tracker = session.profile("profile0");
  const item = tracker.profile.items[itemId];
  for (const objective of getQuest(questIdOf(item)).objectives) {
    const value = stateProgress(session, objective);
    if (value !== undefined && value > 0) setObjective(session, itemId, objective, value);
  }
}

// Re-counts the objectives about what the player holds (assigned characters, HasItem, the collection book) after
// squads, items or the book changed, and at quest login, so quests already active when the account got there catch up.
export function refreshHeldItems(session) {
  const tracker = session.profile("profile0");
  for (const { itemId, item, quest } of activeQuests(tracker)) {
    for (const objective of quest.objectives) {
      const stat = objective.stat && getObjectiveStat(objective.stat);
      if (heldStats[stat?.type]) setObjective(session, itemId, objective, heldStats[stat.type](tracker.profile, stat));
      const book = bookProgress(session, objective);
      const current = item.attributes[`completion_${objective.name}`] ?? 0;
      if (book !== undefined && book > current) setObjective(session, itemId, objective, book);
    }
  }
}

// UpgradeItem / ConvertItem (and the collection book's UpgradeSlottedItem / ConvertSlottedItem) on an account item:
// each Upgrade and HasUpgraded stat (or HasConverted) the item matches after the change counts once, as do objectives
// with the Upgrade (Convert) item event naming the item's template.
export function itemChanged(session, change, item, templateId = item.templateId) {
  const tracker = session.profile("profile0");
  const types = change === "Upgrade" ? ["Upgrade", "HasUpgraded"] : ["HasConverted"];
  for (const { itemId, item: questItem, quest } of activeQuests(tracker)) {
    for (const objective of quest.objectives) {
      const stat = objective.stat && getObjectiveStat(objective.stat);
      if (!stat || !types.includes(stat.type) || !statMatches(stat, item)) continue;
      setObjective(session, itemId, objective, (questItem.attributes[`completion_${objective.name}`] ?? 0) + 1);
    }
  }
  itemEvent(session, [change], templateId, 1);
  refreshHeldItems(session);
}

// Completes and claims every Onboarding quest, following the chain each one grants, which is what the client checks.
export function skipTutorial(session) {
  const tracker = session.profile("profile0");
  for (const questId of startingQuests) {
    const itemId = grantQuest(tracker, questId);
    if (itemId) refreshQuest(session, itemId);
  }

  for (;;) {
    const next = Object.keys(tracker.profile.items).find((itemId) => {
      const item = tracker.profile.items[itemId];
      return getQuest(questIdOf(item) ?? "")?.type === "Onboarding" && item.attributes.quest_state !== "Claimed";
    });
    if (!next) return;
    if (!isDone(tracker.profile.items[next])) completeQuest(session, next);
    if (tracker.profile.items[next].attributes.quest_state === "Completed") claimQuest(session, next);
  }
}
