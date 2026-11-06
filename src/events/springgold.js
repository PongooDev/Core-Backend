import { currentBuild } from "../builds/context.js";
import { getItem } from "../gamedata/items.js";
import { log } from "../log.js";
import { grantItem } from "../profiles/items.js";
import { convertLeftover } from "./candyllamas.js";
import { currentEventsConfig, hasEventEnded, isEventActive } from "./events.js";
import { firecrackerTickets, seasonalGold, spring2018, springLlama } from "./spring2018.js";

// The Seasonal Gold conversion (events/leftovers.js): the first time an account loads on a build running Spring It On!
// whose data has both currencies, up to 3,000 of its Seasonal Gold become Firecracker Tickets, 3 to 1, and the rest of
// its gold goes. Gold earned afterwards (the event's missions and repeatable quest) is the event's own.
export const goldPerFirecracker = 3;
export const convertedGoldCap = 3000;
const holding = (profile, currency) => Object.entries(profile.items)
  .filter(([, item]) => item.templateId.toLowerCase() === currency.toLowerCase() && item.quantity > 0);
// Spring It On!'s end (3.5.1, CL-4000805, the first build past it Core has; events.js): 3.5's notes, "Every 1000 Firecracker
// Tickets will be converted into a Spring Llama", and 3.5.1's, "We've changed the way we convert event tickets. Players get
// 1 event Llama per 1000 tickets and 1 Llama for any tickets left over. (Example) If you have 5 tickets left at the end of
// the event, you still get 1 free event Llama." So the first time an account loads on a build past Spring It On! whose data
// has the Spring Llama (CardPack_Event_2018_Spring, store/catalog.js), its Firecracker Tickets become unopened Spring
// Llamas, one a 1,000 and one more for what is left over (events/leftovers.js). Not while the admin panel runs the event
// anyway. (3.5.1's "Granted all players two free Spring Llamas" is a grant of its own, not done here.)
export const firecrackersPerLlama = 1000;
export const firecrackerConversion = {
  run: "Spring2018",
  due: () => currentEventsConfig()?.autoConvertCandy !== false && hasEventEnded(spring2018) && !isEventActive(spring2018),
  options: () => ({ currency: firecrackerTickets, perLlama: firecrackersPerLlama, llama: springLlama, label: "Firecracker Tickets",
    llamaName: "Spring Llama" }),
  convert: (session) => convertLeftover(session, { ...firecrackerConversion.options(), roundUp: true })
};

// 4.0 (CL-4039451): "Gold no longer resets each season. Seasonal Gold has been renamed to Gold as a result." Accounts are
// shared by every build, so an account that has loaded on 4.0 or later keeps its Gold from then on: Spring It On!'s start
// (2.5 to 3.3's builds) no longer takes it, should the account first meet that event afterwards (Core-Backend #262). Its
// profile0 is set up (profiles/setup.js) with the conversion noted as done, as events/leftovers.js notes one it made.
// Accounts that never reached 4.0 convert as before.
export const goldKeptBuild = 4039451;
const goldMigration = "eventLeftovers.SeasonalGold2018";
export const goldKeptNeedsNote = (profile) => Number(currentBuild()) >= goldKeptBuild && !(profile.coreMigrations ?? []).includes(goldMigration);
export function noteGoldKept(profile) {
  if (goldKeptNeedsNote(profile)) profile.coreMigrations = [...(profile.coreMigrations ?? []), goldMigration];
}

export const goldConversion = {
  run: "SeasonalGold2018",
  due: () => currentEventsConfig()?.autoConvertCandy !== false && isEventActive(spring2018),
  options: () => ({ currency: seasonalGold, label: "Seasonal Gold" }),
  canConvert: () => Boolean(getItem(seasonalGold) && getItem(firecrackerTickets)),
  convert(session) {
    const tracker = session.profile("profile0");
    const stacks = holding(tracker.profile, seasonalGold);
    const total = stacks.reduce((sum, [, item]) => sum + item.quantity, 0);
    for (const [itemId] of stacks) tracker.removeItem(itemId);
    const tickets = Math.floor(Math.min(total, convertedGoldCap) / goldPerFirecracker);
    const lost = total - tickets * goldPerFirecracker;
    if (lost) log("Events", `${session.accountId}'s ${lost} leftover Seasonal Gold went with Spring It On!'s start`);
    if (tickets < 1) return [];
    log("Events", `${session.accountId}'s ${tickets * goldPerFirecracker} Seasonal Gold became ${tickets} Firecracker Tickets`);
    return grantItem(session, firecrackerTickets, tickets);
  }
};
