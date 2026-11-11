import { currentBuild } from "../builds/context.js";
import { getItem } from "../gamedata/items.js";
import { getQuest } from "../gamedata/quests.js";
import { seasonMoment } from "../store/itemshop.js";
import { isEventActive, roadTrip2018 } from "./events.js";

export { roadTrip2018 };

// Road Trip (5.0, CL-4204761 and CL-4214610, 5.10's two builds, 5.21, 5.30 and 5.40; events.js roadTrip2018), Save the World's first Season 5 event, and with it
// Challenge the Horde's return (Core-Backend #298, Update v5.00's notes): "Challenge the Horde is back! Challenge the
// Horde comes to the desert!", "Reduced the total number of Challenge the Horde missions available on the map from 16 to
// 9", "Challenge the Horde missions now become unlocked based upon your Storm Shield Defense progression or your Horde Quest
// progression in the Campaign", "Challenge the Horde Mission Alerts are available: Award Road Trip Tickets used to purchase
// Road Trip Event Llamas. Award Horde Skill Points used to purchase nodes in the Horde Skill Tree. Quota: 10 per day", and
// "Horde Progression quests appear under the Event: Road Trip quest journal category and award the following: Road Trip
// Tickets, V-bucks, PERK currencies, a choice of Epic and Legendary Wild West Heroes, Horde Exclusive Banners."
//
// Its tickets are AccountResource:EventCurrency_RoadTrip ("Road Trip Tickets"), its llama CardPack_Event_2018_RoadTrip
// ("Road Trip Llama", 500 tickets: store/catalog.js), the Horde Skill Tree's points Token:HordePointsTier1-4 ("Tier 1 Horde
// Points"...: what the T1_Horde_* to T4_Horde_* nodes of CCNodePages' Horde page cost, one each).
export const roadTripTickets = "AccountResource:eventcurrency_roadtrip";
export const roadTripLlama = "CardPack:cardpack_event_2018_roadtrip";
export const hordePoints = (zone) => `Token:hordepointstier${Math.min(Math.max(zone, 1), 4)}`;

// The event's quests nothing in 5.0's data grants (Epic's servers handed them out), granted at quest login while it runs:
// - HordeQuest_HordeUnlock (100 tickets) completes once the account holds HomebaseNode:T1_Horde_99587FCCD, the Horde
//   page's free first node (its quest: Storm Shield Defense 3, OutpostQuest_T1_L3). Its hidden reward starts
//   HordeQuest_BuildBase ("Build the Fort", 150 tickets), and that the progression: Stonewood_1, _3 and _4, Plankerton_1-5,
//   Canny_1-5, Twine_1-14 (QuestRewards: tickets, V-Bucks, RE-PERK! and PERK-UP!, Plankerton_3's choice of an Epic and
//   Canny_2's of a Legendary Wild West hero, each zone's last quest its HordeBanner card pack and a repeatable XP quest).
//   Stonewood_2 is in no quest's rewards and counts nothing (an empty stat row), so it isn't given.
// - HordeQuest_Hidden_0-7, the horde theater's zone gates (world/horde.js): each is done by one of its two objectives
//   (ObjectiveCompletionCount 1), a Storm Shield Defense or a Horde progression quest, the notes' "Storm Shield Defense
//   progression or your Horde Quest progression".
export const roadTripQuests = [
  "hordequest_hordeunlock",
  ...Array.from({ length: 8 }, (_, index) => `hordequest_hidden_${index}`)
];

