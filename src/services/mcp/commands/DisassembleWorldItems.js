import { McpError } from "../../../errors.js";
import { getItem } from "../../../gamedata/items.js";
import { upgradeData } from "../../../gamedata/upgrades.js";
import { grantItem } from "../../../profiles/items.js";

// DisassembleWorldItems {targetItemIdAndQuantityPairs: [{itemId, quantity}]}, from 1.11
// (UFortMcpProfileWorld::DisassembleWorldItems): the Save the World backpack's recycle takes the quantities of its
// theater items and gives back what each disassembles into. That is UFortWorldItemDefinition::GetDisassemblyResults
// (sub_6D8910): every result of the definition's DisassembleRecipe row (DisassembleRecipes), its quantity scaled by
// DisassembleDurabilityDegradeMinLootPercent + (Max - Min) × the item's GetDurabilityPercent (item vslot 0x2A8: its
// durability over the template's max durability, clamped to 0-1, 1 for an item without durability) and truncated,
// in single precision as the client works it out. The client's recycle screen (sub_2316320) shows that per item times
// the quantity. Items without a recipe don't disassemble (CanBeDisassembled, "This item does not disassemble.").
// What it gives (ingredients, resources) goes to theater0; a stack it empties leaves the backpack's quickbar.
const invalid = (message) => {
  throw new McpError("errors.com.epicgames.validation.validation_failed", message);
};

function findItemId(tracker, itemId) {
  if (typeof itemId !== "string" || !itemId) return undefined;
  if (tracker.profile.items[itemId]) return itemId;
  const wanted = itemId.toLowerCase();
  return Object.keys(tracker.profile.items).find((id) => id.toLowerCase() === wanted);
}

// UFortWorldItem::GetDurabilityPercent.
export function durabilityPercent(item) {
  const max = getItem(item.templateId)?.maxDurability;
  const durability = item.attributes?.durability;
  if (!(max > 0) || typeof durability !== "number") return 1;
  return Math.min(Math.max(durability / max, 0), 1);
}

// UFortWorldItemDefinition::GetDisassemblyResults for one of the item: [{templateId, quantity}].
export function disassemblyResults(item) {
  const info = getItem(item.templateId);
  const results = info?.disassembleRecipe ? upgradeData().disassembleRecipes[info.disassembleRecipe] : undefined;
  if (!results) return undefined;
  const [min, max] = info.disassembleLootPercent ?? [0.2, 0.8];
  const f = Math.fround;
  const percent = f(f(f(f(max) - f(min)) * f(durabilityPercent(item))) + f(min));
  return results.map(({ templateId, quantity }) => ({ templateId, quantity: Math.max(0, Math.trunc(f(Math.max(quantity, 0) * percent))) }));
}

// The quickbar slots (ModifyQuickbar's FGuid text) that held a recycled item are emptied.
function unslot(tracker, itemIds) {
  const loadout = tracker.profile.stats.attributes.player_loadout;
  if (!loadout) return;
  const gone = new Set(itemIds.map((itemId) => itemId.replace(/-/g, "").toUpperCase()));
  let changed = false;
  const next = { ...loadout };
  for (const name of ["primaryQuickBarRecord", "secondaryQuickBarRecord"]) {
    if (!Array.isArray(loadout[name]?.slots)) continue;
    next[name] = { ...loadout[name], slots: loadout[name].slots.map((slot) => {
      const items = Array.isArray(slot?.items) ? slot.items.filter((id) => !gone.has(String(id).replace(/-/g, "").toUpperCase())) : slot?.items;
      if (items?.length !== slot?.items?.length) changed = true;
      return { ...slot, items };
    }) };
  }
  if (changed) tracker.setStat("player_loadout", next);
}

export function disassembleWorldItems({ req, session, tracker, profileId }) {
  if (!profileId.startsWith("theater")) throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", "DisassembleWorldItems is a theater profile command");
  const pairs = req.body?.targetItemIdAndQuantityPairs;
  if (!Array.isArray(pairs) || pairs.length === 0) invalid("No items to disassemble");

  // Every pair is checked before anything is taken: the item is in the backpack and disassembles, and the quantities
  // asked for it add up to no more than the stack holds.
  const taking = new Map();
  for (const pair of pairs) {
    const itemId = findItemId(tracker, pair?.itemId);
    if (!itemId) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `Item ${pair?.itemId} not found in the backpack`);
    const quantity = pair.quantity;
    if (!Number.isInteger(quantity) || quantity <= 0) invalid(`Can't disassemble ${quantity} of ${pair.itemId}`);
    const item = tracker.profile.items[itemId];
    if (!disassemblyResults(item)) invalid(`${item.templateId} does not disassemble`);
    const total = (taking.get(itemId) ?? 0) + quantity;
    if (total > item.quantity) invalid(`Can't disassemble ${total} of ${pair.itemId}, the stack holds ${item.quantity}`);
    taking.set(itemId, total);
  }

  const given = new Map();
  const emptied = [];
  for (const [itemId, quantity] of taking) {
    const item = tracker.profile.items[itemId];
    for (const result of disassemblyResults(item)) given.set(result.templateId, (given.get(result.templateId) ?? 0) + result.quantity * quantity);
    if (item.quantity > quantity) tracker.setQuantity(itemId, item.quantity - quantity);
    else {
      tracker.removeItem(itemId);
      emptied.push(itemId);
    }
  }
  unslot(tracker, emptied);
  for (const [templateId, quantity] of given) grantItem(session, templateId, quantity);
}
