import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { cubeLake, cubeLightning, cubeMoveTo, cubeMoveToLake, cubeRune, cubeStartMove, cubeTurnOn, currentEventsConfig, riftCorrupt,
  seasonalEventsOn } from "./events.js";
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
// journey, so the replay serves all of it, the Lake to the season's end.
//
// On Season 5's replay (store/itemshop.js seasonMoment) these windows are mapped to real time lap by lap (the replay's
// 12 July to 27 September), as events/tomatorift.js's.
const at = (day, time = "21:00") => Date.parse(`2018-${day}T${time}:00.000Z`);
const runeDays = [["08-28", "08-29"], ["09-02", "09-03"], ["09-05", "09-06"], ["09-07", "09-08"], ["09-10", "09-11"], ["09-13", "09-14"],
  ["09-16", "09-17"]];
const closure = at("08-24");
const lakeAt = at("09-19");
const seasonFirstDay = Date.parse("2018-07-12T00:00:00.000Z");
const seasonEndDay = Date.parse("2018-09-27T00:00:00.000Z");
// The legs: [flag, start, end] in Epic's time, the rolls with StartMove alongside.
const legs = runeDays.flatMap(([stop, leave], index) => {
  const start = index === 0 ? closure : at(runeDays[index - 1][1]);
  return [[cubeMoveTo(index + 1), start, at(stop)], [cubeStartMove, start, at(stop)], [cubeRune(index + 1), at(stop), at(leave)]];
});
export const cubeSchedule = [
  [riftCorrupt, at("08-23", "08:00"), closure],
  [cubeLightning, at("08-23"), closure],
  [cubeTurnOn, closure, seasonEndDay],
  ...legs,
  [cubeMoveToLake, at(runeDays[6][1]), lakeAt],
  [cubeStartMove, at(runeDays[6][1]), lakeAt],
  [cubeLake, lakeAt, seasonEndDay]
].map(([eventType, start, end]) => ({ eventType, start, end }));
const iso = (ms) => new Date(ms).toISOString();

// The Cube's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on (the next four changes), as events/tomatorift.js's: on 5.30 with the seasonal events on, in the
// Automatic mode. A flag the admin switched on is served always (season4Overrides) and one switched off never, so neither
// is scheduled here.
export function cubeStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(cubeTurnOn);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const skip = new Set([...off, ...on]);
  const cycle = seasonEndDay - seasonFirstDay;
  const nowMs = now.getTime();
  const momentNow = seasonMoment(now, null, 5).getTime();
  // The real time this lap's replay started at, and the laps around it.
  const lapStart = nowMs - ((((momentNow - seasonFirstDay) % cycle) + cycle) % cycle);
  const windows = [lapStart - cycle, lapStart, lapStart + cycle].flatMap((lap) => cubeSchedule.map(({ eventType, start, end }) =>
    ({ eventType, since: lap + (start - seasonFirstDay), until: lap + (end - seasonFirstDay) })))
    .filter(({ eventType }) => !skip.has(eventType));
  const eventsAt = (t) => windows.filter(({ since, until }) => t >= since && t < until)
    .map(({ eventType, since, until }) => ({ eventType, activeSince: iso(since), activeUntil: iso(until) }));
  const boundaries = [...new Set(windows.flatMap(({ since, until }) => [since, until]))].filter((t) => t > nowMs).sort((a, b) => a - b).slice(0, 4);
  return [{ validFrom: -Infinity, events: eventsAt(nowMs) }, ...boundaries.map((t) => ({ validFrom: t, events: eventsAt(t) }))];
}
