import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, season5EndDay } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// The Cube, "Kevin" (5.30, CL-4305896; events/events.js). 5.30's paks watch these calendar events:
// - BP_Athena_Event_Components: EventFlag.BR_S5_Rift_Corrupt (the sky's crack turns purple) and BR_S5_Cube_Lightning (its
//   lightning);
// - Athena/Prototype/Blueprints/Cube/CUBE (FortAsyncAction_CalendarEventWatcher): BR_S5_Cube_Lightning (the strikes on the
//   cube's hill), BR_S5_Cube_TurnOn (the cube appears: CubeAppear, OnRep_CubeTurnedOn), BR_S5_Cube_Lake (it sinks into
//   Loot Lake: ImpactLake, PlayFinalSink), and the events of its EventsToBindTo, set on the placed actor: an event whose name
//   holds "Rune" puts the cube on that rune's path index (Runes[n - 1], printing it: its low-gravity dome), and one whose
//   name holds "MoveTo" rolls it toward rune n (the name's last digit, RuneDestination): CalculateNextMove takes the
//   event's progress, TimeSinceBegin over TimeSinceBegin + TimeUntilEnd (EventTimeTotal), through the leg's ProgressCurves
//   and KeyframesPerRune to the step it is on, and BR_S5_Cube_StartMove's time until its end
//   (GetTimeUntilCalendarEventEnd) times the next roll (IncrementIndex, once it is under an hour away). So each leg is an
//   event whose activeSince and activeUntil are the leg's start and end, and StartMove runs with it, ending with it.
// The Fortnite Wiki's Crack Closure (Chapter 1) and Cube Rune Events: the crack spat dark mist on 23 August 2018 and its
// lightning struck the hill north of Truck 'N' Oasis from 5 PM ET that day, a cactus every few hours, until "5:00 PM ET:
// Final lightning strike. The Cube spawns. The Sideways Rift closed." on 24 August; then "stopped near Fatal Fields" on 28
// August and "started rolling again" on 29 August (rune 1), Greasy Grove 2 to 3 September, Salty Springs 5 to 6, Retail
// Row 7 to 8, Wailing Woods 10 to 11, Lazy Links 13 to 14 and Pleasant Park 16 to 17 September; and Kevin the Cube: it
// "proceeded to the edge of Loot Lake on September 19, 2018" and dissolved there. 🟡 The wiki gives the runes' days, not
// their hours: every change is put at 21:00 UTC (5 PM EDT, the Crack Closure's hour), the purple crack from Update v5.30's
// release (23 August, 4 AM ET), and the first roll from the cube's appearing (the wiki: "Though it first appeared to be a
// stationary object, it began to move"). 5.30 was played until Update v5.40 (6 September); its paks have the whole
// journey, so the replay serves all of it, the Lake to the season's end. 5.40 (CL-4352937) plays the same journey from its
// release (the Cube between Salty Springs and Retail Row): its CUBE binds _MoveTo1 to _8 and _Rune1 to _7 (EventsToBindTo),
// its eighth leg the one to the lake (5.30's _MoveToLake), and its Cube_Dest_Scripting watches BR_S5_Cube_Destination
// (5.30's _Lake); the crack's two aren't in its paks. 5.41's (CL-4363240) paks have 5.40's names. Each step names both
// builds' flags, and a build is served its own.
//
// On Season 5's replay (store/itemshop.js seasonMoment) these windows are mapped to real time lap by lap (the replay's
// 12 July to 27 September), as events/tomatorift.js's; the admin panel can set its own times instead, step by step or from
// one step at Epic's spacing, or take the Cube off (events/datedflags.js, Core-Backend #311), or roll it to its next
// location now and hold it there (datedRollSchedule, Core-Backend #322: how a running match rolls it is there).
//
// The appearing, the Crack Closure (Core-Backend #295: the admin panel's "Spawn the Cube now", datedSpawnSchedule). 5.30's
// paks script it from the end of EventFlag.BR_S5_Cube_Lightning; no level sequence plays it (5.30's CUBE and
// BP_Athena_Event_Components, as served in its pakchunkCoreServerAssets pak; the placed actors are Athena_GameplayActors'):
// - BP_Athena_Event_Components (on the server, from the match's start: OnHandleMatchHasStarted, then a second) watches
//   the lightning. On OnEventActive and OnEventUpdated it keeps TotalTimeEvent (TimeSinceBegin + TimeUntilEnd) and, only
//   when TimeUntilEnd is at most MinutesOfFinalLightning (0.25) + 60 minutes, sets EnableFinalLightning for
//   TimeUntilEnd - 15 s - LightningWarmupTime (5 s) and DisableFinalLightning 18 s after it, and DoLighting for the next
//   strike (CalculateTimeToNextStrike: CountdownFrequency 60, 30, 15, 7.5 then 3 minutes by the part of TotalTimeEvent
//   gone, CountdownTiming 0, 0.2, 0.4, 0.6, 0.8, on the minutes left that are a multiple of it). Further from the end it
//   only works out which cacti earlier strikes took (CactusHitIndex). Each strike is SingleLightning (NetMulticast):
//   5 seconds' warm-up on LightningStrikePoints[n] (the hill), then the bolt (strength 3, a beam, in the last 30
//   minutes). EnableFinalLightning sets FinalLightningActive (replicated): its bolt 4 on the hill's centre, a 15-second
//   beam (CubeAppearEffects' LightingStrikeEffects, 12.5 s, launching players near it), and 12.5 s after it strikes,
//   on each client, the rift closes (CentralCrack hidden, P_Geode_Rift_Close, Crack_EndEvent_Start_Cue).
// - CUBE (on the server, from the match's start: TurnOn's and _Lake's watchers at once, the lightning's 2 s later)
//   on the lightning's OnEventActive (not OnEventUpdated), with under 60 minutes to its end: SetSpecificTimeOfDay so
//   that it is SpawnTimeOfDay (3:30, night) at the end, and SpawnCube TimeUntilEnd - CubeAppearEffectTime (2.5 s) on,
//   which plays CubeSpawnEffect (NetMulticast: P_Cube_Spawn and Cube_Spawn_Cue on its hill, Steps[0]) and 2.5 s later
//   TurnOn: PathIndex 0, CubeVisibleWithCollision (OnRep_CubeHidden: CubeAppear's glow) and CubeTurnedOn.
//   BR_S5_Cube_TurnOn turning on does the same at once unless SpawnCube's timer is still running.
// So the lightning's end is the appearing, and _TurnOn (and the first leg) start there. A running match sees the
// change within 5 seconds (CoreV2's calendar revision) as the lightning newly on, so the appearing must be over 20
// seconds away (the final bolt's warm-up) and under an hour (CUBE's limit): the panel's "now" is 30 seconds. A match
// where the lightning was already on gets OnEventUpdated, which CUBE ignores (the Cube then appears without its spawn
// effect at _TurnOn), and one whose Cube is out already keeps it. 5.40's and 5.41's CUBE watch no lightning and set no
// SpawnCube timer, and their paks have neither flag of the crack: _TurnOn alone puts the Cube on its hill there.
//
// The sinking into Loot Lake (Core-Backend #295: the admin panel's "Sink the Cube now", datedSinkSchedule, which has how the
// game plays it): 19 September 2018, on 5.41 (the Fortnite Wiki's Kevin the Cube; Game Informer and others reported it that
// day: it rolled onto the lake, dissolved, and the lake turned purple and bouncy). 5.40's and 5.41's CUBE (Runes 42, 114,
// 186, 240, 314, 381, 460 of 566 Steps; 5.41's differs by a tilted-impact sound and replay fixes) and Cube_Dest_Scripting
// (placed in Athena_POI_Lake_001, with its LakeActor, BP_Athena_Water_LootLake_Child) play it from the end of _MoveTo8 and
// from _Destination; the CUBE itself is placed in Level_CUBE, a streaming level of Athena_Terrain. 5.30's has no lake
// sequence. 6.00's (CL-4402180) paks still hold CUBE and Cube_Dest_Scripting, but no map places them (it has no Level_CUBE
// and no BP_Athena_Water_LootLake_Child): its Loot Lake is Season 6's (Athena_POI_Lake_002 and _LakeIsland_002), with
// the floating island (Athena_POI_Foundations' BP_IslandScripting and CUBE_Simple) whose calendar events are named by the
// server-only BP_IslandServerOnly (not in CL-4402180's client paks; Core-ServerAssets' CL-4395664 pak has it) and served
// by Season 6's dates (events/island.js); so 6.00 plays neither the Cube nor the sink, and isn't served the Cube's flags.
// 6.01's (CL-4424678) paks are the same there (CUBE and Cube_Dest_Scripting cooked, placed by no map), so neither is 6.01,
// nor 6.02 (CL-4461277: its CUBE is 6.01's byte for byte), nor 6.10 (CL-4480234: CUBE's and Cube_Dest_Scripting's uexp are
// 6.02's byte for byte, and its scan has no new flag), nor 6.20 (CL-4497486: its scan has no new Cube flag either; its
// Cube Monsters are the Deimos playlists', events/ltms.js, not the calendar's).
// The panel also puts the Cube straight at any of its stops (datedMoveSchedule): a running match rolls
// it onto a rune from the path's step before it and prints it, the game's own arrival; it can't replay the days-long roll
// between two runes (a leg's MoveTo moves it one step per calendar change, and IncrementIndex's next timer comes out below
// zero after its one roll).
export const cubeEvent = datedEvent("cube");
export const cubeSchedule = cubeEvent.steps.flatMap(({ flags, start, end }) => flags.map((eventType) => ({ eventType, start, end: end ?? season5EndDay })));

// The Cube's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on (the next four changes), as events/tomatorift.js's: on 5.30 to 5.41 with the seasonal events on, in the
// Automatic mode. A flag the admin switched on is served always (season4Overrides) and one switched off never, so neither
// is scheduled here.
export function cubeStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(cubeEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(cubeEvent, datedSettings(config).cube, nowMs, seasonMoment(now, null, 5).getTime());
  // Each build only the names its paks have (5.30's _MoveToLake and _Lake, 5.40's and 5.41's _MoveTo8 and _Destination).
  const elsewhere = cubeEvent.steps.flatMap(({ flags }) => flags).filter((flag) => !onBuild(season4Flag(flag), changelist));
  return datedParts(windows, nowMs, cubeEvent.parts, new Set([...off, ...on, ...elsewhere]));
}
