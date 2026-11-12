import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { blockbuster2018, cramSession2018, isEventActive, mutantStorms2018, roadTrip2018, spring2018, storm2018, winter2017 } from "../events/events.js";
import { cramSession2018End, cramSessionEventItems } from "../events/cramsession2018.js";
import { getItem } from "../gamedata/items.js";
import { nextReplayOf, seasonMoment, weeklyStoreEnd } from "./itemshop.js";

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
// 4.2's (CL-4072250) Perk Recombobulator: "Perk resources will be in the Event Store (available Wed., May 16 at 8pm ET)",
// so from 4.2 every week also sells RE-PERK! (AccountResource:reagent_alteration_generic, which changes a perk and pays
// part of every upgrade) and the four PERK-UP! (reagent_alteration_upgrade_uc to _sr, a perk's next rarity). The
// elemental ones (FIRE-UP!, AMP-UP!, FROST-UP!) are the Elemental Storm alerts' rewards and the elemental husk quests'.
// 🟡 Epic's amounts, prices and limits aren't recorded: these are Core's, in step with the evolution materials above.
// 4.1's paks have the same resources unnamed (PP.Generic, PP.Upgrade.*), so they are gated on 4.2's build, not the data.
export const perkResourcesBuild = 4072250;
const perkResources = [
  { templateId: "AccountResource:reagent_alteration_generic", quantity: 100, price: 100, limit: 5 },
  { templateId: "AccountResource:reagent_alteration_upgrade_uc", quantity: 100, price: 50, limit: 5 },
  { templateId: "AccountResource:reagent_alteration_upgrade_r", quantity: 100, price: 100, limit: 3 },
  { templateId: "AccountResource:reagent_alteration_upgrade_vr", quantity: 100, price: 150, limit: 2 },
  { templateId: "AccountResource:reagent_alteration_upgrade_sr", quantity: 50, price: 200, limit: 2 }
];
// 5.0 (CL-4204761, CL-4214610; Update v5.00's notes, Core-Backend #300): "The Persistent Weekly Store now offers RE-PERKs,
// Uncommon PERK-UPs and Rare PERK-UPs." So from 5.0 those three are the weekly section's perk staples, and the Epic and
// Legendary PERK-UP! leave it (the Horde's alerts and Road Trip's rewards give them); the store also opens on 5.0 with no
// event running (hasEventStore), its event section empty then, as the weekly section is persistent. 🟡 Amounts, prices
// and limits stay 4.2's (Core's).
export const persistentWeeklyBuild = 4204761;
const persistentPerks = ["AccountResource:reagent_alteration_generic", "AccountResource:reagent_alteration_upgrade_uc",
  "AccountResource:reagent_alteration_upgrade_r"];
