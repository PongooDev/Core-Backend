import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, highStakes2019CalendarEvent } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Season 8's High Stakes (8.20, CL-5625478): Update v8.10 brought back the Getaway (8.20's Playlist_Bling_*, "The
// Getaway"), and the Fortnite Wiki's High Stakes Challenges were "available from March 14th 2019 to March 19th 2019"
// (Limited-Time Events: "The High Stakes event returns, along with its LTM, challenges, and free cosmetics, plus new styles
// for the Crystal Llama Back Bling"). 8.20's paks have them as Athena/Items/ChallengeBundleSchedules/LTM/
// Schedule_LTM_Heist_V2 (CalendarEventTag EventFlag.LTM_HighStakes, CalendarEventName CalendarEvent_Season8_HighStakes,
// CleanUpOnBundleCompletion, gift box GB_MakeGoodAthena, "High Stakes Challenges"), whose one bundle is QuestBundle_LTM_Heist_V2
// (Quest_BR_Heist_* : play and win the Getaway, use a Grappler; the Heist back bling, BID_235_Heist, and its styles).
// 8.20 names the schedule's flag CalendarEventTag where 5.40's named it EventName; the extractor writes either as
// eventName. The schedule is given at the quest login while the flag is served (profiles/athena.js settleEventSchedules),
// and the calendar serves the flag and the calendar event on their dates (events/datedflags.js highStakes2019), the
// admin's times, or off; the switch serves the flag always or never (events/season4flags.js). The Getaway's own windows
// are events/ltms.js's.
// 8.20 came out after the event (27 March): on Season 8's replay its window is before 8.20's release, as 5.41's High Stakes
// window is before 5.41's.
export const highStakes2019Event = datedEvent("highStakes2019");
export const highStakes2019Build = 5625478;

// The challenges' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 8.20 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function highStakes2019States(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(highStakes2019Event.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(highStakes2019Event, datedSettings(config).highStakes2019, nowMs,
    seasonMoment(now, null, highStakes2019Event.season).getTime());
  return datedParts(windows, nowMs, highStakes2019Event.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const highStakes2019FlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (highStakes2019States(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

export { highStakes2019CalendarEvent };