// The Weekly Horde Challenges (Update v5.20: "Each week during the run of the Road Trip event, there will be a new Weekly
// Challenge mission in the Challenge the Horde zone ... Weekly Horde Challenge 1: Minibosses"; Update v5.21: "Weekly Horde
// Challenge - Bullet Proof Husks ... One time completion Quest Reward 1500 Gold ... Repeatable quest reward 75 Tickets").
// 5.21's data has both weeks: MissionGen_WeeklyHordeChallenge_01 and _02 (MissionInfo_WeeklyHordeChallenge_01/_02, tagged
// Stat.Mission.Weekly.Horde.Week01/02), each week's four zone themes (World/ZoneThemes/Horde/Challenges' MiniBossArmy and
// RangeImmune, _SW, _Plank, _Canny and _Twine) and difficulty rows (Theater_Horde_Stonewood_Weekly, _Plankerton_Weekly,
// _Uncanny_Weekly, _Final_Weekly: 15, 28, 58 and 76 power), and the week's quests: HordeQuest_Hidden_Weekly<n> (done by
// Storm Shield Defense 3, OutpostQuest_T1_L3) gives HordeQuest_Weekly<n>_Stonewood1, and _Plankerton1, _Canny1 and
// _Twine1 are in no quest's rewards (Epic's servers handed them out); each is done by wave 8 of its zone's weekly mission
// (WaveComplete, the week's tag, Zone.Difficulty 10, 16, 26, 32) and gives its repeatable (75 Road Trip Tickets) besides
// week 1's choice of a Legendary Flintlock and week 2's 1,500 Gold. A build runs the newest week its data has (5.21: week
// 2, its notes'), its hidden quest and the three others given at quest login while Road Trip runs, and its four missions
// in the horde theater (world/horde.js).
// 5.30's data (CL-4305896) has weeks 3 and 4 too: Update v5.30's "Horde Weekly Challenge 3 is now available! ... 16 waves
// of shorter wave phases, less time to prepare and faster enemies ... choose from two legendary Flintlock weapons"
// (HordeQuest_Weekly3_*: Wave = 16, the Flintlock Walloper or Scythe; World/ZoneThemes/Horde/Challenges/EnduranceMode)
// and Content Update v5.30's "Weekly Horde Challenge 4 ... Available August 29, at 8 PM ET ... Husks will not trigger
// traps ... Win a Legendary Redline Ramirez" (HordeQuest_Weekly4_*: Redline Ramirez; Challenges/Untrappable), each
// repeatable for 75 Road Trip Tickets. Its stat rows count them by the theater's tags now (Stat.Theater.Weekly.Horde.WeekA
// and WeekB, and Stat.Theater.Horde for the nine zones' quests, where 5.21's counted Stat.Mission.*): world/horde.js.
// A week with a start (weeklyHordeStarts, Epic's time) runs from then on Season 5's replay, so 5.30 runs week 3 until 30
// August 00:00 UTC (8 PM ET on 29 August) and week 4 from then; the others from the build's release.
// 5.40's data (CL-4352937) has weeks 5 to 7: Update v5.40's "Horde Weekly Challenge 5 ... buff Husks ... bat players away
// with strong knockbacks ... Win 1500 Gold" (HordeQuest_Weekly5_*: 1,500 Gold; Challenges/Indesctructible), Content Update
// v5.40's "Weekly Horde Challenge 6 ... Available Wednesday, September 12 at 8 PM ET ... players have no shields ... Earn
// Field Agent Rio" (HordeQuest_Weekly6_*: Field Agent Rio, HID_Outlander_Myth03_SR_T01; Challenges/NoShields) and Update
// v5.41's "Weekly Horde Challenge 7 ... immune to crowd control effects ... Earn 1500 Gold ... Available Wednesday,
// September 19th at 8 PM ET" (HordeQuest_Weekly7_*; Challenges/CCImmune, GM_Enemy_CCImmune "Unstoppable Husks"), each
// repeatable for 75 Road Trip Tickets, counted by Stat.Theater.Weekly.Horde.WeekA, WeekB and (new) WeekC. So 5.40 runs
// week 5 until 13 September 00:00 UTC, week 6 until 20 September 00:00 UTC and week 7 from then.
export const weeklyHordeWeeks = [1, 2, 3, 4, 5, 6, 7];
export const weeklyHordeQuests = (week) => [`hordequest_hidden_weekly${week}`,
  ...["plankerton", "canny", "twine"].map((zone) => `hordequest_weekly${week}_${zone}1`)];
