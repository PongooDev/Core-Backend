import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, iceStormCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, ltmWinterDeimos, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// The Ice Storm Challenges (7.20, CL-4727874; events/events.js). The Fortnite Wiki's Ice Storm (19 January 2019, 11:00 AM
// PST: the Ice King's storm blanketed the island in snow and summoned the Ice Legion): "To mark the event, all players were
// granted the Ice Storm Challenges", and its Ice Storm Challenges: "available from January 19th 2019 to January 28th 2019
// ... Starting from the beginning of the event, only one challenge was unlocked. However, for every day that passed,
// another challenge would unlock". 7.20's paks have them as Athena/Items/ChallengeBundleSchedules/LTM/Schedule_WinterDeimos
// (CategoryID FNWD, EventName EventFlag.LTM_WinterDeimos, CleanUpOnBundleCompletion), whose one bundle,
// QuestBundle_WinterDeimos ("Ice Storm Challenges", CalendarEventName CalendarEvent_Season7_WinterDeimos), gives three
// quests with it (Quest_FNWD_CompleteQuests, "Complete Ice Storm challenges", six for the Blue Metallic wrap in
// GB_ChallengeComplete; destroy Ice Fiends; damage the Ice Legion with explosive weapons) and two more each day
// DaysFromEventStart 1 to 5 days after the event's start (the extractor's unlockType and unlockValue), and the Winter's
// Thorn glider (Glider_ID_114_IceQueen) once all are done. Its Ice Storm modes are events/ltms.js's.
// The schedule is given at the quest login while the flag is served (profiles/athena.js settleEventSchedules), each later
// challenge at the first quest login on or after its day (profiles/challenges.js, events/fourteendays.js eventDaysOf), and
// the calendar serves the flag and the bundle's calendar event with the event's activeSince and activeUntil
// (events/datedflags.js's dates on Season 7's replay, or the admin's own times, or off; the switch serves the flag always or
// never, events/season4flags.js).
export const iceStormEvent = datedEvent("iceStorm");
const dayMs = 24 * 60 * 60 * 1000;

// The flags' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 7.20 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function iceStormStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(iceStormEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(iceStormEvent, datedSettings(config).iceStorm, nowMs, seasonMoment(now, null, 7).getTime());
  return datedParts(windows, nowMs, iceStormEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the event's dates (none outside them), for the quest login's event schedules.
export const iceStormFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (iceStormStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

// How many whole days the event has run, for its challenges that unlock DaysFromEventStart: from its step's start (19
// January 2019, 19:00 UTC, on Season 7's replay; the admin's own start in the custom mode), null before it or when nothing
// serves the flag. While the admin's switch serves the flag it is on for good, so every day has come.
export function iceStormDay(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(iceStormEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn()) return null;
  const { off, on } = season4Overrides(changelist, config);
  if (off.includes(ltmWinterDeimos)) return null;
  if (on.includes(ltmWinterDeimos)) return Infinity;
  if (!iceStormFlagsNow(now, changelist, config).includes(ltmWinterDeimos)) return null;
  const setting = datedSettings(config).iceStorm;
  const [first] = iceStormEvent.steps;
  const start = setting.mode === "custom"
    ? Date.parse(setting.schedule.find(({ step }) => step === first.id)?.startAt ?? "")
    : null;
  const days = start === null
    ? Math.floor((seasonMoment(now, null, 7).getTime() - first.start) / dayMs)
    : Math.floor((now.getTime() - start) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export { iceStormCalendarEvent };
