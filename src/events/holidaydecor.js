import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, eventsActiveUntil, fortnitemaresDecor621, holidayDecor710, holidayDecorProps710, ltm14DaysOfFortnite, ltmFortnitemares,
  seasonalEventsOn } from "./events.js";
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
// other lobby. The island's decor is BP_CalendarProps (Athena/Prototype/Blueprints/CalendarProps) placed in 7.10's client
// map levels: 68 of them in 54 building and POI levels and five streaming cells, each with an EventName HLDY_01 to HLDY_07
// (events/events.js holidayDecorProps710) and its props (Winter_StringLights, Prop_Winter_Wreath, Prop_Llama_LawnOrnament,
// Prop_SnowFlake_01 to _03, Tree_Pine_05_Christmas3_Athena, Tiered_Athena_FloorLoot_01; HLDY_07's Prop_Athena_Quest_CandyCane,
// the 14 Days' giant candy canes). At BeginPlay the authority watches its event (FortAsyncAction_CalendarEventWatcher) and,
// on OnEventActive, spawns its props for good: a progress range only matters to BP_CalendarProps_Progressive, whose 7.10
// instances watch SP (7.30's Ice Storm, events/icestorm.js), not the holidays. The 14 Days' Visit Giant Candy Canes (day 2),
// Dance at Holiday Trees (day 9) and Destroy Snowflake Decorations (day 12) need them, so the 14 Days' switch serves them too.
// Not served: Athena_NYE_Celebration's BP_NewYearTimer (NYE, the New Year's Eve countdown; 🟡 Epic's times not recorded).
export const holidayDecorEvent = datedEvent("holidayDecor");
const decorBuild = 4667333;

// The decor as calendar events in parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 7.10 with the seasonal events on, in the Automatic mode, on Season 7's replay (events/datedflags.js
// has the dates), the admin's own times or off. The switch (events/season4flags.js) serves TopSecret always or never, so
// it isn't scheduled here then, and the island's decor with it; the 14 Days' switch on serves the island's decor always
// too, unless the decor's switch is off.
export function holidayDecorStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(holidayDecor710);
  if (!entry || Number(changelist) !== decorBuild || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const decorOff = off.includes(holidayDecor710);
  const propsAlways = !decorOff && (on.includes(holidayDecor710) || on.includes(ltm14DaysOfFortnite));
  const nowMs = now.getTime();
  const windows = datedWindows(holidayDecorEvent, datedSettings(config).holidayDecor, nowMs, seasonMoment(now, null, 7).getTime());
  const parts = datedParts(windows, nowMs, holidayDecorEvent.parts, new Set([...off, ...on, ...(decorOff || propsAlways ? holidayDecorProps710 : [])]));
  if (!propsAlways) return parts;
  const props = holidayDecorProps710.map((eventType) => ({ eventType, activeUntil: eventsActiveUntil }));
  return parts.map((part) => ({ ...part, events: [...part.events, ...props] }));
}

// 6.21's Fortnitemares decor (CL-4526925, CoreV2 #718): the island's Halloween props are BP_CalendarProps in 6.21's client
// map levels, as 7.10's holiday decor is, watching HW_01 to HW_08 (events/events.js fortnitemaresDecor621). Nothing served
// those names, so no ghost, pumpkin or gravestone spawned and the Fortnitemares Challenges' Destroy a Ghost Decoration in
// different Named Locations (Quest_FNM_Destroy_ScavengerHunt_GhostDecos, Part 2: destroy_fortnitemares_ghostdeco_<place>,
// TargetTags Building.Type.Prop.Athena.GhostDeco, SourceTags Athena.Location.POI.<place>, ContextTags
// Athena.Playlist.Deimos) had nothing to destroy. A prop spawned by BP_CalendarProps is the class's own building actor
// (Halloween_Ghost_a to _c carry the GhostDeco tag), so its destroy is credited as any prop's.
export const fortnitemaresDecorEvent = datedEvent("fortnitemaresDecor");
const fortnitemaresDecorBuild = 4526925;

// The decor as calendar events in parts, from the part that holds now on: on 6.21 with the seasonal events on, in the
// Automatic mode, on Season 6's replay (events/datedflags.js has the dates), the admin's own times or off. Each name's
// switch (events/season4flags.js) serves it always or never, so it isn't scheduled here then; LTM_Fortnitemares switched
// on serves every name always, unless its own switch is off.
export function fortnitemaresDecorStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  if (Number(changelist) !== fortnitemaresDecorBuild || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const always = on.includes(ltmFortnitemares) ? fortnitemaresDecor621.filter((name) => !off.includes(name) && !on.includes(name)) : [];
  const nowMs = now.getTime();
  const windows = datedWindows(fortnitemaresDecorEvent, datedSettings(config).fortnitemaresDecor, nowMs, seasonMoment(now, null, 6).getTime());
  const parts = datedParts(windows, nowMs, fortnitemaresDecorEvent.parts, new Set([...off, ...on, ...always]));
  if (!always.length) return parts;
  const props = always.map((eventType) => ({ eventType, activeUntil: eventsActiveUntil }));
  return parts.map((part) => ({ ...part, events: [...part.events, ...props] }));
}
