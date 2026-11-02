import crypto from "node:crypto";
import { isEventActive, mutantStorms2018, winter2017 } from "../events/events.js";
import { getItem } from "../gamedata/items.js";
import { nextReplayOf, weeklyStoreEnd } from "./itemshop.js";

// Save the World's Event Store, from 1.11 (CL-3807424): "A new store with items you can purchase using in-game
// currency! Play any mission and earn Seasonal Gold. Use this currency to snag some seasonal items or see what the
// weekly section has to offer. Items rotate weekly." It is the Loot tab's Event page, EventStoreRoot
// (UFortDirectAcquisitionWidgetBase), whose StorefrontNames are ["STWSpecialEventStoreFront",
// "STWRotationalEventStorefront"]. Its GenerateOfferWidget puts an offer of the first storefront in the left list,
// EVENT ITEMS (TileViewEventItems), and every other offer in the right one, WEEKLY ITEMS (TileViewWeeklyItems). The left
// list counts down to GetSeasonStoreEndDate and the right one to GetWeeklyStoreEndDate.
//
// Those two getters (UFortDirectAcquisitionWidgetBase::GetSeasonStoreEndDate / GetWeeklyStoreEndDate) read the
// calendar's client-events state by game mode (1.11 0x8016A0 / 0x8016D0, 2.1 sub_804F20 / sub_804F50, 2.2 sub_7E4020 /
// sub_7E4050, each passed the same Battle Royale flag): Battle Royale's seasonEnd and weeklyStoreEnd, Save the World's
// stwEventStoreEnd (FFortClientEventsState +0x168) and stwWeeklyStoreEnd (+0x170). Without those both headers showed
// 0:00 (Core-Backend #169). The calendar sends them while the store is open (eventStoreEnds):
// - stwEventStoreEnd, EVENT ITEMS: Survive the Holidays' end, on Season 2's replay (store/itemshop.js nextReplayOf):
//   "The Save the World winter event has been extended until January 24" (2.2.0's notes), "ends on January 25"
//   (2.3.0's), so the end of 24 January 2018 (🟡: the hour is Core's). Once the replay passes it, it counts to the
//   next cycle's, when the replay comes round to it again.
// - stwWeeklyStoreEnd, WEEKLY ITEMS: the weekly rotation's end, the item shop's weeklyStoreEnd that storeWeek keys the
//   week's offers by, so the items change when it reaches 0:00.
//
// An offer's "N left" is its purchase limit less what the account bought (1.11 0x7FF7A1C0AC00): the offer's metaInfo
// "EventLimit" (none, or 0, is no limit), and the EventPurchaseTracker:generic_instance item (FortEventPurchaseTrackerItem,
// EFortItemType 0x41) in profile0 whose event_instance_id is the offer's metaInfo "PurchaseLimitingEventId" (compared
// case-insensitively, 0x7FF7A1C01490); the count is that item's event_purchases[offerId]. An offer with a limit but no
// PurchaseLimitingEventId, or no tracker for it, shows nothing left, so profile0 always holds both trackers while the
// event runs (ensureEventPurchaseTrackers, from QueryProfile). The weekly offers' ids carry their week, so one tracker
// serves every week and a new week starts with nothing bought.
//
// Prices are in Seasonal Gold (AccountResource:eventcurrency_scaling, "Seasonal Gold", the gold bars), which the store
// shows with the price item's icon. Epic's catalog held the offers, not the paks; the prices and limits are the ones the
// 1.11 store showed (Core-Backend #144's reference screenshot: Sarah Claus 3,200, Copper Ralphie's Revenge 2,000, Copper
// Stabsworth the III 1,680 with 2 left, Skirmisher Edge 2,800; Survivor 250 with 2 left, Survivalist Jonesy 400, ten Epic
// Flux 75 with 5 left, ten Rare Flux 30 with 10 left), else the Fortnite Wiki's Event Store tiers (Exchange: legendary
// survivor 700, legendary hero 2,800, legendary schematic 1,680, epic schematic 600, ten Pure Drops of Rain 50, ten
// Lightning in a Bottle 100, ten Eyes of the Storm 150, ten Storm Shards 200, five Legendary Flux 75). Which other items
// the event and the weeks sold is Core's choice (🟡).
//
// The weekly section also sells for Daily Coins (Core-Backend #173). 1.11's notes: "These items can be purchased with new
// currencies: Seasonal Gold and Daily Coins ... Daily Coins are earned by completing Daily Quests", 100 a daily quest
// (1.11's dailies). Daily Coins are AccountResource:specialcurrency_daily (SpecialCurrency_Daily, "Special currency used
// to purchase items from the Event Store"), and EventStoreRoot's Update Currency (1.11 to 2.2) shows its balance
// (TextDailyCoin) beside Seasonal Gold's (TextGoldBar). Epic's Daily Coin offers were a week's legendary schematics for
// 700 each: 8.00's notes move "Daily Coin offers from the Weekly Store" from 700 Daily Coins to 1,680 Gold (a legendary
// schematic's Gold price), and the issue's screenshot of a later store shows a legendary weapon (Copper Socket Slugger)
// and a legendary trap (Healing Pad) for 700 each. So every week a legendary weapon and a legendary trap schematic sell
// for 700 Daily Coins, one of each; which ones 1.11 to 2.2's weeks sold isn't recorded, so the picks are Core's (🟡).
export const seasonalGold = "AccountResource:eventcurrency_scaling";
export const dailyCoins = "AccountResource:specialcurrency_daily";
export const eventStorefront = "STWSpecialEventStoreFront";
export const weeklyStorefront = "STWRotationalEventStorefront";
export const eventPurchaseTracker = "EventPurchaseTracker:generic_instance";
// The trackers' event_instance_id, each storefront's offers' PurchaseLimitingEventId.
export const eventStoreInstance = "Winter2017.STWSpecialEventStoreFront";
export const weeklyStoreInstance = "Winter2017.STWRotationalEventStorefront";

