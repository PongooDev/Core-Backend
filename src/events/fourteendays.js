import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, fourteenDaysCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, lteBootyBay, lteFestivus, lteS7Overtime, ltm14DaysOfFortnite, ltmWinterDeimos, seasonalEventsOn } from "./events.js";
import { showtimeDay } from "./festivus.js";
import { overtimeDay } from "./overtime.js";
import { buccaneersBountyDay } from "./buccaneersbounty.js";
import { iceStormDay } from "./icestorm.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// The 14 Days of Fortnite (7.10, CL-4667333; events/events.js). Update v7.10 (18 December 2018): "Explore new Challenges,
// play in new and old LTM's, and unlock rewards in this seasonal event, starting December 19!" 7.10's paks have its
// challenges as Athena/Items/ChallengeBundleSchedules/LTM/Schedule_14DaysOfFortnite (CategoryID 14DoF, EventName
// EventFlag.LTM_14DaysOfFortnite, CleanUpOnBundleCompletion), whose one bundle, QuestBundle_14DaysOfFortnite (VisualStyle
// FourteenDays, CalendarEventName CalendarEvent_Season7_14DaysOfFortnite), gives its first challenge with it ("Start or
// Join a Creative Server", GrantWithBundle) and each of the other thirteen DaysFromEventStart 1 to 13 days after the
// event's start (the extractor's unlockType and unlockValue), each in the gift box GB_14DaysofFortnite (giftBox), and the
// 14 Days ribbon banner (HomebaseBannerIcon:BR14DaysRibbon) once all fourteen are done. The Fortnite Wiki's 14 Days of
// Fortnite Challenges: "Starting from the beginning of the event, only one challenge was unlocked. However, for every day
// that passed, another challenge would unlock to be completed, until all fourteen were available to do."
// The schedule is given at the quest login while the flag is served (profiles/athena.js settleEventSchedules), each later
// challenge at the first quest login on or after its day (profiles/challenges.js), and the calendar serves the flag and the
// bundle's calendar event with the event's activeSince and activeUntil (events/datedflags.js's dates on Season 7's
// replay, or the admin's own times, or off; the switch serves the flag always or never, events/season4flags.js).
export const fourteenDaysEvent = datedEvent("fourteenDays");
const dayMs = 24 * 60 * 60 * 1000;
// The build its dates serve it on: 7.10's. 7.20's paks keep the schedule, but Update v7.20 says "The 14 Days of Fortnite
// event has ended", so 7.20 serves it by the admin's switch only.
const datedBuild = 4667333;

// The flags' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 7.10 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function fourteenDaysStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(fourteenDaysEvent.flag);
  if (!entry || Number(changelist) !== datedBuild || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(fourteenDaysEvent, datedSettings(config).fourteenDays, nowMs, seasonMoment(now, null, 7).getTime());
  return datedParts(windows, nowMs, fourteenDaysEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the event's dates (none outside them), for the quest login's event schedules.
export const fourteenDaysFlagsNow = (now = new Date(), changelist = currentBuild()) =>
  (fourteenDaysStates(now, changelist)[0]?.events ?? []).map(({ eventType }) => eventType);

// How many whole days the event has run for an event challenge that unlocks DaysFromEventStart: from its first step's
// start (19 December 2018, 14:00 UTC, on Season 7's replay; the admin's own start in the custom mode), null before it or
// when nothing serves the flag. While the admin's switch serves the flag it is on for good, so every day has come.
export function fourteenDaysDay(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(fourteenDaysEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn()) return null;
  const { off, on } = season4Overrides(changelist, config);
  if (off.includes(ltm14DaysOfFortnite)) return null;
  if (on.includes(ltm14DaysOfFortnite)) return Infinity;
  if (!fourteenDaysFlagsNow(now, changelist).includes(ltm14DaysOfFortnite)) return null;
  const setting = datedSettings(config).fourteenDays;
  const first = fourteenDaysEvent.steps[0];
  const start = setting.mode === "custom"
    ? Date.parse(setting.schedule.find(({ step }) => step === first.id)?.startAt ?? "")
    : null;
  const days = start === null
    ? Math.floor((seasonMoment(now, null, 7).getTime() - first.start) / dayMs)
    : Math.floor((now.getTime() - start) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

// The days an event schedule's challenges have had, by its event flag: the 14 Days of Fortnite's, 7.20's Ice Storm
// Challenges' (events/icestorm.js), 7.30's Showtime Challenges' (events/festivus.js) and 7.40's Overtime Challenges'
// (events/overtime.js) and 8.30's Buccaneer's Bounty Challenges' (events/buccaneersbounty.js) count days; no other
// event's does.
const eventDays = { [ltm14DaysOfFortnite.toLowerCase()]: fourteenDaysDay, [ltmWinterDeimos.toLowerCase()]: iceStormDay,
  [lteFestivus.toLowerCase()]: showtimeDay, [lteS7Overtime.toLowerCase()]: overtimeDay,
  [lteBootyBay.toLowerCase()]: buccaneersBountyDay };
export const eventDaysOf = (eventName, now = new Date()) => eventDays[String(eventName ?? "").toLowerCase()]?.(now) ?? null;

export { fourteenDaysCalendarEvent };
