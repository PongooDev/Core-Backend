import { anniversary2018BR, blockLanded, blockRiskyReels, blockSlab, cubeDestination, cubeLake, cubeLightning, cubeMoveTo, cubeMoveToLake,
  cubeRune, cubeStartMove, cubeTurnOn, distantFogApproach, distantFogApproach630, distantFogOverlap, distantFogOverlap630, eventsActiveUntil, fortnitemaresDecor621, holidayDecor710, holidayDecorProps710,
  festivusCountdown, festivusLevel, festivusShow, iceKingClock, iceKingCountdown, iceKingCountdownCheck, iceKingIceLegion, iceKingLeadUp, iceKingLoadLevel, iceKingLoadSequence, iceKingStorm, iceKingStormPast,
  iceKingVisible, iceKingWarning, iceStormSnowMelt, islandCrack, islandDrain, islandMoveTo, islandPoi, islandRune, ltm14DaysOfFortnite, ltmHeist, lteFestivus, ltm14DaysOfSummer,
  lteBootyBay, lteS7Overtime, lteS8ExtraCredit, ltmAshton, ltmGoose, ltmHighStakes, ltmMash, ltmVigilante, ltmWax, ltmWinterDeimos, riftCorrupt, s8Burnt, s8Cracked, s8Cracks, s8Heat, s8Tremors, tomatoRiftEvent, tomatoRiftTell, unvaultingAfter, unvaultingCountdown, unvaultingEvent,
  unvaultingDay, unvaultingLevel, unvaultingRune, unvaultingRuneWarmup } from "./events.js";

// 7.10's 14 Days of Fortnite challenge bundle's CalendarEventName (QuestBundle_14DaysOfFortnite).
export const fourteenDaysCalendarEvent = "CalendarEvent_Season7_14DaysOfFortnite";
// 7.20's Ice Storm Challenges bundle's (QuestBundle_WinterDeimos).
export const iceStormCalendarEvent = "CalendarEvent_Season7_WinterDeimos";
// 7.30's Showtime Challenges bundle's (QuestBundle_Festivus, and Schedule_Festivus's).
export const showtimeCalendarEvent = "CalendarEvent_Season7_Festivus";
// 7.40's Overtime Challenges bundle's (QuestBundle_S7_Overtime, and Season7_OT_Schedule's).
export const overtimeCalendarEvent = "CalendarEvent_Season7_OverTime";
// 8.20's Schedule_LTM_Heist_V2 names its calendar event beside its flag (CalendarEventName).
export const highStakes2019CalendarEvent = "CalendarEvent_Season8_HighStakes";
// 8.30's Schedule_PirateParty (the Buccaneer's Bounty Challenges) the same way.
export const buccaneersBountyCalendarEvent = "CalendarEvent_Season8_BootyBay";
// 8.40's Schedule_LTM_Goose (the Air Royale Challenges) the same way.
export const airRoyaleCalendarEvent = "CalendarEvent_Season8_AirRoyale";
// 8.50's Schedule_LTM_Ashton (the Endgame Challenges) the same way.
export const endgameCalendarEvent = "CalendarEvent_Season8_Ashton";
// 8.51's Season8_ExtraCredit_Schedule (the Season 8 Overtime Challenges) the same way, its bundle's flag beside it.
export const extraCreditCalendarEvent = "CalendarEvent_Season8_ExtraCredit";
// 9.01's Schedule_LTM_Wax (the Wick's Bounty Challenges) the same way.
export const wicksBountyCalendarEvent = "CalendarEvent_Season9_Wax";
// 9.10's BundleSchedule_Event_VigilanteBoard (the Downtown Drop Challenges) the same way.
export const downtownDropCalendarEvent = "CalendarEvent_Season9_Vigilante";
// 9.21's Schedule_LTM_Mash (the Horde Rush Challenges) the same way.
export const hordeRushCalendarEvent = "CalendarEvent_Season9_Mash";
// 9.30's Schedule_14DaysOfSummer (the 14 Days of Summer Challenges) the same way.
export const fourteenDaysSummerCalendarEvent = "CalendarEvent_Season9_14DaysOfSummer";

// Season 5's small dated event-flag events, step by step, and the admin's own times for them (Core-Backend #311): 5.21's
// Tomato Town rift (events/tomatorift.js), 5.30's Cube (events/cube.js; 5.40's and 5.41's too) and 5.40's High Stakes
// (events/highstakes.js; 5.41's paks keep it); and Season 6's floating island (6.00 to 6.20, events/island.js), 6.21's
// Butterfly (events/butterfly.js) and 6.30's snowstorm and 6.31's iceberg (events/distantfog.js), on Season 6's replay;
// and The Block of 7.00 and 7.10 (events/block.js) on Season 7's (an event's `season`, 5 without one). Each step is one
// or more calendar events served from its start to its end (null: on to the replay's end, or, on the admin's own times, for good). The events config's
// datedFlags.<event> picks the times:
// - "dates": Epic's dates on its season's replay (store/itemshop.js seasonMoment), lap by lap (the default);
// - "custom": the admin's own times [{step, startAt, endAt}] (ISO; endAt null: stays on), which stay, as the custom rift
//   times of events/season4flags.js do; a step without times isn't served;
// - "off": none of its steps (the flags still switch by hand, events/season4flags.js);
// - "build" (the Birthday Challenges only, its default): as the build serves the flag by itself (events/events.js: 5.10
//   always, counting down to 7 August on the replay, events/birthday2018.js; 5.21 never).
// The Butterfly is off by default, as the rocket's launch waits for its time (events/rocketlaunch.js): 6.21 then serves
// POI0 by itself and the rest by the switches.
// The Battle Royale event challenges (Core-Backend #316) are two of them: 5.10's Birthday Challenges and 5.40's High
// Stakes Challenges (an event's `challenges`, its ChallengeBundleSchedule), given at the quest login while their flag is
// served (profiles/athena.js settleEventSchedules) and counting down to its activeUntil; the admin panel shows them apart.
// 4.5's rifts have their own times already (events/season4flags.js's oddities schedule) and the rocket its launch time
// (events/rocketlaunch.js).
export const season5FirstDay = Date.parse("2018-07-12T00:00:00.000Z");
export const season5EndDay = Date.parse("2018-09-27T00:00:00.000Z");
// Season 6's replay: its 70 days, 27 September to 5 December 2018 (store/itemshop-season6.json).
export const season6FirstDay = Date.parse("2018-09-27T00:00:00.000Z");
export const season6EndDay = Date.parse("2018-12-06T00:00:00.000Z");
// Season 7's replay: its 84 days, 6 December 2018 to 27 February 2019 (store/itemshop-season7.json). Its dated map events
// are The Block's (events/block.js); its Polar Peak thaw and Prisoner are later updates', its Ice Storm 7.20's.
export const season7FirstDay = Date.parse("2018-12-06T00:00:00.000Z");
export const season7EndDay = Date.parse("2019-02-28T00:00:00.000Z");
// Season 8's replay: its 70 days, 28 February to 8 May 2019 (store/itemshop-season8.json). Its dated map event is 8.00's
// Block (events/block.js).
export const season8FirstDay = Date.parse("2019-02-28T00:00:00.000Z");
export const season8EndDay = Date.parse("2019-05-09T00:00:00.000Z");
// Season 9's replay: its 84 days, 9 May to 31 July 2019 (store/itemshop-season9.json; Season 10 began 1 August).
export const season9FirstDay = Date.parse("2019-05-09T00:00:00.000Z");
export const season9EndDay = Date.parse("2019-08-01T00:00:00.000Z");
const seasonDays = { 5: [season5FirstDay, season5EndDay], 6: [season6FirstDay, season6EndDay], 7: [season7FirstDay, season7EndDay],
  8: [season8FirstDay, season8EndDay], 9: [season9FirstDay, season9EndDay] };
export const datedSeasonOf = (event) => event.season ?? 5;
const daysOf = (event) => seasonDays[datedSeasonOf(event)];
// The replay's moment now for an event's season: momentNowMs is that moment (ms), or a function of the season that gives it.
const momentOf = (momentNowMs, event) => (typeof momentNowMs === "function" ? momentNowMs(datedSeasonOf(event)) : momentNowMs);

// The Cube's steps in Epic's time (events/cube.js has the sources): every change at 21:00 UTC, the purple crack from Update
// v5.30's morning; each leg to a rune runs BR_S5_Cube_StartMove alongside its MoveTo. 5.40's CUBE names the leg to the
// lake BR_S5_Cube_MoveTo8 and the lake BR_S5_Cube_Destination (5.41's too), served with 5.30's names (each build watches
// its own).
const at = (day, time = "21:00") => Date.parse(`2018-${day}T${time}:00.000Z`);
const runeStops = [["08-28", "08-29", "Fatal Fields"], ["09-02", "09-03", "Greasy Grove"], ["09-05", "09-06", "Salty Springs"],
  ["09-07", "09-08", "Retail Row"], ["09-10", "09-11", "Wailing Woods"], ["09-13", "09-14", "Lazy Links"], ["09-16", "09-17", "Pleasant Park"]];
const closure = at("08-24");
const lakeAt = at("09-19");
const step = (id, label, flags, start, end) => ({ id, label, flags, start, end });

// The Cube's locations, in order (its hill, the seven runes, Loot Lake), and the leg that rolls it to each: the admin
// panel rolls it to the next one (Core-Backend #322, datedRollSchedule) or straight to any of them (Core-Backend #295,
// datedMoveSchedule), each with its short name.
const cubeLocations = ["spawn", ...runeStops.map((_, index) => `rune${index + 1}`), "lake"];
const cubeLegs = { ...Object.fromEntries(runeStops.map((_, index) => [`moveTo${index + 1}`, `rune${index + 1}`])), moveToLake: "lake" };
const cubeStops = { spawn: "Its hill (Paradise Palms)", ...Object.fromEntries(runeStops.map(([, , place], index) => [`rune${index + 1}`, `Rune ${index + 1}: ${place}`])),
  lake: "Loot Lake" };

// The floating island's steps in Epic's time (6.00, events/island.js has the sources and how 6.00 plays them): the Fortnite
// Wiki's days, each change 🟡 at 00:00 UTC (no source gives the hours), its rune 0 (Loot Lake) from the replay's first day.
// Each stop: the day it leaves for the rune, the day it reaches it, the rune's place (short, and as the wiki puts it).
// The 6.00 island's spline runs Loot Lake, the seven runes and Loot Lake again (its point 8); its leg 8 is the way back.
const at6 = (day) => Date.parse(`2018-${day}T00:00:00.000Z`);
const islandRuneStops = [["09-28", "09-29", "Pleasant Park", "southwest of Pleasant Park"], ["10-01", "10-03", "Shifty Shafts", "by Shifty Shafts"],
  ["10-05", "10-06", "Fatal Fields", "northwest of Fatal Fields"], ["10-08", "10-09", "Retail Row", "south of Retail Row"],
  ["10-10", "10-13", "Wailing Woods", "in Wailing Woods"], ["10-14", "10-16", "Lazy Links", "by Lazy Links"],
  ["10-17", "10-18", "the map's middle", "in the map's middle"]];
