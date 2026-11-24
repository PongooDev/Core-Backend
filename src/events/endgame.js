import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, endgameCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, ltmAshton, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Season 8's Endgame (8.50, CL-6058028): Update v8.50 (25 April 2019), "Join the battle for the Infinity Stones! Fight as
// Chitauri and Thanos or wield Avengers items in the Endgame LTM"; the Fortnite Wiki has the Endgame Challenges from 25
// April to 5 May 2019. 8.50's paks have them as Athena/Items/ChallengeBundleSchedules/LTM/Schedule_LTM_Ashton ("Endgame
// Challenges", CalendarEventTag EventFlag.LTM_Ashton, CalendarEventName CalendarEvent_Season8_Ashton,
// CleanUpOnBundleCompletion), whose one bundle, QuestBundle_LTM_Ashton, gives three challenges with the bundle (damage
// hovering with Iron Man's Repulsors, collect 3 Infinity Stones, play 7 matches), three on DaysFromEventStart 2
// (Stormbreaker throws, Chitauri Jetpack damage, eliminations in 5 matches), three on 4 (Captain America's Shield, the
// Chitauri Laser Rifle, 3 wins as the Chitauri or Thanos) and three on 6 (damage after Hawkeye's grapple, the Chitauri
// Energy Launcher, 3 wins as the heroes); any 10 give the Avengers Quinjet glider. The schedule is given at the quest
// login while the flag is served (profiles/athena.js settleEventSchedules), and the calendar serves the flag and the
// calendar event on their dates (events/datedflags.js endgame), the admin's times, or off; the switch serves the flag
// always or never (events/season4flags.js). The mode is events/ltms.js's Endgame.
export const endgameEvent = datedEvent("endgame");
export const endgameBuild = 6058028;

// The challenges' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 8.50 and 8.51 (its paks keep the schedule) with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function endgameStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(endgameEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(endgameEvent, datedSettings(config).endgame, nowMs,
    seasonMoment(now, null, endgameEvent.season).getTime());
  return datedParts(windows, nowMs, endgameEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const endgameFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (endgameStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

const dayMs = 86400000;
// How many whole days the challenges have run, for the nine that unlock DaysFromEventStart: from their step's start (25
// April 2019, 00:00 UTC, on Season 8's replay; the admin's own start in the custom mode), null before it or when nothing
// serves the flag. While the admin's switch serves the flag it is on for good, so every day has come.
export function endgameDay(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(endgameEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn()) return null;
  const { off, on } = season4Overrides(changelist, config);
  if (off.includes(ltmAshton)) return null;
  if (on.includes(ltmAshton)) return Infinity;
  if (!endgameFlagsNow(now, changelist, config).includes(ltmAshton)) return null;
  const setting = datedSettings(config).endgame;
  const [first] = endgameEvent.steps;
  const start = setting.mode === "custom"
    ? Date.parse(setting.schedule.find(({ step }) => step === first.id)?.startAt ?? "")
    : null;
  const days = start === null
    ? Math.floor((seasonMoment(now, null, 8).getTime() - first.start) / dayMs)
    : Math.floor((now.getTime() - start) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export { endgameCalendarEvent };
