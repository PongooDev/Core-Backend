import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedEventOn, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { activeEventFlags, currentEventsConfig, islandPoi, seasonalEventsOn } from "./events.js";
import { season4Overrides } from "./season4flags.js";

// The Butterfly, Season 6's end-of-Fortnitemares live event (6.21, CL-4526925; 4 November 2018, 18:00 UTC). How 6.21 plays
// it (its client paks decompiled, its server-only BP_IslandServerOnly read from Core-ServerAssets' CL-4526925 pak; the
// gameserver's part is PongooDev/CoreV2's):
// - Athena/Prototype/Blueprints/Island/BP_IslandScripting, placed in Athena_POI_Foundations, loads BP_IslandServerOnly on
//   the server and watches its bindings: EventBinding1 ["POI0", "POI1"] with one FortAsyncAction_CalendarMultiEventWatcher,
//   EventBinding2 EventFlag.BR_S6_Island_Crack and EventBinding3 EventFlag.BR_S6_Island_Drain each with a
//   FortAsyncAction_CalendarEventWatcher. Each acts on OnEventActive: an event active at a calendar download that wasn't at
//   the one before.
// - The first POI event a match finds sets the Leaky Lake's state from the name's last digit (0: the Cube Monsters' days,
//   the house glowing at the Cube; 1: after it, the rainbow and the map icon). On POI0, with its activeUntil under 30
//   minutes away (MinutesBeforeEvent), BP_Butterfly sets the time of day to reach 17.6 at the event (TimeOfDaySetup) and,
//   once the playlist has loaded, the game mode enables Mutator.Butterfly.StormLocation (Mutator_ButterflyStormLocation,
//   an AFortAthenaMutator_Storm whose final circle is at (64064, -41328)): the storm closes on the Butterfly's place.
// - POI1 turning active in a match that began on POI0 is the event: BP_Butterfly's ButterflySequence streams the Butterfly
//   level in, the Cube takes its last drip and spins (CUBE_Simple's LastDrip), then everyone is faded to white, the storm
//   is paused (PauseStormProgression and PauseStormDamage on the storm mutator), Mutator_ButterflyEvent
//   (AFortAthenaMutator_ButterflyEvent, which Athena_GameMode registers in every 6.21 match as a core gameplay modifier)
//   gathers every player's pawn (StartGatheringPawns: out of vehicles and ghost mode, a downed one revived with
//   ForceReviveFromDBNO), and BP_Butterfly takes them to the In-Between (ghost mode with AGID_Butterfly), then back above
//   their spot, with the DeimosShutoff mission event (the Cube Monsters' end) and the storm going on.
// - The crack: its progress (TimeSinceBegin over its span) is the Cube's CrackProgress, and in its last 25 minutes its
//   leadup is timed to play 8 seconds before its end. The drain: the Cube drains (EnableCubeDraining) and drips once an
//   hour (BigDrip, 1/24 of it each; the Butterfly's LastDrip is the 24th).
// A running Core gameserver plays a step when it comes: its calendar has the next parts (validFrom) and moves to each on its
// own tick, as 4.5's has the rocket's (events/rocketlaunch.js), and an admin's change reaches it within 5 seconds (CoreV2's
// AFortGameModeAthena::AskEventCalendarRevision). So "Start now" (or a time) on the Butterfly's step plays it in the matches
// running then, and a match that starts in POI0's last 30 minutes has its storm close on the Butterfly's place.
// Off (the default), 6.21 serves POI0 by itself and POI1, the crack and the drain only by their switches
// (events/season4flags.js); on Epic's dates or the admin's times, POI0 is the schedule's, until the Butterfly
// (events/events.js activeEventFlags). "Before the event" (Core-Backend #354, the Events page's Butterfly card) puts the map
// back to its pre-event state and holds it there: POI0 served, POI1, the crack and the drain not, whatever their switches
// say, so 6.21's Fortnitemares modes are back too (leakyLakeState).
export const butterflyEvent = datedEvent("butterfly");
export const butterflyBuilds = [4526925];

// The Butterfly's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on (the next four changes), as events/island.js's: on 6.21 with the seasonal events on, in the Automatic
// mode. A flag the admin switched on is served always (season4Overrides) and one switched off never, so neither is
// scheduled here.
export function butterflyStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  if (!butterflyBuilds.includes(Number(changelist)) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(datedEventOn(butterflyEvent, changelist), datedSettings(config).butterfly, nowMs, seasonMoment(now, null, 6).getTime());
  if (!windows.length) return [];
  return datedParts(windows, nowMs, butterflyEvent.parts, new Set([...off, ...on]));
}

// The Leaky Lake's state on 6.21 now, as its island scripting reads it (BP_IslandServerOnly's EventBinding1, ["POI0",
// "POI1"]): "after" once POI1 is served (the Butterfly has happened: by its schedule, butterflyStates, or by the POI1 switch,
// season4Overrides), else "before" (Fortnitemares' Cube Monsters' days, POI0's); null on a build without the Butterfly
// (6.20's island scripting has the bindings but no Butterfly, 6.22's lake is after it by itself). Epic's Fortnitemares in
// Battle Royale ended at the Butterfly (Update v6.21: "ends on Sunday, November 4 at 1 PM Eastern Time", the Butterfly's
// moment), so 6.21's Fortnitemares modes follow this state (events/ltms.js `untilButterfly`, Core-Backend #354): the
// calendar's POI events and the lobby's modes come from the one state and can't disagree.
export function leakyLakeState(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  if (!butterflyBuilds.includes(Number(changelist))) return null;
  const served = activeEventFlags(changelist).includes(islandPoi(1))
    || (butterflyStates(now, changelist, config)[0]?.events ?? []).some(({ eventType }) => eventType === islandPoi(1));
  return served ? "after" : "before";
}
