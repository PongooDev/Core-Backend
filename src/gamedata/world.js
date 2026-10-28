import { perBuild } from "./read.js";

const data = perBuild((read) => ({ difficulties: {}, missionAlerts: [], dailyMissionAlertQuota: 0, zoneThemes: {}, ...read("world", {}) }));

export function getDifficulty(rowName) {
  return data().difficulties[rowName];
}

// The MissionAlerts row a mission of this difficulty can carry an alert from, if any (of that loot tier group, when
// given).
export function missionAlertTier(rowName, lootTierGroup) {
  const difficulty = data().difficulties[rowName]?.difficulty;
  if (difficulty === undefined) return undefined;
  return data().missionAlerts.find((row) => difficulty >= row.minimumDifficulty && difficulty <= row.maximumDifficulty
    && (!lootTierGroup || row.lootTierGroup === lootTierGroup));
}

export const dailyMissionAlertQuota = () => data().dailyMissionAlertQuota;

// The outpost item a storm shield zone theme belongs to (its CloudSaveItemDefinition), if it is one.
export function zoneOutpost(zoneTheme) {
  return data().zoneThemes[zoneTheme]?.cloudSaveItem;
}
