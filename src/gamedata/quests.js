import { perBuild, readGameData } from "./read.js";

const questRewardIds = (rewards) => rewards
  .filter((reward) => reward.templateId.toLowerCase().startsWith("quest:"))
  .map((reward) => reward.templateId.slice("quest:".length).toLowerCase());

const data = perBuild((read) => {
  const quests = read("quests", {});
  const granted = new Set(
    Object.values(quests).flatMap((quest) => questRewardIds([
      ...(quest.rewards ?? []),
      ...(quest.hiddenRewards ?? []),
      ...(quest.selectableRewards ?? []).flat()
    ]))
  );
  const starting = Object.entries(quests)
    .filter(([id, quest]) => quest.type === "Onboarding" && !quest.deprecated && !quest.prerequisiteQuest && !granted.has(id))
    .map(([id]) => id);
  // The quest line: the quests each quest's claim grants (its Rewards and HiddenRewards that are quests the build has;
  // reward choices are left out, as which one the player took isn't kept), and the quests that grant each one.
  const children = new Map();
  const parents = new Map();
  for (const [id, quest] of Object.entries(quests)) {
    const next = [...new Set(questRewardIds([...(quest.rewards ?? []), ...(quest.hiddenRewards ?? [])]))].filter((child) => quests[child]);
    children.set(id, next);
    for (const child of next) parents.set(child, [...(parents.get(child) ?? []), id]);
  }
  return { quests, starting, children, parents };
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

// The quests a quest's claim grants, and the quests whose claim grants it, in the requesting build's data.
export const questChildren = (id) => data().children.get(String(id).toLowerCase()) ?? [];
export const questParents = (id) => data().parents.get(String(id).toLowerCase()) ?? [];

// A quest's name as the game shows it (its DisplayName), for the admin panel (Core-Backend #216): gamedata/questnames.json
// (tools/questnames), 3.0's names, else 2.5's; the same for every build. Some are Epic's own hidden ones ("(Hidden)
// Onboarding"); 1.7.2's Halloween scavenger quests have none.
const questNames = readGameData("questnames", {});
export const questName = (id) => questNames[String(id).toLowerCase()]?.trim() || undefined;
