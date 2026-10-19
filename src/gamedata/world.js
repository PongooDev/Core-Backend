import { readGameData } from "./read.js";

const { difficulties = {} } = readGameData("world", {});

export function getDifficulty(rowName) {
  return difficulties[rowName];
}
