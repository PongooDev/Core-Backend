import { perBuild } from "./read.js";

// Item levelling, evolution, recycling and power (upgrades.json): levelCosts, recycleXp, recipes (MetaRecipes),
// ratings (BaseItemRating), from 1.11 disassembleRecipes (the DisassembleRecipes rows world items name: what
// recycling one from the backpack gives back) and craftingRecipes (the CraftingRecipes_New rows schematics name: what
// crafting one costs and makes; extracted for 2.1 and later), for the requesting build.
export const upgradeData = perBuild((read) => {
  const { levelCosts = {}, recycleXp = {}, recipes = {}, ratings = {}, disassembleRecipes = {}, craftingRecipes = {} } = read("upgrades", {});
  return { levelCosts, recycleXp, recipes, ratings, disassembleRecipes, craftingRecipes };
});
