import { getCardPack, itemIds } from "../gamedata/items.js";
import { log } from "../log.js";
import { grantItem } from "../profiles/items.js";
import { currentEventsConfig, fortnitemares, hasEventEnded, isEventActive } from "./events.js";
import { candy } from "./fortnitemares.js";

// 1.9.1's notes: "The Fortnitemares event has ended and Mutant Storms have returned! For every 500 unspent Halloween
// tickets you will receive a Halloween llama, available in the loot tab." The Halloween tickets are Candy
// (EventCurrency_Candy, SearchTags "Candy Halloween Llama ..."), the Halloween llama is the Fortnitemares Llama
// (CardPack_Event_2017_Halloween), the one Candy bought for 500 while the event ran (store/catalog.js), and the loot tab
// lists the account's unopened llamas.
//
// So the first time an account loads on a build past Fortnitemares (1.9.1, CL-3775276, events/events.js) whose data
// still has the llama, each 500 Candy it holds becomes an unopened Fortnitemares Llama, and the Candy left over (under
// 500) goes (events/leftovers.js, Core-Backend #174): 1.9.1's notes give nothing for it, and Candy buys nothing once the
// event is over (Event Tickets: "Once a Season ends, any unspent Tickets are automatically spent and converted into
// associated Event Llamas", so each event starts at 0), as 1.11's and 2.3's notes say of their own tickets.
export const candyPerLlama = 500;
export const halloweenLlama = "CardPack:cardpack_event_2017_halloween";

const stacksOf = (profile, currency) => Object.entries(profile.items)
  .filter(([, item]) => item.templateId.toLowerCase() === currency.toLowerCase() && item.quantity > 0);

// Fortnitemares' end of event conversion (events/leftovers.js).
export const candyConversion = {
  run: "Fortnitemares2017",
  due: () => currentEventsConfig()?.autoConvertCandy !== false && hasEventEnded(fortnitemares) && !isEventActive(fortnitemares),
  options: () => ({ currency: candy, perLlama: currentEventsConfig()?.candyPerLlama ?? candyPerLlama, llama: halloweenLlama,
    label: "Candy", llamaName: "Fortnitemares Llama" })
};

// The admin panel's Convert Candy Now: each 500 Candy of the account into a Fortnitemares Llama, leaving what is left
// over. Returns the llamas granted (grantItem entries), none when there is nothing to convert.
export function convertLeftoverCandy(session) {
  return convertLeftover(session, candyConversion.options());
}

// Whether the requesting build's data has an event's currency and llama, so it can convert them.
export const canConvert = ({ currency, llama }) => Boolean(getCardPack(llama))
  && itemIds().some((templateId) => templateId.toLowerCase() === currency.toLowerCase());

// Turns each perLlama of an event currency the account holds (profile0) into an unopened llama, when the requesting
// build's data has both; what is left over goes too with dropRemainder (the event's end), else stays. Also 1.11's Storm
// Tickets (events/stormllamas.js) and 2.3's Snowflake Tickets (events/winter2017.js).
export function convertLeftover(session, { currency, perLlama, llama, label, llamaName, dropRemainder = false }) {
  if (!canConvert({ currency, llama })) return [];
  const tracker = session.profile("profile0");
  const stacks = stacksOf(tracker.profile, currency);
  const total = stacks.reduce((sum, [, item]) => sum + item.quantity, 0);
  const llamas = Math.floor(total / perLlama);

  let toSpend = dropRemainder ? total : llamas * perLlama;
  for (const [itemId, item] of stacks) {
    if (toSpend <= 0) break;
    const spent = Math.min(item.quantity, toSpend);
    toSpend -= spent;
    if (item.quantity > spent) tracker.setQuantity(itemId, item.quantity - spent);
    else tracker.removeItem(itemId);
  }
  const lost = dropRemainder ? total - llamas * perLlama : 0;
  if (lost) log("Events", `${session.accountId}'s ${lost} leftover ${label} went with the event`);
  if (llamas < 1) return [];
  const granted = grantItem(session, llama, llamas, { packSource: "Store" });
  log("Events", `${session.accountId}'s ${llamas * perLlama} unspent ${label} became ${llamas} ${llamaName}(s)`);
  return granted;
}