const perksNow = () => (Number(currentBuild()) >= persistentWeeklyBuild
  ? perkResources.filter(({ templateId }) => persistentPerks.includes(templateId))
  : Number(currentBuild()) >= perkResourcesBuild ? perkResources : []);
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
//
// 2.4 (CL-3858292) keeps the store and its two event items (2.4's data names the key "Hydra Transform Key"). Its notes
// add one: "The Cozy Campfire trap schematic is available through the Event Store", but 2.4's paks have no Save the
// World Cozy Campfire (no schematic or trap item but Battle Royale's TID_Floor_Player_Campfire_Athena), so there is
// nothing to sell and the store leaves it out.
//
// 2.4.2 (CL-3870737) has it: SID_Floor_Campfire_R/VR/SR (TID_Floor_Campfire, "Cozy Campfire"). So on 2.4.2 the store
// sells the Legendary one, SID_Floor_Campfire_SR_T01, at a legendary schematic's 1,680, one each (🟡: the rarity and
// price are Core's; the notes name neither). A build without it (2.3, 2.4) leaves it out, as every offer its data lacks.
const stormsEventItems = [
  { templateId: "ConversionControl:cck_ranged_assault_hydra_consumable_sr", price: 1680, limit: 1 },
  { templateId: "Hero:hid_constructor_rushbase_f_sr_t01", price: 2800, limit: 1 },
  { templateId: "Schematic:sid_floor_campfire_sr_t01", price: 1680, limit: 1 }
];
export const mutantStorms2018End = "2018-02-13T00:00:00.000Z";
//
// 2.5 (CL-3889387) keeps it for Spring It On! (events/spring2018.js), its gold now "Spring It On! Gold" ("Sprint It On!
// Gold" in 2.5's data, the notes' known issue): "New, Spring it On!-themed items will appear in the store throughout the
// event. Event store Items will appear, and remain available for purchase until the end of Spring It On!. Weekly store
// items will only be available for the week in which they appear." Its one named item is "Heartbreaker Crossbow ...
// Available in the Event Store for Seasonal Gold" (SID_Sniper_Crossbow_SR_Ore_T01, "Heartbreaker"). Beside it the store
// sells 2.5's other Valentine's items no quest or llama gives, Snuggle Specialist Sarah (HID_Ninja_009_F_Valentine_SR)
// and the Flame Grill Floor Trap (SID_Floor_FlameGrill_SR_T01), at a legendary hero's 2,800 and a legendary schematic's
// 1,680, one each (🟡: the picks and prices are Core's). Its trackers are the event's own (Spring2018.*). The event items
// count down to Season 2's last day (🟡: 2.5 was played until 3.0, 22 February 2018; the event ran on into Season 3).
const springEventItems = [
  { templateId: "Schematic:sid_sniper_crossbow_sr_ore_t01", price: 1680, limit: 1 },
  { templateId: "Hero:hid_ninja_009_f_valentine_sr_t01", price: 2800, limit: 1 },
  { templateId: "Schematic:sid_floor_flamegrill_sr_t01", price: 1680, limit: 1 }
];
// On 3.0 (CL-3901517, Season 3) the same moment is Season 3's first day, so the event items count down to the end of
// Season 3's replay (🟡: Spring It On! ran on to 3.5; Core's countdown is the season's).
export const spring2018End = "2018-02-22T00:00:00.000Z";
// 3.0's notes: "The Bald Eagle Hand Cannon is now available in the Weekly Store. This is the highest-damage hand cannon
// yet!" (SID_Pistol_HandCannon_DE_SR_Ore_T01, new in 3.0's data): every week, at a legendary schematic's 1,680 Seasonal
// Gold, one (🟡: Epic's price and limit aren't recorded), on a build whose data has it.
// 3.1's (CL-3915963): "DragonFire shotgun is now available in the Weekly Store! Shoots a cone of fiery death, damaging all
// husks in the area. Heavy auto-shotgun, with a slower rate of fire and smaller magazine size." That is the Spring Llama's
// Dragon heavy shotgun, SID_Shotgun_Dragon_Drum_SR_Ore_T01 (2.5's data on), in the Bald Eagle's place on 3.1 and later
// (🟡: the notes don't say the Bald Eagle left; Core features one item a week, the build's newest), at the same price
// and limit.
// 4.1's (CL-4053532): "HackSAW is now in the Weekly Store (available Wednesday, May 9 at 8pm ET). A light machine gun
// variant with a moderate rate of fire, mild recoil, a long reload time, and excellent ammo efficiency." That is the
// Military LMG, SID_Assault_LMG_Military_SR_Ore_T01 (the M249 SAW's icon, T-Icon-Weapons-SK-M249; in 4.0's data already,
// a Blockbuster Llama weapon, which 4.1's data makes a store item: no longer recyclable or counted toward the vault,
// bInventorySizeLimited false), in the DragonFire's place on 4.1 and later, at a legendary schematic's 1,680 Seasonal Gold,
// one (🟡: Epic's price and limit aren't recorded; Core's week has it from the build's first day, not from 9 May).
// 4.2's (CL-4072250): "Quad Launcher available in Weekly Event Store (available Wed., May 16 at 8pm ET). Holds 4
// incendiary rockets that leave balls of fire behind after they explode." That is the Military Launcher,
// SID_Explosive_Launcher_Military_SR_Ore_T01 (the Quad Launcher; in 4.0's data already, one of Blockbuster's Military
// weapons below, and 4.2 adds its card pack CardPack_Explosive_Launcher_Military_SR), in the HackSAW's place on 4.2 and
// later, at a legendary schematic's 1,680 Gold, one (🟡: Epic's price and limit aren't recorded). So on 4.2 it leaves the
// event items and the HackSAW is back among them, as on 4.0.
// 5.30's (CL-4305896): "Bundlebuss Assault Rifle is now available in the Weekly Store. Available from August 23 at 4 AM ET
// to August 29 at 8 PM ET. A surprisingly accurate multi-barreled Flintlock rifle that fires in powerful bursts." That is
// the Flintlock assault rifle, SID_Assault_Flintlock_SR_Ore_T01 (Road Trip's Event Store weapon since 5.0, below; 5.30's
// data gives it its own alteration loadout, SlotLoadout.Event.Flintlock.Explicit.AssaultRfile), in the Quad Launcher's
// place on 5.30 and later, at a legendary schematic's 1,680 Gold, one (🟡: Epic's price and limit aren't recorded; Core's
// week has it from the build's first day, and keeps it after 29 August), so on 5.30 it leaves Road Trip's event items.
// 5.40's (CL-4352937; Content Update v5.40's and Update v5.41's weapons are in its data): Content Update v5.40's "Wraith
// Assault Rifle added to the Weekly Store ... A silenced assault rifle ... Available Wednesday, September 12 at 8 PM ET until
// Wednesday, September 19 at 8 PM ET" (SID_Assault_Military_Silenced_SR_Ore_T01, new in 5.40's data) and Update v5.41's
// "Bowler Flintlock Launcher added to the Weekly Store ... Available Wednesday, September 19 at 8 PM ET until Wednesday,
// September 26 at 8 PM ET" (the Flintlock Launcher, SID_Launcher_Flintlock_SR_Ore_T01, Road Trip's since 5.0): each in its
// week on Season 5's replay (store/itemshop.js seasonMoment; from 13 and 20 September 00:00 UTC), the Bundlebuss before
// them, at the same price and limit (🟡 as the Bundlebuss's). The Bowler leaves Road Trip's event items in its week. 5.41
// (CL-4363240, Update v5.41's build, whose notes name the Bowler) keeps 5.40's weeks.
// 6.00's (CL-4395664, CL-4402180; Update v6.00): "Added Ratatat Machine Pistol to the Weekly Store. Ratatat is a fast firing
// Automatic Pistol ... Available until October 3 at 8 PM EST" (SID_Pistol_RatRod_SR_Ore_T01, "Ratatat", new in 6.00's
// data) and "The Weekly Store will also feature some returning items during Cram Session. The Hydraulic Sledge is back the
// first week" (SID_Blunt_Hammer_Hydraulic_VR_Ore_T01, the Epic hammer 6.00's data names "Hydraulic Sledge"; its Legendary
// is "Pulverizer"): both every week on 6.00, as 5.30's Bundlebuss (🟡 Core's: Update v6.01's Lead Sled and Obliterator week
// is 6.01's), the Ratatat at a legendary schematic's 1,680 Gold and the Sledge at an epic one's 600, one each (🟡 Epic's
// prices and limits aren't recorded). A build's weeks count on its own season's replay (season, 5 when unset).
// 6.01's (CL-4417689, CL-4424678; Update v6.01): "Lead Sled Hammer added to the Weekly Store. A fast-swinging hammer that
// gains speed with each hit ... Available Wednesday, October 3 at 8 PM ET until Wednesday, October 10 at 8 PM ET" (the Rat
// Rod hammer, SID_Blunt_Hammer_RatRod_SR_Ore_T01, "Lead Sled"; in 6.00's data already) and "Obliterator Sniper Rifle added
// to the Weekly Store. A slow firing Sniper Rifle with high base damage and a heavy kick ... Available Wednesday, October 3
// at 8 PM ET until Wednesday, October 10 at 8 PM ET" (the Military sniper, SID_Sniper_Military_SR_Ore_T01, Blockbuster's;
// "Obliterator" in 6.01's data): both from 4 October 00:00 UTC on Season 6's replay, 6.00's Ratatat and Sledge before them,
// at a legendary schematic's 1,680 Gold, one each (🟡 Epic's prices and limits aren't recorded; Core keeps the week after 10
// October, when Update v6.02 brought the next).
const weeklyFeaturedByBuild = [
  { firstBuild: 4417689, season: 6, weeks: [
    { from: "2018-10-04T00:00:00.000Z", items: [{ templateId: "Schematic:sid_blunt_hammer_ratrod_sr_ore_t01", price: 1680, limit: 1 },
      { templateId: "Schematic:sid_sniper_military_sr_ore_t01", price: 1680, limit: 1 }] },
    { from: null, items: [{ templateId: "Schematic:sid_pistol_ratrod_sr_ore_t01", price: 1680, limit: 1 },
      { templateId: "Schematic:sid_blunt_hammer_hydraulic_vr_ore_t01", price: 600, limit: 1 }] }
  ] },
  { firstBuild: 4395664, season: 6, weeks: [
    { from: null, items: [{ templateId: "Schematic:sid_pistol_ratrod_sr_ore_t01", price: 1680, limit: 1 },
      { templateId: "Schematic:sid_blunt_hammer_hydraulic_vr_ore_t01", price: 600, limit: 1 }] }
  ] },
  { firstBuild: 4352937, weeks: [
    { from: "2018-09-20T00:00:00.000Z", items: [{ templateId: "Schematic:sid_launcher_flintlock_sr_ore_t01", price: 1680, limit: 1 }] },
    { from: "2018-09-13T00:00:00.000Z", items: [{ templateId: "Schematic:sid_assault_military_silenced_sr_ore_t01", price: 1680, limit: 1 }] },
    { from: null, items: [{ templateId: "Schematic:sid_assault_flintlock_sr_ore_t01", price: 1680, limit: 1 }] }
  ] },
  { firstBuild: 4305896, items: [{ templateId: "Schematic:sid_assault_flintlock_sr_ore_t01", price: 1680, limit: 1 }] },
  { firstBuild: 4072250, items: [{ templateId: "Schematic:sid_explosive_launcher_military_sr_ore_t01", price: 1680, limit: 1 }] },
  { firstBuild: 4053532, items: [{ templateId: "Schematic:sid_assault_lmg_military_sr_ore_t01", price: 1680, limit: 1 }] },
  { firstBuild: 3915963, items: [{ templateId: "Schematic:sid_shotgun_dragon_drum_sr_ore_t01", price: 1680, limit: 1 }] },
  { firstBuild: 3901517, items: [{ templateId: "Schematic:sid_pistol_handcannon_de_sr_ore_t01", price: 1680, limit: 1 }] }
];
// The build's featured weekly items now: a build with weeks has the newest week begun on its season's replay.
const weeklyFeatured = (now = new Date()) => {
  const entry = weeklyFeaturedByBuild.find(({ firstBuild }) => Number(currentBuild()) >= firstBuild);
  if (!entry?.weeks) return entry?.items ?? [];
  const moment = seasonMoment(now, null, entry.season ?? 5).getTime();
  return entry.weeks.find(({ from }) => from === null || moment >= Date.parse(from))?.items ?? [];
};
const storms2018 = () => !isEventActive(winter2017) && isEventActive(mutantStorms2018);
// 3.5.1's (CL-4000805) Into the Storm (events/storm2018.js) keeps Spring It On!'s store: its gold is still Spring It On! Gold
// ("Added Spring It On! Gold" to Survive the Storm's rewards, a repeatable quest's "100 Spring It On! Gold"), and its notes
// name no new Event Store item, so the store, its trackers (Spring2018.*) and its countdown run on as 3.3's.
const springNow = () => !isEventActive(winter2017) && !storms2018() && (isEventActive(spring2018) || isEventActive(storm2018));
// 3.2's (CL-3935073) notes: "Wukong is available in the Event Store. This is the Mythic version of the Lunar New Year
// 'Berserker' soldier." (HID_Commando_014_Wukong_SR_T01, in 3.1's data already): a hero at a legendary hero's 2,800, one
// (🟡: Epic's price and limit aren't recorded), on 3.2 and later.
// The countdown (stwEventStoreEnd) on 3.2 is the one 3.0 and 3.1 have: Spring It On!'s items "remain available for purchase
// until the end of Spring It On!", counted to the end of the Season 3 replay's cycle (spring2018End; 🟡: the event ran on to
// 3.5, and Core's clock is the season's, rolling over as the shop's replay does). 3.2's calendar request carries the build
// as the engine version alone (builds/detect.js), which Core read as no build, so the store had no countdown (#233).
// 3.3's (CL-3942182) notes: "Shamrock Reclaimer Outlander is available in the Event Store." That hero is in no pak of 3.3
// (no Shamrock or Reclaimer item in its items or characters: Epic delivered it with a content update), so the store has
// nothing to sell and leaves it out, as every offer a build's data lacks (🟡: add it with its template id when a build has it).
// 3.4's notes (no 3.4 build is at hand; 3.5.1, CL-4000805, is the first whose data has the hero): "Rabbit Raider Jonesy,
// Legendary reskin of the Soldier's Raider subclass, has been added to the Event Store" (HID_Commando_011_M_Easter_SR_T01),
// at a legendary hero's 2,800, one (🟡: Epic's price and limit aren't recorded), on 3.5.1 and later.
// 3.5.2's (CL-4008490) Content Update v3.50: "Neon Weapons - Mercury LMG (Save the World) This energy machinegun has a
// massive magazine ... Find it in the Event Store." The Mercury LMG (SID_Assault_NeonGlow_LMG_SR_Ore_T01, in 3.5.1's data
// already) at a legendary schematic's 1,680, one (🟡: Epic's price and limit aren't recorded), on 3.5.2 and later.
const wukongFirstBuild = 3935073;
const rabbitRaiderFirstBuild = 4000805;
const mercuryLmgFirstBuild = 4008490;
// 3.6's (CL-4019403) notes: "Noble Launcher added. NOTE: This will be available on April 25 at 8pm ET." The Fortnite Wiki's
// Into the Storm lists it among the Event Store's weapons (with the Mercury LMG): SID_Explosive_Launcher_NeonGlow_SR_Ore_T01
// ("Noble Launcher Schematic" in 3.6's card pack, in 3.5.1's data already) at a legendary schematic's 1,680, one (🟡: Epic's
// price and limit aren't recorded), on 3.6 and later.
const nobleLauncherFirstBuild = 4019403;
const springItemsNow = () => [...springEventItems,
  ...(Number(currentBuild()) >= wukongFirstBuild ? [{ templateId: "Hero:hid_commando_014_wukong_sr_t01", price: 2800, limit: 1 }] : []),
  ...(Number(currentBuild()) >= rabbitRaiderFirstBuild ? [{ templateId: "Hero:hid_commando_011_m_easter_sr_t01", price: 2800, limit: 1 }] : []),
  ...(Number(currentBuild()) >= mercuryLmgFirstBuild ? [{ templateId: "Schematic:sid_assault_neonglow_lmg_sr_ore_t01", price: 1680, limit: 1 }] : []),
  ...(Number(currentBuild()) >= nobleLauncherFirstBuild ? [{ templateId: "Schematic:sid_explosive_launcher_neonglow_sr_ore_t01", price: 1680, limit: 1 }] : [])];