const islandBackAt = at6("10-20");
const islandHomeAt = at6("10-21");
const islandLocations = ["lake", ...islandRuneStops.map((_, index) => `rune${index + 1}`), "home"];
const islandLegs = { ...Object.fromEntries(islandRuneStops.map((_, index) => [`moveTo${index + 1}`, `rune${index + 1}`])), moveTo8: "home" };
const islandStops = { lake: "Loot Lake (rune 0)", ...Object.fromEntries(islandRuneStops.map(([, , place], index) => [`rune${index + 1}`, `Rune ${index + 1}: ${place}`])),
  home: "Back over Loot Lake" };
const islandSteps = [
  step("lake", "Hangs over Loot Lake (rune 0)", [islandRune(0)], season6FirstDay, at6(islandRuneStops[0][0])),
  ...islandRuneStops.flatMap(([leave, reach, , place], index) => [
    step(`moveTo${index + 1}`, `Floats to rune ${index + 1} (${place})`, [islandMoveTo(index + 1)], at6(leave), at6(reach)),
    step(`rune${index + 1}`, `Over rune ${index + 1} (${place}): the Cube lifts it`, [islandRune(index + 1)], at6(reach),
      index + 1 < islandRuneStops.length ? at6(islandRuneStops[index + 1][0]) : islandBackAt)
  ]),
  step("moveTo8", "Floats back to Loot Lake", [islandMoveTo(8)], islandBackAt, islandHomeAt),
  step("home", "Back over Loot Lake (rune 0)", [islandRune(0)], islandHomeAt, null)
];
// 6.10 (CL-4464155 on, events/island.js): back over Loot Lake the island is at its rune 8, the spline's last point, not
// rune 0 again, so its "home" step is that flag there (a step's flags from a build on: datedEventOn).
const islandRune8Build = 4464155;

// 6.21's Butterfly (events/butterfly.js has how 6.21 plays it): Epic's 4 November 2018 at 18:00 UTC (Update v6.21's
// "Fortnitemares in Battle Royale ends on Sunday, November 4 at 1 PM Eastern Time"). Before it the Leaky Lake is in its
// Cube Monsters' days (POI0, from the replay's first day, as 6.21 serves it by itself), the Cube cracks and then drains:
// 🟡 the drain's 24 hours are read from CUBE_Simple (BigDrip takes 1/24 of the drain off a drip, and BP_IslandScripting
// times a drip to each whole hour before the drain's end, the Butterfly's LastDrip the 24th); the crack 🟡 from Update v6.20's
// day (24 October, 08:00 UTC: Fortnitemares' first, when the island burst and left the Cube in the lake) to the drain.
const butterflyAt = Date.parse("2018-11-04T18:00:00.000Z");
const butterflyDrainAt = butterflyAt - 24 * 3600000;
const butterflyCrackAt = Date.parse("2018-10-24T08:00:00.000Z");

// The Block (events/block.js has how 7.00 and 7.10 play it). 7.00: Risky Reels stands from Season 7's first day until the
// Block lands on it, which The Game Awards 2018 showed (6 December, 5:30 PM Pacific: 🟡 the show's start, no source gives
// the minute; the Fortnite Wiki has Risky Reels gone on 7 December), and the blank Block from then to the season's end.
// 7.10: its four community builds on the Fortnite Wiki's days (🟡 no hours: 00:00 UTC), DM Arena on to the season's end
// (7.20's Looming Llama of 15 January isn't in 7.10's paks). 7.10 shipped with Grimy Greens up (Update v7.10, 18 December),
// so on the replay it is up from the lap's first day, as 5.21's rift is formed from its lap's start (events/block.js has
// why 7.10's blank Block can't be served instead). 7.20: its two, Looming Llama (Stormhawk; 7.20 shipped with it, 15
// January, so from the lap's first day) and Omega Pyramid (Directingpete, Content Update v7.20, 22 January), on to the
// season's end (🟡 the wiki's days, 00:00 UTC; Update v7.30's Firebase Omega isn't in 7.20's paks). 7.30: its two,
// CoLLAMAsseum (Zarbot, as 7.30's SLAB_1 names him; the wiki's "Zartbot": 7.30 shipped with it, 29 January, so from the
// lap's first day) and Streat Festival (NIBLL, SLAB_2's name for the wiki's "Lunar Street Festival", 5 February, the
// Content Update's day), on to the season's end (🟡 the wiki's days, 00:00 UTC); its slab3 is the blank Block (SLAB_3,
// POI_Block_Blank), which Epic never showed in 7.30, so it isn't served. 7.40: its two, Oily Oaks (MrSlickWillyz, SLAB_1,
// Athena/Maps/Block/7_30's Block_25x25_OilyOaks: 7.40 shipped with it, 14 February, so from the lap's first day) and
// Colossal Compound (Aril_lian1, SLAB_2, 7_40's Block_25x25_ColossalCompound, 19 February, Content Update v7.40's day), on
// to the season's end (the Fortnite Wiki's Season 7 map history; 🟡 its days, 00:00 UTC); its slab3 is the blank Block
// again, not served. 8.00 (CoreV2 #550): its two, Cryptic Castle (HellraiserGaming, SLAB_1, Athena/Maps/Block/8_00's
// Block_25x25_CrypticCastle: 8.00 shipped with it, 28 February 2019, so from the lap's first day) and Turtle Temple
// (BOTIMUS-PRIME, SLAB_2, 8_00's Block_25x25_TurtleTemple, the Fortnite Wiki's v8.01 day, 6 March), on to the season's end
// (8.10's jungle temple of 12 March isn't in 8.00's paks; 🟡 the days', 00:00 UTC); slab3 the blank Block, not served.
const blockLandsAt = Date.parse("2018-12-07T01:30:00.000Z");
const at7 = (date) => Date.parse(`${date}T00:00:00.000Z`);
const blockBuilds = [["2018-12-06", "Grimy Greens, by KAANCITAK"], ["2018-12-23", "Risky Runways, by AKE"],
  ["2018-12-30", "Mysterious Markets, by Bludriv"], ["2019-01-08", "DM Arena, by KojackNumber2"]];
const blockBuilds720 = [["2018-12-06", "Looming Llama, by Stormhawk"], ["2019-01-22", "Omega Pyramid, by Directingpete"]];
const blockBuilds730 = [["2018-12-06", "CoLLAMAsseum, by Zarbot"], ["2019-02-05", "Streat Festival, by NIBLL"]];
const blockBuilds740 = [["2018-12-06", "Oily Oaks, by MrSlickWillyz"], ["2019-02-19", "Colossal Compound, by Aril_lian1"]];
const blockBuilds800 = [["2019-02-28", "Cryptic Castle, by HellraiserGaming"], ["2019-03-06", "Turtle Temple, by BOTIMUS-PRIME"]];
// 8.20 (CL-5625478, Update v8.20, 27 March 2019): SLAB_1 Tropical Treetops (GingerJay91, Athena/Maps/Block/8_20's
// Block_25x25_TropicalTreetops), SLAB_2 Mysterious Mansion (FurryNenja, Block_25x25_MysteriousMansion), SLAB_3 the blank
// Block (not served); its paks also have 8_10's Block_25x25_HarmonyHotel, which no slab streams, and no Skull Island. The
// Fortnite Wiki's Season 8 history: Tropical Treetops from Update v8.20's day, Mysterious Mansion on 2 April ("It was
// quickly replaced by the previous creation"; its note: removed on 2 April 2019), so Tropical Treetops again from 3 April
// to the season's end (🟡 the days, 00:00 UTC; how long the Mansion stood isn't recorded). 8.20 came out mid-season, so its
// first build is up from the lap's first day, as 7.40's Oily Oaks.
const blockSteps820 = [
  step("slab1", "Tropical Treetops, by GingerJay91", [blockSlab(1)], at7("2019-02-28"), at7("2019-04-02")),
  step("slab2", "Mysterious Mansion, by FurryNenja", [blockSlab(2)], at7("2019-04-02"), at7("2019-04-03")),
  step("slab1Again", "Tropical Treetops again, by GingerJay91", [blockSlab(1)], at7("2019-04-03"), null)
];
// 8.30 (CL-5793395, Update v8.30, 10 April 2019): SLAB_1 streams Athena/Maps/Block/8_30's Block_25x25_LlamaSphinx
// ("Llama Sphinx", Prudiz), SLAB_2 Block_25x25_CordialCourtyard ("Cordial Courtyard", GonzoTheWizard), SLAB_3 the blank
// Block (not served). The Fortnite Wiki: Llama Sphinx on Update v8.30's day, Cordial Courtyard on 17 April (Update
// v8.40's day; 8.30's paks already have it), on to the season's end. 8.30 came out mid-season, so its first build is up
// from the lap's first day, as 8.20's. 8.40 (CL-6005771) streams the same two from the same slabs (its POI_Foundations and
// BP_SlabScripting are 8.30's), so it plays 8.30's dates (events/block.js).
const blockBuilds830 = [["2019-02-28", "Llama Sphinx, by Prudiz"], ["2019-04-17", "Cordial Courtyard, by GonzoTheWizard"]];
// 8.50 (CL-6058028, Update v8.50, 25 April 2019): SLAB_1 streams Athena/Maps/Block/8_50's Block_25x25_TrickyTracks ("Tricky
// Tracks", Callum5tewart), SLAB_2 Block_25x25_AlienSanctuary ("Alien Sanctuary", Pr0Spartaner). 8.50's paks no longer have
// 8.30's two. The Fortnite Wiki: Tricky Tracks on Update v8.50's day, Alien Sanctuary on 2 May (Update v8.51's day; 8.50's
// paks already have it), on to the season's end. 8.50 came out mid-season, so its first build is up from the lap's first
// day, as 8.30's.
const blockBuilds850 = [["2019-02-28", "Tricky Tracks, by Callum5tewart"], ["2019-05-02", "Alien Sanctuary, by Pr0Spartaner"]];
// 9.00 (CL-6337466, Update v9.00, 9 May 2019): SLAB_1 streams Athena/Maps/Block/9_00's Block_25x25_ModernMansion ("Modern
// Mansion", MakaMakes_YT), SLAB_2 Block_25x25_CustomCarCarpet ("Custom Cart Carpet" on its slab, Rallred84); BP_SlabScripting
// still watches slab1 to slab3. 9.00's paks no longer have 8.50's two. The Fortnite Wiki's The Block: "Maka's Modern
// Mansion" on 9 May 2019 (Season 9's first day), "Custom Car Carpet" on 15 May (Update v9.01's day; 9.00's paks already have
// it), on to the season's end (🟡 the wiki's next build, 22 May, isn't in 9.00's paks).
const blockBuilds900 = [["2019-05-09", "Modern Mansion, by MakaMakes_YT"], ["2019-05-15", "Custom Car Carpet, by Rallred84"]];
// 9.10 (CL-6639283, Content Update v9.10, 29 May 2019): SLAB_1 streams Athena/Maps/Block/9_10's
// Block_25x25_SwashBucklingSeas ("Swash-buckling Seas", TheBoneRattler), SLAB_2 Block_25x25_SaltyScorpion ("Salty Scorpion",
// Josh822382), SLAB_3 the blank Block (not served); BP_SlabScripting still watches slab1 to slab3. 9.10's paks no longer
// have 9.00's two. The Fortnite Wiki's The Block: Swash-buckling Seas on 22 May 2019 (Update v9.10's day), Salty Scorpion on
// 28 May, on to the season's end (🟡 the wiki's next build, 6 June, is 9.20's). 9.10 came out mid-season, so its first build
// is up from the lap's first day, as 8.50's. CL-6573057 (Update v9.10), whose paks Core has no copy of, plays the same
// (🟡 its paks may not have had Salty Scorpion, 28 May being after its day).
const blockBuilds910 = [["2019-05-09", "Swash-buckling Seas, by TheBoneRattler"], ["2019-05-28", "Salty Scorpion, by Josh822382"]];
// 9.20 (CL-6822798, Update v9.20, 6 June 2019): Athena_POI_Foundations' SLAB_1 streams Athena/Maps/Block/9_20's
// Block_25x25_Firebase_Omega ("Firebase Omega", DrDoofenschmerz), SLAB_2 Block_25x25_Mythical_Mayhem ("Mythical Mayhem",
// TeamFusion), SLAB_3 the blank Block (not served). The Fortnite Wiki's The Block: Firebase Omega on 6 June 2019 (Update
// v9.20's day), Mythical Mayhem on 12 June (Update v9.21's; 9.20's paks already have it), on to the season's end (🟡 the
// wiki's next build, 18 June, is 9.30's). 9.20 came out mid-season, so its first build is up from the lap's first day, as
// 9.10's.
const blockBuilds920 = [["2019-05-09", "Firebase Omega, by DrDoofenschmerz"], ["2019-06-12", "Mythical Mayhem, by TeamFusion"]];
const blockSteps = (builds) => builds.map(([day, label], index) => step(`slab${index + 1}`, label, [blockSlab(index + 1)], at7(day),
  index + 1 < builds.length ? at7(builds[index + 1][0]) : null));
