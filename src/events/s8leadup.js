import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, s8Burnt, s8Cracked, s8Cracks, s8Heat, s8Tremors, seasonalEventsOn } from "./events.js";

// The lead-up to Season 8: the earthquakes and the Wailing Woods drying up, as 7.30 (CL-4834550) and 7.40 (CL-5046157)
// play them (their paks read in FModel, the Blueprints decompiled). The Fortnite Wiki's Season 7 map history: "February 5th
// 2019: ... The ground is occasionally shaking and rumbling noises can be heard, which is an earthquake. February 6th: The
// earthquakes are getting more intense, and trees and other objects are falling over", from 14 February a crack or two a
// day (its Earthquakes, "Volcanic Formation": 26 of them, the last "in Tilted Towers, destroying the News HQ" on the 27th),
// and "February 24th 2019: The grass in the west part of Wailing Woods is dying out and turning brown ... February 27th
// 2019: Wailing Woods now has ashes rising from the ground. All of the forest is brown and dried up".
// - Athena/Prototype/Blueprints/S8Leadup/BP_S8LeadupEvents, placed in Athena/Maps/Streaming/Athena_SP_VFX (both builds),
//   watches EQ (a FortAsyncAction_CalendarEventWatcher): while it is active it lays NumberOfEvents (50) tremors over EQ's
//   span by S8LeadupCurve and, for the next one due within the hour, sets a timer whose MulticastShake plays
//   GameplayCue.Athena.event.EarthquakeTremors on the clients. 7.30's does only that.
// - 7.40's, once the authority's match is ready (FortAsyncAction_AuthorityMatchReady), also reads EQ2: its CrackPhase is
//   how many of FissureHour's 27 hours EQ2 has run (its class defaults: 0, 56.5, 63.25 ... 371.3), with a timer for the
//   next, and the crack splines of Athena/Maps/Athena_Cracken (BP_SplineMesh_Cracks, ProgressOffset 1000 to 26031) grow to
//   it, 40 units in 40 seconds; ProgressionComparisonArray's 2007, 18004 and 26041 bring down Lazy Bridge, a shack (the
//   BP_Cracken_City swaps of Athena_POI_Foundations) and, with GameplayCue.Athena.Destruction.Large, Tilted Towers' News HQ.
//   With EQ2 over it reads EQH: every crack (phase 27); with neither, none. A match keeps the phase it started with until
//   its timer opens the next.
// - 7.40's BP_SnowSetup (Athena_Terrain) no longer holds the snow (7.30's SP and SP1, events/icestorm.js): once the
//   authority's match is ready it reads HP1 (active: Zone 1) and else HP (active: Zone is HP's TimeSpanRatio; neither: 0),
//   and MPC_Landscape's ColorTestAmount follows HeatCurve (0 to 5) of Zone: the woods' grass browning. A match keeps it.
// So this serves each build what it reads (7.30: EQ alone) by Epic's dates on Season 7's replay (events/datedflags.js
// earthquakes and s8Heat), the admin's times, or off. Not with the seasonal events off or in another event mode.
export const earthquakesEvent = datedEvent("earthquakes");
export const s8HeatEvent = datedEvent("s8Heat");
export const tremorsBuild = 4834550;
export const cracksBuild = 5046157;
const reads = { [tremorsBuild]: [s8Tremors], [cracksBuild]: [s8Tremors, s8Cracks, s8Cracked] };
const readsOf = (changelist) => reads[Number(changelist)] ?? [];

function states(event, reads, now, config) {
  if (!reads.length || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const nowMs = now.getTime();
  const windows = datedWindows(event, datedSettings(config)[event.id], nowMs, seasonMoment(now, null, event.season).getTime())
    .filter(({ eventType }) => reads.includes(eventType));
  return datedParts(windows, nowMs, event.parts);
}

// The earthquakes' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 7.30 (EQ) and 7.40 (EQ, EQ2 and EQH) with the seasonal events on, in the Automatic mode.
export const earthquakesStates = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  states(earthquakesEvent, readsOf(changelist), now, config);

// The Wailing Woods' heat the same way: 7.40's HP and HP1.
export const s8HeatStates = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  states(s8HeatEvent, Number(changelist) === cracksBuild ? [s8Heat, s8Burnt] : [], now, config);
