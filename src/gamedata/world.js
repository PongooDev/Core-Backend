import { readGameData } from "./read.js";

const { zoneThemes = {}, missionGenerators = {}, difficulties = {} } = readGameData("world", {});

// Data keys are full class paths ("/Game/.../BP_ZT_TheForest.BP_ZT_TheForest_C"); theaters name them by asset.
function byAssetName(record) {
  return new Map(Object.keys(record).map((path) => [path.split("/").pop().split(".")[0].toLowerCase(), path]));
}
const themePaths = byAssetName(zoneThemes);
const generatorPaths = byAssetName(missionGenerators);

export function zoneThemePath(name) {
  return themePaths.get(name.toLowerCase());
}

export function missionGeneratorPath(name) {
  return generatorPaths.get(name.toLowerCase());
}

export function getDifficulty(rowName) {
  return difficulties[rowName];
}