// The Ice Storm Challenges (7.20, events/icestorm.js): the Fortnite Wiki's "available from January 19th 2019 to January
// 28th 2019", from the Ice Storm itself (19 January, 11:00 AM PST: "To mark the event, all players were granted the Ice
// Storm Challenges"; 🟡 the end is Core's, the last day's end).
const iceStormChallengesAt = Date.parse("2019-01-19T19:00:00.000Z");
const iceStormChallengesEnd = Date.parse("2019-01-29T00:00:00.000Z");
const blockModes = ["dates", "custom"];
// 7.30's snow (events/icestorm.js iceStormMeltStates): the Ice Storm's snow (SP) as 7.30 shipped with it, from the lap's
// first day to Update v7.30's day (29 January), then its melting (SP1: BP_SnowSetup's Snow_Amount is 1 less SP1's progress
// at a match's start) to the Fortnite Wiki's "February 1st 2019: The snow melted" (🟡 the days', 00:00 UTC: no source
// gives the hours).
const iceStormMeltAt = Date.parse("2019-01-29T00:00:00.000Z");
const iceStormMeltedAt = Date.parse("2019-02-01T00:00:00.000Z");
// 7.30's Showtime (events/festivus.js has how 7.30 plays it). The Fortnite Wiki's Showtime: "aired on February 2nd 2019 at
// 11AM PST and the encore on the same day at 11PM PST", ten minutes each (its end date: 11:10 PM PST); its Pleasant Park:
// "January 29th 2019: A stage is being set up ... February 3rd 2019: The stage at Pleasant Park is now gone". So FLevel
// (the stage) from Update v7.30's day to the encore's end, F0 (the countdown) until each show, F1 the shows' ten minutes
// (🟡 the stage's hours aren't recorded: 00:00 UTC on the 29th, and it goes after the encore). The Showtime Challenges: the
// wiki's "available from January 30th 2019 to February 2nd 2019" (🟡 00:00 UTC of the 30th to the 2nd's end).
const festivusShowAt = Date.parse("2019-02-02T19:00:00.000Z");
const festivusEncoreAt = Date.parse("2019-02-03T07:00:00.000Z");
const festivusShowMs = 10 * 60000;
const festivusStageAt = Date.parse("2019-01-29T00:00:00.000Z");
const showtimeChallengesAt = Date.parse("2019-01-30T00:00:00.000Z");
const showtimeChallengesEnd = Date.parse("2019-02-03T00:00:00.000Z");
// 7.40's Overtime Challenges (events/overtime.js): the Fortnite Wiki's "available from February 14th 2019 to February 28th
// 2019", Update v7.40's day to the season's end (🟡 00:00 UTC; Epic's free Season 8 Battle Pass went to those with 13 done
// "by February 27").
const overtimeChallengesAt = Date.parse("2019-02-14T00:00:00.000Z");
// 8.20's High Stakes Challenges (events/highstakes2019.js): the Fortnite Wiki's "available from March 14th 2019 to March 19th
// 2019" (Limited-Time Events: "The High Stakes event returns, along with its LTM, challenges, and free cosmetics"; 🟡 00:00
// UTC, the last day's end).
const highStakes2019At = Date.parse("2019-03-14T00:00:00.000Z");
const highStakes2019End = Date.parse("2019-03-20T00:00:00.000Z");
// 8.30's Buccaneer's Bounty Challenges (events/buccaneersbounty.js): the Fortnite Wiki's event "April 10th 2019" to "April
// 16th 2019" (🟡 00:00 UTC, to the last day's end). The bundle opens one more challenge each day itself (DaysFromEventStart).
const buccaneersBountyAt = Date.parse("2019-04-10T00:00:00.000Z");
const buccaneersBountyEnd = Date.parse("2019-04-17T00:00:00.000Z");
// 8.40's Air Royale Challenges (events/airroyale.js): the Fortnite Wiki's "available from April 17th 2019 to April 24th
// 2019" (🟡 00:00 UTC, to the last day's end). The bundle opens three more challenges on its third and fifth days itself
// (DaysFromEventStart 2 and 4).
const airRoyaleAt = Date.parse("2019-04-17T00:00:00.000Z");
const airRoyaleEnd = Date.parse("2019-04-25T00:00:00.000Z");
// 8.50's Endgame Challenges (events/endgame.js): the Fortnite Wiki's "available from April 25th 2019 to May 5th 2019" (🟡
// 00:00 UTC, to the last day's end). The bundle opens three more challenges on its third, fifth and seventh days itself
// (DaysFromEventStart 2, 4 and 6).
const endgameAt = Date.parse("2019-04-25T00:00:00.000Z");
const endgameEnd = Date.parse("2019-05-06T00:00:00.000Z");
// 8.51's Season 8 Overtime Challenges (events/extracredit.js): the Fortnite Wiki's "available from May 3rd 2019 to May 8th
// 2019" (🟡 00:00 UTC, to the last day's end, which is Season 8's). The bundle opens two more challenges on its third and
// fifth days itself (DaysFromEventStart 2 and 4).
const extraCreditAt = Date.parse("2019-05-03T00:00:00.000Z");
const extraCreditEnd = Date.parse("2019-05-09T00:00:00.000Z");
// 9.01's Wick's Bounty Challenges (events/wicksbounty.js): the Fortnite Wiki's from May 16th 2019, the mode's first day. Its
// "to May 19th 2019" is contradicted by Epic's 20 May post ("complete challenges to earn ... before it ends"), so 🟡 to the
// end of 21 May, the day before Update v9.10; 00:00 UTC. Every challenge comes with the bundle.
const wicksBountyAt = Date.parse("2019-05-16T00:00:00.000Z");
const wicksBountyEnd = Date.parse("2019-05-22T00:00:00.000Z");
// 9.10's Downtown Drop Challenges (events/downtowndrop.js): the Fortnite Wiki's "available from May 22nd 2019 to June 4th
// 2019", Update v9.10's day to Update v9.20's (🟡 00:00 UTC, no hours recorded). Two challenges come with the bundle, the
// rest a day at a time from the flag's start (DaysFromEventStart).
const downtownDropAt = Date.parse("2019-05-22T00:00:00.000Z");
const downtownDropEnd = Date.parse("2019-06-04T00:00:00.000Z");
// 9.21's Horde Rush Challenges (events/horderush.js): the Fortnite Wiki's "available from June 13th 2019 to June 19th 2019"
// (🟡 00:00 UTC, to the last day's end). Every challenge comes with the bundle.
const hordeRushAt = Date.parse("2019-06-13T00:00:00.000Z");
const hordeRushEnd = Date.parse("2019-06-20T00:00:00.000Z");
// 9.30's 14 Days of Summer (events/fourteendayssummer.js): Content Update v9.30's "The fun begins on June 25, 9 AM Eastern
// Time" (13:00 UTC), a challenge and an unvaulted weapon a day for fourteen days, and the Fortnite Wiki's end, 15 July 2019
// (🟡 to that day's end). Day n's weapon (EventFlag.Unvaulting.Day<n>) is in the loot for 24 hours from day n's start (the
// wiki's "A weapon was unvaulted for 24 hours only").
export const fourteenDaysSummerAt = Date.parse("2019-06-25T13:00:00.000Z");
const fourteenDaysSummerEnd = Date.parse("2019-07-16T00:00:00.000Z");
const summerDayMs = 24 * 60 * 60 * 1000;
// 8.51's Unvaulting (events/unvaulting.js has how 8.51 plays it and the sources). The Fortnite Wiki's Unvaulting: 4 May 2019,
// 2:00 to 2:05 PM ET (18:00 UTC); its Vault: "April 30th 2019: An orange hologram appeared above one of The Vault rune
// slots. May 1st 2019: The fifth rune has appeared above the Volcano ... May 3rd 2019: The fifth and final rune has entered
// The Vault. A 24 hour countdown timer has appeared above The Vault."
// - GWW5 (the fifth rune's hologram) from 30 April to 1 May, GW5 (the rune over the volcano) from 1 May to the countdown
//   (🟡 the days', 00:00 UTC; the rune's end is the countdown's start).
// - GWS1, the countdown, its 24 hours to the event: BP_SnowScripting counts to its activeUntil, so it ends at the event.
// - GWLevel (Next2, the sky above the vault) from the countdown's last 30 minutes (BP_SnowScripting's own 30-minute mark:
//   the time of day, the final circle over the vault) to 15 minutes after the event (🟡 no source gives Epic's).
// - GWS0, the event, from 18:00 for 10 minutes (BP_SnowScripting plays it from its TimeSinceBegin: the gateway's 60 s, the
//   vote's 150 s at most, 35 s to the outro, its 60 s and the storm after; 🟡 the wiki's five minutes are the vote's end).
// - PGW, after: the volcano's ash sky and its three hits (Retail Row, Polar Peak, Tilted Towers), from the event's end to the
//   season's end.
const unvaultingAt = Date.parse("2019-05-04T18:00:00.000Z");
const unvaultingRuneWarmupAt = Date.parse("2019-04-30T00:00:00.000Z");
const unvaultingRuneAt = Date.parse("2019-05-01T00:00:00.000Z");
const unvaultingCountdownAt = unvaultingAt - 24 * 3600000;
const unvaultingLevelAt = unvaultingAt - 30 * 60000;
const unvaultingLevelEnd = unvaultingAt + 15 * 60000;
const unvaultingEnd = unvaultingAt + 10 * 60000;
// The lead-up to Season 8 (events/s8leadup.js has how 7.30 and 7.40 play it, and the sources).
// - EQ, the tremors: from Content Update v7.30's day (5 February: the wiki's "The ground is occasionally shaking and rumbling
//   noises can be heard, which is an earthquake") to the season's end (🟡 00:00 UTC; how long Epic's ran isn't recorded).
// - EQ2, the cracks: 7.40's BP_S8LeadupEvents opens crack n once EQ2 has run its FissureHour[n] hours (0, 56.5, 63.25 ...
//   371.3, 27 of them; the first shows at 56.5). 🟡 It began 12 February 2019 at 09:00 UTC (4 AM ET): the only start that
//   puts the cracks on the Fortnite Wiki's days (two on the 14th, the first southwest of Tomato Temple, ... the 26th through
//   Tilted Towers on the 27th; one off by a day) at the hours Epic's replay of the same Blueprint in 2026 shows (12:30 PM ET
//   for the first, 3:18 PM ET for the 26th); EQ2 then runs to the season's end.
// - EQH, every crack open: from the last crack (371.3 hours in) to the season's end, so a custom EQ2 that ends keeps them.
// - HP, the heat drying the Wailing Woods (7.40's BP_SnowSetup): the wiki's "February 24th 2019: The grass in the west part
//   of Wailing Woods is dying out and turning brown" to "February 27th 2019: ... All of the forest is brown and dried up",
//   then HP1, burnt through, to the season's end (🟡 the days, 00:00 UTC).
const s8TremorsAt = Date.parse("2019-02-05T00:00:00.000Z");
export const s8CracksAt = Date.parse("2019-02-12T09:00:00.000Z");
export const s8FissureHours = [0, 56.5, 63.25, 70.45, 81.4, 93.55, 106, 124.25, 136.1, 156.9, 178, 212.05, 231.95, 239.1, 244.25,
  255.75, 270.1, 277.05, 288.5, 300.55, 318.4, 333, 344.3, 351.05, 355.4, 364.5, 371.3];
