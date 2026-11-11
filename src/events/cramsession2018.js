import { getItem } from "../gamedata/items.js";
import { getQuest } from "../gamedata/quests.js";
import { cramSession2018, isEventActive } from "./events.js";

export { cramSession2018 };

// Cram Session (6.00, CL-4395664 and CL-4402180; events.js cramSession2018), Save the World's Season 6 mini-event, Update
// v6.00: "Level-up and evolve your favorite items during the Cram Session mini event! Mini-Boss Mission Alerts are active,
// and up to 10 can be completed per day. For the duration of the event, Mini-Boss Mission Alerts will drop two XP,
// Evolution Material, Transform Keys or V-Bucks. Mini-Boss Mission Alerts will drop Gold instead of Tickets. Mini-Boss
// Mission Alerts will not drop Heroes, Schematics, Survivors, Mini Reward Llamas, Transform Keys or V-Bucks during this
// event. Added four quest lines, each of which has ten stages that grant increasingly better one time rewards upon
// completion, (Hero/Schematic/Survivor XP, Evolution Materials, PERK-UPs or Gold). Has repeatable quests that award
// Elemental PERK-UPs, RE-PERKs and Evolution Materials", and "Event Store will feature MEGA B.A.S.E. Kyle for the
// duration of Cram Session". It runs on 6.00 by its build, as Road Trip on 5.0 (🟡 its end: Update v6.00 doesn't date it;
// its Event Store items count down to Season 6's end on the replay, cramSession2018End).
//
// Its quests (Quests/Events/Autumn, QuestCategoryTable's Cram row), which nothing in 6.00's data grants (Epic's servers
// handed them out), granted at quest login while it runs:
// - the four lines' first stages, AutumnQuest_ExploreZones_1 ("Let's Explore": fully explore 3 zones in 5+ missions),
//   AutumnQuest_TreasureChests_1 ("Treasure Hunter": 3 chests), AutumnQuest_Safes_1 ("Safecracking": a safe, 300 Gold) and
//   AutumnQuest_KillHusks_1 ("The Air Itself is Filled with Husks": 500 husks); each stage's hidden reward is the next
//   (_2 to _10), so the rest of each line follows from the data;
// - GenericQuest_KillMiniBosses_Repeatable (a Mini-Boss alert's Mini-Boss, a TransientQuest): a choice of evolution
//   materials, granting itself again (its hidden reward).
// HalloweenQuest_KillVlad, new in 6.00's data too, is Fortnitemares 2018's (Update v6.20), not Cram Session's.
export const cramSessionQuests = ["autumnquest_explorezones_1", "autumnquest_treasurechests_1", "autumnquest_safes_1",
  "autumnquest_killhusks_1", "genericquest_killminibosses_repeatable"];

// The requesting build's Cram Session quests, when the event runs there.
export const cramSessionEventQuests = () => (isEventActive(cramSession2018) ? cramSessionQuests.filter((questId) => getQuest(questId)) : []);

// Its Event Store (store/eventstore.js): MEGA B.A.S.E. Kyle (HID_Constructor_BASEBig_SR_T01, "MEGABASE Kyle" in 6.00's
// data, a Mythic Constructor) at the Fortnite Wiki's 3,200 Gold ("available for purchase in the Event Store for 3,200
// Gold, for the duration of Cram Session"), one (🟡 the limit is Core's, as Ragnarok's). Its trackers are
// CramSession2018.* (Core's name: the event store's instance ids are the backend's).
export const cramSessionEventItems = [{ templateId: "Hero:hid_constructor_basebig_sr_t01", price: 3200, limit: 1 }];
// 🟡 Update v6.00 doesn't say when Cram Session ended: its items count down to the end of Season 6 (Season 7 began on 6
// December 2018), on Season 6's replay.
export const cramSession2018End = "2018-12-06T00:00:00.000Z";

// Its Mini-Boss alerts (world/theaters.js, MissionAlert_MiniBoss): "two XP, Evolution Material" (the Fortnite Wiki's Cram
// Session: "additional XP, Evolution Materials, RE-PERK!, or PERK-UP! rewards instead of one") and Gold "instead of
// Tickets", without the heroes, schematics, survivors, llamas, transform keys or V-Bucks the alerts give otherwise. So an
// alert gives the zone's evolution material pack as always, two picks rolled from its seed (pick, a function the caller
// passes: (choices, seed) => one choice) among the tier's Hero, Schematic and Survivor XP packs, the zone's evolution
// pack and, from Plankerton, a RE-PERK! or the zone's PERK-UP! pack (perkPacks), and Gold by the alert row's zone as
// Blockbuster's tickets were (🟡 Core's: 50, 70, 90, 120; the notes give no amount).
const goldByZone = [50, 70, 90, 120];
export const cramSessionGold = (zone) => goldByZone[Math.min(Math.max(zone, 1), goldByZone.length) - 1];
export function cramSessionMiniBossRewards(zone, tier, seed, { pick, perkPacks, gold }) {
  const evolution = [`CardPack:zcp_reagent_c_t0${zone}_high`, 1];
  const choices = [...["heroxp", "schematicxp", "personnelxp"].map((kind) => [`CardPack:zcp_${kind}_t${tier}`, 1]), evolution, ...perkPacks]
    .filter(([templateId]) => getItem(templateId));
  const picks = choices.length ? [pick(choices, `${seed}:cram:1`), pick(choices, `${seed}:cram:2`)] : [];
  // The same pack twice is one reward of twice the quantity.
  const merged = new Map();
  for (const [templateId, quantity] of [evolution, ...picks, ...(getItem(gold) ? [[gold, cramSessionGold(zone)]] : [])]) {
    merged.set(templateId, (merged.get(templateId) ?? 0) + quantity);
  }
  return [...merged];
}
