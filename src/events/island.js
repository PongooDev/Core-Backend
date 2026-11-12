import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Season 6's floating island (6.00, CL-4395664 and CL-4402180; PongooDev/CoreV2#401). How 6.00 places it:
// - Athena/Prototype/Blueprints/Island/BP_IslandScripting, placed in Athena_POI_Foundations (BP_IslandScripting3), on the
//   server (HasAuthority) loads the server-only BP_IslandServerOnly (a FortServerOnlyObject) and watches its
//   EventBindings with one FortAsyncAction_CalendarMultiEventWatcher. Those are, in its order (CL-4395664's server-assets
//   pak, Core-ServerAssets release cl-4395664, read with CUE4Parse): EventFlag.BR_S6_Island_MoveTo1 to _MoveTo7,
//   _Rune0 to _Rune7, _MoveTo8. 6.00's client paks (CL-4402180) don't have BP_IslandServerOnly, so a host's server needs
//   the server-assets pak for the island to be placed at all.
// - Only OnEventActive (an event active at a calendar download that wasn't at the one before) does anything; OnEventUpdated
//   and OnEventEnded keep the event's name and times and stop. An event whose name holds "Rune" sets CachedTime to the
//   name's last digit; one whose name holds "MoveTo" sets it to that digit less one plus Lerp(0.08, 0.97, the event's
//   progress), its TimeSinceBegin over TimeSinceBegin + TimeUntilEnd. So with two island events on, the island goes where
//   the last to turn on says: Core serves one at a time.
// - CachedTime is a point on its Spline (GetIslandPositionFromTime: the distance along it between the points either side,
//   snapped to the build grid, 512 by 512 by 384): point 0 is Loot Lake (66048, -43008, 7680, where the level places the
//   Lake Island plot), points 1 to 7 the runes, and point 8 Loot Lake again. That is IslandPosition, replicated:
//   OnRep_IslandPosition broadcasts IslandPositionUpdate, which the level blueprint's SetLevelPosition (on the server)
//   turns into ABuildingFoundation::SetDynamicFoundationTransform on LF_Athena_StreamingTest13, the Lake Island plot,
//   whose level (Athena_POI_LakeIsland_002) moves with it (CoreV2 restored that stripped function, 23527899); on clients it
//   is AFortGameStateAthena::SetFloatingIslandInformation(IslandPosition, CachedTime > 0 and whole), the map's island icon,
//   lit (FloatingIslandBrushActivated) while it stands over a rune 1 to 7, and the vortex's centre (AthenaVortexCenter).
//   CachedTime also sets Growthstage (the Cube's growth in the house, its whole part) and CrackProgress (CachedTime / 7)
//   and tells DudeBro_VortexMeshes whether it is at a rune (its rune beam's sounds, IsAtRune).
// - With no island event on, CachedTime stays -1 and nothing places it: the map icon sits at (0, 0, 0), the map's middle,
//   and the Lake Island plot's level never streams in on the server, so a client that streams it in near Loot Lake is
//   kicked ("ignored non-existant package").
// What a match plays: the island is put once, at the match's first calendar download, and moves only when another island
// event turns on (a running Core gameserver fetches the calendar within 5 seconds of an admin's change: CoreV2's
// AFortGameModeAthena::AskEventCalendarRevision). A leg doesn't fly it across the map in a match; a match that starts on a
// leg has it partway along by the leg's progress then (8% at its start, 97% at its end).
//
// Epic's dates (the Fortnite Wiki's Floating Island, Chapter 1, Season 6 history): on 27 September 2018 the island rose over
// Loot Lake; on 28 September it started moving to the rune southwest of Pleasant Park and on the 29th the Cube lifted that
// rune; on 1 October it returned the rune and moved to the one by Shifty Shafts (lifted 3 October); on 5 October to
// northwest of Fatal Fields (6 October); on 8 October to south of Retail Row (ComicBook.com reported it "just activated" on
// 9 October; the wiki has it lifted and returned on the 10th); on 10 October to Wailing Woods (13 October); on 14 October
// to Lazy Links (16 October); on 17 October to the map's middle (18 October); on 20 October the runes reached the island
// and it moved back over Loot Lake (Leaky Lake), where it was on 21 October. The spline's points are those places in that
// order. 🟡 The days are the wiki's (Retail Row's arrival ComicBook.com's), none of them has hours, so every change is put
// at 00:00 UTC of its day. What followed isn't 6.00's: the runes rising and flying to the island (18 to 20 October), the
// sky portal (21 October), the island breaking up (24 October) and the Cube's end (3 and 4 November) are later updates'
// content with no flag in BP_IslandServerOnly, so on the replay the island stays over Loot Lake (rune 0) to the season's end.
// 6.00 itself was played only until Update v6.01, but its scripting has the whole journey, so the replay serves all
// of it on Season 6's 70 days (store/itemshop.js seasonMoment), lap by lap from the day 6.00 is first served, as the Cube's
// on Season 5's (events/cube.js). The admin panel can set its own times (events/datedflags.js) or put the island straight
// at any of its stops and keep it there (datedMoveSchedule: that stop's flag alone, from now).
//
// 6.01 (CL-4417689 and CL-4424678) keeps the island, served by the same flags and dates (season4flags.js). Its
// BP_IslandScripting (CL-4424678's client paks, against 6.00's) is 6.00's with three changes:
// - OnEventActive does nothing once HasSetIslandPosition is set, which the server does the first time it gives
//   IslandPosition a place (after OnRep_IslandPosition). So a 6.01 match places the island once, by the first island
//   event it finds active, and keeps it there: an island flag that turns on later (the next leg or rune on the replay, or
//   the admin's stop) moves it in the next match, not in a running one, where 6.00 took the last to turn on.
// - GetIslandPosition, without MCP (UFortKismetLibrary::IsRunningNoMCP), puts CachedTime at 1, the first rune, instead of
//   binding the calendar's events. A Core server runs with MCP, so it binds them as 6.00's does.
// - On clients OnRep_IslandPosition goes through TrySetIslandLocation, which waits (a one second timer) for the game
//   state before SetFloatingIslandInformation, the map's island icon.
// Its event names are read as 6.00's ("Rune" and "MoveTo" by their last digit, the leg's progress 8% to 97%) over the
// same nine spline points (its Spline is 6.00's, point for point), and they are the same sixteen: 6.01's own
// BP_IslandServerOnly (Core-ServerAssets' CL-4417689 pak, release cl-4417689) binds 6.00's names in 6.00's order. A
// CL-4424678 host needs that asset too: Core-ServerAssets has no pak for it yet (2026-11-12).
//
// 6.02 (CL-4442095 and CL-4461277) keeps it as 6.01 has it: CL-4461277's BP_IslandScripting is 6.01's byte for byte
// (uasset and uexp), and 6.02's own BP_IslandServerOnly (Core-ServerAssets' CL-4442095 pak, release cl-4442095, read over
// HTTP ranges) binds the same sixteen names in the same order. Update v6.02 came on 10 October, the day the island left
// the Retail Row rune for Wailing Woods' (MoveTo5), where the replay has a 6.02 match find it. A CL-4461277 host needs
// that asset too: Core-ServerAssets has CL-4442095's pak only (2026-11-12).
export const islandEvent = datedEvent("island");

// The island's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on (the next four changes), as events/cube.js's: on 6.00 to 6.02 with the seasonal events on, in the
// Automatic mode. A flag the admin switched on is served always (season4Overrides) and one switched off never, so neither is
// scheduled here.
export function islandStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(islandEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(islandEvent, datedSettings(config).island, nowMs, seasonMoment(now, null, 6).getTime());
  return datedParts(windows, nowMs, islandEvent.parts, new Set([...off, ...on]));
}
