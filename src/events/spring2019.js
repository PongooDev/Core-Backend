import { currentBuild } from "../builds/context.js";
import { getQuest } from "../gamedata/quests.js";
import { seasonMoment, withoutSeasonStartRecording } from "../store/itemshop.js";
import { currentEventsConfig, isEventActive, scheduleEventFlags, spring2019, spring2019Flag, spring2019Phase1, spring2019Phase2 } from "./events.js";

export { spring2019, spring2019Flag, spring2019Phase1, spring2019Phase2 };

// Save the World's Spring 2019 (8.00, CL-5203069, 8.20, CL-5625478, 8.30, CL-5793395, and 8.40, CL-6005771; events.js spring2019). Two chapters on one quest
// map, QuestMap2's Spring2019QuestMap (8.20's FModel), each page shown while its row's QuestEventFlag is active:
// - Love Storm, pages LoveStorm01-04, EventFlag.Spring2019.Phase1. Update v8.00 (28 February 2019): "Love is in the air -
//   everybody run! Homebase has fallen victim to a virulent love outbreak". 15 LoveQuest_2019 quests from
//   Fetch_Telescopes to KillCollect_LoveLobbers, with Landmark_Trebuchet (MissionGen_YouSendMe, Landmark.LoveStorm).
// - Yarrr!, pages Yarrr!01-05, EventFlag.Spring2019.Phase2. Update v8.20 (27 March 2019): "Pirates have invaded
//   Homebase!", the "Yarrr!" questline, Corsair, Jack's Revenge and Blakebeard the Blackhearted. 15 PirateQuest_2019 quests
//   from Fetch_SeeBots to Fetch_Bottles, with Landmark_Island (MissionGen_PirateCove) and Landmark_WalkThePlank.
// EventFlag.Spring2019 is the event's own flag, served with both. 8.00's data already has the pirate quests (8.00 shipped
// Yarrr!'s content early), but Epic ran Yarrr! from 8.20, so 8.00 runs Love Storm only.
// Both chapters' quests pay Spring Tickets (and some Gold) themselves; the Pirate Llama they buy is the store's
// (store/catalog.js, Core-Backend #406/#407).
export const springTickets = "AccountResource:eventcurrency_spring";

// When each flag starts on Season 8's replay (store/itemshop.js seasonMoment), on which builds. 🟡 00:00 UTC (the notes
// give the days only). The ends aren't recorded: Love Storm isn't in Update v8.20's notes and Yarrr! isn't in any later
// Season 8 notes, so both run to Season 8's end (Love Storm, from the season's first day, all season); the replay then
// starts over without Yarrr! until its day comes round again.
// 8.30 keeps both chapters' flags and quests (its paks' LoveQuest_2019 and PirateQuest_2019 are 8.20's) and runs them as 8.20 does;
// 8.40 too (its quests are 8.30's), with two more Event Store heroes (store/eventstore.js).
export const spring2019Builds = { v800: 5203069, v820: 5625478, v830: 5793395, v840: 6005771 };
export const spring2019Chapters = [
  { flag: spring2019Flag, from: "2019-02-28T00:00:00.000Z", firstBuild: spring2019Builds.v800 },
  { flag: spring2019Phase1, from: "2019-02-28T00:00:00.000Z", firstBuild: spring2019Builds.v800 },
  { flag: spring2019Phase2, from: "2019-03-27T00:00:00.000Z", firstBuild: spring2019Builds.v820 }
];

// The events config's spring2019 (the admin panel's card): "dates" (Epic's days on Season 8's replay, the default), "on"
// (every chapter the build has, always) or "off".
export const spring2019Modes = ["dates", "on", "off"];
export const defaultSpring2019 = "dates";
export const sanitizeSpring2019 = (value, current = defaultSpring2019) =>
  (typeof value === "string" && spring2019Modes.includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() : current);

// Whether the build serves one of the event's flags now (events.js asks for each Spring2019 row it has). Reading the
// clock never starts Season 8's replay: event flags are asked for outside 8.x's own requests too (the admin panel).
export function spring2019FlagServed(flag, changelist = currentBuild(), now = new Date(), config = currentEventsConfig()) {
  const chapter = spring2019Chapters.find((candidate) => candidate.flag === flag);
  if (!chapter || Number(changelist) < chapter.firstBuild) return false;
  const mode = sanitizeSpring2019(config?.spring2019);
  if (mode !== "dates") return mode === "on";
  return withoutSeasonStartRecording(() => seasonMoment(now, null, 8)).getTime() >= Date.parse(chapter.from);
}

scheduleEventFlags(spring2019, (flag, changelist) => spring2019FlagServed(flag, changelist));

// The quests that start each chapter, given at quest login while its flag is served: the first quest of the map's first
// page (nothing in the data grants it; each quest's hidden reward grants the next), and the chapter's hidden video quest
// (Hidden_WatchVideo, a Client stat for the chapter's video, no reward), as Frostnite's.
export const loveStormQuests = ["lovequest_2019_fetch_telescopes", "lovequest_2019_hidden_watchvideo"];
export const yarrrQuests = ["piratequest_2019_fetch_seebots", "piratequest_2019_hidden_watchvideo"];

export function spring2019EventQuests() {
  return [...(isEventActive(spring2019Phase1) ? loveStormQuests : []), ...(isEventActive(spring2019Phase2) ? yarrrQuests : [])]
    .filter((questId) => getQuest(questId));
}

// The chapters' landmark missions (world/landmarks.js), each on a tile only a holder of its quest sees: the generator its
// primary mission's tag matches and the zone theme the generator's level is made for (8.20's world data).
export const spring2019Landmarks = [
  {
    questId: "lovequest_2019_landmark_trebuchet",
    missionGenerator: "/Game/World/MissionGens/MissionGen_YouSendMe.MissionGen_YouSendMe_C",
    zoneTheme: "/Game/World/ZoneThemes/Landmarks/ZT_Trebuchet/BP_ZT_Trebuchet.BP_ZT_Trebuchet_C"
  },
  {
    questId: "piratequest_2019_landmark_island",
    missionGenerator: "/Game/World/MissionGens/MissionGen_PirateCove.MissionGen_PirateCove_C",
    zoneTheme: "/Game/World/ZoneThemes/Landmarks/ZT_PirateCove/BP_ZT_PirateCove_Landmark.BP_ZT_PirateCove_Landmark_C"
  },
  {
    questId: "piratequest_2019_landmark_walktheplank",
    missionGenerator: "/Game/World/MissionGens/MissionGen_WalkThePlank.MissionGen_WalkThePlank_C",
    zoneTheme: "/Game/World/ZoneThemes/Landmarks/ZT_WalkthePlank/BP_ZT_TheLakeside_WalkthePlank.BP_ZT_TheLakeside_WalkthePlank_C"
  }
];
