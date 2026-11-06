import { McpError } from "../errors.js";
import { getItem } from "../gamedata/items.js";
import { upgradeData } from "../gamedata/upgrades.js";
import { missingAlterations } from "./alterations.js";
import { grantItem } from "./items.js";
import { itemChanged } from "./progress.js";
import { hasUnlocked } from "./unlocks.js";
import { inOverflow } from "./vault.js";

// Levelling, evolving and recycling account items, from the game data (UFortAccountItemDefinition):
//   UpgradeItem   one level, costing XPAccountItemLevels[levelCost][level] of the item's XP, up to MaxLevel;
//   ConvertItem   the evolution recipe ConversionRecipes[index] in MetaRecipes (its costs, for its result);
//   RecycleItem   XPAccountItemRewards[recycleXp][level] of the item's XP back, plus the SacrificeRecipe's results.
// Both recipes need their catalyst tags unlocked on the skill tree.
// Heroes and defenders use hero XP, survivors personnel XP, schematics schematic XP: the client's
// UFortMcpContext::GetUpgradeXPBalance(EFortItemType) (sub_64BE00) reads GetHeroXp for Hero and Defender, GetSchematicXp
// for Schematic and GetPersonnelXp for Worker. The recipes are the requesting build's (1.2 fixed the Founder's rare laser
// sword evolving into the very rare one, gamedata/3541083).

