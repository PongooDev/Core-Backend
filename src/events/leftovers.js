import { candyConversion, canConvert, convertLeftover } from "./candyllamas.js";
import { goldConversion } from "./springgold.js";
import { stormConversion, stormConversion2018 } from "./stormllamas.js";
import { snowflakeConversion } from "./winter2017.js";

// What an event's unspent tickets become when it ends (Core-Backend #174), each at the rate its patch notes give:
// Fortnitemares' Candy, 500 a Fortnitemares Llama (1.9.1, events/candyllamas.js); the Mutant Storms' Storm Tickets, 1,000
// a Vindertech Llama (1.11, events/stormllamas.js); Survive the Holidays' Snowflake Tickets, 1,000 a Holiday Survival
// Llama (2.3, events/winter2017.js); the storms' return's Storm Tickets, 1,000 a Storm Llama (2.5, events/stormllamas.js).
// Spring It On!'s start turns Seasonal Gold into Firecracker Tickets, 3 to 1 up to 3,000 (2.5, events/springgold.js), a
// conversion of its own (convert). What is left over under the rate is lost ("All other unspent tickets will be lost
// after this event is over").
//
// Epic converted every account once, when the event ended. Accounts are shared by every build, so Core converts one when
// it first loads (QueryProfile, ClientQuestLogin) holding the tickets on a build where the event is over and whose data
// has the event's llama, and notes that on profile0 (coreMigrations, Core's, never sent) so it never happens again:
// tickets earned afterwards on an older build stay. A build where the event still runs (or the admin panel runs it)
// never converts.
const conversions = [candyConversion, stormConversion, snowflakeConversion, stormConversion2018, goldConversion];
const migration = (conversion) => `eventLeftovers.${conversion.run}`;
const converted = (profile, conversion) => (profile.coreMigrations ?? []).includes(migration(conversion));
const holds = (profile, currency) => Object.values(profile.items)
  .some((item) => item.templateId.toLowerCase() === currency.toLowerCase() && item.quantity > 0);

// Converts each ended event's tickets the account holds, if it never has. Returns the llamas granted.
export function convertEventLeftovers(session) {
  const { profile } = session.profile("profile0");
  const granted = [];
  for (const conversion of conversions) {
    if (converted(profile, conversion) || !conversion.due()) continue;
    const options = conversion.options();
    if (!(conversion.canConvert ? conversion.canConvert() : canConvert(options)) || !holds(profile, options.currency)) continue;
    granted.push(...(conversion.convert ? conversion.convert(session) : convertLeftover(session, { ...options, dropRemainder: true })));
    profile.coreMigrations = [...(profile.coreMigrations ?? []), migration(conversion)];
  }
  return granted;
}
