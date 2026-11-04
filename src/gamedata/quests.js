import { perBuild, readGameData } from "./read.js";

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

// A quest's name as the game shows it (its DisplayName), for the admin panel (Core-Backend #216): gamedata/questnames.json
// (tools/questnames), 3.0's names, else 2.5's; the same for every build. Some are Epic's own hidden ones ("(Hidden)
// Onboarding"); 1.7.2's Halloween scavenger quests have none.
const questNames = readGameData("questnames", {});
export const questName = (id) => questNames[String(id).toLowerCase()]?.trim() || undefined;
