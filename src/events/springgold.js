import { getItem } from "../gamedata/items.js";
import { log } from "../log.js";
import { grantItem } from "../profiles/items.js";
import { currentEventsConfig, isEventActive } from "./events.js";
import { firecrackerTickets, seasonalGold, spring2018 } from "./spring2018.js";

// The Seasonal Gold conversion (events/leftovers.js): the first time an account loads on a build running Spring It On!
// whose data has both currencies, up to 3,000 of its Seasonal Gold become Firecracker Tickets, 3 to 1, and the rest of
// its gold goes. Gold earned afterwards (the event's missions and repeatable quest) is the event's own.
export const goldPerFirecracker = 3;
export const convertedGoldCap = 3000;
const holding = (profile, currency) => Object.entries(profile.items)
  .filter(([, item]) => item.templateId.toLowerCase() === currency.toLowerCase() && item.quantity > 0);
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