// 4.0's (CL-4039451) Blockbuster (events/blockbuster2018.js) has a store of its own: its gold is 4.0's "Gold" ("Seasonal
// Gold has been renamed to Gold", the same AccountResource:EventCurrency_Scaling, now kept from season to season and
// capped at 5,000 by its MaxStackSize), its trackers Blockbuster2018.*, and its one named item is the Mythic Soldier
// Raven ("[New] Mythic Soldier "Raven" - Subclass: Nevermore"; the Fortnite Wiki's Blockbuster: "Raven ... was
// introduced with Blockbuster in 2018 and was sold in the Event Store"), HID_Commando_Myth02_SR_T01, at a legendary
// hero's 2,800, one (🟡: Epic's price and limit aren't recorded, as Wukong's). Spring It On!'s and Into the Storm's
// items leave with them. Its event items count down to the end of Season 4's replay (blockbuster2018End, 12 July 2018;
// 🟡: Blockbuster ran on to Part 4, 27 June, and Core's countdown is the season's).
// Raven was not alone (Core-Backend #265's screenshot showed the Event Items list with him only, sold out). The Fortnite Wiki's
// Blockbuster page lists the Event Store's heroes (Raven, The Cloaked Star, 8-Bit Demo, Archaeolo-Jess; Chromium Ramirez,
// Diecast Jonesy, Old Glory A.C. and Patriot Penny too, which 4.0's and 4.1's data hasn't, so they stay out) and its Military
// Weapons set, the Blockbuster Llama's: the Military Auto, Surgical and Silenced SMG assault weapons, the Military LMG
// (the HackSAW), Pistol, Shotgun, Sniper, Crossbow, Spear and Launcher, which 4.0's data has as legendary schematics. So the
// event items are the four heroes, a legendary Survivor and the weapons, at a legendary hero's 2,800, a legendary
// Survivor's 700 and a legendary schematic's 1,680, one each (🟡: Epic's prices and limits aren't recorded, except Raven's
// 2,800 Gold). 4.1 moves the HackSAW to the Weekly Store (weeklyFeaturedByBuild), so there it leaves the event items; 4.2
// moves the Quad Launcher there instead.
const blockbusterWeapons = ["assault_military_auto", "assault_military_surgical", "assault_smg_silenced_military", "assault_lmg_military",
  "pistol_silenced_military", "shotgun_military", "sniper_military", "sniper_crossbow_military", "piercing_spear_military",
  "explosive_launcher_military"];
