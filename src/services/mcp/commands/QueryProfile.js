import { convertEventLeftovers } from "../../../events/leftovers.js";
import { removeEndedEventQuests } from "../../../events/quests.js";
import { ensureEventPurchaseTrackers } from "../../../store/eventstore.js";
import { fitSchematicAlterations } from "../../../profiles/alterations.js";
import { clearClaimedToday } from "./ClaimLoginReward.js";

// Loading the quest log takes an ended event's unfinished quests out of it (events/quests.js, Core-Backend #127), and
// turns an ended event's unspent tickets into its llamas, once (events/leftovers.js, #129, #174). While 1.11's Event
// Store is open the account gets the purchase trackers its limits count on (store/eventstore.js).
// From 3.5 the trackers are common_core's (profiles/common.js), which the client queries first, so that query gives them too.
// From 4.2 the account's weapon and trap schematics get the perks they lack (profiles/alterations.js, Core-Backend #270).
export function queryProfile({ profileId, tracker, session }) {
  if (profileId === "common_core") ensureEventPurchaseTrackers(tracker);
  if (profileId !== "profile0") return;
  clearClaimedToday(tracker);
  ensureEventPurchaseTrackers(tracker);
  removeEndedEventQuests(session);
  convertEventLeftovers(session);
  fitSchematicAlterations(tracker);
}
