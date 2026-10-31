import { currentEventsConfig, isEventActive } from "../events/events.js";
import { perBuild } from "./read.js";

const data = perBuild((read) => ({ difficulties: {}, missionAlerts: [], dailyMissionAlertQuota: 0, missionAlertCategories: {},
  missionAlertSpreads: {}, zoneThemes: {}, ...read("world", {}) }));

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

// A MissionAlerts row by name.
export function missionAlertRow(name) {
  return data().missionAlerts.find((row) => row.name === name);
}

export const dailyMissionAlertQuota = () => data().dailyMissionAlertQuota;

// From 1.7.2 an alert's category (a MissionAlertCategories row: GeneralCategory, StormCategory...) is an
// EFortMissionAlertCategory with its own daily quota, and the profile keeps the claims of each category apart
// (profiles/alerts.js). Cert and 1.2 have no categories: one quota (DailyMissionAlertQuota) for every alert.
export const hasMissionAlertCategories = () => Object.keys(data().missionAlertCategories).length > 0;

// {category, quota, repeatable} of a MissionAlertCategories row.
export function missionAlertCategory(rowName) {
  const cat = data().missionAlertCategories[rowName];
  if (!cat) return undefined;
  if (rowName === "StormCategory") {
    const customQuota = currentEventsConfig()?.stormAlertQuota;
    if (Number.isInteger(customQuota) && customQuota >= 1) {
      return { ...cat, quota: customQuota };
    }
  }
  return cat;
}

export function missionAlertCategories() {
  const all = data().missionAlertCategories;
  const customQuota = currentEventsConfig()?.stormAlertQuota;
  if (Number.isInteger(customQuota) && customQuota >= 1 && all.StormCategory) {
    return {
      ...all,
      StormCategory: { ...all.StormCategory, quota: customQuota }
    };
  }
  return all;
}

// A MissionAlertSpreadDatas row (1.9.1's Mutant Storms): {chanceToSpread, totalChancesToSpread, maxNumTilesToSpreadTo,
// spreadInterval (minutes), missionAlertRowName}.
export function missionAlertSpread(name) {
  return data().missionAlertSpreads[name];
}

// The outpost item a storm shield zone theme belongs to (its CloudSaveItemDefinition), if it is one.
export function zoneOutpost(zoneTheme) {
  return data().zoneThemes[zoneTheme]?.cloudSaveItem;
}