// Survive the Holidays' offers, for as long as it runs.
const eventItems = [
  { templateId: "Hero:hid_ninja_013_sr_t01", price: 3200, limit: 1 },
  { templateId: "Schematic:sid_sniper_bbgun_sr_ore_t01", price: 2000, limit: 1 },
  { templateId: "Schematic:sid_edged_sword_light_sr_ore_t01", price: 1680, limit: 2 },
  { templateId: "Hero:hid_ninja_009_sr_t01", price: 2800, limit: 1 },
  { templateId: "Worker:workerbasic_sr_t01", price: 700, limit: 1 }
];

// Every week's: a Survivor and Epic and Rare Flux; and the week's picks: a legendary and a rare hero, a legendary and an
// epic schematic, and two of the resources.
const weeklyStaples = [
  { templateId: "Worker:workerbasic_vr_t01", price: 250, limit: 2 },
  { templateId: "AccountResource:reagent_evolverarity_vr", quantity: 10, price: 75, limit: 5 },
  { templateId: "AccountResource:reagent_evolverarity_r", quantity: 10, price: 30, limit: 10 }
];
const weeklyResources = [
  { templateId: "AccountResource:reagent_c_t01", quantity: 10, price: 50, limit: 10 },
  { templateId: "AccountResource:reagent_c_t02", quantity: 10, price: 100, limit: 5 },
  { templateId: "AccountResource:reagent_c_t03", quantity: 10, price: 150, limit: 3 },
  { templateId: "AccountResource:reagent_c_t04", quantity: 10, price: 200, limit: 2 },
  { templateId: "AccountResource:reagent_evolverarity_sr", quantity: 5, price: 75, limit: 10 }
];
// The core heroes and weapons: no founders', platform, Halloween, holiday, Scavenger or Vindertech ones.
const coreHeroes = [
  "commando_007", "commando_008", "commando_009", "commando_010", "commando_gcgrenade", "commando_grenadegun",
  "commando_grenademaster", "commando_gunheadshot", "commando_guntough", "commando_shockdamage",
  "constructor_007", "constructor_008", "constructor_009", "constructor_010", "constructor_basebig", "constructor_basehyper",
  "constructor_hammerplasma", "constructor_hammertank", "constructor_plasmadamage", "constructor_rushbase",
  "ninja_007", "ninja_008", "ninja_009", "ninja_010", "ninja_slashbreath", "ninja_slashtail", "ninja_smokedimmak",
  "ninja_starsassassin", "ninja_starsrain", "ninja_swordmaster",
  "outlander_007", "outlander_008", "outlander_009", "outlander_010", "outlander_punchdamage", "outlander_punchphase",
  "outlander_spherefragment", "outlander_zonefragment", "outlander_zoneharvest", "outlander_zonepistol"
];
const coreWeapons = [
  "assault_auto", "assault_burst", "assault_doubleshot", "assault_hydra", "assault_lmg", "assault_raygun", "assault_semiauto",
  "assault_singleshot", "assault_surgical", "blunt_club_light", "blunt_hammer_heavy", "blunt_hammer_rocket",
  "blunt_light_rocketbat", "blunt_light", "blunt_medium", "edged_axe_heavy", "edged_axe_light", "edged_axe_medium_laser",
  "edged_axe_medium", "edged_scythe_laser", "edged_scythe", "edged_sword_heavy", "edged_sword_hydraulic",
  "edged_sword_medium_laser", "edged_sword_medium", "launcher_grenade", "launcher_hydraulic", "launcher_rocket",
  "piercing_spear_laser", "piercing_spear_military", "piercing_spear", "pistol_auto", "pistol_autoheavy", "pistol_bolt",
  "pistol_gatling", "pistol_handcannon_semi", "pistol_handcannon", "pistol_hydraulic", "pistol_rapid", "pistol_rocket",
  "pistol_semiauto", "pistol_space", "pistol_zapper", "shotgun_auto", "shotgun_break_ou", "shotgun_break", "shotgun_heavy",
  "shotgun_longarm", "shotgun_minigun", "shotgun_semiauto", "shotgun_standard", "shotgun_tactical_precision", "sniper_amr",
  "sniper_auto", "sniper_boltaction_scope", "sniper_hydraulic", "sniper_shredder", "sniper_standard_scope",
  "sniper_standard", "sniper_tripleshot"
];
// The core traps: no holiday (falling ceiling, freeze) ones.
const coreTraps = [
  "ceiling_electric_aoe", "ceiling_electric_single", "ceiling_gas", "floor_health", "floor_launcher", "floor_spikes",
  "floor_spikes_wood", "floor_ward", "wall_darts", "wall_electric", "wall_launcher", "wall_light", "wall_wood_spikes"
];
const weeklyPicks = [
  { pool: coreHeroes.map((name) => `Hero:hid_${name}_sr_t01`), price: 2800, limit: 1 },
  { pool: coreWeapons.map((name) => `Schematic:sid_${name}_sr_ore_t01`), price: 1680, limit: 1 },
  { pool: coreWeapons.map((name) => `Schematic:sid_${name}_vr_ore_t01`), price: 600, limit: 1 },
  { pool: coreHeroes.map((name) => `Hero:hid_${name}_r_t01`), price: 400, limit: 1 }
];
// The week's Daily Coin offers, while the build's data has Daily Coins.
const dailyCoinPicks = [
  { pool: coreWeapons.map((name) => `Schematic:sid_${name}_sr_ore_t01`), price: 700, limit: 1, currency: dailyCoins },
  { pool: coreTraps.map((name) => `Schematic:sid_${name}_sr_t01`), price: 700, limit: 1, currency: dailyCoins }
];

