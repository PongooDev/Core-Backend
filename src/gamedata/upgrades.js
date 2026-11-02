import { perBuild } from "./read.js";

// Item levelling, evolution, recycling and power (upgrades.json): levelCosts, recycleXp, recipes (MetaRecipes),
// ratings (BaseItemRating) and, from 1.11, disassembleRecipes (the DisassembleRecipes rows world items name: what
// recycling one from the backpack gives back), for the requesting build.
export const upgradeData = perBuild((read) => {
  const { levelCosts = {}, recycleXp = {}, recipes = {}, ratings = {}, disassembleRecipes = {} } = read("upgrades", {});
  return { levelCosts, recycleXp, recipes, ratings, disassembleRecipes };
});
