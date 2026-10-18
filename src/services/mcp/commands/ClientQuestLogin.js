import { startingQuests } from "../../../gamedata/quests.js";
import { grantQuest } from "../../../profiles/quests.js";

export function clientQuestLogin({ tracker }) {
  for (const questId of startingQuests) grantQuest(tracker, questId);
}
