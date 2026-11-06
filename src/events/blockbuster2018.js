import { getItem } from "../gamedata/items.js";
import { getQuest } from "../gamedata/quests.js";
import { blockbuster2018, isEventActive } from "./events.js";

export { blockbuster2018 };

// Blockbuster (4.0, CL-4039451; events.js blockbuster2018), Save the World's first Season 4 event: "Blockbuster Event -
// Part 1: Origin Story ... There are reports of a strange new husk lurking about harassing survivors and Ray has
// disappeared!", "Blockbuster Tickets can be found inside Upgrade and Daily Llamas, and earned by completing quests and
// defeating Miniboss mission alerts", "Blockbuster Llama is available in the Loot Tab ... Costs 500 Blockbuster Tickets",
// "Completing the first week of quests rewards a choice of one Legendary Ranged Weapon (Bald Eagle, Silenced Specter, or
// Crossbow)" and "Repeatable Quest to kill a miniboss that awards 50 Gold". Its tickets are
// AccountResource:EventCurrency_Blockbuster ("Blockbuster Tickets"), its gold AccountResource:EventCurrency_Scaling, which
// 4.0 renames "Gold" ("Gold no longer resets each season. Seasonal Gold has been renamed to Gold.") and caps at 5,000 (its
// MaxStackSize: "Gold caps at 5000").
export const blockbusterTickets = "AccountResource:eventcurrency_blockbuster";

// The Blockbuster Llama (CardPack_Event_2018_Blockbuster, "Guarantees at least one Epic or better limited time Military
// weapon or Hero!"), store/catalog.js.
export const blockbusterLlama = "CardPack:cardpack_event_2018_blockbuster";

// The event's quests nothing in 4.0's data grants (Epic's servers handed them out), granted at quest login while it runs:
// - Part 1's line, "Five quests and one Landmark Mission": Reactive_CometShards (11 comet shards, 250 tickets) leads to
//   Landmark_Comet (100 V-Bucks), then Reactive_Flyers, Reactive_Bees and Reactive_ChromeHuskData (250 tickets each),
//   and Reactive_RaySignal, the notes' choice of the Crossbow, the Bald Eagle or the Silenced Specter
//   (CardPack_Sniper_Crossbow / Pistol_HandCannon_DE / Assault_SMG_Silenced_Military_SR);
// - Hidden_WatchVideo counts the event's video (a hidden quest, no reward);
// - KillMiniBosses_Repeatable, the notes' repeatable Mini-Boss quest: 50 Gold, granting itself again.
// Hidden_EnableHusky waits for TestQuestBlockbuster2018 (100,000,000 Smasher kills, a test quest), so neither is given.
export const blockbusterQuests = [
  "blockbusterquest_2018_reactive_cometshards",
  "blockbusterquest_2018_hidden_watchvideo",
  "blockbusterquest_2018_killminibosses_repeatable"
];

// The requesting build's Blockbuster quests, when the event runs there.
export const blockbusterEventQuests = () => (isEventActive(blockbuster2018) ? blockbusterQuests.filter((questId) => getQuest(questId)) : []);

// "Miniboss Mission Alerts are more common during this event and award between 50 and 120 Blockbuster Tickets, scaled
// based on difficulty. These tickets are granted in addition to their normal rewards" (world/theaters.js): by the alert
// row's zone, Stonewood 50, Plankerton 70, Canny Valley 90, Twine Peaks 120 (🟡 Core's steps between the notes' ends).
const ticketsByZone = [50, 70, 90, 120];
export const miniBossTicketsFor = (zone) => ticketsByZone[Math.min(Math.max(zone, 1), ticketsByZone.length) - 1];

// "Blockbuster Tickets can be found inside Upgrade and Daily Llamas": an Upgrade Llama (CardPack_Bronze, one or ten)
// bought while the event runs also gives Blockbuster Tickets, 100 a llama (🟡 Core's, as 2.3's Storm Tickets and 2.5's
// Firecracker Tickets: Epic's loot tables held the amount; five llamas buy a Blockbuster Llama). Returns how many for
// count llamas, 0 for any other offer.
export const blockbusterTicketsPerUpgradeLlama = 100;
export function upgradeLlamaBlockbusterTickets(offer, count) {
  const upgradeLlama = offer.currencyType === "MtxCurrency" && offer.templateId.toLowerCase() === "cardpack:cardpack_bronze";
  return upgradeLlama && isEventActive(blockbuster2018) && getItem(blockbusterTickets) ? blockbusterTicketsPerUpgradeLlama * count : 0;
}
