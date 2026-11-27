import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, hordeRushCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Season 9's Horde Rush Challenges (9.21, CL-6922310): the Fortnite Wiki has them "available from June 13th 2019 to June
// 19th 2019", the mode's days. 9.21's paks have them as Athena/Items/ChallengeBundleSchedules/LTM/Schedule_LTM_Mash ("Horde
// Rush Challenges", ChallengeCategory.Event, CalendarEventTag EventFlag.LTM_Mash, CalendarEventName
// CalendarEvent_Season9_Mash, CleanUpOnBundleCompletion), whose one bundle, QuestBundle_LTM_Mash, gives its challenges with
// the bundle (OnScheduleGranted): headshots on the Horde, Poison Fiends or Explosive Brutes from 5 m, score multipliers,
// Spawn Obelisk damage, Gold Brutes, a win without being eliminated and four team-score stages; all 7 give the Fiend wrap.
// They count in Horde Rush (Playlist_Mash_Squads, Athena.Playlist.Mash: events/ltms.js hordeRush). The schedule is given
// at the quest login while the flag is served (profiles/athena.js settleEventSchedules); the calendar serves the flag on
// its dates (events/datedflags.js hordeRush), the admin's times, or off, and the switch serves it always or never
// (events/season4flags.js). 9.20's paks already have the schedule but not the mode's server data, so only 9.21 serves them.
export const hordeRushEvent = datedEvent("hordeRush");
export const hordeRushBuild = 6922310;

// The challenges' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 9.21 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function hordeRushStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(hordeRushEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(hordeRushEvent, datedSettings(config).hordeRush, nowMs,
    seasonMoment(now, null, hordeRushEvent.season).getTime());
  return datedParts(windows, nowMs, hordeRushEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const hordeRushFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (hordeRushStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

export { hordeRushCalendarEvent };