const blockbusterEventItems = [
  { templateId: "Hero:hid_commando_myth02_sr_t01", price: 2800, limit: 1 },
  { templateId: "Hero:hid_ninja_myth02_sr_t01", price: 2800, limit: 1 },
  { templateId: "Hero:hid_constructor_016_m_v1_blockbuster_sr_t01", price: 2800, limit: 1 },
  { templateId: "Hero:hid_outlander_zoneharvest_blockbuster_sr_t01", price: 2800, limit: 1 },
  { templateId: "Worker:workerbasic_sr_t01", price: 700, limit: 1 },
  ...blockbusterWeapons.map((name) => ({ templateId: `Schematic:sid_${name}_sr_ore_t01`, price: 1680, limit: 1 }))
];
const blockbusterItems = (now) => blockbusterEventItems.filter(({ templateId }) => !weeklyFeatured(now).some((item) => item.templateId === templateId));
export const blockbuster2018End = "2018-07-12T00:00:00.000Z";
const blockbusterNow = () => !isEventActive(winter2017) && !storms2018() && !springNow() && isEventActive(blockbuster2018);
// 5.0's (CL-4204761, CL-4214610) Road Trip (events/roadtrip2018.js) opens a store of its own, sold for Gold as Blockbuster's
// (its trackers RoadTrip2018.*). The Fortnite Wiki's Road Trip lists the Event Store's weapons, the Bowler, Bundlebuss,
// Spyglass, Typewriter, Walloper and Wraith, and its heroes (Bladestorm Enforcer, Quickdraw Calamity...). 5.0's data has
// the first five as legendary schematics (the Flintlock Launcher, Assault, Scoped Sniper and Hammer, and the Autodrum
// assault rifle, new in 5.0); the Wraith and the heroes aren't in its paks (later content updates), so they stay out. So
// the event items are those five at a legendary schematic's 1,680 Gold and a legendary Survivor at 700, one each (🟡:
// Epic's prices and limits aren't recorded). Its event items count down to the event's end, Season 5's (roadTrip2018End,
// 27 September 2018, Season 6's start with Fortnitemares' return; 🟡 the hour is Core's), on Season 5's replay.
// 5.10 (CL-4225813, CL-4240749; Update v5.10's notes) adds a hero: "Urban Assault Sledgehammer Soldier is available in
// the Event Store. Available July 25 at 8PM Eastern Time (July 26 at 0000 GMT)": HID_Commando_GunHeadshot_M_V1_RoadTrip_SR
// ("Urban Assault Sledgehammer", new in 5.10's data, so only 5.10 offers it), at a legendary hero's 2,800 Gold, one (🟡 as
// Blockbuster's heroes; from 5.10's release, not its hour).
// 5.21 (CL-4288479; Core has no 5.20, so it carries Update v5.20's too) adds two: Update v5.20's "Mythic Ragnarok
// Outlander comes to the Event Store. Available August 8th, at 8PM ET" (HID_Outlander_Myth02_SR_T01, "Ragnarok", new in
// 5.21's data: 5.10's has only the higher tiers, as "Dark Viking Proto"), at the Fortnite Wiki's 3,200 Gold, and Update
// v5.21's "New Constructor Machinist: Thora added to the Event Store. Available Wednesday, August 15th at 8pm ET"
// (HID_Constructor_011_F_V1_RoadTrip_SR_T01, "Machinist Thora"), at the wiki's 2,800 Gold, one each (🟡 the limits are
// Core's, as the Sledgehammer's; from 5.21's release).
// 5.30 (CL-4305896; Content Update v5.30's hero is in its data): "Mythic Bladestorm Enforcer Ninja. Available in the Event
// Store August 29, at 8 PM ET. Features new subclass - Bladestorm" (HID_Ninja_Myth03_SR_T01, "Bladestorm Enforcer", new
// in 5.30's data), at a Mythic hero's 3,200 Gold as Ragnarok's, one (🟡 the price is Ragnarok's, the limit Core's; from
// 5.30's release). Its Bundlebuss moves to the Weekly Store (weeklyFeaturedByBuild).
// 5.40 (CL-4352937): "Harvester Fiona available in the Event Store. A new look for the Husk Harvester Ninja"
// (HID_Ninja_015_F_V1_RoadTrip_SR_T01, "Harvester Fiona", new in 5.40's data), at a legendary hero's 2,800 Gold as Thora's,
// one (🟡 the price and limit are Core's; from 5.40's release).
const roadTripEventItemList = [
  ...["launcher_flintlock", "assault_flintlock", "sniper_flintlock_scope", "blunt_hammer_flintlock", "assault_autodrum"]
    .map((name) => ({ templateId: `Schematic:sid_${name}_sr_ore_t01`, price: 1680, limit: 1 })),
  { templateId: "Hero:hid_commando_gunheadshot_m_v1_roadtrip_sr_t01", price: 2800, limit: 1 },
  { templateId: "Hero:hid_outlander_myth02_sr_t01", price: 3200, limit: 1 },
  { templateId: "Hero:hid_constructor_011_f_v1_roadtrip_sr_t01", price: 2800, limit: 1 },
  { templateId: "Hero:hid_ninja_myth03_sr_t01", price: 3200, limit: 1 },
  { templateId: "Hero:hid_ninja_015_f_v1_roadtrip_sr_t01", price: 2800, limit: 1 },
  { templateId: "Worker:workerbasic_sr_t01", price: 700, limit: 1 }
];
const roadTripEventItems = (now) => roadTripEventItemList.filter(({ templateId }) => !weeklyFeatured(now).some((item) => item.templateId === templateId));
export const roadTrip2018End = "2018-09-27T00:00:00.000Z";
const roadTripNow = () => !isEventActive(winter2017) && !storms2018() && !springNow() && !blockbusterNow() && isEventActive(roadTrip2018);
// 6.00's Cram Session (events/cramsession2018.js) sells MEGA B.A.S.E. Kyle, counted by trackers of its own
// (CramSession2018.*), its items counting down to Season 6's end on the replay (cramSession2018End).
const cramSessionItems = (now) => cramSessionEventItems.filter(({ templateId }) => !weeklyFeatured(now).some((item) => item.templateId === templateId));
const cramSessionNow = () => !isEventActive(winter2017) && !storms2018() && !springNow() && !blockbusterNow() && !roadTripNow()
  && isEventActive(cramSession2018);
