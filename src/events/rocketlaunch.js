import { currentBuild } from "../builds/context.js";
import { currentEventsConfig, eventsActiveUntil, seasonalEventsOn } from "./events.js";

// Blast Off, Season 4's live event: the rocket that left the villain lair north of Snobby Shores on 30 June 2018 at 18:00
// UTC, cracked the sky and left a rift behind (Update v4.50's season, 4.5: CL-4159770 and CL-4166199). No hotfix or
// curve row drives it: 4.5's map runs it from Epic's calendar, as every EventFlag.* its paks hold says (the byte scan of
// all 215,808 files of CL-4166199's archive, events/events.js):
// - Athena/Maps/Test/Events/BP_GeodeScripting (the rocket, its lair, the countdown and the launch's level sequence)
//   watches three calendar events with FortAsyncAction_CalendarEventWatcher::WatchCalendarEvent, whose OnEventActive,
//   OnEventUpdated and OnEventEnded hand it (EventName, TimeUntilEnd), TimeUntilEnd being the time to the event's
//   activeUntil:
//   - EventFlag.BR_S4_Geode_Countdown: OnEventActive keeps TimeUntilEnd as TimeUntilCountdownEnd and, on the server
//     (HasAuthority), sets ServerWorldSecondsAtLaunch = GetServerWorldTimeSeconds + its seconds, replicated
//     (OnRep_ServerWorldSecondsUntilLaunch): the hologram's countdown (days, hours, minutes and seconds digits,
//     MPC_Countdown, its dial TimespanRemaining / CountdownTotalSeconds, 172,800: 48 hours) and the klaxons at 600, 540 ...
//     120 seconds counts to the countdown event's activeUntil. ShowPhase2 = 1.
//   - EventFlag.BR_S4_Geode_Begin: OnEventActive sets SequenceStartTime = TotalLaunchSequenceLength (240 seconds) -
//     TimeUntilEnd and, on the server, plays LaunchRocketSequence from there (JumpToSeconds, Play): the launch is the
//     240 seconds before the begin event's activeUntil, so a match that starts during it joins the launch where it is.
//   - EventFlag.BR_S4_Geode_Over: OnEventActive, on the server, ShowPhase2 = 0 and VillainBase = 0: the countdown and
//     the lair after the launch. BP_HologramCountDown watches it too.
// - Athena/Events/BP_Athena_Event_Components (CrackEvent EventFlag.BR_S4_Rift_Growth, CrackEventDuration 13.6): while the
//   event is active its sky crack shows (AreCracksVisible) and grows, CrackProgression = MapRangeClamped(days to its
//   activeUntil, 13.6, 0, 0, 3).
// So the backend's half is the calendar (services/fortnite/calendar.js): the client-events channel names each of those
// events in activeEvents, {eventType, activeSince, activeUntil}, in states whose validFrom is when they start, and the
// channel is good no later than the next change. With a launch time L (the admin panel's, events config rocketLaunch):
//   EventFlag.BR_S4_Geode_Countdown  from L - countdownHours (48 by default) until L
//   EventFlag.BR_S4_Geode_Begin      from L until L + 240 s
//   EventFlag.BR_S4_Geode_Over       from L + 240 s on (activeUntil: never, eventsActiveUntil)
//   EventFlag.BR_S4_Rift_Growth      from L + 240 s until L + 240 s + 13.6 days
// Before the countdown no flag is served: the rocket waits in its lair. The gameserver reads the same timeline (it runs
// the BP's server half: the launch sequence and the replicated countdown). Without a launch time nothing is served.
// Athena_OdditiesActors' EventFlag.BR_S4_Oddity_01 to _08 _Tell and _Event (the rifts that took the map's objects in
// July, with AthenaGameData's Default.Oddities.Intensity row at 0) are left to the Custom flags.
export const rocketLaunchBuilds = [4159770, 4166199];
export const geodeCountdown = "EventFlag.BR_S4_Geode_Countdown";
export const geodeBegin = "EventFlag.BR_S4_Geode_Begin";
export const geodeOver = "EventFlag.BR_S4_Geode_Over";
export const riftGrowth = "EventFlag.BR_S4_Rift_Growth";
// Epic's: 30 June 2018, 18:00 UTC (2 PM Eastern).
export const originalRocketLaunch = "2018-06-30T18:00:00.000Z";
export const launchSequenceSeconds = 240;
export const riftGrowthDays = 13.6;
export const defaultCountdownHours = 48;
export const defaultRocketLaunch = { at: null, countdownHours: defaultCountdownHours };