export const weeklyHordeStarts = { 4: "2018-08-30T00:00:00.000Z", 6: "2018-09-13T00:00:00.000Z", 7: "2018-09-20T00:00:00.000Z" };
export const weeklyHordeWeek = (now = new Date()) => [...weeklyHordeWeeks].reverse().find((week) => getQuest(`hordequest_hidden_weekly${week}`)
  && (!weeklyHordeStarts[week] || seasonMoment(now, null, 5).getTime() >= Date.parse(weeklyHordeStarts[week]))) ?? null;
// Every week's, for the event's quest line (events/quests.js).
export const roadTripLineQuests = [...roadTripQuests, ...weeklyHordeWeeks.flatMap(weeklyHordeQuests)];

// The requesting build's Road Trip quests, when the event runs there: with its Weekly Horde Challenge's.
export const roadTripEventQuests = (now = new Date()) => {
  if (!isEventActive(roadTrip2018)) return [];
  const week = weeklyHordeWeek(now);
  return [...roadTripQuests, ...(week ? weeklyHordeQuests(week) : [])].filter((questId) => getQuest(questId));
};

// "Award Road Trip Tickets ... Award Horde Skill Points ... Perk Recombobulator materials are now distributed in Challenge
// the Horde including RE-PERK! or PERK-UP! in larger quantities than found in Campaign missions" (the Fortnite Wiki's
// Challenge the Horde): a Horde alert (MissionAlert_HordeCategory_01, loot tier group HordeBash_MissionAlert, every tile
// difficulty) gives, by its mission's difficulty row, 5 Road Trip Tickets a tile difficulty, 2 of its zone's Horde Points
// and, from Plankerton's zones, 50 RE-PERK! a zone (🟡 Core's amounts: no shipped table has the group, Epic's servers rolled
// it). A zone here is the difficulty row's, Theater_Horde_Stonewood_* 1, _Plankerton_* 2, _Uncanny_* 3, _Final 4.
export const hordeZoneOf = (rowName) => (/_Stonewood_/.test(rowName ?? "") ? 1 : /_Plankerton_/.test(rowName ?? "") ? 2
  : /_Uncanny_/.test(rowName ?? "") ? 3 : /_Final$/.test(rowName ?? "") ? 4 : 1);
// 5.10 (CL-4225813): "Perk Combobulator resource rewards increased +50% across all Horde reward tiers", so 75 RE-PERK! a
// zone there. Its "Gold reward doubled across all Horde reward tiers" changes nothing of Core's: no Horde reward is Gold.
export const hordePerkBoostBuild = 4225813;
export function hordeAlertRewards(rowName, difficulty) {
  const zone = hordeZoneOf(rowName);
  const perkPerZone = Number(currentBuild()) >= hordePerkBoostBuild ? 75 : 50;
  return [
    ...(getItem(roadTripTickets) ? [[roadTripTickets, 5 * Math.max(1, difficulty ?? 1)]] : []),
    ...(getItem(hordePoints(zone)) ? [[hordePoints(zone), 2]] : []),
    ...(zone >= 2 && getItem("AccountResource:reagent_alteration_generic") ? [["AccountResource:reagent_alteration_generic", perkPerZone * zone]] : [])
  ];
}

// A Horde mission's own rewards (its HordeBash_<zone>_<level> loot tier group, which no world info Core has): its zone's
// Horde Points, which the reward chest's level multiplies (world/theaters.js missionRewardQuantity: 1 to 6 for a full run),
// and from Plankerton the zone's RE-PERK! pack (🟡 Core's: Epic's tiers were its own; 5.10's "Gold reward doubled across all
// Horde reward tiers" and "Perk Combobulator resource rewards increased +50% across all Horde reward tiers" are later).
const perkLevels = ["", "", "low", "medium", "high"];
export function hordeMissionRewards(rowName) {
  const zone = hordeZoneOf(rowName);
  const perk = zone >= 2 ? `CardPack:zcp_reagent_alteration_generic_${perkLevels[zone]}` : undefined;
  return [
    ...(getItem(hordePoints(zone)) ? [{ itemType: hordePoints(zone), quantity: 1 }] : []),
    ...(perk && getItem(perk) ? [{ itemType: perk, quantity: 1 }] : [])
  ];
}