// 2.3 (CL-3847564) keeps the store through the storms' return (events/mutantstorms.js): "Put it towards those evolution
// materials in the Event Store with weekly rotating items", "Event Store has been updated! The Legendary Hydra Transform
// Key is available in the Event Store! The Event Store also offers Legendary Constructor BASE Hype", and "All missions
// will continue to award Seasonal Gold, and Daily Quests will continue to award Daily Coins. Seasonal Gold will reset
// once the Spring Event starts". So on 2.3 its event items are those two (Hydra Assault Weapon Transform Schematic,
// ConversionControl:CCK_Ranged_Assault_Hydra_Consumable_SR, at a legendary schematic's 1,680; BASE Hype,
// HID_Constructor_RushBase_F_SR, at a legendary hero's 2,800; one each, 🟡), counted by trackers of their own event
// (MutantStorms2018.*), the weekly section as before. The storms ran until 2.5 turned their tickets into llamas
// (events/stormllamas.js; 13 February 2018), which the event items count down to (🟡: the hour is Core's).
const stormsEventItems = [
  { templateId: "ConversionControl:cck_ranged_assault_hydra_consumable_sr", price: 1680, limit: 1 },
  { templateId: "Hero:hid_constructor_rushbase_f_sr_t01", price: 2800, limit: 1 }
];
export const mutantStorms2018End = "2018-02-13T00:00:00.000Z";
const storms2018 = () => !isEventActive(winter2017) && isEventActive(mutantStorms2018);
const eventItemsNow = () => (storms2018() ? stormsEventItems : eventItems);
export const eventStoreInstanceNow = () => (storms2018() ? "MutantStorms2018.STWSpecialEventStoreFront" : eventStoreInstance);
export const weeklyStoreInstanceNow = () => (storms2018() ? "MutantStorms2018.STWRotationalEventStorefront" : weeklyStoreInstance);

