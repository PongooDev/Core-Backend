import { startingQuests } from "../../../gamedata/quests.js";
import { grant } from "../../../profiles/progress.js";

// The client may send this several times a session and logs out after 5 failed retries, so it must always succeed.
export function clientQuestLogin({ session }) {
  for (const questId of startingQuests) grant(session, `Quest:${questId}`, 1);
}
