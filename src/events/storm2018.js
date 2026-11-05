import { getQuest } from "../gamedata/quests.js";
import { isEventActive, storm2018 } from "./events.js";

export { storm2018 };

// Into the Storm (3.5.1, CL-4000805; events.js storm2018), Save the World's event after Spring It On!: "New Questline:
// Into the Storm: Opening Act ... Accompany Lars and Ray on their journey into Lars' past", "Into the Storm Llama is
// available in the Loot Tab. Cost: 1000 Storm Tickets. Event Llama guarantees at least one Epic (or higher) Neon Weapon or
// Cyberpunk Hero", "Survive the Storm returns!" and "Mutant Storms are more active during this event and award between
// 100 and 240 Storm Tickets". Its tickets are Storm Tickets again (EventCurrency_StormZone, events/mutantstorms.js), its
// gold still Spring It On! Gold ("Added Spring It On! Gold, scaled by difficulty and number of days completed"), so the
// Event Store stays open on it (store/eventstore.js).

// The Into the Storm Llama (CardPack_Event_2018_Storm, "Guarantees at least one Epic or better limited time Neon weapon or
// Hero!"), store/catalog.js.
export const intoTheStormLlama = "CardPack:cardpack_event_2018_storm";

// The event's quests nothing in 3.5's data grants (Epic's servers handed them out), granted at quest login while it runs:
// every StormQuest_2018 quest no other quest names as a reward.
// - The Opening Act's line starts at Reactive_ServiceCars (20 service cars, then the research, the husk data, the records,
//   the speakers, the equipment, the maps, the AC parts and the hoverboards) and ends at Reactive_SkyAtlases, the notes'
//   "Choice of Legendary Ranged Neon Weapon (Pistol, Shotgun, Assault)" (CardPack_Pistol/Shotgun/Assault_NeonGlow_SR).
// - Hidden_1 waits for the sky atlases and starts the rest: the telescopes, the payphones, the insulators, Landmark_Lars
//   (MissionGen_RtL_StormQuest2018Landmark; 3.5's zone themes ZT_IntotheStorm/BP_ZT_LaunchingLars and
//   BP_ZT_ObserveTheSkies), the servers and Landmark_Observe, whose reward is the choice of the four Legendary Cyberpunk heroes (Bullet Storm Jonesy, Heavy BASE Kyle, Harvester
//   Sarah, T.E.D.D. Shot Jess).
// - Hidden_WatchVideo counts the event's video (a hidden quest, no reward).
// - The notes' side quests: CompleteSurviveAny (three Survivals, 1,000 Storm Tickets) and CompleteSurvive7Day_D1 to _D3
//   ("Power 15/40/70 Event Themed Banner + 1000 Storm Tickets": a 7-Day Survival on each difficulty, CardPack_Storm2018_
//   Banner_Easy/_Med/_Hard), and CompleteStormZones_Repeatable ("Repeatable Quest to complete 2 Mutant Storm Mission Alerts
//   that awards 100 Spring It On! Gold", granting itself again).
export const intoTheStormQuests = [
  "stormquest_2018_reactive_servicecars",
  "stormquest_2018_hidden_1",
  "stormquest_2018_hidden_watchvideo",
  "stormquest_2018_completesurviveany",
  "stormquest_2018_completesurvive7day_d1",
  "stormquest_2018_completesurvive7day_d2",
  "stormquest_2018_completesurvive7day_d3",
  "stormquest_2018_completestormzones_repeatable"
];

// The requesting build's Into the Storm quests, when the event runs there.
export const stormEventQuests = () => (isEventActive(storm2018) ? intoTheStormQuests.filter((questId) => getQuest(questId)) : []);
