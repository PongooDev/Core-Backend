import { getQuest } from "../gamedata/quests.js";
import { isEventActive, mutantStorms } from "./events.js";

export { mutantStorms };

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
