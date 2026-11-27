import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, holidayDecor710, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// 7.10's holiday decor (CL-4667333, CoreV2 #699). Battle Royale's seasonal decor events are AthenaSeasonalDecorEvents
// (UFortEventItemDefinitionBase: RequiredEventTag, the event flag that turns them on, read from the calendar's
// client-events activeEventFlags by the seasonal event manager, as 6.20's BR_Decor_HalloweenBus with
// EventFlag.HalloweenBattleBus). 7.10's server-assets pak has two that need the plain name TopSecret:
// - BR_Decor_WinterBus: BattleBusOverride BBID_WinterBus ("Winter Bus", BusPrefabClass B_BattleBus_Winter2018, the
//   lobby and flight music Athena_Bus_Music_Lobby_Xmas_Loop and _Xmas_Loop);
// - BR_Decor_SupplyDropHoliday: SupplyDropOverride AthenaSupplyDrop_Holiday.
// Its other decor stays off: BR_Decor_SupplyDropGift is 1.11's EventFlag.SupplyDropGift, BR_Decor_BiplaneHoliday (the Santa
// Stormwing) names no RequiredEventTag, BR_Decor_HalloweenBus is 6.20's.
// The lobby is LobbySeason7's (Frontend_Lobby_Winter_BR, events/events.js), which 7.10 serves by itself: its paks have no
// other lobby. The 14 Days of Fortnite's giant candy canes and holiday trees are BP_CalendarProps instances in the
// client's map levels, each watching a calendar event its level names; those levels aren't in the server-assets pak, so
// their names aren't served here (🟡).
export const holidayDecorEvent = datedEvent("holidayDecor");
const decorBuild = 4667333;

// The decor as calendar events in parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 7.10 with the seasonal events on, in the Automatic mode, on Season 7's replay (events/datedflags.js
// has the dates), the admin's own times or off. The switch (events/season4flags.js) serves TopSecret always or never, so
// it isn't scheduled here then.
export function holidayDecorStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(holidayDecor710);
  if (!entry || Number(changelist) !== decorBuild || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(holidayDecorEvent, datedSettings(config).holidayDecor, nowMs, seasonMoment(now, null, 7).getTime());
  return datedParts(windows, nowMs, holidayDecorEvent.parts, new Set([...off, ...on]));
}
