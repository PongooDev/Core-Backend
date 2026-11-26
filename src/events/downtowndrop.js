import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, downtownDropCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Season 9's Downtown Drop Challenges (9.10: CL-6573057, Update v9.10, and CL-6639283, whose data both play on): the Fortnite
// Wiki has them "available from May 22nd 2019 to June 4th 2019", Update v9.10's Fortnite x Jordan. 9.10's paks have them as
// Athena/Items/ChallengeBundleSchedules/Styles/BundleSchedule_Event_VigilanteBoard (ChallengeCategory.Event, CalendarEventTag
// EventFlag.LTM_Vigilante, CalendarEventName CalendarEvent_Season9_Vigilante), whose one bundle,
// QuestBundle_Event_VigilanteBoard, gives two challenges with the bundle and eleven more a day at a time (DaysFromEventStart 1 to 8, counted from the flag's start): any 1 gives
// the Back Board back bling, all 13 its Sweaty style; each challenge gives a spray or another Back Board style. The
// challenges count in the Downtown Drop LTM's island (Playlist_Creative_Vigilante), which Core doesn't serve (events/ltms.js),
// so they show and keep their progress but can't be done on a Core server. The schedule is given at the quest login while
// the flag is served (profiles/athena.js settleEventSchedules); the calendar serves the flag on its dates
// (events/datedflags.js downtownDrop), the admin's times, or off, and the switch serves it always or never
// (events/season4flags.js). 9.01's paks have neither the schedule nor the flag.
export const downtownDropEvent = datedEvent("downtownDrop");
export const downtownDropBuild = 6573057;

// The challenges' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 9.10 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function downtownDropStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(downtownDropEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(downtownDropEvent, datedSettings(config).downtownDrop, nowMs,
    seasonMoment(now, null, downtownDropEvent.season).getTime());
  return datedParts(windows, nowMs, downtownDropEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const downtownDropFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (downtownDropStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

export { downtownDropCalendarEvent };
