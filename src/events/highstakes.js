import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// High Stakes (5.40, CL-4352937; events/events.js). Update v5.40 (6 September 2018): "Welcome to the High Stakes event!
// Assemble your crew for the new Getaway LTM and complete challenge to get some free rewards." 5.40's paks have its
// challenges as Athena/Items/ChallengeBundleSchedules/LTM/Schedule_LTM_Heist, whose EventName is EventFlag.LTM_Heist (the
// extractor's eventName), with its bundle's three quests (Quest_BR_Heist_Play_Matches, _Damage_DiamondCarriers,
// _PickupDiamond_DifferentMatches: the wiki's "Play matches of The Getaway", "Deal damage to Jewel carrying opponents",
// "Pick up Jewels in different matches") and the Crowbar for all three. The schedule is given at the quest login while the
// flag is served (profiles/athena.js settleEventSchedules), and the calendar serves the flag with its end as activeUntil,
// which the challenges tab counts down to.
// The Fortnite Wiki's High Stakes Challenges: "available from September 6th 2018"; Epic's tweet of 13 September: "The
// Getaway LTM has switched back to Squads. Call the crew and complete those challenges now before High Stakes ends next
// week with the update", Update v5.41 (18 September). So the flag runs from Update v5.40's morning to Update v5.41's (🟡
// the hours are Core's: 08:00 UTC, 4 AM ET, as the Cube's purple crack from Update v5.30's; the wiki's "to September 11th"
// is the challenges' first end, which the tweet outlasts). The Getaway's own windows are events/ltms.js's. 5.41 (CL-4363240)
// keeps the schedule and the flag in its paks: on Season 5's replay its window is before 5.41's release, as the Cube's
// journey on 5.30 runs past 5.30's, and the admin's own times or switch serve it whenever.
//
// On Season 5's replay (store/itemshop.js seasonMoment) the window is mapped to real time lap by lap, as the Cube's; the
// admin panel can set its own times instead, or take it off (events/datedflags.js), or switch the flag on or off
// (events/season4flags.js).
export const highStakesEvent = datedEvent("highStakes");

// The flag's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on, as events/cube.js's: on 5.40 and 5.41 with the seasonal events on, in the Automatic mode. A flag the admin
// switched on is served always (season4Overrides) and one switched off never, so neither is scheduled here.
export function highStakesStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(highStakesEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(highStakesEvent, datedSettings(config).highStakes, nowMs, seasonMoment(now, null, 5).getTime());
  return datedParts(windows, nowMs, highStakesEvent.parts, new Set([...off, ...on]));
}

// The High Stakes flags served now by its dates (none outside them), for the quest login's event schedules.
export const highStakesFlagsNow = (now = new Date(), changelist = currentBuild()) =>
  (highStakesStates(now, changelist)[0]?.events ?? []).map(({ eventType }) => eventType);
