import { getQuest } from "../gamedata/quests.js";
import { currentEventsConfig, hasEventEnded, isEventActive, winter2017 } from "./events.js";

export { winter2017 };

// Survive the Holidays (1.11, CL-3807424), "The Fortnite Guide to Holiday Survival": "Help Ray bring the holiday spirit
// to everyone in the husk-ridden world in this new event questline. Earn an avalanche of Snowflake Tickets by
// participating in the event. ... Holiday Survival Llamas are available for purchase (1000 Snowflake Tickets.)" Its
// content waits for EventFlag.Winter2017 (events.js): the Mini-Boss mission alerts (MissionAlert_MiniBossCategory_01 to
// _04, a quota of 10 a day, world/theaters.js) and the Survive the Storm ones (Survival3Day/7DayCategory), and the
// winter quests (WinterQuest_2017_*), which 1.10's data already had, dormant.

// Snowflake Tickets (EventCurrency_Snowballs, bIsEventItem, "Snowflake Tickets"), and the Holiday Survival Llama they buy
// (CardPack_Event_2017_Winter, "Guarantees at least one Epic or better limited time Vacuum Tube weapon or Hero!",
// store/catalog.js).
export const snowflakeTickets = "AccountResource:eventcurrency_snowballs";
export const holidayLlama = "CardPack:cardpack_event_2017_winter";

// 2.3.0's notes (25 January 2018) end it: "For every 1,000 unspent Snowflake tickets, a Holiday Survival Llama will
// automatically be granted and can be found in the Loot Tab. All remaining tickets will be lost." So the first time an
// account loads on a build past 2.2 (CL-3841827, events.js) whose data still has the llama, each 1,000 Snowflake Tickets
// become an unopened Holiday Survival Llama and the rest go (events/leftovers.js, Core-Backend #174): 2.3
// (CL-3847564), whose data still has the llama, is the first. The rate is the Holiday Survival Llama's price, the admin
// panel's snowflakePerLlama (1,000 by default, as 1.11's notes price it).
export const snowflakeConversion = {
  run: "Winter2017",
  due: () => currentEventsConfig()?.autoConvertCandy !== false && hasEventEnded(winter2017) && !isEventActive(winter2017),
  options: () => ({ currency: snowflakeTickets, perLlama: currentEventsConfig()?.snowflakePerLlama ?? 1000, llama: holidayLlama,
    label: "Snowflake Tickets", llamaName: "Holiday Survival Llama" })
};

// The event's quests nothing in the game data grants (Epic's servers handed them out), granted at quest login while it
// runs: Ray's questline (Reactive_Fetch_Radios, whose hidden rewards lead through the decorations, gifts and trees to
// Lars' landmark mission and the present drops), the Frozen Troll (Reactive_FrozenTroll), the Survive the Storm quests
// (CompleteSurviveAny and CompleteSurvive7Day_D1-D3, the Frostbite and the holiday banners), the Mini-Boss quests
// (KillMiniBosses, ten for a holiday hero; KillMiniBosses_Repeatable, "a new repeatable quest that gives Seasonal Gold
// each time you manage to take out a Mini-Boss", which grants itself again), KillMistMonsters, and
// Hidden_WatchVideo, the event's movie (as Fortnitemares' HalloweenQuest_2017_Hidden_WatchVideo): every winter quest no
// other quest grants.
export const winterQuests = [
  "winterquest_2017_reactive_fetch_radios",
  "winterquest_2017_reactive_frozentroll",
  "winterquest_2017_completesurviveany",
  "winterquest_2017_completesurvive7day_d1",
  "winterquest_2017_completesurvive7day_d2",
  "winterquest_2017_completesurvive7day_d3",
  "winterquest_2017_killminibosses",
  "winterquest_2017_killminibosses_repeatable",
  "winterquest_2017_killmistmonsters",
  "winterquest_2017_hidden_watchvideo"
];

// The requesting build's Survive the Holidays quests, when the event runs there.
export function winterEventQuests() {
  return isEventActive(winter2017) ? winterQuests.filter((questId) => getQuest(questId)) : [];
}
