import crypto from "node:crypto";
import { getQuest } from "../gamedata/quests.js";

export function findQuestItem(profile, questId) {
  const templateId = `quest:${questId}`;
  return Object.keys(profile.items).find((itemId) => profile.items[itemId].templateId.toLowerCase() === templateId);
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
  tracker.addItem(itemId, { templateId: `Quest:${questId}`, attributes, quantity: 1 });
  return itemId;
}