// No event running: 5.0's persistent weekly store alone (persistentWeeklyBuild), with no event items.
const noEventNow = () => !isEventActive(winter2017) && !storms2018() && !springNow() && !blockbusterNow() && !roadTripNow() && !cramSessionNow();
const persistentOnlyNow = () => noEventNow() && Number(currentBuild()) >= persistentWeeklyBuild;
const eventItemsNow = (now = new Date()) => (storms2018() ? stormsEventItems : springNow() ? springItemsNow() : blockbusterNow() ? blockbusterItems(now)
  : roadTripNow() ? roadTripEventItems(now) : cramSessionNow() ? cramSessionItems(now) : persistentOnlyNow() ? [] : eventItems);
export const eventStoreInstanceNow = () => (storms2018() ? "MutantStorms2018.STWSpecialEventStoreFront"
  : springNow() ? "Spring2018.STWSpecialEventStoreFront" : blockbusterNow() ? "Blockbuster2018.STWSpecialEventStoreFront"
    : roadTripNow() ? "RoadTrip2018.STWSpecialEventStoreFront" : cramSessionNow() ? "CramSession2018.STWSpecialEventStoreFront" : eventStoreInstance);
export const weeklyStoreInstanceNow = () => (storms2018() ? "MutantStorms2018.STWRotationalEventStorefront"
  : springNow() ? "Spring2018.STWRotationalEventStorefront" : blockbusterNow() ? "Blockbuster2018.STWRotationalEventStorefront"
    : roadTripNow() ? "RoadTrip2018.STWRotationalEventStorefront" : cramSessionNow() ? "CramSession2018.STWRotationalEventStorefront"
      : weeklyStoreInstance);