export const hasRocketLaunch = (changelist = currentBuild()) => rocketLaunchBuilds.includes(Number(changelist));

// The events config's rocketLaunch: {at: ISO time or null, countdownHours 0 to 168}.
export function sanitizeRocketLaunch(value, current = defaultRocketLaunch) {
  const result = { ...defaultRocketLaunch, ...(current ?? {}) };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  if (value.at === null || value.at === "") result.at = null;
  else if (typeof value.at === "string" && !Number.isNaN(Date.parse(value.at))) result.at = new Date(Date.parse(value.at)).toISOString();
  const hours = Number(value.countdownHours);
  if (value.countdownHours !== undefined && Number.isFinite(hours) && hours >= 0 && hours <= 168) result.countdownHours = hours;
  return result;
}

// The launch's moments (ms) on a 4.5 build with a launch time set and the seasonal events on; null otherwise.
export function rocketLaunchTimes(changelist = currentBuild(), config = currentEventsConfig()) {
  if (!hasRocketLaunch(changelist) || !seasonalEventsOn() || config?.mode === "off") return null;
  const { at, countdownHours } = sanitizeRocketLaunch(config?.rocketLaunch);
  if (!at) return null;
  const launch = Date.parse(at);
  const sequenceEnd = launch + launchSequenceSeconds * 1000;
  return { countdownStart: launch - countdownHours * 3600000, launch, sequenceEnd, riftEnd: sequenceEnd + Math.round(riftGrowthDays * 86400000) };
}

const iso = (ms) => new Date(ms).toISOString();

// The calendar events of each part of the launch: [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}],
// from the part that holds now on (an empty list without a launch time). Before the countdown the part has no events.
export function rocketLaunchStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const t = rocketLaunchTimes(changelist, config);
  if (!t) return [];
  const event = (eventType, since, until) => ({ eventType, activeSince: iso(since), activeUntil: until === null ? eventsActiveUntil : iso(until) });
  const parts = [
    { validFrom: -Infinity, events: [] },
    { validFrom: t.countdownStart, events: [event(geodeCountdown, t.countdownStart, t.launch)] },
    { validFrom: t.launch, events: [event(geodeBegin, t.launch, t.sequenceEnd)] },
    { validFrom: t.sequenceEnd, events: [event(geodeOver, t.sequenceEnd, null), event(riftGrowth, t.sequenceEnd, t.riftEnd)] },
    { validFrom: t.riftEnd, events: [event(geodeOver, t.sequenceEnd, null)] }
  // A part that takes no time (a countdown of 0 hours) gives way to the next.
  ].filter((part, index, all) => index === all.length - 1 || part.validFrom < all[index + 1].validFrom);
  const time = now.getTime();
  const current = parts.findLastIndex((part) => part.validFrom <= time);
  return parts.slice(Math.max(0, current));
}

// The rocket's event flags in force now (none without a launch time).
export const rocketLaunchFlags = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (rocketLaunchStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

// The next moment the launch's flags change after now (ms), for the calendar's cacheExpire; null for none.
export function nextRocketLaunchChange(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const next = rocketLaunchStates(now, changelist, config)[1];
  return next ? next.validFrom : null;
}

// The admin panel's view: the launch time, the countdown, the phase now and the four moments.
export function rocketLaunchStatus(now = new Date(), config = currentEventsConfig()) {
  const { at, countdownHours } = sanitizeRocketLaunch(config?.rocketLaunch);
  const t = at ? rocketLaunchTimes(rocketLaunchBuilds[1], config) : null;
  const time = now.getTime();
  const phase = !at ? "unscheduled" : !t ? "off" : time < t.countdownStart ? "scheduled" : time < t.launch ? "countdown"
    : time < t.sequenceEnd ? "launching" : time < t.riftEnd ? "rift" : "over";
  return { at, countdownHours, phase, original: originalRocketLaunch,
    ...(t ? { countdownStart: iso(t.countdownStart), launch: iso(t.launch), sequenceEnd: iso(t.sequenceEnd), riftEnd: iso(t.riftEnd) } : {}) };
}
