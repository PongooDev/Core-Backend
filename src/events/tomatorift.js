import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { currentEventsConfig, seasonalEventsOn, tomatoRiftEvent, tomatoRiftTell } from "./events.js";
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
export const tomatoRiftEventAt = "2018-08-19T00:00:00.000Z";
const seasonFirstDay = Date.parse("2018-07-12T00:00:00.000Z");
const seasonEndDay = Date.parse("2018-09-27T00:00:00.000Z");
const eventAt = Date.parse(tomatoRiftEventAt);
const iso = (ms) => new Date(ms).toISOString();

// The rift's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on, as events/oddities.js's: on 5.21 with the seasonal events on, in the Automatic mode. A flag the admin
// switched on is served always (season4Overrides) and one switched off never, so neither is scheduled here.
export function tomatoRiftStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(tomatoRiftTell);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const skip = new Set([...off, ...on]);
  const cycle = seasonEndDay - seasonFirstDay;
  const nowMs = now.getTime();
  const momentNow = seasonMoment(now, null, 5).getTime();
  // Epic's moment at a real time t, in this lap's terms.
  const momentAt = (t) => seasonFirstDay + ((((momentNow + (t - nowMs)) - seasonFirstDay) % cycle) + cycle) % cycle;
  const eventsAt = (t) => {
    const moment = momentAt(t);
    const lapStart = t - (moment - seasonFirstDay);
    return (moment < eventAt
      ? [{ eventType: tomatoRiftTell, activeSince: iso(lapStart), activeUntil: iso(lapStart + (eventAt - seasonFirstDay)) }]
      : [{ eventType: tomatoRiftEvent, activeSince: iso(lapStart + (eventAt - seasonFirstDay)), activeUntil: iso(lapStart + cycle) }])
      .filter(({ eventType }) => !skip.has(eventType));
  };
  // The next two changes: the head's coming out and the lap's end, whichever come first.
  const lapStartNow = nowMs - (momentAt(nowMs) - seasonFirstDay);
  const boundaries = [lapStartNow + (eventAt - seasonFirstDay), lapStartNow + cycle, lapStartNow + cycle + (eventAt - seasonFirstDay)]
    .filter((t) => t > nowMs).slice(0, 2);
  return [{ validFrom: -Infinity, events: eventsAt(nowMs) }, ...boundaries.map((t) => ({ validFrom: t, events: eventsAt(t) }))];
}
