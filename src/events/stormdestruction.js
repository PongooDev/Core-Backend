import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";

// Storm Destruction (PongooDev/CoreV2#395), Update v5.40's "the edges of the Storm will damage player-built structures in
// the final phases" (Epic: about 10% of matches get that far). The game calls it the mega storm, and all of it is the
// build's own code and data:
// - AFortGameModeAthena::HandleMatchHasStarted (5.40 0xBEEAD0) spawns its MegaStormManagerClass, Athena_GameMode_C's
//   MegaStormManagerAthena_C (5 building actors a frame, 0.18 s apart, 0.75 s before the first).
// - AFortGameModeAthena::StartNewSafeZonePhase (0xC030B0) rounds the new circle's MegaStormGridCellThickness (the map
//   info's SafeZoneDefinitions, AthenaGameData's Default.SafeZone.NN.MegaStormGridThickness at level 0) into the safe zone
//   indicator's NextMegaStormGridCellThickness. At 1 or more, while FortAthenaGameModeCVars::bMegaStormEnabled (the console
//   variable Athena.bMegaStormEnabled) is set and the manager is there, it starts a mega storm circle on the storm's edge
//   per building grid cell ("FortGameModeAthena: Starting MegaStorm on SafeZone[%d]"); otherwise it logs why not.
// - AMegaStormManager::Tick (0xC364C0) gathers the building actors on each circle from the structural grid
//   (FMegaStormCircle, 0xC390E0) and destroys them a few at a time (0xC387B0), with the Athena.StormEdgeDestruction
//   analytics event at the end; the safe zone indicator's Tick replicates the circles (NumActiveMegaStormCircles), which
//   plays GCNL_MegaStorm_DamageRing, the storm's flash, on the clients.
// 5.40's (CL-4352937) and 5.41's (CL-4363240) paks set it on: AthenaGameData's circles 06 to 09 (the last four) are 2
// cells thick, the others 0, and DefaultEngine.ini's [ConsoleVariables] has Athena.bMegaStormEnabled=1. 5.41's notes say
// "The Storm wall no longer destroys structures during the last few circles" with the same paks, so Epic turned it off by
// hotfix, and 6.00's (CL-4402180) DefaultEngine.ini ships Athena.bMegaStormEnabled=0: the console variable is Epic's switch.
// No build has a chance of its own: Epic's "about 10%" is the share of matches reaching those circles, not a roll.
//
// So this hotfix sets Epic's switch on 5.40 and 5.41, in DefaultEngine.ini's [ConsoleVariables] (UOnlineHotfixManager::
// HotfixIniFile applies an Engine.ini's console variables again, FConfigCacheIni::LoadConsoleVariablesFromINI: 5.40
// 0x3EB3E0 -> 0x1625B90), by the events config's stormDestruction {mode, percent}:
// - "dates" (the default): Epic's dates on Season 5's replay (store/itemshop.js seasonMoment), 7 September 2018 until its
//   removal on 8 September (the dates reported in CoreV2#395), on 5.40, whose days they were; off on 5.41;
// - "always": on, on both;
// - "off": off, on both.
// percent (the admin's share of matches, default 10, 0 to 100) goes to the gameserver in its warmup answer
// (services/matchmaking/warmup.js): while the switch is on, CoreV2 rolls each match against it and turns the switch off
// for a match that doesn't get it; 100 is every match, as Epic's paks have it, and 0 is off. With the seasonal events off
// the switch is off. Other builds get nothing: 6.00 and later ship it off, and the builds before 5.40 have none.
// The server takes the hotfix at its start, so a change reaches a running gameserver when it starts again.
export const stormDestructionBuilds = [4352937, 4363240];
export const stormDestructionDatesBuild = 4352937;
export const stormDestructionModes = ["dates", "always", "off"];
export const defaultStormDestruction = { mode: "dates", percent: 10 };
export const stormDestructionStart = Date.parse("2018-09-07T00:00:00.000Z");
export const stormDestructionEnd = Date.parse("2018-09-08T00:00:00.000Z");

const percentOf = (value) => {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number) : undefined;
};

// The events config's stormDestruction: {mode, percent}, each kept from current when the input's isn't one.
export function sanitizeStormDestruction(value, current = defaultStormDestruction) {
  const base = {
    mode: stormDestructionModes.includes(current?.mode) ? current.mode : defaultStormDestruction.mode,
    percent: percentOf(current?.percent) ?? defaultStormDestruction.percent
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  return {
    mode: stormDestructionModes.includes(value.mode) ? value.mode : base.mode,
    percent: percentOf(value.percent) ?? base.percent
  };
}

// Whether Epic's dates hold Season 5's replay now.
export const inStormDestructionDates = (now = new Date()) => {
  const moment = seasonMoment(now, null, 5).getTime();
  return moment >= stormDestructionStart && moment < stormDestructionEnd;
};

// Epic's switch for the build now: true or false on 5.40 and 5.41, null on the others (nothing served).
export function stormDestructionOn(changelist = currentBuild(), now = new Date(), config = currentEventsConfig()) {
  const build = Number(changelist);
  if (!stormDestructionBuilds.includes(build)) return null;
  const { mode, percent } = sanitizeStormDestruction(config?.stormDestruction);
  if (!seasonalEventsOn() || mode === "off" || percent === 0) return false;
  if (mode === "always") return true;
  return build === stormDestructionDatesBuild && inStormDestructionDates(now);
}

// DefaultEngine.ini's console variables for the build ("" for one without the switch).
export function stormDestructionEngineSection(changelist = currentBuild(), now = new Date(), config = currentEventsConfig()) {
  const on = stormDestructionOn(changelist, now, config);
  return on === null ? "" : ["[ConsoleVariables]", `Athena.bMegaStormEnabled=${on ? 1 : 0}`, ""].join("\r\n");
}

// The share of matches (0 to 100) the gameserver gives a mega storm while the switch is on.
export const stormDestructionPercent = (config = currentEventsConfig()) => sanitizeStormDestruction(config?.stormDestruction).percent;

// The admin panel's view: the setting, Epic's dates, whether they hold the replay now, and the switch on each build.
export function stormDestructionStatus(now = new Date(), config = currentEventsConfig()) {
  const setting = sanitizeStormDestruction(config?.stormDestruction);
  return {
    ...setting,
    modes: stormDestructionModes,
    original: { start: new Date(stormDestructionStart).toISOString(), end: new Date(stormDestructionEnd).toISOString() },
    inDates: inStormDestructionDates(now),
    builds: Object.fromEntries(stormDestructionBuilds.map((build) => [build, stormDestructionOn(build, now, config)]))
  };
}
