import { convertLeftoverCandy } from "../../../events/candyllamas.js";
import { convertLeftoverStormTickets } from "../../../events/stormllamas.js";
import { removeEndedEventQuests } from "../../../events/quests.js";
import { ensureEventPurchaseTrackers } from "../../../store/eventstore.js";
import { clearClaimedToday } from "./ClaimLoginReward.js";

// Loading the quest log takes an ended event's unfinished quests out of it (events/quests.js, Core-Backend #127), and
// on a build past Fortnitemares turns unspent Candy into Fortnitemares Llamas (events/candyllamas.js, #129), and past the
// Mutant Storms (1.11) unspent Storm Tickets into Vindertech Llamas (events/stormllamas.js). While 1.11's Event Store is
// open the account gets the purchase trackers its limits count on (store/eventstore.js).
export function queryProfile({ profileId, tracker, session }) {
  if (profileId !== "profile0") return;
  clearClaimedToday(tracker);
  ensureEventPurchaseTrackers(tracker);
  removeEndedEventQuests(session);
  convertLeftoverCandy(session);
  convertLeftoverStormTickets(session);
}