// The store is open while the requesting build runs Survive the Holidays (or 2.3's to 2.4.2's storms, 2.5's Spring It
// On!, 3.5.1's Into the Storm, 4.0's to 4.2's Blockbuster, 5.0's Road Trip or 6.00's Cram Session) and its data has
// Seasonal Gold; on 5.0 and later always (the persistent weekly store).
export const hasEventStore = () => (isEventActive(winter2017) || isEventActive(mutantStorms2018) || isEventActive(spring2018) || isEventActive(storm2018)
  || isEventActive(blockbuster2018) || isEventActive(roadTrip2018) || isEventActive(cramSession2018) || Number(currentBuild()) >= persistentWeeklyBuild)
  && Boolean(getItem(seasonalGold));

const has = ({ templateId }) => Boolean(getItem(templateId));
const nameOf = (templateId) => templateId.split(":")[1].toLowerCase();

// Survive the Holidays' end on Epic's clock.
export const winter2017End = "2018-01-25T00:00:00.000Z";

// The calendar's Event Store countdowns, none while it is closed.
export function eventStoreEnds(now = new Date()) {
  if (!hasEventStore()) return {};
  const end = storms2018() ? mutantStorms2018End : springNow() ? spring2018End : blockbusterNow() ? blockbuster2018End
    : roadTripNow() ? roadTrip2018End : cramSessionNow() ? cramSession2018End : persistentOnlyNow() ? null : winter2017End;
  if (!end) return { stwEventStoreEnd: weeklyStoreEnd(now), stwWeeklyStoreEnd: weeklyStoreEnd(now) };
  return { stwEventStoreEnd: nextReplayOf(end, now), stwWeeklyStoreEnd: weeklyStoreEnd(now) };
}

