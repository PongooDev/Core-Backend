import { McpError } from "../errors.js";
import { getItem } from "../gamedata/items.js";
import { readGameData } from "../gamedata/read.js";
import { grantItem } from "./items.js";
import { hasUnlocked } from "./unlocks.js";

// Levelling, evolving and recycling account items, from the game data (UFortAccountItemDefinition):
//   UpgradeItem   one level, costing XPAccountItemLevels[levelCost][level] of the item's XP, up to MaxLevel;
//   ConvertItem   the evolution recipe ConversionRecipes[index] in MetaRecipes (its costs, for its result);
//   RecycleItem   XPAccountItemRewards[recycleXp][level] of the item's XP back, plus the SacrificeRecipe's results.
// Both recipes need their catalyst tags unlocked on the skill tree.
// Heroes use hero XP, survivors and defenders personnel XP, schematics schematic XP (the client's GetHeroXp,
// GetPersonnelXp and GetSchematicXp balances).
const { levelCosts = {}, recycleXp = {}, recipes = {} } = readGameData("upgrades", {});

const xpResource = {
  FortHeroType: "AccountResource:heroxp",
  FortWorkerType: "AccountResource:personnelxp",
  FortDefenderItemDefinition: "AccountResource:personnelxp",
  FortSchematicItemDefinition: "AccountResource:schematicxp"
};

// Recipes need their RequiredCatalysts unlocked on the skill tree (the recycler upgrades, each evolution tier).
const locked = (catalysts) => {
  throw new McpError("errors.com.epicgames.fortnite.item_consumption_failed", `Unlock ${catalysts.join(", ")} on the skill tree first`);
};

const fail = (message) => {
  throw new McpError("errors.com.epicgames.fortnite.item_consumption_failed", message);
};

function accountItem(tracker, itemId) {
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  const info = item && getItem(item.templateId);
  if (!item || !info?.levelCost) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `Item ${itemId} not found or can't be upgraded`);
  return { item, info };
}

// Takes what a list of costs asks for from the profile's stacks, or fails without taking anything.
function pay(tracker, costs) {
  const plan = costs.map(({ templateId, quantity }) => {
    const stacks = Object.entries(tracker.profile.items).filter(([, held]) => held.templateId.toLowerCase() === templateId.toLowerCase());
    const have = stacks.reduce((sum, [, held]) => sum + held.quantity, 0);
    if (have < quantity) fail(`Not enough ${templateId}: ${have} of ${quantity}`);
    return { stacks, quantity };
  });
  for (const { stacks, quantity } of plan) {
    let left = quantity;
    for (const [stackId, held] of stacks) {
      if (!left) break;
      const used = Math.min(left, held.quantity);
      left -= used;
      if (held.quantity > used) tracker.setQuantity(stackId, held.quantity - used);
      else tracker.removeItem(stackId);
    }
  }
}

export function upgradeItem(session, itemId) {
  const tracker = session.profile("profile0");
  const { item, info } = accountItem(tracker, itemId);
  const level = item.attributes.level ?? 1;
  if (level >= info.maxLevel) fail(`${item.templateId} is already at its highest level, ${info.maxLevel}`);
  const cost = levelCosts[info.levelCost]?.[level];
  if (!cost) fail(`No level cost for ${info.levelCost} level ${level}`);
  pay(tracker, [{ templateId: xpResource[info.class], quantity: cost }]);
  tracker.setItemAttribute(itemId, "level", level + 1);
}

// The evolved item takes the old one's place, id and attributes (level, squad slot, favorite) included.
export function convertItem(session, itemId, conversionIndex) {
  const tracker = session.profile("profile0");
  const { item, info } = accountItem(tracker, itemId);
  const recipe = recipes[info.conversions?.[conversionIndex]];
  if (!recipe || recipe.results.length !== 1) fail(`${item.templateId} has no evolution ${conversionIndex}`);
  if (!hasUnlocked(tracker.profile, recipe.catalysts)) locked(recipe.catalysts);
  pay(tracker, recipe.costs);
  const [result] = recipe.results;
  const attributes = { ...item.attributes, item_seen: 0 };
  tracker.removeItem(itemId);
  tracker.addItem(itemId, { templateId: result.templateId, attributes, quantity: 1 });
}

export function recycleItem(session, itemId) {
  const tracker = session.profile("profile0");
  const { item, info } = accountItem(tracker, itemId);
  if (item.attributes.squad_id) fail(`${item.templateId} is in a squad`);
  const catalysts = recipes[info.recycleRecipe]?.catalysts ?? [];
  if (!hasUnlocked(tracker.profile, catalysts)) locked(catalysts);
  const xp = Math.round(recycleXp[info.recycleXp]?.[item.attributes.level ?? 1] ?? 0);
  tracker.removeItem(itemId);
  if (xp > 0) grantItem(session, xpResource[info.class], xp);
  for (const { templateId, quantity } of recipes[info.recycleRecipe]?.results ?? []) grantItem(session, templateId, quantity);
}
