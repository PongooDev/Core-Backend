import crypto from "node:crypto";
import { McpError } from "../../../errors.js";
import { getItem } from "../../../gamedata/items.js";
import { upgradeData } from "../../../gamedata/upgrades.js";
import { hasUnlocked } from "../../../profiles/unlocks.js";
import { settleBackpack, worldStackCap } from "../../../profiles/vault.js";
import { unslot } from "./DisassembleWorldItems.js";

// CraftWorldItem {targetSchematicItemId, numTimesToCraft}, from 1.11 (UFortMcpProfileWorld::CraftWorldItem, FString
// TargetSchematicItemId, int32 NumTimesToCraft; the same through 3.0): the Save the World backpack's Craft. The front end
// queues crafts and sends them on theater0 one schematic at a time (2.5's sub_E39F80 calls the command's thunk,
// sub_1035380, with NumTimesToCraft 1; in a zone the same queue calls the server's ServerCraftSchematic instead).
// Crafting here does what the gameserver's AFortPlayerController::ServerCraftSchematic does in a zone (CoreV2's
// UFortSchematicItem::ServerCraftSchematic, from 2.2's 0x897AD0):
// - The schematic is the account's (profile0); its CraftingRecipe row (CraftingRecipes_New) gives the costs, the one
//   world item it makes and how many (GetResultWorldItemDefinition, GetQuantityProduced), and its RequiredCatalysts.
// - Every cost is taken from the backpack (theater0), whatever the row's bIsConsumed: the client's CanCraftSchematic
//   never reads it. An ingredient the backpack is short of is crafted first from the account's own schematic for it
//   (GetSchematicForItem: blast powder, nuts and bolts...), as many times as the shortfall needs.
// - The result is made at the schematic's level (CreateTemporaryItemInstanceBP(Count, Level)): a weapon or trap carries
//   that level and full durability. It tops up the backpack's stacks of the same template and attributes up to
//   MaxStackSize, then makes new stacks (one item each for weapons). The lobby sends no quickbar slot (the zone's
//   PostCraftSlot), so nothing is slotted; a stack the craft empties leaves its quickbar slot.
// - New backpack items past its limit go to its overflow, as grants do; a craft that would take the backpack past
//   512 stacks, or that it can't pay for, is refused whole.
// 🟡 Epic's service isn't in the client: the error codes are Core's. 2.5's notes say crafted weapons come with one
// free clip in a zone; the backend has no clip sizes, so a weapon crafted here starts empty (the entry's LoadedAmmo 0).
const invalid = (message) => {
  throw new McpError("errors.com.epicgames.validation.validation_failed", message);
};

const short = (message) => {
  throw new McpError("errors.com.epicgames.fortnite.item_consumption_failed", message);
};

const guidKey = (itemId) => String(itemId).replace(/-/g, "").toLowerCase();
const sameTemplate = (a, b) => a.toLowerCase() === b.toLowerCase();

function findItemId(profile, itemId) {
  if (typeof itemId !== "string" || !itemId) return undefined;
  if (profile.items[itemId]) return itemId;
  const wanted = guidKey(itemId);
  return Object.keys(profile.items).find((id) => guidKey(id) === wanted);
}

// UFortSchematicItemDefinition::GetRecipe for a schematic the account holds, when it makes one world item.
function schematicRecipe(schematic) {
  const recipe = upgradeData().craftingRecipes[getItem(schematic.templateId)?.craftingRecipe];
  return recipe?.results.length === 1 && recipe.results[0].quantity > 0 ? recipe : undefined;
}

// AFortPlayerController::GetSchematicForItem: the account's schematic that makes this item.
function schematicFor(account, templateId) {
  return Object.keys(account.items).find((itemId) => {
    const recipe = schematicRecipe(account.items[itemId]);
    return recipe && sameTemplate(recipe.results[0].templateId, templateId);
  });
}

