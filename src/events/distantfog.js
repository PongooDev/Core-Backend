import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";

// 6.31's Ice King iceberg, in the distance off the island's south-west (Core-Backend #362). How 6.31 shows it:
// - Athena/Background/Athena_Background.umap (6.31, CL-4573279) has the actor BP_Distant_Fog and its SM_Iceberg
//   StaticMeshComponent, with the ice floes, chunks, fog and aurora it brings alongside. 6.30's same level (CL-4573096)
//   has the floes, fog and aurora but no iceberg, and 6.20's to 6.22's have none of them: the iceberg is 6.31's alone.
// - BP_Distant_Fog (Athena/Environments/Blueprints/Events/BP_Distant_Fog, decompiled from 6.31's paks): its defaults hold
//   FogApproachEvent "BR_S6_Approach_03" and FogApproachOverlapEvent "BR_S6_Approach_Overlap" — plain strings, no
//   "EventFlag." prefix — and ReceiveBeginPlay watches each with a FortAsyncAction_CalendarEventWatcher. Its
//   MoveProgress is the point it puts the iceberg at on its Spline (UpdateIcebergLocation, GetLocationAtTime): 1.01 on a
//   dedicated server at begin play (the preview point, 1.0, is what UserConstructionScript lays down for clients), while
//   the approach event is active it is MapRangeClamped(TimespanRatio(TimeSinceBegin, TimeSinceBegin + TimeUntilEnd), 1, 0,
//   1, 6-31EndPoint), and the overlap event turns on and it is at 6-31EndPoint at once. So both events are the calendar's
//   and nothing else drives it: with neither served the iceberg stays where the spline's preview point puts it, which is
//   out of sight.
// - The names are not event flags (no "EventFlag." prefix, and no pak of any build holds them as one), so they are not in
//   Season 4's switchable flag catalog (events/season4flags.js): the admin controls this event through its card on the
//   Events page (dates, custom or off, events/eventschedules.js) like the other dated events, and this module serves it on
//   6.31 alone, the only build whose backdrop has the iceberg.
const distantFogBuild = 4573279;

export const distantFogEvent = datedEvent("distantFog");

// The iceberg's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the
// part that holds now on (the next four changes), as events/island.js's: on 6.31, with the seasonal events on and in the
// Automatic mode.
export function distantFogStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  if (Number(changelist) !== distantFogBuild) return [];
  if (!seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const nowMs = now.getTime();
  const windows = datedWindows(distantFogEvent, datedSettings(config).distantFog, nowMs, seasonMoment(now, null, 6).getTime());
  return datedParts(windows, nowMs, distantFogEvent.parts);
}
