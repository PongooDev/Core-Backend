import { perBuild } from "./read.js";

const data = perBuild((read) => {
  const quests = read("quests", {});
  const granted = new Set(
    Object.values(quests).flatMap((quest) => [
      ...(quest.rewards ?? []),
      ...(quest.hiddenRewards ?? []),
      ...(quest.selectableRewards ?? []).flat()
    ])
      .filter((reward) => reward.templateId.toLowerCase().startsWith("quest:"))
      .map((reward) => reward.templateId.slice("quest:".length).toLowerCase())
  );
  const starting = Object.entries(quests)
    .filter(([id, quest]) => quest.type === "Onboarding" && !quest.deprecated && !quest.prerequisiteQuest && !granted.has(id))
    .map(([id]) => id);
  return { quests, starting };
});

// The onboarding quests a new account starts with (no quest grants them, none comes first).
export function startingQuests() {
  return data().starting;
}

export function getQuest(id) {
  return data().quests[id.toLowerCase()];
}

export function questIds() {
  return Object.keys(data().quests);
}
