import { getObjectiveStat } from "../gamedata/homebase.js";
import { getCharacter, getItem } from "../gamedata/items.js";
import { getQuest, startingQuests } from "../gamedata/quests.js";
import { grantItem } from "./items.js";
import { grantQuest, isDone, questIdOf } from "./quests.js";

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
  if (!hasVisibleRewards(quest)) claimQuest(session, itemId);

  itemEvent(session, ["HasCompletedQuest", "QuestComplete"], `Quest:${questId}`, 1);
}

// Grants rewards, the chosen reward group and hidden rewards. Returns what the rewards screen shows.
export function claimQuest(session, itemId, selectedIndex = -1) {
  const tracker = session.profile("profile0");
  const quest = getQuest(questIdOf(tracker.profile.items[itemId]));
  setState(tracker, itemId, "Claimed");

  const shown = [];
  for (const reward of [...(quest.rewards ?? []), ...(quest.selectableRewards?.[selectedIndex] ?? [])]) {
    shown.push(...grant(session, reward.templateId, reward.quantity).filter((entry) => typeOf(entry.templateId) !== "quest"));
  }
  for (const reward of quest.hiddenRewards ?? []) grant(session, reward.templateId, reward.quantity);
  return shown;
}

// Every grant goes through here so quests that wait on acquiring an item, or a newly granted quest that is
// already satisfied, move on in the same command.
export function grant(session, templateId, quantity) {
  const granted = grantItem(session, templateId, quantity);
  for (const entry of granted) {
    if (entry.profileId !== "profile0") continue;
    if (typeOf(entry.templateId) === "quest") refreshQuest(session, entry.itemId);
    else itemEvent(session, ["Acquire"], entry.templateId, entry.quantity);
  }
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

export function advanceObjective(session, statName, count) {
  const tracker = session.profile("profile0");
  for (const { itemId, item, quest } of activeQuests(tracker)) {
    const objective = quest.objectives.find((candidate) => candidate.name === statName.toLowerCase());
    if (objective) setObjective(session, itemId, objective, (item.attributes[`completion_${objective.name}`] ?? 0) + count);
  }
}

// Gameplay tags match themselves and their children, case-insensitively.
export function hasTag(tags, wanted) {
  const target = wanted.toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === target || tag.toLowerCase().startsWith(`${target}.`));
}

// ObjectiveStatTable conditions: "Squad.Id == x", "Squad.Slot == n", "Item HasTag t", joined by && and ||.
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
    return false;
  }));
}

function assignedCount(profile, stat) {
  return Object.values(profile.items).filter((item) => {
    if (!item.attributes.squad_id) return false;
    if (stat.templateId && typeOf(item.templateId) !== stat.templateId.toLowerCase()) return false;
    const tags = getCharacter(item.templateId)?.tags ?? [];
    return (!stat.targetTags || hasTag(tags, stat.targetTags)) && conditionHolds(stat.condition, item, tags);
  }).length;
}

// Objectives that describe what the player holds rather than events: owning an item, or having a character
// assigned somewhere. They are re-counted whenever that could have changed.
function stateProgress(profile, objective) {
  if (objective.itemEvent === "Acquire" && objective.item) {
    return Object.values(profile.items).filter((item) => sameId(item.templateId, objective.item)).reduce((sum, item) => sum + item.quantity, 0);
  }
  const stat = objective.stat && getObjectiveStat(objective.stat);
  if (stat?.type === "HasAssignedWorker") return assignedCount(profile, stat);
  return undefined;
}

function refreshQuest(session, itemId) {
  const tracker = session.profile("profile0");
  const item = tracker.profile.items[itemId];
  for (const objective of getQuest(questIdOf(item)).objectives) {
    const value = stateProgress(tracker.profile, objective);
    if (value !== undefined && value > 0) setObjective(session, itemId, objective, value);
  }
}

export function refreshAssignments(session) {
  const tracker = session.profile("profile0");
  for (const { itemId, quest } of activeQuests(tracker)) {
    for (const objective of quest.objectives) {
      const stat = objective.stat && getObjectiveStat(objective.stat);
      if (stat?.type === "HasAssignedWorker") setObjective(session, itemId, objective, assignedCount(tracker.profile, stat));
    }
  }
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
