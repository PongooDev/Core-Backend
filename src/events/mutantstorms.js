import { getItem } from "../gamedata/items.js";
import { getQuest } from "../gamedata/quests.js";
import { blockbuster2018, cramSession2018, isEventActive, mutantStorms, mutantStorms2018 } from "./events.js";

export { mutantStorms, mutantStorms2018 };

// The Mutant Storms (1.9.1, CL-3775276): "The Fortnitemares event has ended and Mutant Storms have returned! ... Fight
// the storm and earn tickets from missions up to 10 times per day. New Event Quests specific to Mutant Storms have
// been added." Its content waits for EventFlag.Vindertech: the StormCategory mission alerts (MissionAlert_StormCategory_01
// to _04, RequiredEventFlag EventFlag.Vindertech, a quota of 10 a day in MissionAlertCategories, spreading by
// MissionAlertSpreadDatas) and the Vindertech quests (category LTE_Vindertech). 1.10 (CL-3790078) keeps the event, its
// quests and llama, with its StormCategory rows requiring EventFlag.ActiveStorms instead and no spreading
// (world/theaters.js). The event is events.js's mutantStorms, which names each build's flag.

// Storm Tickets (EventCurrency_StormZone, bIsEventItem).
export const stormTickets = "AccountResource:eventcurrency_stormzone";

// The event's quests nothing in the game data grants (Epic's servers handed them out), granted at quest login while it
// runs: the first stage of each Vindertech chain (Freak of Nature: CompleteStorms_1, ExploreZones_1, Safes_1,
// TreasureChests_1, whose hidden rewards start the next stage), the quests that wait for a chain's last stage
// (CompleteStorms, CompleteExploreZones, CompleteSafes, CompleteTreasureChests), the class storm quests
// (CompleteStorms_Melee, _Ranged), the mutation hunts (KillEnragedHuskyHusks, KillQuickenedPitchers,
// KillWallWeakeningLobbers) and the Vindertech weapon quests (LevelUp_, Evolve_Vindertech): every Vindertech quest no
// other quest grants.
export const mutantStormsQuests = [
  "vindertechquest_completestorms_1",
  "vindertechquest_explorezones_1",
  "vindertechquest_safes_1",
  "vindertechquest_treasurechests_1",
  "vindertechquest_completestorms",
  "vindertechquest_completeexplorezones",
  "vindertechquest_completesafes",
  "vindertechquest_completetreasurechests",
  "vindertechquest_completestorms_melee",
  "vindertechquest_completestorms_ranged",
  "vindertechquest_killenragedhuskyhusks",
  "vindertechquest_killquickenedpitchers",
  "vindertechquest_killwallweakeninglobbers",
  "vindertechquest_levelup_vindertech",
  "vindertechquest_evolve_vindertech"
];

// The requesting build's Mutant Storms quests, when the event runs there.
export function mutantStormsEventQuests() {
  return isEventActive(mutantStorms) ? mutantStormsQuests.filter((questId) => getQuest(questId)) : [];
}

// The Mutant Storms' return (2.3, CL-3847564; events.js mutantStorms2018): "Mutant Storm mission alerts award Storm
// Tickets ... Quota: 10 per day" (2.3's StormCategory rows, EventFlag.ActiveStorms, quota 10, world/theaters.js), "Up to
// 5 Mutant Storms are available at a time in Stonewood, and up to 25 Active Storms ... in Plankerton, Canny Valley, and
// Twine Peaks", "Most Event Quests award Storm Tickets. Some Event Quests award V-Bucks", "Hydraulic Weapons and Storm
// Zone Heroes have returned, and are available in the Storm Llamas", and the Mini-Bosses stay: "Up to 3 of these
// Mini-Boss mission alerts can appear in Stonewood at a time and up to 6 at a time in Plankerton, Canny and Twine.
// Quota: 3 per day. These Mini-boss alerts have replaced the old generic Mission Alerts", with the return of the
// "Mini-Boss" quest that "Awards Seasonal Gold currency and is repeatable", and the Event Store stays open
// (store/eventstore.js).
//
// 2.3's quests are 2.2's: the event quests of the Hydraulic storms are the FirstStorm ones (FirstStormQuest_*, Storm
// Tickets, V-Bucks, Hydraulic weapon upgrades and the storm mutations' hunts), and the Mini-Boss quest is Survive the
// Holidays' repeatable one (WinterQuest_2017_KillMiniBosses_Repeatable, 20 Seasonal Gold). Granted at quest login while
// it runs: the first of each FirstStorm chain (KillEnragedHusks, KillExplodingDeathburstHusks and KillQuickenedHusks
// lead to the rest; LevelUp_Hydraulic to Evolve_Hydraulic) and the ones nothing grants. HydraulicStormLlama counts a
// stat no 2.3 objective row has, so it is left out (🟡).
const firstStormQuests2018 = [
  "firststormquest_completestormzones",
  "firststormquest_killenragedhusks",
  "firststormquest_killexplodingdeathbursthusks",
  "firststormquest_killquickenedhusks",
  "firststormquest_killhuskstraps",
  "firststormquest_killmistmonsters",
  "firststormquest_levelup_hydraulic",
  "winterquest_2017_killminibosses_repeatable"
];

