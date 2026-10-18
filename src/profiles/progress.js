import { getQuest, startingQuests } from "../gamedata/quests.js";
import { grantItem } from "./items.js";
import { grantQuest, isDone, questIdOf } from "./quests.js";

function setState(tracker, itemId, state) {
  tracker.setItemAttribute(itemId, "quest_state", state);
  tracker.setItemAttribute(itemId, "last_state_change_time", new Date().toISOString());
}

function objectivesMet(item, quest) {
  return quest.objectives.every((objective) => (item.attributes[`completion_${objective.name}`] ?? 0) >= objective.count);
}

// Quests with a reward choice wait at Completed for the player to pick; the rest are claimed straight away.
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

  if (quest.selectableRewards?.length) {
    setState(tracker, itemId, "Completed");
  } else {
    setState(tracker, itemId, "Claimed");
    for (const reward of [...(quest.rewards ?? []), ...(quest.hiddenRewards ?? [])]) {
      grantItem(session, reward.templateId, reward.quantity);
    }
  }

  advanceObjective(session, `questcomplete_${questId}`, 1);
}

export function advanceObjective(session, statName, count) {
  const tracker = session.profile("profile0");
  const name = statName.toLowerCase();
  const key = `completion_${name}`;

  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (item.attributes.quest_state !== "Active" || !(key in item.attributes)) continue;
    const quest = getQuest(questIdOf(item) ?? "");
    const objective = quest?.objectives.find((candidate) => candidate.name === name);
    if (!objective) continue;

    const value = Math.min(item.attributes[key] + count, objective.count);
    if (value !== item.attributes[key]) tracker.setItemAttribute(itemId, key, value);
    if (objectivesMet(item, quest)) completeQuest(session, itemId);
  }
}

// Completes every Onboarding quest, following the chain each one grants, which is what the client checks.
export function skipTutorial(session) {
  const tracker = session.profile("profile0");
  for (const questId of startingQuests) grantQuest(tracker, questId);

  for (;;) {
    const next = Object.keys(tracker.profile.items).find((itemId) => {
      const item = tracker.profile.items[itemId];
      return getQuest(questIdOf(item) ?? "")?.type === "Onboarding" && !isDone(item);
    });
    if (!next) return;
    completeQuest(session, next);
  }
}
