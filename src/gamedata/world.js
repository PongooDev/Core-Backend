import { isEventActive } from "../events/events.js";
import { perBuild } from "./read.js";

const data = perBuild((read) => ({ difficulties: {}, missionAlerts: [], dailyMissionAlertQuota: 0, zoneThemes: {}, ...read("world", {}) }));

export function getDifficulty(rowName) {
  return data().difficulties[rowName];
}

// The MissionAlerts row of a category (its CategoryRowName, a MissionAlertCategories row: GeneralCategory, StormCategory,
// StormLowCategory, HordeCategory, HalloweenCategory) a mission of this difficulty can carry an alert from, if any.
// Rows for an event flag Core doesn't run (EventFlag.FirstStorm's Storm rows, EventFlag.Horde's) and rows only used to
// spread storms are left out.
export function missionAlertTier(rowName, category = "GeneralCategory") {
  const difficulty = data().difficulties[rowName]?.difficulty;
  if (difficulty === undefined) return undefined;
  return data().missionAlerts.find((row) => (row.category ?? "GeneralCategory") === category && !row.onlyUsedForSpreading
    && (!row.requiredEventFlag || isEventActive(row.requiredEventFlag))
    && difficulty >= row.minimumDifficulty && difficulty <= row.maximumDifficulty);
}

export const dailyMissionAlertQuota = () => data().dailyMissionAlertQuota;

// The outpost item a storm shield zone theme belongs to (its CloudSaveItemDefinition), if it is one.
export function zoneOutpost(zoneTheme) {
  return data().zoneThemes[zoneTheme]?.cloudSaveItem;
}