const stableJson = (value) => (value && typeof value === "object" && !Array.isArray(value)
  ? `{${Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${stableJson(value[name])}`).join(",")}}`
  : JSON.stringify(value));

const heldQuantity =(profile, templateId) => Object.values(profile.items)
  .filter((item) => sameTemplate(item.templateId, templateId)).reduce((sum, item) => sum + item.quantity, 0);

// Takes quantity of a template from the backpack's stacks, first stack first; returns the ids of stacks it emptied.
function take(tracker, templateId, quantity) {
  const emptied = [];
  let left = quantity;
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (left <= 0) break;
    if (!sameTemplate(item.templateId, templateId)) continue;
    const used = Math.min(left, item.quantity);
    left -= used;
    if (item.quantity > used) tracker.setQuantity(itemId, item.quantity - used);
    else {
      tracker.removeItem(itemId);
      emptied.push(itemId);
    }
  }
  return emptied;
}

// UFortSchematicItem::ServerCraftSchematic, times over. Returns the backpack items it made.
function craft(session, theater, schematicId, times, depth) {
  const account = session.profile("profile0").profile;
  const schematic = account.items[schematicId];
  const recipe = schematicRecipe(schematic);
  if (!recipe) invalid(`${schematic.templateId} has no crafting recipe`);
  if (!hasUnlocked(account, recipe.catalysts)) short(`Unlock ${recipe.catalysts.join(", ")} on the skill tree first`);

  const emptied = [];
  for (const { templateId, quantity } of recipe.costs) {
    const needed = quantity * times;
    const owned = heldQuantity(theater.profile, templateId);
    const ingredientSchematic = owned < needed && depth < 8 ? schematicFor(account, templateId) : undefined;
    if (ingredientSchematic) {
      const produced = schematicRecipe(account.items[ingredientSchematic]).results[0].quantity;
      craft(session, theater, ingredientSchematic, Math.ceil((needed - owned) / produced), depth + 1);
    }
    const have = heldQuantity(theater.profile, templateId);
    if (have < needed) short(`Not enough ${templateId} to craft ${schematic.templateId}: ${have} of ${needed}`);
    emptied.push(...take(theater, templateId, needed));
  }
  unslot(theater, emptied);

  const [result] = recipe.results;
  const info = getItem(result.templateId);
  if (!info || info.profile !== "theater") invalid(`${schematic.templateId} makes ${result.templateId}, which isn't a backpack item`);
  if (info.neverPersisted) invalid(`${result.templateId} is never persisted`);
  // Weapons and traps carry the schematic's level and full durability; ammo and ingredients carry nothing, as granted.
  const attributes = info.maxDurability !== undefined ? { level: schematic.attributes?.level ?? 1, durability: info.maxDurability } : {};
  const limit = info.maxStackSize > 0 ? info.maxStackSize : Infinity;
  const key = stableJson(attributes);
  let remaining = result.quantity * times;
  for (const [itemId, item] of Object.entries(theater.profile.items)) {
    if (remaining <= 0) break;
    if (!sameTemplate(item.templateId, result.templateId) || item.quantity >= limit || stableJson(item.attributes ?? {}) !== key) continue;
    const amount = Math.min(remaining, limit - item.quantity);
    theater.setQuantity(itemId, item.quantity + amount);
    remaining -= amount;
  }
  if (Object.keys(theater.profile.items).length + Math.ceil(remaining / limit) > worldStackCap) {
    throw new McpError("errors.com.epicgames.fortnite.inventory_full", `The backpack holds ${worldStackCap} stacks`);
  }
  const made = [];
  for (; remaining > 0; remaining -= Math.min(remaining, limit)) {
    const itemId = crypto.randomUUID();
    theater.addItem(itemId, { templateId: result.templateId, attributes: structuredClone(attributes), quantity: Math.min(remaining, limit) });
    made.push(itemId);
  }
  settleBackpack(theater, account, made);
}

export function craftWorldItem({ req, session, tracker, profileId }) {
  if (!profileId.startsWith("theater")) throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", "CraftWorldItem is a theater profile command");
  const account = session.profile("profile0").profile;
  const schematicId = findItemId(account, req.body?.targetSchematicItemId);
  if (!schematicId || getItem(account.items[schematicId].templateId)?.class !== "FortSchematicItemDefinition") {
    throw new McpError("errors.com.epicgames.fortnite.item_not_found", `Schematic ${req.body?.targetSchematicItemId} not found`);
  }
  const times = req.body?.numTimesToCraft ?? 1;
  if (!Number.isInteger(times) || times <= 0) invalid(`Can't craft ${times} times`);
  craft(session, tracker, schematicId, times, 0);
}
