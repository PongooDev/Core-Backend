import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";

// The Ice King's iceberg coming in off the island's south-west at the end of Season 6 (Core-Backend #362): 6.30's
// snowstorm and 6.31's iceberg. How the two builds show it:
// - Athena/Background/Athena_Background.umap places the actor BP_Distant_Fog on both. 6.31's (CL-4573279) has its
//   SM_Iceberg StaticMeshComponent, with the ice floes, chunks, fog and aurora it brings alongside. 6.30's (CL-4573096)
//   has the fog (StaticMesh is SM_Ice_Fog, with SM_Ice_Fog_Spread, _Surround, _Top and SoftFog) and the floes, and no
//   iceberg, chunks or aurora. 6.20's to 6.22's have none of it. The placed actor keeps the blueprint's defaults on both.
// - BP_Distant_Fog (Athena/Environments/Blueprints/Events/BP_Distant_Fog, decompiled from each build's paks): its
//   defaults hold FogApproachEvent and FogApproachOverlapEvent as plain strings, no "EventFlag." prefix: 6.30's
//   "BR_S6_Approach_01" and "BR_S6_Approach_02", 6.31's "BR_S6_Approach_03" and "BR_S6_Approach_Overlap". On a dedicated
//   server ReceiveBeginPlay sets MoveProgress to 1.01 and binds ContinueSetup to the FortGameModeZone's
//   OnHandleMatchHasStarted; a second after the match starts ContinueSetup watches both names with a
//   FortAsyncAction_CalendarEventWatcher each. Only OnEventActive does anything (OnEventUpdated and OnEventEnded keep the
//   event's times and stop): the approach event sets MoveProgress to MapRangeClamped(TimespanRatio(TimeUntilEnd,
//   TimeUntilEnd + TimeSinceBegin), 1, 0, 1, the build's end point), so 1 at the event's start and the end point at its
//   end, and the overlap event sets it to the end point at once. MoveProgress is replicated, and OnRep_MoveProgress
//   (UpdateIcebergLocation) puts StaticMesh at that point on its Spline and fades the fog by it. So a match places it by
//   the event active when it starts, and again only when an event newly turns on at a later calendar download (the
//   approach doesn't creep on within a match); the calendar's two events are all that drive it.
// - 6.30: its end point is 6-3EndPoint, 0.4, and OnRep_MoveProgress hides the whole actor while MoveProgress is over 1,
//   so with neither event on the snowstorm isn't there at all. Its floes (IceFloeParent) show only below the end point,
//   which neither event reaches, so 6.30's events bring in the fog alone.
// - 6.31: its end point is 6-31EndPoint, and UpdateIcebergLocation also slides SM_Iceberg in and reveals it, the floes,
//   chunks and aurora by the progress. With neither event on the iceberg stays at 1.01, the spline's far end, out of sight.
// - The names are not event flags (no "EventFlag." prefix, and no pak of any build holds them as one), so they are not in
//   Season 4's switchable flag catalog (events/season4flags.js): the admin controls each build's through its own card on
//   the Events page (dates, custom or off, events/eventschedules.js) like the other dated events, and this module serves
//   each build its own pair alone (events/datedflags.js has the dates).
const distantFogEvents = { 4573096: "distantFog630", 4573279: "distantFog" };

export const distantFogEvent = datedEvent("distantFog");
export const distantFog630Event = datedEvent("distantFog630");
// The build's own event (null: a build without BP_Distant_Fog's calendar events).
export const distantFogEventOf = (changelist = currentBuild()) => datedEvent(distantFogEvents[Number(changelist)]) ?? null;

// The build's distant fog as calendar events in parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}],
// from the part that holds now on (the next four changes), as events/island.js's: on 6.30 and 6.31, with the seasonal
// events on and in the Automatic mode.
export function distantFogStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const event = distantFogEventOf(changelist);
  if (!event) return [];
  if (!seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const nowMs = now.getTime();
  const windows = datedWindows(event, datedSettings(config)[event.id], nowMs, seasonMoment(now, null, 6).getTime());
  return datedParts(windows, nowMs, event.parts);
}
