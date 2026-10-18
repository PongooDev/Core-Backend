import crypto from "node:crypto";
import { getQuest } from "../gamedata/quests.js";

export function questIdOf(item) {
  const [type, name] = item.templateId.split(":");
  return type.toLowerCase() === "quest" ? name.toLowerCase() : undefined;
}

export function findQuestItem(profile, questId) {
  return Object.keys(profile.items).find((itemId) => questIdOf(profile.items[itemId]) === questId.toLowerCase());
}

export function grantQuest(tracker, questId) {
  const quest = getQuest(questId);
  if (!quest || findQuestItem(tracker.profile, questId)) return null;

  const attributes = {
    quest_state: "Active",
    last_state_change_time: new Date().toISOString(),
    sent_new_notification: false
  };
  for (const objective of quest.objectives) attributes[`completion_${objective.name}`] = 0;

  const itemId = crypto.randomUUID();
  tracker.addItem(itemId, { templateId: `Quest:${questId.toLowerCase()}`, attributes, quantity: 1 });
  return itemId;
}

export const isDone = (item) => ["Completed", "Claimed"].includes(item.attributes.quest_state);

// The client's bTutorialCompleted: at least one Onboarding quest, and all of them Completed or Claimed.
export function tutorialCompleted(profile) {
  const onboarding = Object.values(profile.items).filter((item) => getQuest(questIdOf(item) ?? "")?.type === "Onboarding");
  return onboarding.length > 0 && onboarding.every(isDone);
}
