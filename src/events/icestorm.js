import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedStepsThisLap, datedWindows, iceStormCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, iceKingLoadLevel, iceKingLoadSequence, iceKingStorm, iceKingStormPast, ltmWinterDeimos, seasonalEventsOn } from "./events.js";
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

// The Ice King and his Ice Storm, Season 7's live event (7.20, CL-4727874; 19 January 2019, 11:00 AM PST, code-named Mooney).
// How 7.20 plays it (its client paks decompiled; nothing of it is server-only):
// - Athena_POI_Foundations places BP_MooneyLoader (replicated, always relevant). Once the match's playlist has loaded, and
//   not in Creative, it watches LoadLevel with a FortAsyncAction_CalendarEventWatcher, and LoadSequence too; its
//   OnEventActive sets LoadMooneyMap or LoadMooneySequence, whose OnRep streams Athena/Maps/Test/S7/MooneyMap
//   (BP_MooneyScripting, BP_Mooney_Countdown: the sphere over Polar Peak, the Ice King in it, its clock's twelve orbs) or
//   MooneySequenceMap (a Replicated_LevelSequence, MooneySequence, that plays the storm), on the server and on each client
//   from its own calendar (the reporter's client streamed MooneySequenceMap in the frame its calendar download came in).
//   The storm reaches the clients only as MooneySequence's replicated playback, and 7.20's replication graph sends a
//   client a streaming level's always-relevant actors only when the server had that level before the client made it
//   visible (events/datedflags.js has why), so LoadSequence is served from the sphere's first day on, every mode with it:
//   every match loads the storm's level at its start, before a client joins, and Start now, a time or Epic's dates play
//   the storm to the players of the matches running then (🟡 Epic's LoadSequence times aren't recorded; its storm played
//   to the matches running at it, so their servers had the level before their players).
// - BP_MooneyScripting (MooneyMap), once the authority's match is ready (FortAsyncAction_AuthorityMatchReady), reads SP
//   (GetCalendarEventInformation): active, the event is past (EventPast: the sphere, the Ice King and the clock hidden) and
//   nothing else runs. Otherwise it reads WDK (active: NormalizedBubbleVisible, the Ice King showing in the sphere by the
//   event's progress) and watches WD0, WD1, WD2, warning (ShowTVWarning: the TVs' weather warning, MPC_Countdown's
//   VillainBase) and Countdown (the TVs' countdown to its end, corrected by R0 five minutes before it); and in the Ice
//   Storm playlists (Athena.Playlist.Deimos) it sets the S7 day phases' fog. WD0 (the clock: CurrentHour, an orb off each
//   two hours), WD1 (LeadUpActive, and in its last 35 minutes the time of day set to reach 22:30 at the storm) and then
//   WD2, which with LeadUpActive is the storm (BeginIceKingEvent): the server plays the sequence (the Ice King breaks out,
//   his aurora, the blizzard rolls over the island, MooneySequence's Holiday_SnowAmount spreading the snow), 11.3 seconds
//   in pauses the storm (Mutator.SpecialEvent's AFortAthenaMutator_SpecialEvent::PauseStormProgression) and pushes its
//   clouds back, 45 seconds in blends the fog in, 65 seconds in sends the DeimosTurnOn mission event (the Ice Legion) and
//   lets the storm go on, and 86 seconds in holds the sequence at its end. A match must have seen WD1 turn on before WD2
//   to play it (LeadUpActive), so "Start now" sets the storm 30 seconds on with WD1 already on.
// - BP_SnowSetup (Athena_Terrain), once the authority's match is ready, reads SP: its replicated Snow_Amount is 1 with it
//   (MPC_Landscape's Holiday_SnowAmount at SnowCurve's 15: the island under snow) and 0 without (1.2: Season 7's own
//   snow). That is 7.20's only snow input: its SetSnow(float) has no caller in the paks, and the melting stages came with
//   later updates, not in 7.20's files. The snow switch below (config iceKingSnow) serves SP by the event ("event", the
//   default), never ("none": Season 7's own snow, and the sphere and Ice King stay) or always ("full": the island under
//   snow, the Ice King's visuals gone as after the storm). A match keeps the snow it started with; the storm's own spread
//   plays only in the matches running at the storm.
// The calendar's parts move on by themselves (validFrom) and a Core gameserver fetches an admin's change within 5 seconds
// (CoreV2's AFortGameModeAthena::AskEventCalendarRevision), so a time or "Start now" plays in the matches running then.
// Nothing of it is stripped from 7.20's server: on a headless 7.20 server (CoreV2 main with a logging-only diagnostic,
// -CoreBotMatch, this backend's "Start now") the loader streamed both levels, WD1 set LeadUpActive, the TVs' warning and countdown, WD2 played the storm
// (CurrentHour 0, the sequence), Mutator_SpecialEvent (Athena_GameMode's SpecialEventModifier) paused the storm
// (bSafeZonePaused) and let it go on, and the fog blend ran; a match started after SP hid the Ice King (EventPast). A
// watcher acts on a calendar download (OnEventActive for an event newly active there), and a server downloads its
// calendar before it opens its session to players (its update check), so a match's watchers see it.
// "before" (the default) holds the sphere as 7.20 shipped (LoadLevel, with the storm's idle sequence level LoadSequence) and
// the default modes; Epic's dates play it on Season 7's replay; the admin's times wherever they are. Its storm switches
// Solo, Duos and Squads to the Ice Storm's (iceKingState, events/ltms.js fromIceStorm).
export const iceKingEvent = datedEvent("iceKing");
export const iceKingBuild = 4727874;
export const iceKingSnowModes = ["event", "none", "full"];
export const defaultIceKingSnow = "event";
export const sanitizeIceKingSnow = (value, current = defaultIceKingSnow) =>
  (typeof value === "string" && iceKingSnowModes.includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() : current);

