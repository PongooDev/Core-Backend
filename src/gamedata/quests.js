import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "gamedata", "quests.json");
const quests = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

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
