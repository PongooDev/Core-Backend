import { getItem } from "../gamedata/items.js";
import { getQuest } from "../gamedata/quests.js";
import { isEventActive, spring2018, spring2018Phase3 } from "./events.js";

export { spring2018 };

// Spring It On! (2.5, CL-3889387, and 3.0, CL-3901517, its Luck Explosion chapter; events.js spring2018), Save the World's spring event: "Spring It On! begins with a tale
// of love in a storm-ridden world", "Firecracker Tickets ... Used to purchase Spring Llamas from the Loot tab", "Updated
// Loot Llamas to award Firecracker Tickets for the duration of the event", "Spring Llama is available in the Loot tab and
// costs 1000 Firecracker Tickets to purchase. Each Llama will contain a Lunar New Years Hero, or a Dragon weapon", and
// "Up to 3000 Seasonal Gold will be converted 3 to 1 into Firecracker Tickets, and any additional gold beyond that is
// lost ... Spring It On! Gold is also seasonal" (2.5's EventCurrency_Scaling is "Sprint It On! Gold", the notes' known
// issue, the Seasonal Gold item of 1.11 to 2.4.2 renamed). The Event Store stays open on it (store/eventstore.js).

// Firecracker Tickets (EventCurrency_Spring) and the Spring Llama they buy (CardPack_Event_2018_Spring, store/catalog.js).
export const firecrackerTickets = "AccountResource:eventcurrency_spring";
export const springLlama = "CardPack:cardpack_event_2018_spring";
export const seasonalGold = "AccountResource:eventcurrency_scaling";

// The event's quests nothing in 2.5's data grants (Epic's servers handed them out), granted at quest login while it runs:
// the first quest of each of its chains for the two phases 2.5 runs (events.js). The Valentine's phase's are the
// LoveQuest_2018 line (Reactive_Mailboxes, whose hidden rewards lead through Summer, Dennis, the song, the flowers and the
// chocolates to the teddy bears and "Love Trooper Jonesy, Legendary Soldier", HID_Commando_GunTough_Valentine_SR) and
// Val's (SpringQuest_2018_Reactive_RescueVal, through the tents, Summer's clothing, Dennis' gym stuff and tapes and the
// melee kills to the quotes and "New Legendary Melee Defender", CardPack_Spring_DefenderMelee_SR, Bruiser Val). The
// Lunar New Year's is Reactive_Fireworks, which grants the repeatable fireworks quest ("Spring It On! Gold ... Awarded
// for completing a repeatable Quest": 100 Gold, granting itself again) and the opt-in difficulty quest
// (Complete_BumpedDifficulty), leading through the lanterns to "Choice of three Legendary Dragon Ranged Weapon"
// (Complete_FireworkClusters). The rest of the line (Reactive_EggHunt, the clovers, the pub and the Mini-Boss finale) is
// the later phases', and SpringQuest_2018_StarterHidden is a test quest (quest_reactive_test1).
export const springQuests = [
  "lovequest_2018_reactive_mailboxes",
  "springquest_2018_reactive_rescueval",
  "springquest_2018_reactive_fireworks"
];
// 3.3's (CL-3942182) Luck of the Storm: "Uncover treacherous treasures, track mythical creatures..." starts at the pots of gold
// (SpringQuest_2018_Reactive_PotsOfGold, 7 pots, hidden reward the clovers quest, then the Leprechaun traps, the garden
// gnomes and the Pub quest), granted while EventFlag.Spring2018Phase3 runs (🟡: Epic's servers started it; Core grants it
// at quest login like the other chapters' first quests).
export const luckOfTheStormQuests = ["springquest_2018_reactive_potsofgold"];

// The requesting build's Spring It On! quests, when the event runs there.
export function springEventQuests() {
  if (!isEventActive(spring2018)) return [];
  const started = [...springQuests, ...(isEventActive(spring2018Phase3) ? luckOfTheStormQuests : [])];
  return started.filter((questId) => getQuest(questId));
}

// "Updated Loot Llamas to award Firecracker Tickets for the duration of the event": an Upgrade Llama (CardPack_Bronze,
// one or ten) bought while it runs also gives Firecracker Tickets, 100 a llama (🟡 Core's, as 2.3's Storm Tickets:
// Epic's catalog held the amount; ten llamas buy a Spring Llama). Returns how many for count llamas, 0 for any other
// offer.
export const firecrackersPerUpgradeLlama = 100;
export function upgradeLlamaFirecrackers(offer, count) {
  const upgradeLlama = offer.currencyType === "MtxCurrency" && offer.templateId.toLowerCase() === "cardpack:cardpack_bronze";
  return upgradeLlama && isEventActive(spring2018) && getItem(firecrackerTickets) ? firecrackersPerUpgradeLlama * count : 0;
}
