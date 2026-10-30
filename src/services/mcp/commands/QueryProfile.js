import { convertLeftoverCandy } from "../../../events/candyllamas.js";
import { removeEndedEventQuests } from "../../../events/quests.js";
import { clearClaimedToday } from "./ClaimLoginReward.js";

// Loading the quest log takes an ended event's unfinished quests out of it (events/quests.js, Core-Backend #127), and
// on a build past Fortnitemares turns unspent Candy into Fortnitemares Llamas (events/candyllamas.js, #129).
export function queryProfile({ profileId, tracker, session }) {
  if (profileId !== "profile0") return;
  clearClaimedToday(tracker);
  removeEndedEventQuests(session);
  convertLeftoverCandy(session);
}