const s8CrackedAt = s8CracksAt + s8FissureHours.at(-1) * 3600000;
const s8HeatAt = Date.parse("2019-02-24T00:00:00.000Z");
const s8BurntAt = Date.parse("2019-02-27T00:00:00.000Z");
// 7.20's Ice King and his Ice Storm (events/icestorm.js has how 7.20 plays it). Epic's storm was 19 January 2019, 11:00 AM
// PST (the Fortnite Wiki's Ice Storm; Newsweek: the TVs' countdown "set to expire around 2 p.m. EST on January 19"). Each
// step's names and spacing are 7.20's blueprints': WD0 ends 12 minutes before the storm (BP_MooneyScripting adds 12 minutes
// to its end for the clock, and WD1's default end is 12:00), WD1 runs those 12 minutes, the TVs' Countdown and R0 count to
// the storm. 🟡 Epic's other hours aren't recorded: the sphere is up from the replay's first day (7.20 shipped with it, 15
// January, as the Block's Looming Llama), the Ice King shows in it from Update v7.20's day (🟡 09:00 UTC) to the clock, the
// TVs' warning and countdown from the Wednesday afternoon Newsweek dates them to (16 January, 🟡 2 PM ET), the clock its
// last 24 hours (Fortnite Insider: the sphere "changed to a clock counting down 24 hours"), WD2 the storm's first 10
// minutes, and SP (storm past) from the storm on: a match that starts after it begins under snow. The storm's sequence level
// (LoadSequence) is up with the sphere, from the replay's first day on, idle but for the storm (CoreV2 #490): a client
// sees the storm's sequence only when the server had MooneySequenceMap before the client made it visible (7.20's
// UFortReplicationGraphNode_AlwaysRelevant_ForConnection::GatherActorListsForConnection drops a streaming level it has no
// always-relevant actors for yet, 0x12FFAF0, and puts it back only on one of them flushing its dormancy, 0x1313C00, which
// the awake MooneySequence never does). A match loads it at its start; one that saw it turn on mid-match, as Start now did
// while LoadSequence began 24 hours before the storm, raced its clients' calendar downloads and the server played the storm
// for itself (its storm circle paused) while its players saw nothing. So no admin change turns it on in a running match.
export const iceKingStormAt = Date.parse("2019-01-19T19:00:00.000Z");
const iceKingClockMs = 24 * 3600000;
const iceKingLeadUpMs = 12 * 60000;
const iceKingStormMs = 10 * 60000;