// The store is open while the requesting build runs Survive the Holidays (or 2.3's storms) and its data has Seasonal
// Gold.
export const hasEventStore = () => (isEventActive(winter2017) || isEventActive(mutantStorms2018)) && Boolean(getItem(seasonalGold));

const has = ({ templateId }) => Boolean(getItem(templateId));
const nameOf = (templateId) => templateId.split(":")[1].toLowerCase();

// Survive the Holidays' end on Epic's clock.
export const winter2017End = "2018-01-25T00:00:00.000Z";

// The calendar's Event Store countdowns, none while it is closed.
export function eventStoreEnds(now = new Date()) {
  if (!hasEventStore()) return {};
  return { stwEventStoreEnd: nextReplayOf(storms2018() ? mutantStorms2018End : winter2017End, now), stwWeeklyStoreEnd: weeklyStoreEnd(now) };
}

// The week the weekly items are for: the day their countdown (the calendar's stwWeeklyStoreEnd) ends, e.g. "20261104".
export const storeWeek = (now = new Date()) => weeklyStoreEnd(now).toISOString().slice(0, 10).replaceAll("-", "");

// A number from 0 to 1 for each of a week's picks, the same every time for that week.
function weekRandom(week, index) {
  return crypto.createHash("sha256").update(`${weeklyStorefront}:${week}:${index}`).digest().readUInt32BE(0) / 0x100000000;
}

// The week's picks, from the items the requesting build has: one from each pick's pool, and two resources.
function weeklyItems(week) {
  const picks = weeklyPicks.map(({ pool, price, limit }, index) => {
    const offered = pool.filter((templateId) => getItem(templateId) && !eventItemsNow().some((item) => item.templateId === templateId));
    return offered.length ? { templateId: offered[Math.floor(weekRandom(week, index) * offered.length)], price, limit } : undefined;
  }).filter(Boolean);
  const resources = weeklyResources.filter(has);
  const first = Math.floor(weekRandom(week, weeklyPicks.length) * resources.length);
  const second = (first + 1 + Math.floor(weekRandom(week, weeklyPicks.length + 1) * (resources.length - 1))) % resources.length;
  const chosen = resources.length > 1 ? [resources[first], resources[second]] : resources;
  // The Daily Coin picks, never the week's Seasonal Gold schematic.
  const coinPicks = getItem(dailyCoins) ? dailyCoinPicks.map(({ pool, ...offer }, index) => {
    const offered = pool.filter((templateId) => getItem(templateId) && !picks.some((pick) => pick.templateId === templateId));
    return offered.length
      ? { ...offer, templateId: offered[Math.floor(weekRandom(week, weeklyPicks.length + 2 + index) * offered.length)] } : undefined;
  }).filter(Boolean) : [];
  return [...coinPicks, ...picks.slice(0, 3), ...chosen, ...weeklyStaples.filter(has), ...picks.slice(3)];
}

