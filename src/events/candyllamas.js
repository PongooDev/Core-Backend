import { getCardPack, itemIds } from "../gamedata/items.js";
import { log } from "../log.js";
import { grantItem } from "../profiles/items.js";
import { currentEventsConfig, fortnitemares, hasEventEnded } from "./events.js";
import { candy } from "./fortnitemares.js";

// 1.9.1's notes: "The Fortnitemares event has ended and Mutant Storms have returned! For every 500 unspent Halloween
// tickets you will receive a Halloween llama, available in the loot tab." The Halloween tickets are Candy
// (EventCurrency_Candy, SearchTags "Candy Halloween Llama ..."), the Halloween llama is the Fortnitemares Llama
// (CardPack_Event_2017_Halloween), the one Candy bought for 500 while the event ran (store/catalog.js), and the loot tab
// lists the account's unopened llamas.
//
// So on a build past Fortnitemares (1.9.1, CL-3775276, events/events.js) whose data still has the llama, loading the
// account (QueryProfile, ClientQuestLogin) turns each 500 Candy it holds into an unopened Fortnitemares Llama. The
// Candy left over (under 500) stays: the notes give nothing for it. Converting leaves under 500, so it happens once
// per hoard, and Candy earned later on an older build is converted the next time the account loads on 1.9.1.
export const candyPerLlama = 500;
export const halloweenLlama = "CardPack:cardpack_event_2017_halloween";

const candyStacks = (profile) => Object.entries(profile.items)
  .filter(([, item]) => item.templateId.toLowerCase() === candy.toLowerCase() && item.quantity > 0);

// Returns the llamas granted (grantItem entries), none when there is nothing to convert.
export function convertLeftoverCandy(session, force = false) {
  const config = currentEventsConfig();
  if (!force && config?.autoConvertCandy === false) return [];
  if (!force && !hasEventEnded(fortnitemares)) return [];
  if (!getCardPack(halloweenLlama)) return [];
  if (!itemIds().some((templateId) => templateId.toLowerCase() === candy.toLowerCase())) return [];
  const tracker = session.profile("profile0");
  const stacks = candyStacks(tracker.profile);
  const total = stacks.reduce((sum, [, item]) => sum + item.quantity, 0);
  const perLlama = config?.candyPerLlama ?? candyPerLlama;
  const llamas = Math.floor(total / perLlama);
  if (llamas < 1) return [];

  let toSpend = llamas * perLlama;
  for (const [itemId, item] of stacks) {
    if (toSpend <= 0) break;
    const spent = Math.min(item.quantity, toSpend);
    toSpend -= spent;
    if (item.quantity > spent) tracker.setQuantity(itemId, item.quantity - spent);
    else tracker.removeItem(itemId);
  }
  const granted = grantItem(session, halloweenLlama, llamas, { packSource: "Store" });
  log("Events", `${session.accountId}'s ${llamas * perLlama} unspent Candy became ${llamas} Fortnitemares Llama(s)`);
  return granted;
}
