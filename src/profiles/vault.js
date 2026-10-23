import { getItem } from "../gamedata/items.js";
import { readGameData } from "../gamedata/read.js";
import { heldQuantity, ownsNode } from "./homebase.js";

// The item limits (inventory.json: what skill tree nodes and account buffs add to the FortHomebaseSet attributes).
//
// The account vault ("Inventory 221 / 200" in the frontend):
// - Limit (UFortInventoryContext::GetVaultItemLimit -> sub_2BEF5B0): (int) InventorySizeBonus, which only
//   StartNode_CommandCenter raises (GE_AccountInventorySize_Start, +200; the attribute set's base is 0, no clamp), plus
//   the quantity of every Token:AccountInventoryBonus ("Armory Slot") item (sub_5BC850 -> sub_3906120).
// - Count (account profile slot 0x52, sub_68A4A0): one per account item whose definition has bInventorySizeLimited
//   (heroes, schematics, survivors and leads, defenders, alterations; items.json inventorySizeLimited), whatever its
//   quantity. Overflow items count too, so the client shows the true total, in red past the limit (sub_2C37BE0).
// - An item is in overflow when its inventory_overflow_date attribute (UFortAccountItem +0xE8, FString) is any
//   non-empty string (IsInventoryOverflowItem sub_5C5270, no date compared). The client never writes it; MCP did. The
//   client then refuses to level, evolve or slot it ("Items in the vault overflow temporarily can not level up.") and,
//   while the vault has overflown, to buy skill tree nodes.
// 🟡 Epic's server side isn't in the client. Core: a grant always lands (as rewards must), and after every change to
// profile0 exactly (count - limit) items are in overflow: the newest items without the date get it (now, ISO 8601),
// and when room is made the ones that have waited longest come back first. Core refuses the same actions the client
// does for them.
//
// The backpack (theater0, in a zone): limit (inventory interface slot 40, sub_5B60C0) = (int) WorldInventorySizeBonus
// (StartNode_CommandCenter +50, 26 nodes +5 each, Buff:vipstatus +20) + the quantity of Token:WorldInventoryBonus;
// count (slot 48, sub_5BCA20) = one per stack whose world item definition has bInventorySizeLimited (weapons, traps,
// consumables, ingredients...; not resources, ammo, badges, building pieces) and which isn't in overflow (the
// FFortItemEntry bool inventory_overflow_date, read from the theater0 attribute of that name) or a gift. The world
// inventory never holds more than 512 stacks in all (sub_5B5FB0). A pickup that doesn't fit is refused in the zone
// (sub_5DF090, "Backpack full!" / "Can't hold more of this item!", sub_5E5080).
// 🟡 Core: world items MCP grants (rewards, the admin panel) that don't fit the backpack are put in its overflow, as the
// zone does with items it has to keep; nothing past the 512-stack cap is granted.
const { nodes = {}, buffs = {} } = readGameData("inventory", {});
export const worldStackCap = 512;

function attribute(profile, name) {
  let total = 0;
  for (const [nodeId, effects] of Object.entries(nodes)) if (effects[name] && ownsNode(profile, nodeId)) total = Math.fround(total + effects[name]);
  for (const [buff, effects] of Object.entries(buffs)) if (effects[name] && heldQuantity(profile, buff) > 0) total = Math.fround(total + effects[name]);
  return Math.trunc(total);
}

export const vaultLimit = (profile) => attribute(profile, "InventorySizeBonus") + heldQuantity(profile, "Token:AccountInventoryBonus");
export const backpackLimit = (profile) => attribute(profile, "WorldInventorySizeBonus") + heldQuantity(profile, "Token:WorldInventoryBonus");

export const isLimited = (item) => Boolean(getItem(item.templateId)?.inventorySizeLimited);
export const inOverflow = (item) => Boolean(item?.attributes?.inventory_overflow_date);

const vaultItemIds = (profile) => Object.keys(profile.items).filter((itemId) => isLimited(profile.items[itemId]));

export function vaultState(profile) {
  const ids = vaultItemIds(profile);
  return { count: ids.length, limit: vaultLimit(profile), overflow: ids.filter((itemId) => inOverflow(profile.items[itemId])).length };
}

// profile0's overflow after a change: exactly (count - limit) vault items carry inventory_overflow_date.
export function settleVault(tracker, now = new Date()) {
  const { profile } = tracker;
  const ids = vaultItemIds(profile);
  const wanted = Math.max(0, ids.length - vaultLimit(profile));
  const flagged = ids.filter((itemId) => inOverflow(profile.items[itemId]));
  if (flagged.length > wanted) {
    const longestWaiting = [...flagged].sort((a, b) => String(profile.items[a].attributes.inventory_overflow_date)
      .localeCompare(String(profile.items[b].attributes.inventory_overflow_date)));
    for (const itemId of longestWaiting.slice(0, flagged.length - wanted)) tracker.removeItemAttribute(itemId, "inventory_overflow_date");
  } else if (flagged.length < wanted) {
    // 🟡 Items in a squad are the last to go: the newest ones outside any squad first.
    const date = now.toISOString();
    const free = ids.filter((itemId) => !inOverflow(profile.items[itemId])).reverse();
    const inSquad = (itemId) => Boolean(profile.items[itemId].attributes?.squad_id);
    const order = [...free.filter((itemId) => !inSquad(itemId)), ...free.filter(inSquad)];
    for (const itemId of order.slice(0, wanted - flagged.length)) tracker.setItemAttribute(itemId, "inventory_overflow_date", date);
  }
}

// The backpack's limited stacks that aren't in overflow, and all its stacks.
export function backpackState(theater, profile0) {
  const items = Object.values(theater.items);
  return { count: items.filter((item) => isLimited(item) && !inOverflow(item)).length, stacks: items.length, limit: backpackLimit(profile0) };
}

// New theater0 stacks that don't fit the backpack go to its overflow, newest first.
export function settleBackpack(theaterTracker, profile0, newItemIds) {
  const { profile } = theaterTracker;
  let { count, limit } = backpackState(profile, profile0);
  for (const itemId of [...newItemIds].reverse()) {
    if (count <= limit) break;
    const item = profile.items[itemId];
    if (!item || !isLimited(item) || inOverflow(item)) continue;
    theaterTracker.setItemAttribute(itemId, "inventory_overflow_date", true);
    count--;
  }
}
