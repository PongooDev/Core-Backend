import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { buccaneersBountyCalendarEvent, datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, lteBootyBay, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Season 8's Buccaneer's Bounty (8.30, CL-5793395): Update v8.30 (10 April 2019), "Test your skills in a fresh LTM every
// single day and collect your very own treasure in the form of in-game rewards by completing free Challenges"; the
// Fortnite Wiki has the event from 10 to 16 April 2019. 8.30's paks have its challenges as Athena/Items/
// ChallengeBundleSchedules/LTM/Schedule_PirateParty (CalendarEventTag EventFlag.LTE_BootyBay, CalendarEventName
// CalendarEvent_Season8_BootyBay, CleanUpOnBundleCompletion), whose one bundle, QuestBundle_PirateParty, gives
// Quest_BR_PP_Visit_PirateCamps with the bundle and opens Quest_BR_PP_BuriedTreasure, _Top10_Squads_WithFriend and
// _Use_Cannon one each day after (DaysFromEventStart 1 to 3); all four give the Boobytrapped emote (eid_pirategold).
// The schedule is given at the quest login while the flag is served (profiles/athena.js settleEventSchedules), and the
// calendar serves the flag and the calendar event on their dates (events/datedflags.js buccaneersBounty), the admin's
// times, or off; the switch serves the flag always or never (events/season4flags.js). The day's modes are
// events/ltms.js's Buccaneer's Bounty entries.
export const buccaneersBountyEvent = datedEvent("buccaneersBounty");
export const buccaneersBountyBuild = 5793395;

// The challenges' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 8.30 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function buccaneersBountyStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(buccaneersBountyEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(buccaneersBountyEvent, datedSettings(config).buccaneersBounty, nowMs,
    seasonMoment(now, null, buccaneersBountyEvent.season).getTime());
  return datedParts(windows, nowMs, buccaneersBountyEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const buccaneersBountyFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (buccaneersBountyStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

const dayMs = 86400000;
// How many whole days the challenges have run, for the three that unlock DaysFromEventStart: from their step's start (10
// April 2019, 00:00 UTC, on Season 8's replay; the admin's own start in the custom mode), null before it or when nothing
// serves the flag. While the admin's switch serves the flag it is on for good, so every day has come.
export function buccaneersBountyDay(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(buccaneersBountyEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn()) return null;
  const { off, on } = season4Overrides(changelist, config);
  if (off.includes(lteBootyBay)) return null;
  if (on.includes(lteBootyBay)) return Infinity;
  if (!buccaneersBountyFlagsNow(now, changelist, config).includes(lteBootyBay)) return null;
  const setting = datedSettings(config).buccaneersBounty;
  const [first] = buccaneersBountyEvent.steps;
  const start = setting.mode === "custom"
    ? Date.parse(setting.schedule.find(({ step }) => step === first.id)?.startAt ?? "")
    : null;
  const days = start === null
    ? Math.floor((seasonMoment(now, null, 8).getTime() - first.start) / dayMs)
    : Math.floor((now.getTime() - start) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export { buccaneersBountyCalendarEvent };
