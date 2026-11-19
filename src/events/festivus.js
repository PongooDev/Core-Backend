import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, showtimeCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, lteFestivus, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Showtime, Marshmello's concert at Pleasant Park (7.30, CL-4834550; code-named Festivus). The Fortnite Wiki's Showtime: "a
// Concert Live Event ... that aired on February 2nd 2019 at 11AM PST and the encore on the same day at 11PM PST"; its
// Pleasant Park: "January 29th 2019: A stage is being set up at Pleasant Park where the Football Field is ... February 3rd
// 2019: The stage at Pleasant Park is now gone". How 7.30 plays it (its client paks decompiled):
// - Athena_POI_Foundations' level Blueprint, once the match's playlist has loaded and only with authority, reads FLevel
//   (UFortKismetLibrary::GetCalendarEventInformation): active, it turns on PleasentParkFestivus (an LF_Athena_POI_50x50,
//   Dynamic_StartDisabled, streaming Athena/Maps/POI/Athena_POI_CommunityPark_003_M: the field with the stage), else
//   PleasentParkDefault, the park as it was. A match keeps the one it started with.
// - BP_FestivusManager (placed in the same level) acts only in a playlist tagged Athena.Playlist.Concert, the "Party at
//   Pleasant Park" playlists (Playlist_Music_*, events/ltms.js). There it watches FLevel (its sub-level), F0 (the
//   countdown: shown once F0 has 29 hours or less to its end, corrected every 15 seconds from F0's TimeUntilEnd) and F1
//   (the show: the pre-show visuals, then the concert's media, its low and no gravity, beach balls and the rest of its
//   timeline), each with a FortAsyncAction_CalendarEventWatcher, and falls back to starting the show from the calendar
//   itself 30 seconds late (CalendarBackupStartDelay). The concert's video and sound play on the clients.
// So FLevel stands from Update v7.30's day to the encore's end, F0 runs to each show and F1 is each show's ten minutes
// (events/datedflags.js festivus): Epic's dates on Season 7's replay, the admin's times, or off (the park as it was). Not
// with the seasonal events off or in another event mode. 🟡 Epic's hours for the stage aren't recorded.
//
// The Showtime Challenges: 7.30's paks have them as Athena/Items/ChallengeBundleSchedules/LTM/Schedule_Festivus (CategoryID
// Festivus, EventName EventFlag.LTE_Festivus, CalendarEventName CalendarEvent_Season7_Festivus, CleanUpOnBundleCompletion,
// "Showtime Challenges"), whose one bundle, QuestBundle_Festivus, gives "Search a Showtime Poster" with it (Mello Made It
// Right) and "Visit the Showtime Venue" (Keep It Mello) and "Use Keep It Mello at a Trucker's Oasis, Ice Cream Parlor and
// Frozen Lake" (Marshy Smasher) DaysFromEventStart 1, each in GB_Festivus, and the Showtime banner (BRFestivus) for all
// three. The wiki's Showtime Challenges: "available from January 30th 2019 to February 2nd 2019". The schedule is given at
// the quest login while its flag is served (profiles/athena.js settleEventSchedules), its later challenges at the first
// quest login on or after their day (profiles/challenges.js, events/fourteendays.js eventDaysOf), and the calendar serves
// the flag and the bundle's calendar event on their dates (events/datedflags.js showtime), or the admin's times, or off; the
// switch serves the flag always or never (events/season4flags.js).
export const festivusEvent = datedEvent("festivus");
export const showtimeEvent = datedEvent("showtime");
export const festivusBuild = 4834550;
const dayMs = 24 * 60 * 60 * 1000;

// The concert's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 7.30 with the seasonal events on, in the Automatic mode.
export function festivusStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  if (Number(changelist) !== festivusBuild || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const nowMs = now.getTime();
  const windows = datedWindows(festivusEvent, datedSettings(config).festivus, nowMs, seasonMoment(now, null, festivusEvent.season).getTime());
  return datedParts(windows, nowMs, festivusEvent.parts);
}

// The Showtime Challenges' calendar events the same way. A flag the admin switched on is served always (season4Overrides)
// and one switched off never, so neither is scheduled here.
export function showtimeStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(showtimeEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(showtimeEvent, datedSettings(config).showtime, nowMs, seasonMoment(now, null, showtimeEvent.season).getTime());
  return datedParts(windows, nowMs, showtimeEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const showtimeFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (showtimeStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

// How many whole days the challenges have run, for those that unlock DaysFromEventStart: from their step's start (30
// January 2019, 00:00 UTC, on Season 7's replay; the admin's own start in the custom mode), null before it or when nothing
// serves the flag. While the admin's switch serves the flag it is on for good, so every day has come.
export function showtimeDay(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(showtimeEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn()) return null;
  const { off, on } = season4Overrides(changelist, config);
  if (off.includes(lteFestivus)) return null;
  if (on.includes(lteFestivus)) return Infinity;
  if (!showtimeFlagsNow(now, changelist, config).includes(lteFestivus)) return null;
  const setting = datedSettings(config).showtime;
  const [first] = showtimeEvent.steps;
  const start = setting.mode === "custom"
    ? Date.parse(setting.schedule.find(({ step }) => step === first.id)?.startAt ?? "")
    : null;
  const days = start === null
    ? Math.floor((seasonMoment(now, null, 7).getTime() - first.start) / dayMs)
    : Math.floor((now.getTime() - start) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export { showtimeCalendarEvent };
