import { getQuest } from "../gamedata/quests.js";
import { isEventActive, season9Flag, season9Phase1, talesOfBeyond } from "./events.js";

export { season9Flag, season9Phase1, talesOfBeyond };

// Save the World's Tales of Beyond (9.00, CL-6337466, Core-Backend #435). 9.00's QuestMapData has two event callouts:
// "TALES OF BEYOND" ("Join the hunt for a strange visitor beyond the bounds of reality!", EventCalloutQuestFlag
// EventFlag.Season9.Phase1) and "WARGAMES" (EventFlag.Outpost, events/wargames.js). Its quest pages are QuestMap2's
// Season9AQuestMap, TalesofBeyond01-04, each shown while EventFlag.Season9.Phase1 is active: 15 Quests/Events/Season9
// quests (category LTE_Season9A) from S9_Fetch_Quest_A1 ("Lok Out": "Lok has gone missing") to S9_GatherCollect_Quest_A15,
// each granting the next as its hidden reward. They pay Summer Tickets (AccountResource:eventcurrency_summer) and Gold;
// S9_Fetch_Quest_A9 gives the hero Paleo Luna (hid_ninja_029_dinoninja_sr_t01). EventFlag.Season9 is Season 9's own flag, served with it
// as EventFlag.Spring2019 is with its chapters.
// The S9_*_B quests (B0 to B15, with landmarks) are in 9.00's paks but on no quest map page of 9.00's: not given.
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

export const talesOfBeyondEventQuests = () =>
  (isEventActive(season9Phase1) ? talesOfBeyondQuests.filter((questId) => getQuest(questId)) : []);
