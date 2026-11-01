import { convertLeftover } from "./candyllamas.js";
import { currentEventsConfig, hasEventEnded, isEventActive, mutantStorms } from "./events.js";
import { stormTickets } from "./mutantstorms.js";

// 1.11's notes: "With the end of the Mutant Storms event, every 1,000 unspent Storm Tickets will be converted to a storm
// llama that will be available in their loot tab. All other unspent tickets will be lost after this event is over." The
// storm llama is the Vindertech Llama (CardPack_Event_Vindertech, "Guarantees at least one Epic or better limited time
// Vindertech weapon!"), the one Storm Tickets bought while the event ran (store/catalog.js).
//
// So on a build past the Mutant Storms (1.11, CL-3807424, events/events.js) whose data still has the llama, loading the
// account (QueryProfile, ClientQuestLogin) turns each 1,000 Storm Tickets it holds into an unopened Vindertech Llama, as
// 1.9.1 does with Candy (events/candyllamas.js). The tickets left over (under 1,000) stay: Core takes nothing away, so
// tickets earned later on an older build are converted the next time the account loads on 1.11.
export const stormTicketsPerLlama = 1000;
export const stormLlama = "CardPack:cardpack_event_vindertech";

// Returns the llamas granted (grantItem entries), none when there is nothing to convert.
export function convertLeftoverStormTickets(session, force = false) {
  if (!force && currentEventsConfig()?.autoConvertCandy === false) return [];
  // Not while the admin panel runs the event anyway (its Vindertech Llama offer is then on sale).
  if (!force && (!hasEventEnded(mutantStorms) || isEventActive(mutantStorms))) return [];
  return convertLeftover(session, { currency: stormTickets, perLlama: stormTicketsPerLlama, llama: stormLlama, label: "Storm Tickets",
    llamaName: "Vindertech Llama" });
}
