import { pageId } from "../collectionbook/pages.js";
import { getQuest } from "../gamedata/quests.js";
import { fortnitemares, isEventActive } from "./events.js";
import { mutantStormsEventQuests } from "./mutantstorms.js";

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

// The requesting build's event quests, when the event runs there (and the Mutant Storms', events/mutantstorms.js).
export function eventQuests() {
  return [...(isEventActive(fortnitemares) ? fortnitemaresQuests.filter((questId) => getQuest(questId)) : []), ...mutantStormsEventQuests()];
}

// The event's collection book pages, the "Fortnitemares Items" category (CollectionCategoryTable Halloween2017): its
// heroes (Skull Trooper Jonesy, Marine Corpse Ramirez...) and its survivors (the Monster 'Cosplayer' packs' husks,
// trolls...), whose Super Rare section gives the Jack-O-Launcher.
// The client lists a page only once its book profile holds the page item (collectionbook/pages.js; 1.8's
// UFortCollectionBookPage init sub_4F7260 reads the row named by the item and nothing else), and nothing in 1.8's data
// grants these: homebaseonboarding's hidden rewards unlock the 32 standard pages only, and no quest, card pack or
// book reward names a PageSpecial_* page. 🟡 Epic's servers gave them while the event ran; Core gives them to every
// book profile of a build that runs the event (profiles/setup.js), when the book first loads there.
export const fortnitemaresPages = ["PageSpecial_Halloween2017_Heroes", "PageSpecial_Halloween2017_Workers"];

// The requesting build's event pages, when the event runs there.
export function eventBookPages() {
  return isEventActive(fortnitemares) ? fortnitemaresPages.map(pageId).filter(Boolean) : [];
}
