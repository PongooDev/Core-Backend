import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { airRoyaleCalendarEvent, datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, ltmGoose, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Season 8's Air Royale (8.40, CL-6005771): Update v8.40 (17 April 2019), "Pilot the X-4 Stormwing in this Limited Time
// Mode as you fight to become the last plane flying! Complete free Challenges to unlock brand new Wraps"; the Fortnite
// Wiki has the Air Royale Challenges from 17 to 24 April 2019. 8.40's paks have them as Athena/Items/
// ChallengeBundleSchedules/LTM/Schedule_LTM_Goose (CalendarEventTag EventFlag.LTM_Goose, CalendarEventName
// CalendarEvent_Season8_AirRoyale, CleanUpOnBundleCompletion), whose one bundle, QuestBundle_LTM_Goose, gives three
// challenges with the bundle (SMG or Minigun damage to Stormwings, collect the sky chests, play 7 matches: Callsign
// Skull), three on DaysFromEventStart 2 (pistol damage, destroy Stormwings, outlast 100: Callsign Falcon) and three on 4
// (assault rifle damage, damage with upgraded Stormwing weapons, a top 5: Callsign Wolf); all nine give Callsign Hornet.
// The schedule is given at the quest login while the flag is served (profiles/athena.js settleEventSchedules), and the
// calendar serves the flag and the calendar event on their dates (events/datedflags.js airRoyale), the admin's times, or
// off; the switch serves the flag always or never (events/season4flags.js). The mode is events/ltms.js's Air Royale.
export const airRoyaleEvent = datedEvent("airRoyale");
export const airRoyaleBuild = 6005771;

// The challenges' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 8.40 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function airRoyaleStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(airRoyaleEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(airRoyaleEvent, datedSettings(config).airRoyale, nowMs,
    seasonMoment(now, null, airRoyaleEvent.season).getTime());
  return datedParts(windows, nowMs, airRoyaleEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const airRoyaleFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (airRoyaleStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

const dayMs = 86400000;
// How many whole days the challenges have run, for the six that unlock DaysFromEventStart: from their step's start (17
// April 2019, 00:00 UTC, on Season 8's replay; the admin's own start in the custom mode), null before it or when nothing
// serves the flag. While the admin's switch serves the flag it is on for good, so every day has come.
export function airRoyaleDay(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(airRoyaleEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn()) return null;
  const { off, on } = season4Overrides(changelist, config);
  if (off.includes(ltmGoose)) return null;
  if (on.includes(ltmGoose)) return Infinity;
  if (!airRoyaleFlagsNow(now, changelist, config).includes(ltmGoose)) return null;
  const setting = datedSettings(config).airRoyale;
  const [first] = airRoyaleEvent.steps;
  const start = setting.mode === "custom"
    ? Date.parse(setting.schedule.find(({ step }) => step === first.id)?.startAt ?? "")
    : null;
  const days = start === null
    ? Math.floor((seasonMoment(now, null, 8).getTime() - first.start) / dayMs)
    : Math.floor((now.getTime() - start) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export { airRoyaleCalendarEvent };
