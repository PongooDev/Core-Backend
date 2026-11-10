import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Tomato Town's rift (5.21, CL-4288479; events/events.js): Athena_GameplayActors' calendar event prop handler watches
// EventFlag.BR_S5_Oddity_Tomato_Tell (the rift forms over Uncle Pete's Pizza Pit) and EventFlag.BR_S5_Oddity_Tomato_Event
// (the rift spits out Prop_Tomato_Stone, the stone tomato head), as 4.5's oddities (events/season4flags.js) watch theirs:
// a _Tell runs until its _Event begins, and the _Event stays on. The Fortnite Wiki's Tomato Town: "A rift started forming
// on top of Uncle Pete's Pizza Pit" on 15 August 2018 (Update v5.21's day) and "The rift spits out a small stone tomato
// head statue" on 19 August; Update v5.30 (23 August) replaced Tomato Town with Tomato Temple, which 5.21 doesn't have, so
// on 5.21 the stone head stays to the season's end.
//
// On Season 5's replay (store/itemshop.js seasonMoment) the rift is formed until 19 August and the head is out from then to
// the replay's end (27 September, Season 6's day), and its next lap starts over. 🟡 The wiki gives days, not hours, so the
// head comes out at midnight UTC on 19 August; and before 15 August on the replay 5.21 shows the rift already formed (its
// own map's state: 5.21 shipped with it).
// The admin panel can set its own times instead, or take the rift off (events/datedflags.js, Core-Backend #311).
export const tomatoRiftEventAt = "2018-08-19T00:00:00.000Z";
const tomatoRift = datedEvent("tomatoRift");

// The rift's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on (the next two changes), as events/oddities.js's: on 5.21 with the seasonal events on, in the Automatic
// mode. A flag the admin switched on is served always (season4Overrides) and one switched off never, so neither is
// scheduled here.
export function tomatoRiftStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(tomatoRift.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(tomatoRift, datedSettings(config).tomatoRift, nowMs, seasonMoment(now, null, 5).getTime());
  return datedParts(windows, nowMs, tomatoRift.parts, new Set([...off, ...on]));
}