export const datedEvents = [
  { id: "cube", name: "the Cube (5.30 – 5.41)", flag: cubeTurnOn, anchor: "crack", parts: 4, locations: cubeLocations, legs: cubeLegs, stops: cubeStops,
    spawn: "spawn", sink: "lake", sinkLeg: "moveToLake", steps: [
    step("crack", "The sky's crack turns purple", [riftCorrupt], at("08-23", "08:00"), closure),
    step("lightning", "Lightning strikes the hill", [cubeLightning], at("08-23"), closure),
    step("spawn", "The Cube appears (the crack closes)", [cubeTurnOn], closure, null),
    ...runeStops.flatMap(([stop, leave, place], index) => {
      const start = index === 0 ? closure : at(runeStops[index - 1][1]);
      return [step(`moveTo${index + 1}`, `Rolls to rune ${index + 1} (${place})`, [cubeMoveTo(index + 1), cubeStartMove], start, at(stop)),
        step(`rune${index + 1}`, `Prints rune ${index + 1} (${place})`, [cubeRune(index + 1)], at(stop), at(leave))];
    }),
    step("moveToLake", "Rolls to Loot Lake", [cubeMoveToLake, cubeMoveTo(8), cubeStartMove], at(runeStops[6][1]), lakeAt),
    step("lake", "Sinks into Loot Lake", [cubeLake, cubeDestination], lakeAt, null)
  ] },
  // The floating island (6.00 to 6.20, events/island.js): one of its flags at a time, as 6.00's scripting takes the last
  // one that turns on (6.01's, 6.02's and 6.10's the first, once a match). The admin panel puts it straight at any of its
  // stops (datedMoveSchedule).
  { id: "island", name: "the floating island (6.00 – 6.20)", season: 6, flag: islandRune(0), anchor: "lake", parts: 4, locations: islandLocations,
    legs: islandLegs, stops: islandStops, steps: islandSteps, laterFlags: [{ step: "home", firstBuild: islandRune8Build, flags: [islandRune(8)] }] },
  // 6.31's iceberg (events/distantfog.js has how its blueprint plays it): Athena_Background's BP_Distant_Fog slides its
  // SM_Iceberg along the spline while BR_S6_Approach_03 is active, from the preview point (1) toward 6.31's end point, and
  // puts it there at once when BR_S6_Approach_Overlap turns on. 🟡 No source gives Epic's hours: the approach runs from
  // Update v6.31's day (27 November 2018) to the day before Season 6's end, and the overlap the last day, when the iceberg
  // is at the island as Season 7 begins.
  { id: "distantFog", name: "the Ice King's iceberg (6.31)", season: 6, flag: distantFogApproach, anchor: "overlap", parts: 4, steps: [
    step("approach", "The iceberg drifts in toward the island", [distantFogApproach], at6("11-27"), at6("12-05")),
    step("overlap", "The iceberg at the island (6.31's end point)", [distantFogOverlap], at6("12-05"), season6EndDay)
  ] },
  // 6.30's snowstorm (events/distantfog.js): the same BP_Distant_Fog with 6.30's own two events and no iceberg. While
  // BR_S6_Approach_01 is active it slides its SM_Ice_Fog along the spline from the preview point (1) to 6.30's end point
  // (its 6-3EndPoint, 0.4), and BR_S6_Approach_02 puts it there at once; with neither on the actor is hidden. 🟡 The
  // Fortnite Wiki's days, no hours (00:00 UTC, as 6.31's): the approach from Update v6.30's day (14 November 2018) to
  // Update v6.31's (27 November), where 6.30's blueprint ends it and 6.31's iceberg carries on from, and the end point
  // from then to Season 6's end, for the 6.30 players who stay on it. 🟡 CL-4573096's files are the Content Update's (19
  // November, builds/detect.js); no source says whether 14 November's 6.30 already had the snowstorm (the wiki has it
  // "sometime after the Butterfly Event"), so it runs from Update v6.30's day, the day the backend serves 6.30 from.
  { id: "distantFog630", name: "the Ice King's snowstorm (6.30)", season: 6, flag: distantFogApproach630, anchor: "overlap", parts: 4,
    steps: [
      step("approach", "The snowstorm drifts in toward the island", [distantFogApproach630], at6("11-14"), at6("11-27")),
      step("overlap", "The snowstorm at 6.30's end point", [distantFogOverlap630], at6("11-27"), season6EndDay)
    ] },
  // 6.21's Butterfly (events/butterfly.js): opt-in, as the rocket's launch is. Its steps run to the Butterfly, after which
  // the Leaky Lake is POI1's; "Start now" (or any time on the Butterfly's step) plays it then, the crack and drain before it at
  // Epic's spacing.
  // "before" (Core-Backend #354) holds the map in its pre-event state: no steps of its own here, and 6.21 serves POI0 and
  // none of POI1, the crack or the drain whatever their switches say (events/events.js activeEventFlags).
  { id: "butterfly", name: "the Butterfly (6.21)", season: 6, flag: islandPoi(1), anchor: "butterfly", parts: 4,
    modes: ["off", "before", "dates", "custom"], defaultMode: "off", steps: [
      step("deimos", "Fortnitemares' Leaky Lake: the Cube Monsters' days", [islandPoi(0)], season6FirstDay, butterflyAt),
      step("crack", "The Cube cracks (its last crack 8 seconds before the drain)", [islandCrack], butterflyCrackAt, butterflyDrainAt),
      step("drain", "The Cube drains into the lake, a drip each hour", [islandDrain], butterflyDrainAt, butterflyAt),
      step("butterfly", "The Butterfly: the Cube bursts and every player goes to the In-Between and back", [islandPoi(1)], butterflyAt, null)
    ] },
  // On the replay the rift is formed from the lap's start (5.21 shipped with it formed) until the head comes out.
  // High Stakes (5.40, events/highstakes.js; 5.41's paks keep it): from Update v5.40's morning to Update v5.41's.
  { id: "highStakes", name: "High Stakes (5.40 – 5.41)", flag: ltmHeist, anchor: "challenges", parts: 1, challenges: "Schedule_LTM_Heist", steps: [
    step("challenges", "The High Stakes Challenges", [ltmHeist], Date.parse("2018-09-06T08:00:00.000Z"), Date.parse("2018-09-18T08:00:00.000Z"))
  ] },
  // The Birthday Challenges (5.10, Schedule_Birthday2018_BR, events/birthday2018.js; 5.21's paks keep them): the Fortnite
  // Wiki's Fortnite 1st Birthday, 24 July to 7 August 2018 (🟡 days, not hours: midnight UTC, as birthdayEndedAt).
  // The 14 Days of Fortnite (7.10, events/fourteendays.js): Update v7.10's "Starting December 19, log in each day at 9 AM
  // ET(1400 UTC)" to the original end, and the week Epic brought the challenges back (the Fortnite Wiki: "14 Days of
  // Fortnite has been extended for a limited time!", 7 January 2019, "LAST CHANCE", 14 January; 🟡 their hours are Core's,
  // 14:00 UTC and the end of 14 January). Each step serves the challenges' flag and CalendarEvent_Season7_14DaysOfFortnite,
  // the calendar event the bundle names (its CalendarEventName), with their activeSince.
  { id: "fourteenDays", name: "the 14 Days of Fortnite (7.10)", season: 7, flag: ltm14DaysOfFortnite, anchor: "challenges", parts: 2,
    challenges: "Schedule_14DaysOfFortnite", steps: [
      step("challenges", "The 14 Days of Fortnite: a challenge a day and its modes", [ltm14DaysOfFortnite, fourteenDaysCalendarEvent],
        Date.parse("2018-12-19T14:00:00.000Z"), Date.parse("2019-01-02T14:00:00.000Z")),
      step("extended", "The challenges back for a week", [ltm14DaysOfFortnite, fourteenDaysCalendarEvent],
        Date.parse("2019-01-07T14:00:00.000Z"), Date.parse("2019-01-15T00:00:00.000Z"))
    ] },
  // 7.10's holiday decor (events/holidaydecor.js): the Winter Bus and the holiday supply drops from the 14 Days of Fortnite's
  // start (Yahoo, 18 December 2018: players "jump out of a festive Battle Bus"), Update v7.10's "Starting December 19, log
  // in each day at 9 AM ET(1400 UTC)". 🟡 Epic's end isn't recorded: on to the 14 Days' extension's end, 15 January 2019,
  // Update v7.20's day, the last of 7.10's.
  // The island's decor (HLDY_01 to HLDY_07) comes and goes with them: the 14 Days' second challenge, the next day, visits
  // HLDY_07's giant candy canes. 🟡 Epic's own times for the seven aren't recorded.
  { id: "holidayDecor", name: "the holiday Battle Bus, supply drops and decor (7.10)", season: 7, flag: holidayDecor710, anchor: "decor", parts: 2, steps: [
    step("decor", "The Winter Bus, the holiday supply drops and the island's decor", [holidayDecor710, ...holidayDecorProps710], Date.parse("2018-12-19T14:00:00.000Z"),
      Date.parse("2019-01-15T00:00:00.000Z"))
  ] },
  // 6.21's Fortnitemares island decor (events/holidaydecor.js fortnitemaresDecorStates): HW_01 to HW_08, the
  // BP_CalendarProps of 6.21's client map levels, ghosts, pumpkins and gravestones among them. 🟡 Epic's own times for the
  // eight aren't recorded: from 26 October 2018 (00:00 UTC) to Battle Royale's Fortnitemares' end, the Butterfly (Update
  // v6.21's "ends on Sunday, November 4 at 1 PM Eastern Time").
  { id: "fortnitemaresDecor", name: "Fortnitemares' island decor (6.21)", season: 6, flag: fortnitemaresDecor621[0], anchor: "decor", parts: 2, steps: [
    step("decor", "Fortnitemares' island decor: ghosts, jack-o'-lanterns, gravestones, haunted houses", fortnitemaresDecor621,
      Date.parse("2018-10-26T00:00:00.000Z"), butterflyAt)
  ] },
  { id: "birthday", name: "the Birthday Challenges (5.10 – 5.21)", flag: anniversary2018BR, anchor: "challenges", parts: 1,
    challenges: "Schedule_Birthday2018_BR", modes: ["build", "dates", "custom", "off"], defaultMode: "build", steps: [
      step("challenges", "The Birthday Challenges", [anniversary2018BR], Date.parse("2018-07-24T00:00:00.000Z"), Date.parse("2018-08-07T00:00:00.000Z"))
    ] },
  { id: "tomatoRift", name: "Tomato Town's rift (5.21)", flag: tomatoRiftTell, anchor: "event", parts: 2, steps: [
    step("tell", "A rift forms over Uncle Pete's Pizza Pit", [tomatoRiftTell], season5FirstDay, Date.parse("2018-08-19T00:00:00.000Z")),
    step("event", "The rift spits out the stone tomato head", [tomatoRiftEvent], Date.parse("2018-08-19T00:00:00.000Z"), null)
  ] },
  // The Block is the map, not an event: no "off" (it would leave an empty crater no build ever showed), and it is served
  // whatever the Seasonal Events switch and the event mode say (events/block.js).
  { id: "block700", name: "The Block (7.00)", season: 7, flag: blockLanded, anchor: "block", parts: 2, modes: blockModes, steps: [
    step("reels", "Risky Reels stands (the Block hasn't landed)", [blockRiskyReels], season7FirstDay, blockLandsAt),
    step("block", "The Block has landed on Risky Reels (blank, with its signs)", [blockLanded], blockLandsAt, null)
  ] },
  { id: "block710", name: "The Block's community builds (7.10)", season: 7, flag: blockSlab(1), anchor: "slab1", parts: 4, modes: blockModes,
    steps: blockSteps(blockBuilds) },
  { id: "block720", name: "The Block's community builds (7.20)", season: 7, flag: blockSlab(1), anchor: "slab1", parts: 2, modes: blockModes,
    steps: blockSteps(blockBuilds720) },
  { id: "block730", name: "The Block's community builds (7.30)", season: 7, flag: blockSlab(1), anchor: "slab1", parts: 2, modes: blockModes,
    steps: blockSteps(blockBuilds730) },
  { id: "block740", name: "The Block's community builds (7.40)", season: 7, flag: blockSlab(1), anchor: "slab1", parts: 2, modes: blockModes,
    steps: blockSteps(blockBuilds740) },
  { id: "block800", name: "The Block's community builds (8.00)", season: 8, flag: blockSlab(1), anchor: "slab1", parts: 2, modes: blockModes,
    steps: blockSteps(blockBuilds800) },
  { id: "block820", name: "The Block's community builds (8.20)", season: 8, flag: blockSlab(1), anchor: "slab1", parts: 3, modes: blockModes,
    steps: blockSteps820 },
  { id: "block830", name: "The Block's community builds (8.30)", season: 8, flag: blockSlab(1), anchor: "slab1", parts: 2, modes: blockModes,
    steps: blockSteps(blockBuilds830) },
  { id: "block850", name: "The Block's community builds (8.50)", season: 8, flag: blockSlab(1), anchor: "slab1", parts: 2, modes: blockModes,
    steps: blockSteps(blockBuilds850) },
  { id: "block900", name: "The Block's community builds (9.00)", season: 9, flag: blockSlab(1), anchor: "slab1", parts: 2, modes: blockModes,
    steps: blockSteps(blockBuilds900) },
  { id: "block910", name: "The Block's community builds (9.10)", season: 9, flag: blockSlab(1), anchor: "slab1", parts: 2, modes: blockModes,
    steps: blockSteps(blockBuilds910) },
  { id: "block920", name: "The Block's community builds (9.20, 9.21)", season: 9, flag: blockSlab(1), anchor: "slab1", parts: 2, modes: blockModes,
    steps: blockSteps(blockBuilds920) },
  // 7.20's Ice King (events/icestorm.js): steps that overlap, each a calendar name's own window. Held "before" the event by
  // default (the sphere over Polar Peak and the default modes) until the admin starts it ("Start now", a time, or Epic's
  // dates on the replay); its storm switches Solo, Duos and Squads to the Ice Storm's (events/ltms.js fromIceStorm).
  { id: "iceKing", name: "the Ice King's Ice Storm (7.20)", season: 7, flag: iceKingStorm, anchor: "storm", parts: 6,
    modes: ["before", "dates", "custom"], defaultMode: "before", steps: [
      // First, so the Events page names the step after it that's on (the sphere, the TVs...), not this idle level.
      step("sequence", "The storm's sequence level is loaded", [iceKingLoadSequence], season7FirstDay, null),
      step("sphere", "The ice sphere hangs over Polar Peak", [iceKingLoadLevel], season7FirstDay, null),
      step("iceKing", "The Ice King shows in the sphere", [iceKingVisible], Date.parse("2019-01-15T09:00:00.000Z"), iceKingStormAt - iceKingClockMs),
      step("warning", "The TVs broadcast the weather warning and count down", [iceKingWarning, iceKingCountdown, iceKingCountdownCheck],
        Date.parse("2019-01-16T19:00:00.000Z"), iceKingStormAt),
      step("clock", "The sphere's clock counts down its last day", [iceKingClock], iceKingStormAt - iceKingClockMs, iceKingStormAt - iceKingLeadUpMs),
      step("leadUp", "The last 12 minutes: night falls on the island", [iceKingLeadUp], iceKingStormAt - iceKingLeadUpMs, iceKingStormAt),
      step("storm", "The Ice Storm: the Ice King breaks out and snow covers the island", [iceKingStorm], iceKingStormAt, iceKingStormAt + iceKingStormMs),
      // WDSPAWN with it: the Ice Legion's spawners in the Ice Storm modes from the storm on (CoreV2 #490, events/events.js).
      step("after", "After the storm: the island under snow and the Ice Legion", [iceKingStormPast, iceKingIceLegion], iceKingStormAt, null)
    ] },
  // The Ice Storm Challenges (7.20, events/icestorm.js): one step, the challenges' flag and the bundle's calendar event.
  { id: "iceStorm", name: "the Ice Storm Challenges (7.20)", season: 7, flag: ltmWinterDeimos, anchor: "challenges", parts: 1,
    challenges: "Schedule_WinterDeimos", steps: [
      step("challenges", "The Ice Storm Challenges: more each day", [ltmWinterDeimos, iceStormCalendarEvent], iceStormChallengesAt, iceStormChallengesEnd)
    ] },
  // 7.30's snow after the Ice Storm (events/icestorm.js): under snow, then melting.
  { id: "iceStormMelt", name: "the Ice Storm's snow melting (7.30)", season: 7, flag: iceStormSnowMelt, anchor: "melt", parts: 2, steps: [
    step("snow", "The island under the Ice Storm's snow", [iceKingStormPast], season7FirstDay, iceStormMeltAt),
    step("melt", "The snow melts", [iceStormSnowMelt], iceStormMeltAt, iceStormMeltedAt)
  ] },
  // 7.30's Showtime (events/festivus.js): the stage at Pleasant Park, the countdowns and the two shows. Steps of one name
  // don't overlap, so each is served once at a time.
  { id: "festivus", name: "Showtime, Marshmello's concert (7.30)", season: 7, flag: festivusShow, anchor: "show", parts: 5, steps: [
    step("stage", "The stage stands at Pleasant Park", [festivusLevel], festivusStageAt, festivusEncoreAt + festivusShowMs),
    step("countdown", "The countdown to the show", [festivusCountdown], festivusStageAt, festivusShowAt),
    step("show", "Showtime: Marshmello plays Pleasant Park", [festivusShow], festivusShowAt, festivusShowAt + festivusShowMs),
    step("encoreCountdown", "The countdown to the encore", [festivusCountdown], festivusShowAt + festivusShowMs, festivusEncoreAt),
    step("encore", "The encore", [festivusShow], festivusEncoreAt, festivusEncoreAt + festivusShowMs)
  ] },
  // 7.30's Showtime Challenges (events/festivus.js): one step, the challenges' flag and the bundle's calendar event.
  { id: "showtime", name: "the Showtime Challenges (7.30)", season: 7, flag: lteFestivus, anchor: "challenges", parts: 1,
    challenges: "Schedule_Festivus", steps: [
      step("challenges", "The Showtime Challenges", [lteFestivus, showtimeCalendarEvent], showtimeChallengesAt, showtimeChallengesEnd)
    ] },
  // 7.40's Overtime Challenges (events/overtime.js): one step, the challenges' flag and the bundle's calendar event.
  { id: "overtime", name: "the Overtime Challenges (7.40)", season: 7, flag: lteS7Overtime, anchor: "challenges", parts: 1,
    challenges: "Season7_OT_Schedule", steps: [
      step("challenges", "The Overtime Challenges", [lteS7Overtime, overtimeCalendarEvent], overtimeChallengesAt, season7EndDay)
    ] },
  // 8.20's High Stakes Challenges (events/highstakes2019.js): one step, the challenges' flag and the schedule's calendar event.
  { id: "highStakes2019", name: "the High Stakes Challenges (8.20)", season: 8, flag: ltmHighStakes, anchor: "challenges", parts: 1,
    challenges: "Schedule_LTM_Heist_V2", steps: [
      step("challenges", "The High Stakes Challenges", [ltmHighStakes, highStakes2019CalendarEvent], highStakes2019At, highStakes2019End)
    ] },
  // 8.30's Buccaneer's Bounty Challenges (events/buccaneersbounty.js): one step, the flag and the schedule's calendar event.
  { id: "buccaneersBounty", name: "the Buccaneer's Bounty Challenges (8.30)", season: 8, flag: lteBootyBay, anchor: "challenges", parts: 1,
    challenges: "Schedule_PirateParty", steps: [
      step("challenges", "The Buccaneer's Bounty Challenges", [lteBootyBay, buccaneersBountyCalendarEvent], buccaneersBountyAt, buccaneersBountyEnd)
    ] },
  // 8.40's Air Royale Challenges (events/airroyale.js): one step, the flag and the schedule's calendar event.
  { id: "airRoyale", name: "the Air Royale Challenges (8.40)", season: 8, flag: ltmGoose, anchor: "challenges", parts: 1,
    challenges: "Schedule_LTM_Goose", steps: [
      step("challenges", "The Air Royale Challenges", [ltmGoose, airRoyaleCalendarEvent], airRoyaleAt, airRoyaleEnd)
    ] },
  // 8.50's Endgame Challenges (events/endgame.js): one step, the flag and the schedule's calendar event.
  { id: "endgame", name: "the Endgame Challenges (8.50)", season: 8, flag: ltmAshton, anchor: "challenges", parts: 1,
    challenges: "Schedule_LTM_Ashton", steps: [
      step("challenges", "The Endgame Challenges", [ltmAshton, endgameCalendarEvent], endgameAt, endgameEnd)
    ] },
  // 8.51's Season 8 Overtime Challenges (events/extracredit.js): one step, the flag and the schedule's calendar event.
  { id: "extraCredit", name: "the Season 8 Overtime Challenges (8.51)", season: 8, flag: lteS8ExtraCredit, anchor: "challenges", parts: 1,
    challenges: "Season8_ExtraCredit_Schedule", steps: [
      step("challenges", "The Season 8 Overtime Challenges", [lteS8ExtraCredit, extraCreditCalendarEvent], extraCreditAt, extraCreditEnd)
    ] },
  // 9.01's Wick's Bounty Challenges (events/wicksbounty.js): one step, the flag and the schedule's calendar event.
  { id: "wicksBounty", name: "the Wick's Bounty Challenges (9.01)", season: 9, flag: ltmWax, anchor: "challenges", parts: 1,
    challenges: "Schedule_LTM_Wax", steps: [
      step("challenges", "The Wick's Bounty Challenges", [ltmWax, wicksBountyCalendarEvent], wicksBountyAt, wicksBountyEnd)
    ] },
  // 9.10's Downtown Drop Challenges (events/downtowndrop.js): one step, the flag and the schedule's calendar event.
  { id: "downtownDrop", name: "the Downtown Drop Challenges (9.10)", season: 9, flag: ltmVigilante, anchor: "challenges", parts: 1,
    challenges: "BundleSchedule_Event_VigilanteBoard", steps: [
      step("challenges", "The Downtown Drop Challenges", [ltmVigilante, downtownDropCalendarEvent], downtownDropAt, downtownDropEnd)
    ] },
  // 9.21's Horde Rush Challenges (events/horderush.js): one step, the flag and the schedule's calendar event.
  { id: "hordeRush", name: "the Horde Rush Challenges (9.21, 9.30)", season: 9, flag: ltmMash, anchor: "challenges", parts: 1,
    challenges: "Schedule_LTM_Mash", steps: [
      step("challenges", "The Horde Rush Challenges", [ltmMash, hordeRushCalendarEvent], hordeRushAt, hordeRushEnd)
    ] },
  // 9.30's 14 Days of Summer (events/fourteendayssummer.js): the challenges' flag and calendar event for the whole event,
  // and each day's unvaulted weapon for its day.
  { id: "fourteenDaysSummer", name: "the 14 Days of Summer (9.30)", season: 9, flag: ltm14DaysOfSummer, anchor: "challenges", parts: 2,
    challenges: "Schedule_14DaysOfSummer", steps: [
      step("challenges", "The 14 Days of Summer: a challenge a day", [ltm14DaysOfSummer, fourteenDaysSummerCalendarEvent],
        fourteenDaysSummerAt, fourteenDaysSummerEnd),
      ...Array.from({ length: 14 }, (_, index) => step(`unvault${index + 1}`, `Day ${index + 1}'s unvaulted weapon`,
        [unvaultingDay(index + 1)], fourteenDaysSummerAt + index * summerDayMs, fourteenDaysSummerAt + (index + 1) * summerDayMs))
    ] },
  // 8.51's Unvaulting (events/unvaulting.js): the fifth rune, the countdown, the event and the island after it. "Start now"
  // (or any time on the event's step) plays it then, the steps before it at Epic's spacing.
  { id: "unvaulting", name: "the Unvaulting (8.51)", season: 8, flag: unvaultingEvent, anchor: "event", parts: 6, steps: [
    step("runeWarmup", "The fifth rune's hologram over its slot in the Vault", [unvaultingRuneWarmup], unvaultingRuneWarmupAt, unvaultingRuneAt),
    step("rune", "The fifth rune over the volcano: drop items in to fill it", [unvaultingRune], unvaultingRuneAt, unvaultingCountdownAt),
    step("countdown", "The 24-hour countdown over the Vault", [unvaultingCountdown], unvaultingCountdownAt, unvaultingAt),
    step("level", "The sky above the Vault streamed in", [unvaultingLevel], unvaultingLevelAt, unvaultingLevelEnd),
    step("event", "The Unvaulting: the Vault opens, the vote, the eruption", [unvaultingEvent], unvaultingAt, unvaultingEnd),
    step("after", "After the eruption: the ash sky, Retail Row, Polar Peak and Tilted Towers hit", [unvaultingAfter], unvaultingEnd, null)
  ] },
  // The lead-up to Season 8 (events/s8leadup.js): the earthquakes (7.30's tremors, 7.40's cracks), and 7.40's heat.
  { id: "earthquakes", name: "the earthquakes before Season 8 (7.30, 7.40)", season: 7, flag: s8Cracks, anchor: "cracks", parts: 3, steps: [
    step("tremors", "Tremors shake the island", [s8Tremors], s8TremorsAt, null),
    step("cracks", "The ground cracks open, crack by crack (7.40)", [s8Cracks], s8CracksAt, null),
    step("cracked", "Every crack open, Tilted Towers' News HQ down (7.40)", [s8Cracked], s8CrackedAt, null)
  ] },
  { id: "s8Heat", name: "the Wailing Woods drying up (7.40)", season: 7, flag: s8Heat, anchor: "heat", parts: 2, steps: [
    step("heat", "The Wailing Woods dry up", [s8Heat], s8HeatAt, s8BurntAt),
    step("burnt", "The Wailing Woods burnt brown", [s8Burnt], s8BurntAt, null)
  ] }
];
export const datedEvent = (id) => datedEvents.find((event) => event.id === id);
export const datedModes = ["dates", "custom", "off"];
export const datedModesOf = (event) => event.modes ?? datedModes;
export const defaultDatedMode = (event) => event.defaultMode ?? "dates";
export const defaultDatedFlags = Object.fromEntries(datedEvents.map((event) => [event.id, { mode: defaultDatedMode(event), schedule: [] }]));

const validTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const iso = (ms) => new Date(ms).toISOString();
const minScale = 0.001;
const maxScale = 10;

// A schedule list [{step, startAt, endAt}] checked: each step of the event once, startAt a time, endAt null or a time after
// it. Returns it normalized (ISO, in the event's step order), or null.
export function validDatedSchedule(event, list) {
  if (!Array.isArray(list)) return null;
  const byStep = new Map();
  for (const item of list) {
    const own = event.steps.find(({ id }) => id === item?.step);
    if (!own || byStep.has(own.id) || !validTime(item.startAt)) return null;
    if (item.endAt !== null && item.endAt !== undefined && (!validTime(item.endAt) || Date.parse(item.endAt) <= Date.parse(item.startAt))) return null;
    byStep.set(own.id, { step: own.id, startAt: iso(Date.parse(item.startAt)), endAt: item.endAt == null ? null : iso(Date.parse(item.endAt)) });
  }
  return event.steps.filter(({ id }) => byStep.has(id)).map(({ id }) => byStep.get(id));
}

// Every step at Epic's spacing from one step's start: {startAt, step (default the event's anchor), scale (1: Epic's
// spacing, 0.5: twice as fast)}. A step that ran on to the season's end stays on.
export function shiftedDatedSchedule(event, { startAt, step: anchorId = event.anchor, scale = 1 } = {}) {
  const anchor = event.steps.find(({ id }) => id === anchorId);
  const factor = Number(scale);
  if (!anchor || !validTime(startAt) || !Number.isFinite(factor) || factor < minScale || factor > maxScale) return null;
  const start = Date.parse(startAt);
  const shift = (ms) => iso(start + Math.round((ms - anchor.start) * factor));
  return event.steps.map(({ id, start: own, end }) => ({ step: id, startAt: shift(own), endAt: end === null ? null : shift(end) }));
}