// The week the weekly items are for: the day their countdown (the calendar's stwWeeklyStoreEnd) ends, e.g. "20261104".
export const storeWeek = (now = new Date()) => weeklyStoreEnd(now).toISOString().slice(0, 10).replaceAll("-", "");

// A number from 0 to 1 for each of a week's picks, the same every time for that week.
function weekRandom(week, index) {
  return crypto.createHash("sha256").update(`${weeklyStorefront}:${week}:${index}`).digest().readUInt32BE(0) / 0x100000000;
}

// The week's picks, from the items the requesting build has: one from each pick's pool, and two resources.
function weeklyItems(week, now = new Date()) {
  const picks = weeklyPicks.map(({ pool, price, limit }, index) => {
    const offered = pool.filter((templateId) => getItem(templateId) && !eventItemsNow(now).some((item) => item.templateId === templateId));
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
  const perks = perksNow().filter(has);
  return [...weeklyFeatured(now).filter(has), ...coinPicks, ...picks.slice(0, 3), ...chosen, ...weeklyStaples.filter(has), ...perks, ...picks.slice(3)];
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
    [eventStorefront]: eventItemsNow(now).filter(has).map((item) => toOffer(`core_stw_event_${offerName(item)}`, eventStoreInstanceNow())(item)),
    [weeklyStorefront]: weeklyItems(week, now).map((item) => toOffer(`core_stw_weekly_${week}_${offerName(item)}`, weeklyStoreInstanceNow())(item))
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
