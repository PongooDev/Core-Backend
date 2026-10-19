import { readGameData } from "./read.js";

const quests = readGameData("quests", {});

const granted = new Set(
  Object.values(quests).flatMap((quest) => [
    ...(quest.rewards ?? []),
    ...(quest.hiddenRewards ?? []),
    ...(quest.selectableRewards ?? []).flat()
  ])
    .filter((reward) => reward.templateId.toLowerCase().startsWith("quest:"))
    .map((reward) => reward.templateId.slice("quest:".length).toLowerCase())
);

export const startingQuests = Object.entries(quests)
  .filter(([id, quest]) => quest.type === "Onboarding" && !quest.deprecated && !quest.prerequisiteQuest && !granted.has(id))
  .map(([id]) => id);

export function getQuest(id) {
  return quests[id.toLowerCase()];
}

export function questIds() {
  return Object.keys(quests);
}
