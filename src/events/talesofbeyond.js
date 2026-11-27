import { getQuest } from "../gamedata/quests.js";
import { isEventActive, season9Flag, season9Phase1, season9Phase2, stellarHorizon, talesOfBeyond } from "./events.js";

export { season9Flag, season9Phase1, season9Phase2, stellarHorizon, talesOfBeyond };

// Save the World's Tales of Beyond (9.00, CL-6337466, Core-Backend #435). 9.00's QuestMapData has two event callouts:
// "TALES OF BEYOND" ("Join the hunt for a strange visitor beyond the bounds of reality!", EventCalloutQuestFlag
// EventFlag.Season9.Phase1) and "WARGAMES" (EventFlag.Outpost, events/wargames.js). Its quest pages are QuestMap2's
// Season9AQuestMap, TalesofBeyond01-04, each shown while EventFlag.Season9.Phase1 is active: 15 Quests/Events/Season9
// quests (category LTE_Season9A) from S9_Fetch_Quest_A1 ("Lok Out": "Lok has gone missing") to S9_GatherCollect_Quest_A15,
// each granting the next as its hidden reward. They pay Summer Tickets (AccountResource:eventcurrency_summer) and Gold;
// S9_Fetch_Quest_A9 gives the hero Paleo Luna (hid_ninja_029_dinoninja_sr_t01). EventFlag.Season9 is Season 9's own flag, served with it
// as EventFlag.Spring2019 is with its chapters.
// The S9_*_B quests (B0 to B15, with landmarks) are in 9.00's paks but on no quest map page of 9.00's to 9.10's: not given
// there. They are 9.20's Beyond the Stellar Horizon (below).
// The reporter's pirate line is Spring 2019's Yarrr! (PirateQuest_2019, events/spring2019.js): 9.00's paks still have the
// quests, but QuestMapData has no Spring2019QuestMap and EventFlag.Spring2019 is gone, so 9.00's quest map can't show it.
// 🟡 Epic's days aren't recorded: it runs on 9.00 throughout, as Wargames does.

// Summer Tickets (EventCurrency_Summer, "Summer Tickets"), which Tales of Beyond's and Wargames' quests pay, and the llama they buy:
// the Military Llama (CardPack_Event_2019_Military, new in 9.00's paks: "Guarantees at least one Epic or better limited
// time Military weapon or Hero!", store/catalog.js, Core-Backend #437).
export const summerTickets = "AccountResource:eventcurrency_summer";
export const militaryLlama = "CardPack:cardpack_event_2019_military";

// The quest that starts the line, given at quest login while the flag is served (nothing in 9.00's data grants it).
export const talesOfBeyondQuests = ["s9_fetch_quest_a1"];

// 9.20's (CL-6822798) Beyond the Stellar Horizon (Update v9.20: "Join the cast and crew of Beyond the Stellar Horizon as
// the VSS Gallant takes flight once more"): Season9SciFiQuestData's "BEYOND THE STELLAR HORIZON" callout and
// QuestMap2's Season9BQuestMap, five pages, each shown while EventFlag.Season9.Phase2 is active, of the 15 quests from
// S9_Fetch_Quest_B1 to S9_Fetch_Quest_B15, each granting the next as its hidden reward. They pay Summer Tickets, Gold and
// (S9_Fetch_Quest_B14) the Mythic outlander Azalea Clark (hid_outlander_028_retroscifistoryoutlander_sr_t01, the notes'
// "Available from the Beyond the Stellar Horizon quest line"). S9_Hidden_WatchVideo_B0 is on no page and nothing grants
// it. Tales of Beyond runs on beside it: 9.20's EventQuestMapSideBarData shows its row on Phase1 or Phase2. 🟡 Epic's days
// aren't recorded: on for all of 9.20, and of 9.21 (CL-6922310), whose quests are 9.20's.
export const stellarHorizonQuests = ["s9_fetch_quest_b1"];

export const talesOfBeyondEventQuests = () => [
  ...(isEventActive(season9Phase1) ? talesOfBeyondQuests.filter((questId) => getQuest(questId)) : []),
  ...(isEventActive(season9Phase2) ? stellarHorizonQuests.filter((questId) => getQuest(questId)) : [])];

// 9.20's Sci-Fi Llama (CardPack_Event_2019_Season9: "Guarantees at least one Epic or better limited time Sci-Fi weapon or
// Hero!", 9.10's placeholder pack renamed; store/catalog.js, cardpacks/contents.js): Update v9.20's "New Sci-Fi Llama is
// available in the store. Features 4 new Sci-Fi Heroes, and 5 new Sci-Fi Weapons. Costs 500 Summer Tickets".
export const sciFiLlama = "CardPack:cardpack_event_2019_season9";
