import { getQuest } from "../gamedata/quests.js";
import { birthday2018, isEventActive } from "./events.js";

export { birthday2018 };

// The Fortnite Birthday (5.10, CL-4225813 and CL-4240749; events.js birthday2018), Save the World's side (Update v5.10):
// "Celebrate #Fortnite1st with cake, loot, and a special in-game questline. Complete the questline to unlock Birthday
// Brigade Ramirez. While you're partying, find and eat birthday cakes to earn event tickets which can be spent on the
// limited time Birthday Llama", "New Fortnite Birthday quests! Find and eat Birthday Cakes to earn event tickets. Eliminate
// Cake Sploders to earn a Birthday Hero." The Fortnite Wiki's Fortnite 1st Birthday: 24 July to 7 August 2018.
//
// Its quests (Quests/Events/Anniversary2018), which nothing in 5.10's data grants (Epic's servers handed them out), granted
// at quest login while it runs:
// - AnniversaryQuest_2018_Kill_Cake_Sploders ("Sploding Husks": 50 sploders in successful missions): Birthday Brigade
//   Ramirez (HID_Commando_010_Bday_SR_T01, "Birthday Brigade Ramirez", a Legendary Sergeant);
// - AnniversaryQuest_2018_Complete_Cake_Repeatable (5 cakes in successful missions, a TransientQuest): 100 Road Trip
//   Tickets, granting itself again (its hidden reward).
export const birthdayQuests = ["anniversaryquest_2018_kill_cake_sploders", "anniversaryquest_2018_complete_cake_repeatable"];

// The Birthday Llama (CardPack_Event_2018_Anniversary, "Birthday Llama"): "Awards past event items from Llamas and Event
// Store, but not from Quest Rewards ... Cost: 1,000 Road Trip tickets" (store/catalog.js).
export const birthdayLlama = "CardPack:cardpack_event_2018_anniversary";
export const birthdayLlamaPrice = 1000;

// The requesting build's Birthday quests, when the event runs there.
export const birthdayEventQuests = () => (isEventActive(birthday2018) ? birthdayQuests.filter((questId) => getQuest(questId)) : []);