// The schedule input for an event: {startAt, step, scale} replaces every step's times; a list [{step, startAt, endAt}] sets
// those steps' over the current ones (or over seed, the steps' times now, when there are none yet; both times null removes
// a step's); null clears them. Returns the new schedule, or null when the input isn't one.
export function datedSchedulePatch(event, value, current = [], seed = []) {
  if (value === null) return [];
  if (Array.isArray(value)) {
    const base = new Map((current.length ? current : seed).map((entry) => [entry.step, entry]));
    for (const item of value) {
      if (!event.steps.some(({ id }) => id === item?.step)) return null;
      if (item.startAt === null && item.endAt === null) base.delete(item.step);
      else base.set(item.step, item);
    }
    return validDatedSchedule(event, [...base.values()]);
  }
  if (value && typeof value === "object") return shiftedDatedSchedule(event, value);
  return null;
}

// The events config's datedFlags: {<event>: {mode, schedule}}, each merged over the current one; a bad mode or schedule
// keeps the current.
export function sanitizeDatedFlags(value, current = defaultDatedFlags) {
  const result = {};
  for (const event of datedEvents) {
    const own = current?.[event.id];
    const modes = datedModesOf(event);
    const next = { mode: modes.includes(own?.mode) ? own.mode : defaultDatedMode(event), schedule: validDatedSchedule(event, own?.schedule ?? []) ?? [] };
    const input = value?.[event.id];
    if (input && typeof input === "object" && !Array.isArray(input)) {
      if (modes.includes(input.mode)) next.mode = input.mode;
      if (input.schedule === null) next.schedule = [];
      else if (input.schedule !== undefined) next.schedule = validDatedSchedule(event, input.schedule) ?? next.schedule;
    }
    result[event.id] = next;
  }
  return result;
}

export const datedSettings = (config) => sanitizeDatedFlags(config?.datedFlags);

// Epic's steps on the replay's lap that holds now, as real times: lapStart is the real time that lap began. The replay is
// the event's season's (momentNowMs: that season's moment now, store/itemshop.js seasonMoment).
const lapOf = (event, nowMs, momentNowMs) => {
  const [first, end] = daysOf(event);
  const cycle = end - first;
  return { cycle, first, end, lapStart: nowMs - ((((momentNowMs - first) % cycle) + cycle) % cycle) };
};
export function datedStepsThisLap(event, nowMs, momentNowMs) {
  const { lapStart, first, end: seasonEnd } = lapOf(event, nowMs, momentNowMs);
  const real = (ms) => lapStart + (ms - first);
  return event.steps.map(({ id, start, end }) => ({ step: id, startAt: iso(real(start)), endAt: iso(real(end ?? seasonEnd)) }));
}

// An event as a build has it: its steps with the flags that build's files give them (an event's laterFlags: a step's
// flags from a build on, the newest that holds). An event without any is itself on every build.
export function datedEventOn(event, changelist) {
  const build = Number(changelist);
  const later = (event.laterFlags ?? []).filter(({ firstBuild }) => Number.isInteger(build) && build >= firstBuild);
  if (!later.length) return event;
  const flagsOf = (id) => later.filter(({ step: own }) => own === id).sort((a, b) => b.firstBuild - a.firstBuild)[0]?.flags;
  return { ...event, steps: event.steps.map((own) => (flagsOf(own.id) ? { ...own, flags: flagsOf(own.id) } : own)) };
}

// The modes that schedule none of an event's steps: "off", "build" (the build serves the flag itself) and the Butterfly's
// "before" (the build holds its pre-event state, events/events.js activeEventFlags).
const unscheduledModes = ["off", "build", "before"];

// The event's windows [{eventType, since, until (ms, Infinity: for good)}] by its mode: Epic's dates on the laps around
// now, or the admin's times (none in the unscheduled modes).
export function datedWindows(event, setting, nowMs, momentNowMs) {
  if (unscheduledModes.includes(setting.mode)) return [];
  if (setting.mode === "custom") {
    return setting.schedule.flatMap(({ step: id, startAt, endAt }) => event.steps.find((own) => own.id === id).flags
      .map((eventType) => ({ eventType, since: Date.parse(startAt), until: endAt === null ? Infinity : Date.parse(endAt) })));
  }
  const { cycle, lapStart, first, end: seasonEnd } = lapOf(event, nowMs, momentNowMs);
  return [lapStart - cycle, lapStart, lapStart + cycle].flatMap((lap) => event.steps.flatMap(({ flags, start, end }) => flags.map((eventType) =>
    ({ eventType, since: lap + (start - first), until: lap + ((end ?? seasonEnd) - first) }))));
}

// Windows as calendar parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part that holds
// now on (the next `count` changes), each event once, without the skipped flags.
export function datedParts(windows, nowMs, count, skip = new Set()) {
  const kept = windows.filter(({ eventType }) => !skip.has(eventType));
  const eventsAt = (t) => {
    const seen = new Set();
    return kept.filter(({ eventType, since, until }) => t >= since && t < until && !seen.has(eventType) && seen.add(eventType))
      .map(({ eventType, since, until }) => ({ eventType, activeSince: iso(since), activeUntil: until === Infinity ? eventsActiveUntil : iso(until) }));
  };
  const boundaries = [...new Set(kept.flatMap(({ since, until }) => [since, until]))].filter((t) => Number.isFinite(t) && t > nowMs)
    .sort((a, b) => a - b).slice(0, count);
  return [{ validFrom: -Infinity, events: eventsAt(nowMs) }, ...boundaries.map((t) => ({ validFrom: t, events: eventsAt(t) }))];
}

// Rolling the Cube to its next location (Core-Backend #322). The game moves it by its calendar events alone:
// Athena/Prototype/Blueprints/Cube/CUBE (5.30 and 5.40) watches each of its EventsToBindTo with a
// FortAsyncAction_CalendarEventWatcher, which at every calendar download (5.30 dump 0x1060F30) calls OnEventActive for an
// event active now that wasn't before, OnEventUpdated for one still active and OnEventEnded for one gone. On OnEventActive
// a _RuneN puts the cube's PathIndex on Runes[N - 1] and OnRep_PathIndex runs PerformStep: the first time in a match
// (InitialSetup) it is put there, afterwards it rolls there (RollTimeline at PlayRate 0.08, 12.5 s, from the path's step
// before it), lands (LandedAtRune) and prints the rune (StartRuneSequence). So a rune that turns on in a running match
// rolls the cube onto it, its last roll and not the path's 42 to 106 steps between stops (Runes 42, 114, 186, 244, 318,
// 382, 461 of 567 Steps); a new match starts it there. A _MoveToN
// that turns on puts it as far along the path as the leg's progress, the next roll timed from BR_S5_Cube_StartMove's end
// and set only under an hour away (CalculateNextMove): it rolls in Epic's days, not at once, so the panel's roll goes to
// the next rune, not the leg. On OnEventUpdated 5.30 puts it where the event says (InitialSetup) and 5.40 does nothing.
// BR_S5_Cube_TurnOn turning on puts it on step 0, its hill. The lake: 5.40's CUBE watches BR_S5_Cube_Destination, which
// puts PathIndex on the path's last step (rolling into Loot Lake in a running match) and turns Cube_Dest_Scripting's lake
// on (LakeTurnOn); 5.30's BR_S5_Cube_Lake calls ImpactLake, which is empty, so there the cube stays where it was and starts
// a new match on its hill (its _TurnOn). A running Core gameserver fetches the calendar within 5 seconds of a change
// (CoreV2's AFortGameModeAthena::AskEventCalendarRevision and Client_RefreshEventCalendar), its players with it.
//
// A step's times now (the status's `current`) hold nowMs.
const onAt = (current, nowMs) => Boolean(current) && Date.parse(current.startAt) <= nowMs && (current.endAt === null || nowMs < Date.parse(current.endAt));

// Where an event with locations (the Cube) is on its schedule at nowMs, from its steps' times now: `now` the step that says
// so (a leg it is rolling on, else the last location it is at, else another step on, the crack or its lightning; null:
// none), and `next` the location a roll takes it to (null after the last).
export function datedPlace(event, steps, nowMs) {
  const on = steps.filter(({ current }) => onAt(current, nowMs)).map(({ step: id }) => id);
  const at = event.locations.filter((id) => on.includes(id)).at(-1) ?? null;
  const leg = on.find((id) => event.legs[id]) ?? null;
  const reached = at === null ? -1 : event.locations.indexOf(at);
  const rolling = leg ? event.legs[leg] : null;
  const next = rolling !== null && event.locations.indexOf(rolling) > reached ? rolling : event.locations[reached + 1] ?? null;
  return { now: leg ?? at ?? on.at(-1) ?? null, next };
}

