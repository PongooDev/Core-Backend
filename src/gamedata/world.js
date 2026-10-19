import { readGameData } from "./read.js";

const { difficulties = {}, missionAlerts = [], dailyMissionAlertQuota = 0, zoneThemes = {} } = readGameData("world", {});

export function getDifficulty(rowName) {
  return difficulties[rowName];
}

// The MissionAlerts row a mission of this difficulty can carry an alert from, if any.
export function missionAlertTier(rowName) {
  const difficulty = difficulties[rowName]?.difficulty;
  if (difficulty === undefined) return undefined;
  return missionAlerts.find((row) => difficulty >= row.minimumDifficulty && difficulty <= row.maximumDifficulty);
}

export { dailyMissionAlertQuota };

// The outpost item a storm shield zone theme belongs to (its CloudSaveItemDefinition), if it is one.
export function zoneOutpost(zoneTheme) {
  return zoneThemes[zoneTheme]?.cloudSaveItem;
}
