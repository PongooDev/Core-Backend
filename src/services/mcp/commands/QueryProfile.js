import { removeEndedEventQuests } from "../../../events/quests.js";
import { clearClaimedToday } from "./ClaimLoginReward.js";

// Loading the quest log takes an ended event's unfinished quests out of it (events/quests.js, Core-Backend #127).
export function queryProfile({ profileId, tracker, session }) {
  if (profileId !== "profile0") return;
  clearClaimedToday(tracker);
  removeEndedEventQuests(session);
}
