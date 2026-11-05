import { convertLeftover } from "./candyllamas.js";
import { currentEventsConfig, hasEventEnded, isEventActive, mutantStorms, mutantStorms2018, storm2018 } from "./events.js";
import { stormLlama2018, stormTickets } from "./mutantstorms.js";

// 1.11's notes: "With the end of the Mutant Storms event, every 1,000 unspent Storm Tickets will be converted to a storm
// llama that will be available in their loot tab. All other unspent tickets will be lost after this event is over." The
// storm llama is the Vindertech Llama (CardPack_Event_Vindertech, "Guarantees at least one Epic or better limited time
// Vindertech weapon!"), the one Storm Tickets bought while the event ran (store/catalog.js).
//
// So the first time an account loads on a build past the Mutant Storms (1.11, CL-3807424, events/events.js) whose data
// still has the llama, each 1,000 Storm Tickets it holds becomes an unopened Vindertech Llama and the rest are lost
// (events/leftovers.js, Core-Backend #174). The storms came back with 2.3 ("As the snow melts, Mutant Storms return!")
// and 2.5 converted them again ("Each stack of 1000 Storm Event Tickets has been exchanged for Storm Llamas"): that run
// is a conversion of its own (stormConversion2018).
export const stormTicketsPerLlama = 1000;
export const stormLlama = "CardPack:cardpack_event_vindertech";

// The Mutant Storms' (1.9.1 to 1.10) end of event conversion. Not while the admin panel runs the event anyway (its
// Vindertech Llama offer is then on sale), nor on 2.3, where the storms are back and Storm Tickets buy its Storm Llama
// (events.js mutantStorms2018): there they are the event's currency again. Past the return (2.5) they are the return's
// (stormConversion2018).
export const stormConversion = {
  run: "MutantStorms2017",
  due: () => {
    const cfg = currentEventsConfig();
    return cfg?.autoConvertStormTickets !== false && cfg?.autoConvertCandy !== false && hasEventEnded(mutantStorms)
      && !isEventActive(mutantStorms) && !isEventActive(mutantStorms2018) && !hasEventEnded(mutantStorms2018);
  },
  options: () => ({ currency: stormTickets, perLlama: stormTicketsPerLlama, llama: stormLlama, label: "Storm Tickets",
    llamaName: "Vindertech Llama" })
};

// The admin panel's Convert Storm Tickets Now: each 1,000 of the account's into a Vindertech Llama, leaving what is left
// over. Returns the llamas granted (grantItem entries), none when there is nothing to convert.
export function convertLeftoverStormTickets(session) {
  return convertLeftover(session, stormConversion.options());
}

// The storms' return (2.3 to 2.4.2, events.js mutantStorms2018) ends with 2.5: "Each stack of 1000 Storm Event Tickets
// has been exchanged for Storm Llamas." The storm llama is the return's Storm Llama (CardPack_Event_FirstStorm), the one
// its tickets bought (store/catalog.js). So the first time an account loads on a build past 2.4.2 whose data still has
// it, each 1,000 Storm Tickets become an unopened Storm Llama and the rest go (events/leftovers.js). Not while the admin
// panel runs the storms anyway, nor on a build running Into the Storm (3.5.1, events/storm2018.js), whose Storm Tickets
// buy its own llama: the conversion waits for a build where neither runs.
export const stormConversion2018 = {
  run: "MutantStorms2018",
  due: () => {
    const cfg = currentEventsConfig();
    return cfg?.autoConvertStormTickets !== false && cfg?.autoConvertCandy !== false && hasEventEnded(mutantStorms2018)
      && !isEventActive(mutantStorms) && !isEventActive(mutantStorms2018) && !isEventActive(storm2018);
  },
  options: () => ({ currency: stormTickets, perLlama: stormTicketsPerLlama, llama: stormLlama2018, label: "Storm Tickets",
    llamaName: "Storm Llama" })
};