// The event's windows [{eventType, since, until}] now by its mode, before the snow switch: none outside 7.20, with the
// seasonal events off, or in another event mode.
function iceKingWindows(now, changelist, config) {
  if (Number(changelist) !== iceKingBuild || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const nowMs = now.getTime();
  const moment = seasonMoment(now, null, iceKingEvent.season).getTime();
  const setting = datedSettings(config).iceKing;
  if (setting.mode === "before") {
    // The sphere and the storm's sequence level, held on: a match running when the admin starts the event has both.
    const sphere = datedStepsThisLap(iceKingEvent, nowMs, moment).find(({ step }) => step === "sphere");
    return [iceKingLoadLevel, iceKingLoadSequence].map((eventType) => ({ eventType, since: Date.parse(sphere.startAt), until: Infinity }));
  }
  return datedWindows(iceKingEvent, setting, nowMs, moment);
}

// The Ice King's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on, with the snow switch's SP.
export function iceKingStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const windows = iceKingWindows(now, changelist, config);
  if (!windows.length) return [];
  const snow = sanitizeIceKingSnow(config?.iceKingSnow);
  const nowMs = now.getTime();
  const kept = snow === "event" ? windows : windows.filter(({ eventType }) => eventType !== iceKingStormPast);
  if (snow === "full") kept.push({ eventType: iceKingStormPast, since: nowMs - 60000, until: Infinity });
  return datedParts(kept, nowMs, iceKingEvent.parts);
}

// The island's state on 7.20 now, as its storm leaves it: "after" once the storm has come (its SP step served, whatever
// the snow switch), else "before"; null on another build. 7.20's Ice Storm Solo, Duos and Squads take the default modes'
// place from the storm (Epic's lobby had the normal three until the Ice Storm: Core-Backend #354), so they follow this
// (events/ltms.js fromIceStorm), and the lobby's modes and the map come from the one schedule.
export function iceKingState(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  if (Number(changelist) !== iceKingBuild) return null;
  const nowMs = now.getTime();
  const past = iceKingWindows(now, changelist, config).some(({ eventType, since, until }) => eventType === iceKingStormPast && since <= nowMs && nowMs < until);
  return past ? "after" : "before";
}

// The Ice Legion in the storm's own matches (CoreV2 #490). 7.20 brings it only to a match whose playlist has it: the
// Ice Storm playlists' Mutator_DeimosMissions_W spawns the Ice Legion's two missions (W_Deimos_Mission_RiftSpawners_Static,
// whose rifts 7.20's Deimos_Gameplay doesn't have, and _Dynamic, the Ice Shards SupplyDrop_Deimos drops), and the dynamic
// one waits for WDSPAWN (events/events.js iceKingIceLegion). BP_MooneyScripting's DeimosTurnOn, 65 seconds into the storm,
// goes to the match's missions, and only AFortMission_RiftSpawners takes it (7.20 0x11BD280: its spawners on, 0x11C5380);
// Playlist_DefaultSolo, _Duo and _Squad have no mutator, no mission and no AI settings, so a match on them has nothing to
// turn on. BP_MooneyScripting also gives a match on an Ice Storm playlist (Athena.Playlist.Deimos) whose storm hasn't
// passed (no SP) the S7 day phases' fog (DayTimeOverrideFog 1), which only a match on them before the storm can see. So
// Epic's matches at the storm were on the Ice Storm playlists, their spawners off until DeimosTurnOn, while the lobby
// still had the normal three until the storm (Core-Backend #354). 🟡 How Epic's matchmaking did it isn't in the files:
// here the default modes' matches are assigned as their Ice Storm playlists (events/ltms.js iceStormMatchBucket) from
// iceKingLegionLeadMs before the storm until it, so every match running at the storm started on one (a match lasts up to
// about 25 minutes). A match that started on a default playlist earlier plays the storm without the Ice Legion.
export const iceKingLegionLeadMs = 30 * 60000;
export function iceKingStormSoon(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const nowMs = now.getTime();
  return iceKingWindows(now, changelist, config)
    .some(({ eventType, since }) => eventType === iceKingStorm && nowMs < since && since - iceKingLegionLeadMs <= nowMs);
}

// Whether the storm is on Epic's dates (Season 7's replay), where the Ice Storm modes' Original dates start with it.
export const iceKingOnEpicDates = (config = currentEventsConfig()) => datedSettings(config).iceKing.mode === "dates";