const toOffer = (offerId, instance) => ({ templateId, quantity = 1, price, limit, currency = seasonalGold }) => ({
  offerId,
  templateId,
  quantity,
  title: "",
  currencyType: "GameItem",
  currencySubType: currency,
  price,
  eventLimit: limit,
  purchaseLimitingEventId: instance,
  stwEventStore: true
});

// The Event Store's offers by storefront, none when it is closed.
export function eventStoreOffers(now = new Date()) {
  if (!hasEventStore()) return { [eventStorefront]: [], [weeklyStorefront]: [] };
  const week = storeWeek(now);
  const offerName = (item) => `${nameOf(item.templateId)}${item.quantity > 1 ? `_x${item.quantity}` : ""}${item.currency === dailyCoins ? "_dailycoins" : ""}`;
  return {
    [eventStorefront]: eventItemsNow().filter(has).map((item) => toOffer(`core_stw_event_${offerName(item)}`, eventStoreInstanceNow())(item)),
    [weeklyStorefront]: weeklyItems(week).map((item) => toOffer(`core_stw_weekly_${week}_${offerName(item)}`, weeklyStoreInstanceNow())(item))
  };
}

const trackerOf = (profile, instance) => Object.entries(profile.items).find(([, item]) =>
  item.templateId.toLowerCase() === eventPurchaseTracker.toLowerCase()
  && String(item.attributes?.event_instance_id ?? "").toLowerCase() === instance.toLowerCase());

// Gives profile0 the trackers the store's limits count on while it is open, and takes the past weeks' purchases out of
// the weekly one. tracker: profile0's change tracker. Returns the trackers' item ids by instance.
export function ensureEventPurchaseTrackers(tracker, now = new Date()) {
  if (!hasEventStore()) return {};
  const ids = {};
  const weeklyInstance = weeklyStoreInstanceNow();
  for (const instance of [eventStoreInstanceNow(), weeklyInstance]) {
    const found = trackerOf(tracker.profile, instance);
    if (found) {
      ids[instance] = found[0];
      continue;
    }
    const itemId = crypto.randomUUID();
    tracker.addItem(itemId, {
      templateId: eventPurchaseTracker,
      attributes: { event_purchases: {}, event_instance_id: instance, _private: false, devName: "" },
      quantity: 1
    });
    ids[instance] = itemId;
  }
  const weeklyId = ids[weeklyInstance];
  const purchases = tracker.profile.items[weeklyId].attributes.event_purchases ?? {};
  const thisWeek = `core_stw_weekly_${storeWeek(now)}_`;
  const kept = Object.fromEntries(Object.entries(purchases).filter(([offerId]) => offerId.startsWith(thisWeek)));
  if (Object.keys(kept).length !== Object.keys(purchases).length) tracker.setItemAttribute(weeklyId, "event_purchases", kept);
  return ids;
}

// How many of an Event Store offer the account has bought.
export function eventPurchases(profile, offer) {
  const found = trackerOf(profile, offer.purchaseLimitingEventId);
  return found?.[1].attributes?.event_purchases?.[offer.offerId] ?? 0;
}

// Counts quantity more of an offer bought, in its tracker. tracker: profile0's change tracker.
export function recordEventPurchase(tracker, offer, quantity, now = new Date()) {
  const itemId = ensureEventPurchaseTrackers(tracker, now)[offer.purchaseLimitingEventId];
  const purchases = tracker.profile.items[itemId].attributes.event_purchases ?? {};
  tracker.setItemAttribute(itemId, "event_purchases", { ...purchases, [offer.offerId]: (purchases[offer.offerId] ?? 0) + quantity });
}