// 2.4 (CL-3858292) ships the storms' own quest line, Quests/Events/MutantStorms2018 (MutantStormsQuest_2018_*: Storm
// Tickets and V-Bucks for the storm zones and the storm mutations' hunts, a trap pack for trap kills, a Storm Zone hero
// for Hydraulic Smasher kills, 500 Storm Tickets for buying a Storm Llama), and its own repeatable Mini-Boss quest
// (MutantStormsQuest_2018_KillMiniBosses_Repeatable, 50 Seasonal Gold). So on 2.4 those are the event quests, in place
// of the FirstStorm and winter ones: the first of each chain (CompleteStormZones_1; KillEnragedHusks_1,
// KillExplodingDeathburstHusks_1 and KillQuickenedHusks_1 lead to the other hunts) and the ones nothing grants.
// HydraulicStormLlama counts PurchaseCardPack of CardPack_Event_FirstStorm, which buying the Storm Llama fires
// (PurchaseCatalogEntry).
const mutantStormsQuests2018 = [
  "mutantstormsquest_2018_completestormzones_1",
  "mutantstormsquest_2018_killenragedhusks_1",
  "mutantstormsquest_2018_killexplodingdeathbursthusks_1",
  "mutantstormsquest_2018_killquickenedhusks_1",
  "mutantstormsquest_2018_killhuskstraps",
  "mutantstormsquest_2018_killmistmonsters",
  "mutantstormsquest_2018_hydraulicstormllama",
  "mutantstormsquest_2018_killminibosses_repeatable"
];

// Every quest the storms' return starts on any build (events/quests.js takes the line from these).
export const mutantStorms2018Quests = [...firstStormQuests2018, ...mutantStormsQuests2018];

// The Storm Llama they buy: CardPack_Event_FirstStorm ("Storm Llama", "Guarantees at least one Epic or better limited
// time Hydraulic weapon or Hero!"), store/catalog.js.
export const stormLlama2018 = "CardPack:cardpack_event_firststorm";

// The requesting build's quests of the storms' return, when it runs there.
export function mutantStorms2018EventQuests() {
  if (!isEventActive(mutantStorms2018)) return [];
  const own = mutantStormsQuests2018.filter((questId) => getQuest(questId));
  return own.length ? own : firstStormQuests2018.filter((questId) => getQuest(questId));
}

// "Purchased upgrade Llamas award Storm Tickets" (2.3, and 2.4's and 2.4.2's storms): an Upgrade Llama (CardPack_Bronze, store/catalog.js's
// core_cardpack_bronze offers, one or ten) bought while 2.3's storms run also gives Storm Tickets, 100 a llama (🟡 Core's:
// Epic's catalog held the amount; ten llamas, 500 V-Bucks, buy a Storm Llama). Returns how many for count llamas, 0 for
// any other offer.
export const ticketsPerUpgradeLlama = 100;
export function upgradeLlamaTickets(offer, count) {
  const upgradeLlama = offer.currencyType === "MtxCurrency" && offer.templateId.toLowerCase() === "cardpack:cardpack_bronze";
  return upgradeLlama && isEventActive(mutantStorms2018) && getItem(stormTickets) ? ticketsPerUpgradeLlama * count : 0;
}

// Whether the requesting build's Mini-Boss alerts run without Survive the Holidays (2.3's to 2.4.2's storms, and 4.0's
// Blockbuster: "Miniboss Mission Alerts are more common during this event", its MiniBossCategory rows on
// EventFlag.ActiveMiniBosses, placed and rewarded as 2.3's, world/theaters.js), and 6.00's Cram Session (placed as 2.3's,
// rewarded by events/cramsession2018.js).
export const miniBossesStay = () => isEventActive(mutantStorms2018) || isEventActive(blockbuster2018) || isEventActive(cramSession2018);
