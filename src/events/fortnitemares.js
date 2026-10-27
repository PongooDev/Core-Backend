import { getQuest } from "../gamedata/quests.js";
import { fortnitemares, isEventActive } from "./events.js";

// Fortnitemares (Halloween 2017, 1.8): what the event gives on top of its flag (events/events.js).

// The event's quests nothing in the game data grants (Epic's servers handed them out while the event ran), granted at
// quest login while the event runs, for builds whose data has them:
// - HalloweenQuest_2017_Opener ("Hёxin'", 250 Candy): its hidden rewards start every other event quest, the chain the
//   front end's event pages show (Halloween_QuestMapWidget's HalloweenMapPage_01-05: the Opener, TtS_Intro, then the
//   Hexsylvania reactive quests);
// - HalloweenQuest_2017_Hidden_WatchVideo: HBOnboardingFlow plays the Hexsylvania movie (Announce_HexsylvaniaCine)
//   while this quest is in progress and completes it through its client objective;
// - HalloweenQuest_2017_EpicHeroes and _LegendaryHeroes: an Epic and a Legendary Fortnitemares hero to choose, for
//   finishing the Hex Files and Fetch 5 quests;
// - HalloweenQuest_2017_CompleteMissions_<n> ("Vlad World": 30 Hexsylvania missions in a 5+ ... 32+ zone, the
//   ZoneHarvest Fortnitemares hero): 14 variants, one per difficulty, of which Epic gave each player one. Core gives
//   the first, 5+ (🟡: how Epic chose the variant was its server's).
export const fortnitemaresQuests = [
  "halloweenquest_2017_opener",
  "halloweenquest_2017_hidden_watchvideo",
  "halloweenquest_2017_epicheroes",
  "halloweenquest_2017_legendaryheroes",
  "halloweenquest_2017_completemissions_1"
];

export const candy = "AccountResource:eventcurrency_candy";

// The requesting build's event quests, when the event runs there.
export function eventQuests() {
  return isEventActive(fortnitemares) ? fortnitemaresQuests.filter((questId) => getQuest(questId)) : [];
}