const xpResource = {
  FortHeroType: "AccountResource:heroxp",
  FortWorkerType: "AccountResource:personnelxp",
  FortDefenderItemDefinition: "AccountResource:heroxp",
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
export function pay(tracker, costs) {
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

// The item may sit in another profile (a collection book's slotted items); the cost always comes out of profile0.
export function upgradeItem(session, itemId, profileId = "profile0") {
  const tracker = session.profile(profileId);
  const { item, info } = accountItem(tracker, itemId);
  // ItemUpgradeRestrictionReason_VaultOverflow: "Items in the vault overflow temporarily can not level up." (profiles/vault.js)
  if (inOverflow(item)) fail(`${item.templateId} is in the vault overflow and can't level up`);
  const level = item.attributes.level ?? 1;
  if (level >= info.maxLevel) fail(`${item.templateId} is already at its highest level, ${info.maxLevel}`);
  const cost = upgradeData().levelCosts[info.levelCost]?.[level];
  if (!cost) fail(`No level cost for ${info.levelCost} level ${level}`);
  pay(session.profile("profile0"), [{ templateId: xpResource[info.class], quantity: cost }]);
  tracker.setItemAttribute(itemId, "level", level + 1);
  itemChanged(session, "Upgrade", tracker.profile.items[itemId]);
}

// The evolved item takes the old one's place, id and attributes (level, squad slot, favorite) included.
// Returns the evolved item as a grant entry (profiles/items.js lootEntry).
export function convertItem(session, itemId, conversionIndex, profileId = "profile0") {
  const tracker = session.profile(profileId);
  const account = session.profile("profile0");
  const { item, info } = accountItem(tracker, itemId);
  // ItemEvolutionRestrictionReason_VaultOverflow: "Items in the vault overflow temporarily can not be evolved."
  if (inOverflow(item)) fail(`${item.templateId} is in the vault overflow and can't be evolved`);
  const recipe = upgradeData().recipes[info.conversions?.[conversionIndex]];
  if (!recipe || recipe.results.length !== 1) fail(`${item.templateId} has no evolution ${conversionIndex}`);
  if (!hasUnlocked(account.profile, recipe.catalysts)) locked(recipe.catalysts);
  pay(account, recipe.costs);
  const [result] = recipe.results;
  const attributes = { ...item.attributes, item_seen: 0 };
  tracker.removeItem(itemId);
  tracker.addItem(itemId, { templateId: result.templateId, attributes: { ...attributes, ...missingAlterations({ templateId: result.templateId, attributes }) }, quantity: 1 });
  itemChanged(session, "Convert", tracker.profile.items[itemId], item.templateId);
  return { templateId: result.templateId, itemId, profileId, quantity: 1 };
}

// UFortAccountItem::GetLevelRelativeCostForRarityUpgrade (2.5 vslot 0x270, sub_C25720): the XP the item's levels cost
// at the new rarity less what they cost at its own, each the sum of the definition's XPAccountItemLevels row from
// level 1 to the one below the item's (sub_C1B640, a float total truncated at every step). Undefined (the client's -1)
// when the result levels with another XP type.
export function levelRelativeRarityCost(item, info, resultInfo) {
  if (!resultInfo || xpResource[info.class] !== xpResource[resultInfo.class]) return undefined;
  const f = Math.fround;
  const levelsCost = (row) => {
    const curve = upgradeData().levelCosts[row] ?? [];
    let total = 0;
    for (let level = 1; level < (item.attributes?.level ?? 1); level++) total = Math.trunc(f(f(curve[level] ?? 0) + f(total)));
    return total;
  };
  return Math.trunc(f(levelsCost(resultInfo.levelCost) - levelsCost(info.levelCost)));
}

// UpgradeItemRarity {targetItemId}, from 1.10 (CL 3790078; UFortMcpProfileAccount::UpgradeItemRarity): Flux raises an
// account item's rarity. The item's UpgradeRarityRecipeHandle names a MetaRecipes row (EvolveRarity.*) with one result,
// the same item a rarity up; 2.5's rows are its notes' reworked costs ("more Training Manuals and evolution materials
// ... depending on the star level of the Hero"), 2.4.2's the early ones. The checks are the client's
// UFortAccountItem::CanUpgradeItemRarity (2.5 vslot 0x280, sub_C1C260; EItemEvolutionRestrictionReason):
// NoRarityUpgrade without a one-result row, VaultOverflow for an item in the vault overflow, MissingCatalyst without
// the row's RequiredCatalysts on the skill tree (Unlocks.RarityUpgrade.Hero.*), MissingCosts short of a cost or of the
// level-relative XP. The item keeps its id, level and the rest of its attributes. Returns it as a grant entry.
// 🟡 Epic's service isn't in the client: the error codes are Core's.
// 4.2 (CL-4072250) adds weapon and trap schematics ("Added the ability to upgrade Weapon and Trap Schematic Rarity. Uses the
// same recipe as Hero Rarity Upgrade ... Unlocked by the 2-Star Evolution Skill Tree Nodes", Core-Backend #271): its data
// names every schematic's EvolveRarity.SID.* row, and its 2-star evolution nodes grant Unlocks.RarityUpgrade.Weapon.*
// and .Trap.*, so they go through here unchanged. 🟡 "Legacy schematics must be converted by the Perk Recombobulator
// before their rarity can be upgraded" is the client's check, and Core has no Perk Recombobulator yet (#270). The perks
// stay with the item; a result whose loadout has more slots gets new perks for them (profiles/alterations.js).
export function upgradeItemRarity(session, itemId) {
  const tracker = session.profile("profile0");
  const { item, info } = accountItem(tracker, itemId);
  const recipe = upgradeData().recipes[info.rarityUpgrade];
  if (!recipe || recipe.results.length !== 1) fail(`${item.templateId} has no rarity upgrade`);
  if (inOverflow(item)) fail(`${item.templateId} is in the vault overflow and can't be evolved`);
  if (!hasUnlocked(tracker.profile, recipe.catalysts)) locked(recipe.catalysts);
  const [result] = recipe.results;
  const xp = levelRelativeRarityCost(item, info, getItem(result.templateId));
  pay(tracker, xp > 0 ? [...recipe.costs, { templateId: xpResource[info.class], quantity: xp }] : recipe.costs);
  const attributes = { ...item.attributes, item_seen: 0 };
  tracker.removeItem(itemId);
  tracker.addItem(itemId, { templateId: result.templateId, attributes: { ...attributes, ...missingAlterations({ templateId: result.templateId, attributes }) }, quantity: 1 });
  itemChanged(session, "UpgradeRarity", tracker.profile.items[itemId], item.templateId);
  return { templateId: result.templateId, itemId, profileId: "profile0", quantity: 1 };
}

export function recycleItem(session, itemId) {
  const tracker = session.profile("profile0");
  const { item, info } = accountItem(tracker, itemId);
  if (item.attributes.squad_id) fail(`${item.templateId} is in a squad`);
  const { recipes } = upgradeData();
  const catalysts = recipes[info.recycleRecipe]?.catalysts ?? [];
  if (!hasUnlocked(tracker.profile, catalysts)) locked(catalysts);
  const xp = recycleXpRefund(item);
  tracker.removeItem(itemId);
  if (xp) grantItem(session, xp.templateId, xp.quantity);
  for (const { templateId, quantity } of recipes[info.recycleRecipe]?.results ?? []) grantItem(session, templateId, quantity);
}

// The XP an item gives back when it's recycled or sacrificed to a transform: UFortAccountItem::GetRecycleValue (vslot
// 0x258, sub_5BF970) reads the definition's LevelToSacrificeXpHandle row of XPAccountItemRewards at the item's level and
// truncates it; the XP type is the one levelling it costs (hero XP for heroes and defenders, schematic XP, survivor XP).
export function recycleXpRefund(item) {
  const info = getItem(item.templateId);
  const quantity = Math.trunc(upgradeData().recycleXp[info?.recycleXp]?.[item.attributes?.level ?? 1] ?? 0);
  return quantity > 0 && xpResource[info.class] ? { templateId: xpResource[info.class], quantity } : null;
}

// UFortAccountItemDefinition::GetRecyclingRefunds: the SacrificeRecipe's results, what recycling the item gives besides
// its XP.
export function recyclingRefunds(templateId) {
  return upgradeData().recipes[getItem(templateId)?.recycleRecipe]?.results ?? [];
}
