import { startingQuests } from "../../../gamedata/quests.js";
import { refreshDailyQuests } from "../../../profiles/dailies.js";
import { grant, refreshHeldItems } from "../../../profiles/progress.js";

// The client may send this several times a session and logs out after 5 failed retries, so it must always succeed.
// Objectives about what the account holds are re-counted, so quests already active catch up with it (e.g. a collection
// book levelled before Core credited collectionbook_levelup).
export function clientQuestLogin({ session }) {
  for (const questId of startingQuests()) grant(session, `Quest:${questId}`, 1);
  refreshDailyQuests(session);
  refreshHeldItems(session);
}
