import { perBuild } from "./read.js";

// Item levelling, evolution, recycling and power (upgrades.json): levelCosts, recycleXp, recipes (MetaRecipes) and
// ratings (BaseItemRating), for the requesting build.
export const upgradeData = perBuild((read) => {
  const { levelCosts = {}, recycleXp = {}, recipes = {}, ratings = {} } = read("upgrades", {});
  return { levelCosts, recycleXp, recipes, ratings };
});