// The Cube's stage at nowMs for the admin panel's track of its stops: `toward` the location a leg on now rolls it to (null:
// none) and `at` the location it is at, or rolls from on a leg (null: not out).
export function datedStage(event, steps, nowMs) {
  const on = steps.filter(({ current }) => onAt(current, nowMs)).map(({ step: id }) => id);
  const leg = on.find((id) => event.legs[id]) ?? null;
  const toward = leg ? event.legs[leg] : null;
  const at = toward ? event.locations[event.locations.indexOf(toward) - 1] ?? null : event.locations.filter((id) => on.includes(id)).at(-1) ?? null;
  return { at, toward };
}

// The admin's times that put it at one of its locations now and hold it there (Core-Backend #295's movement stages): that
// location from now on, with the Cube's appearing (_TurnOn) kept from its start, or from now when it isn't out yet. Loot
// Lake is the sink: datedSinkSchedule, it rolls in sinkLeadSeconds from now. Null for a location it doesn't have.
// What a running match plays (a Core gameserver fetches the calendar within 5 seconds of the change): a rune newly on
// rolls the Cube onto it from the path's step before it, whichever stop it was at, and prints it (the roll above); its hill
// changes nothing there (_TurnOn stays on and the game has no roll back), so new matches start it there; and the sink.
// The floating island (no appearing, no sink) is that stop's flag alone from now on: one island flag at a time
// (events/island.js has what a running match plays).
export function datedMoveSchedule(event, steps, to, nowMs) {
  if (!event.locations?.includes(to)) return null;
  if (to === event.sink) return datedSinkSchedule(event, nowMs + sinkLeadSeconds * 1000);
  if (!event.spawn) return validDatedSchedule(event, [{ step: to, startAt: iso(nowMs), endAt: null }]);
  const appearing = steps.find(({ step: id }) => id === event.spawn);
  const out = { step: event.spawn, startAt: onAt(appearing.current, nowMs) ? appearing.current.startAt : iso(nowMs), endAt: null };
  return validDatedSchedule(event, to === event.spawn ? [out] : [out, { step: to, startAt: iso(nowMs), endAt: null }]);
}

// The admin's times that roll it to its next location now and hold it there: datedMoveSchedule to the next location. Null
// after the last, and while it rolls into Loot Lake (the sink's last stretch, which matches already play: datedSinkStatus).
export function datedRollSchedule(event, steps, nowMs) {
  const { next } = datedPlace(event, steps, nowMs);
  if (next === null || (next === event.sink && datedSinkStatus(event, steps, nowMs).phase === "rollingIn")) return null;
  return datedMoveSchedule(event, steps, next, nowMs);
}

// The Cube sinking into Loot Lake (Core-Backend #295), 19 September 2018 (the Fortnite Wiki's Kevin the Cube: it rolled
// into the lake and dissolved, and the lake turned bouncy), played on 5.41. How 5.40's and 5.41's paks play it (their CUBE
// and Cube_Dest_Scripting are the same but for 5.41's tilted-impact sound and replay fixes; events/cube.js): its leg to the
// lake (BR_S5_Cube_MoveTo8, with BR_S5_Cube_StartMove) and then BR_S5_Cube_Destination.
// - CUBE, on _MoveTo8's OnEventActive, puts PathIndex at Runes[6] (460) plus the leg's progress times its 104 steps (the
//   path's last but one, 564, is the lake's surface): CalculateNextMove, rolling there from the step before it, and sets
//   IncrementIndex for the next step's time less its 12.5-second roll and 5 seconds, if under an hour away; IncrementIndex
//   waits 5 seconds and rolls one step on. In the leg's last hour it also sets the time of day to reach
//   DestinationTimeOfDay (21:30) at its end. So a match where the leg turns on in its last 104th (27.7 minutes at Epic's two
//   days) rolls the Cube to the lake's edge (563) and, 12.5 seconds before the leg's end, onto the water (564), landing
//   as it ends: CubeRollFeedback splashes (Cube_Dest_Scripting's CubeSplash, the water boils) and shakes the camera, and
//   5 seconds on ImpactLake plays LakeTimeline (80 s): the Cube sinks over 60 seconds (Steps 564 to 565) while the lake's
//   corruption spreads (MPC_Landscape's LakeCorruption, CubeStartSinking), at 60 s DoneSinking (CubeStopSinking, the
//   Cube off) and at 67 s TurnOn: Cube_Dest_Scripting's LakeTurnOn turns the lake on (LakeState 2, its purple material,
//   P_C_L_TurnOn and the lake made Bouncy) and DestTurnedOn. After the roll onto the water, IncrementIndex's next timer
//   (from BR_S5_Cube_StartMove's end, the leg's) works out below zero, so no roll follows it.
// - _Destination's OnEventActive, with the Cube not at the lake's surface or under it, puts it under it (565, rolling
//   down in a running match) and turns the lake on at once; a new match after the sink starts so: the Cube gone, the
//   lake purple and bouncy.
// A match where the leg was already on gets OnEventUpdated, which 5.40's and 5.41's CUBE ignore, so it gets that quick
// version once it sees _Destination. 5.30's paks have no lake sequence (its _Lake calls an empty ImpactLake, and it has
// no Cube_Dest_Scripting), and 6.00's place neither the Cube nor the lake's scripting (its Loot Lake is Season 6's,
// with the floating island; events/cube.js). Each schedule here sets every step at Epic's spacing from the Cube rolling
// onto the water at sinkAtMs, as the admin's own times: the leg to the lake from two days before, rune 7 the day before
// that. "Now" is a minute on, so a running match sees the leg newly on within its last 104th with time for both rolls.
export const sinkLeadSeconds = 60;
export const minSinkLeadSeconds = 30;
export const sinkPlaysSeconds = 85;
export const cubeLakeLegSteps = 104;
export function datedSinkSchedule(event, sinkAtMs) {
  if (!event.sink || !Number.isFinite(sinkAtMs)) return null;
  return shiftedDatedSchedule(event, { startAt: iso(sinkAtMs), step: event.sink, scale: 1 });
}

// When it sinks on its times now and Epic's: {at (null: not served), original, playsFrom, phase}. playsFrom is when its leg
// to the lake reaches its last 104th: a match whose leg turns on from then (one that starts then, or any running one
// when the admin's change is that late) plays the sink. The phase: "unscheduled", "scheduled", "rolling" (on its leg to
// the lake), "rollingIn" (the last 104th), "sinking" (sinkPlaysSeconds from it: the roll lands, it sinks and the lake
// turns) or "sunk" (the lake bouncy).
export function datedSinkStatus(event, steps, nowMs) {
  const own = steps.find(({ step }) => step === event.sink);
  const leg = steps.find(({ step }) => step === event.sinkLeg);
  const at = own.current?.startAt ?? null;
  const ms = at === null ? null : Date.parse(at);
  const legStart = leg.current && leg.current.endAt !== null && Date.parse(leg.current.endAt) === ms ? Date.parse(leg.current.startAt) : null;
  const playsFrom = ms === null ? null : legStart === null ? ms : ms - Math.floor((ms - legStart) / cubeLakeLegSteps);
  const phase = ms === null ? "unscheduled" : nowMs >= ms + sinkPlaysSeconds * 1000 ? "sunk" : nowMs >= ms ? "sinking"
    : nowMs >= playsFrom ? "rollingIn" : onAt(leg.current, nowMs) ? "rolling" : "scheduled";
  return { at, original: own.original.startAt, playsFrom: playsFrom === null ? null : iso(playsFrom), phase };
}

// The Cube's appearing, the Crack Closure (Core-Backend #295; events/cube.js has how 5.30 plays it): every step at Epic's
// spacing from its appearing at spawnAtMs, as the admin's own times. The game's sequence counts to the lightning's end,
// which is the appearing: the crack is purple and the lightning on from a day and a half and a day before, so a match
// within the last hour sees the strikes, the final bolt from 20 seconds before and the Cube at the end; rune 1 four days
// after. Null for an event without one.
export const spawnLeadSeconds = 30;
export const minSpawnLeadSeconds = 25;
const spawnStrikesMs = 3600000;
export function datedSpawnSchedule(event, spawnAtMs) {
  if (!event.spawn || !Number.isFinite(spawnAtMs)) return null;
  return shiftedDatedSchedule(event, { startAt: iso(spawnAtMs), step: event.spawn, scale: 1 });
}

// When it appears on its times now and Epic's: {at (null: not served), original, phase}, the phase "unscheduled",
// "scheduled", "lightning" (its last hour: the strikes and the final bolt) or "spawned".
export function datedSpawnStatus(event, steps, nowMs) {
  const own = steps.find(({ step }) => step === event.spawn);
  const at = own.current?.startAt ?? null;
  const ms = at === null ? null : Date.parse(at);
  const phase = ms === null ? "unscheduled" : nowMs < ms - spawnStrikesMs ? "scheduled" : nowMs < ms ? "lightning" : "spawned";
  return { at, original: own.original.startAt, phase };
}

// The admin panel's view of each event: its mode and each step's Epic date, its times on the replay's lap now, the
// admin's own times and the times it runs at now (by the mode); the Cube's place and its appearing too. momentNowMs is
// Season 5's replay moment now, or a function of the season that gives its replay's (the floating island's is Season 6's).
export function datedFlagsStatus(nowMs, momentNowMs, config) {
  const settings = datedSettings(config);
  return {
    modes: datedModes,
    events: datedEvents.map((event) => {
      const setting = settings[event.id];
      const lap = datedStepsThisLap(event, nowMs, momentOf(momentNowMs, event));
      const custom = new Map(setting.schedule.map((entry) => [entry.step, entry]));
      const steps = event.steps.map(({ id, label, flags, start, end }, index) => ({
        step: id, label, flags,
        original: { startAt: iso(start), endAt: end === null ? null : iso(end) },
        dates: { startAt: lap[index].startAt, endAt: end === null ? null : lap[index].endAt },
        custom: custom.get(id) ?? null,
        current: unscheduledModes.includes(setting.mode) ? null : setting.mode === "custom" ? custom.get(id) ?? null : lap[index]
      }));
      return {
        id: event.id, name: event.name, season: datedSeasonOf(event), mode: setting.mode, modes: datedModesOf(event), challenges: event.challenges ?? null,
        anchor: event.anchor, schedule: setting.schedule, steps,
        place: event.locations ? datedPlace(event, steps, nowMs) : null,
        stops: event.locations ? event.locations.map((id) => ({ id, label: event.stops[id] })) : null,
        stage: event.locations ? datedStage(event, steps, nowMs) : null,
        spawn: event.spawn ? datedSpawnStatus(event, steps, nowMs) : null,
        sink: event.sink ? datedSinkStatus(event, steps, nowMs) : null
      };
    })
  };
}
