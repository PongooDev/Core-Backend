import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, wicksBountyCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Season 9's Wick's Bounty (9.01, CL-6428087): the Fortnite Wiki has the Wick's Bounty Challenges from 16 May 2019, the mode's
// first day (Squads). 9.01's paks have them as Athena/Items/ChallengeBundleSchedules/LTM/Schedule_LTM_Wax ("Wick's Bounty
// Challenges", CalendarEventTag EventFlag.LTM_Wax, CalendarEventName CalendarEvent_Season9_Wax,
// CleanUpOnBundleCompletion), whose one bundle, QuestBundle_LTM_Wax, gives all six challenges with the bundle: win a match
// (the One Shot umbrella), play 5 matches (the Boogeyman wrap), collect 120 gold tokens, 20 in a single match, 500 damage
// with shotguns and with assault rifles (500 XP each); any 5 give the Gold Token back bling. 9.00's paks have the schedule
// and the quests (at 150, 25 and 7) but neither reward cosmetic nor the mode, so only 9.01 serves them. The schedule is
// given at the quest login while the flag is served (profiles/athena.js settleEventSchedules), and the calendar serves the
// flag and the calendar event on their dates (events/datedflags.js wicksBounty), the admin's times, or off; the switch
// serves the flag always or never (events/season4flags.js). The mode is events/ltms.js's Wick's Bounty.
export const wicksBountyEvent = datedEvent("wicksBounty");
export const wicksBountyBuild = 6428087;

// The challenges' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 9.01 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function wicksBountyStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(wicksBountyEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(wicksBountyEvent, datedSettings(config).wicksBounty, nowMs,
    seasonMoment(now, null, wicksBountyEvent.season).getTime());
  return datedParts(windows, nowMs, wicksBountyEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const wicksBountyFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (wicksBountyStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

export { wicksBountyCalendarEvent };
