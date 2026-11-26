import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, festivusShow, seasonalEventsOn, unvaultingEvent, unvaultingLevel } from "./events.js";

// Live events with their own playlist (Core-Backend #436): before the event Epic took every other playlist out of the
// lobby, the event's alone left, and put them back once it was over. Each entry: the dated event (events/datedflags.js),
// the build that plays it, its LTM (events/ltms.js), the flag of its show steps (each a window that ends the lock) and the
// step whose start opens the lock (leadFlag; without one, eventLeadMs before the show).
// - The Unvaulting (8.51, Playlist_Music_Highest): The Verge, via Video Games Chronicle (5 May 2019): Epic "disabled most
//   of the standard Fortnite battle royale modes" and added the limited time playlist The Unvaulting; Fortnite Insider
//   (ShiinaBR's datamine): every other mode is deactivated for the event, which has its own mode. The lock opens with the
//   "level" step (GWLevel, the event's 30 minutes before, BP_SnowScripting's own 30-minute mark) and ends with the
//   "event" step (GWS0). 🟡 No source gives the minute the modes went or came back.
// - Showtime (7.30, Playlist_Music_Highest, Party at Pleasant Park, the only playlist that plays the concert:
//   events/festivus.js): Twinfinite (2 February 2019): the Showtime mode was "the only way to play the game". The lock is
//   each show's ("show", "encore": F1), from eventLeadMs before it to its end; between the two the lobby is as before.
//   🟡 No source gives the lead: eventLeadMs is the half hour Epic gave its later live events (the playlist alone from 30
//   minutes before, as for The End and later).
export const eventLeadMs = 30 * 60000;
// events/unvaulting.js unvaultingBuild and events/festivus.js festivusBuild, not imported: both load events/ltms.js, which
// loads this file.
const unvaultingBuild = 6165369;
const festivusBuild = 4834550;
export const eventPlaylistEvents = [
  { event: "unvaulting", build: unvaultingBuild, ltm: "unvaulting", flag: unvaultingEvent, leadFlag: unvaultingLevel },
  { event: "festivus", build: festivusBuild, ltm: "partyAtPleasantPark", flag: festivusShow, leadFlag: null }
];

// The admin panel's switch (settings lockEventPlaylists), on unless false, as Epic's lobby was.
export const eventPlaylistsLockOn = (settingsValue) => settingsValue?.lockEventPlaylists !== false;

// The lock in force on the build now: {event, ltm, since, until (ms)}, or null. Only while the event is scheduled (the
// seasonal events on, the Automatic mode, the event on Epic's dates or the admin's times, "Start now" among them).
export function eventPlaylistLock(build, settingsValue, now = new Date(), config = currentEventsConfig()) {
  if (!eventPlaylistsLockOn(settingsValue)) return null;
  const entry = eventPlaylistEvents.find((own) => own.build === Number(build));
  if (!entry || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return null;
  const event = datedEvent(entry.event);
  const nowMs = now.getTime();
  const windows = datedWindows(event, datedSettings(config)[event.id], nowMs, seasonMoment(now, null, event.season).getTime());
  for (const show of windows.filter(({ eventType, until }) => eventType === entry.flag && Number.isFinite(until))) {
    const lead = windows.filter(({ eventType, since, until }) => entry.leadFlag && eventType === entry.leadFlag && since <= show.since && until > show.since)
      .sort((a, b) => b.since - a.since)[0];
    const since = lead ? lead.since : show.since - eventLeadMs;
    if (since <= nowMs && nowMs < show.until) return { event: entry.event, ltm: entry.ltm, since, until: show.until };
  }
  return null;
}
