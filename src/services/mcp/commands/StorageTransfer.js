import crypto from "node:crypto";
import { McpError } from "../../../errors.js";
import { getItem } from "../../../gamedata/items.js";
import { backpackState, storageState, worldStackCap } from "../../../profiles/vault.js";
import { unslot } from "./DisassembleWorldItems.js";

// StorageTransfer {theaterToOutpostItems, outpostToTheaterItems: [{itemId, quantity}]}, from 1.11
// (UFortMcpProfileWorld::StorageTransfer, FItemIdAndQuantityPair; the same in 2.1 and 2.2): the Save the World lobby's
// storm shield storage moves quantities of backpack items (theater0) into storage (outpost0) and back. The front end
// sends it on theater0 (UFortOutpostFunctionLibrary::TransferItemToStorage / TransferItemFromStorage, 2.1's
// sub_820450 / sub_820040, when the player has no storage vault actor): one pair, the item and the count chosen,
// in the direction asked. Before sending, the client takes the quantities off its own copies of both profiles
// (sub_7997F0, "outpost%d"); the response brings the other profile along (multiUpdate).
// - Every pair is checked before anything moves: the item is in the profile it leaves, the quantity is a positive
//   whole number, and the quantities asked for one item add up to no more than its stack.
// - A whole stack keeps its item id; part of one becomes a new item. What arrives tops up the stacks of the same
//   template with the same attributes (durability, level...) up to MaxStackSize first, as the world inventory gives
//   items (profiles/items.js), then makes new stacks. Storage has no overflow: an overflowed backpack item stored
//   leaves its inventory_overflow_date behind.
// - Both capacities hold (profiles/vault.js): storage's item count against StorageInventorySizeBonus, the backpack's
//   limited stacks against its limit and 512 stacks in all. A transfer that would take either past its limit, and
//   further than it already was, is refused whole.
// From 3.5 (CL-4000805; 3.6, 4.0, 4.1 and 4.2 the same) the command takes one list instead,
// {transferOperations: [{itemId, quantity, toStorage, newItemIdHint}]} (FItemTransferOperation): toStorage says the
// direction, and newItemIdHint names the item the part of a stack becomes. Both forms are read, so every build's
// request moves its items (#276: 3.5+ sent only transferOperations and got "No items to transfer").
// 🟡 Epic's service isn't in the client: the merging, the ids and the refusal (Core's error code) are Core's.
const invalid = (message) => {
  throw new McpError("errors.com.epicgames.validation.validation_failed", message);
};

const guidKey = (itemId) => String(itemId).replace(/-/g, "").toLowerCase();

function findItemId(profile, itemId) {
  if (typeof itemId !== "string" || !itemId) return undefined;
  if (profile.items[itemId]) return itemId;
  const wanted = guidKey(itemId);
  return Object.keys(profile.items).find((id) => guidKey(id) === wanted);
}

const stableJson = (value) => (value && typeof value === "object" && !Array.isArray(value)
  ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
  : JSON.stringify(value));

// The pairs of one direction, checked against the profile they leave: [[itemId, quantity]].
// A pair's newItemIdHint goes into hints, by the item it leaves.
function takings(profile, pairs, name, hints) {
  if (pairs === undefined || pairs === null) return [];
  if (!Array.isArray(pairs)) invalid(`${name} isn't a list`);
  const taking = new Map();
  for (const pair of pairs) {
    const itemId = findItemId(profile, pair?.itemId);
    if (!itemId) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `Item ${pair?.itemId} not found in ${profile.profileId}`);
    const quantity = pair.quantity;
    if (!Number.isInteger(quantity) || quantity <= 0) invalid(`Can't transfer ${quantity} of ${pair.itemId}`);
    const total = (taking.get(itemId) ?? 0) + quantity;
    if (total > profile.items[itemId].quantity) invalid(`Can't transfer ${total} of ${pair.itemId}, the stack holds ${profile.items[itemId].quantity}`);
    taking.set(itemId, total);
    if (typeof pair.newItemIdHint === "string" && pair.newItemIdHint && !hints.has(itemId)) hints.set(itemId, pair.newItemIdHint);
  }
  return [...taking];
}

// Puts quantity of the template with these attributes into the profile; a whole stack that moved keeps its id.
function deposit(tracker, { templateId, attributes }, quantity, keepId) {
  const info = getItem(templateId);
  const limit = info?.maxStackSize > 0 ? info.maxStackSize : Infinity;
  const key = `${templateId.toLowerCase()}|${stableJson(attributes)}`;
  let remaining = quantity;
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (remaining <= 0) break;
    if (`${item.templateId.toLowerCase()}|${stableJson(item.attributes ?? {})}` !== key || item.quantity >= limit) continue;
    const amount = Math.min(remaining, limit - item.quantity);
    tracker.setQuantity(itemId, item.quantity + amount);
    remaining -= amount;
  }
  let id = keepId && !tracker.profile.items[keepId] ? keepId : undefined;
  while (remaining > 0) {
    const amount = Math.min(remaining, limit);
    tracker.addItem(id ?? crypto.randomUUID(), { templateId, attributes: structuredClone(attributes), quantity: amount });
    id = undefined;
    remaining -= amount;
  }
}

function move(from, to, taking, hints) {
  const emptied = [];
  for (const [itemId, quantity] of taking) {
    const item = from.profile.items[itemId];
    const { inventory_overflow_date: _overflow, ...attributes } = item.attributes ?? {};
    const whole = quantity === item.quantity;
    if (whole) {
      from.removeItem(itemId);
      emptied.push(itemId);
    } else from.setQuantity(itemId, item.quantity - quantity);
    deposit(to, { templateId: item.templateId, attributes }, quantity, whole ? itemId : hints.get(itemId));
  }
  return emptied;
}

export function storageTransfer({ req, session, profileId }) {
  const [, kind, index] = /^(theater|outpost)(\d+)$/.exec(profileId) ?? [];
  if (!kind) throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", "StorageTransfer is a theater or outpost profile command");
  const theater = session.profile(`theater${index}`);
  const outpost = session.profile(`outpost${index}`);
  const body = req.body ?? {};
  let toStoragePairs = body.theaterToOutpostItems;
  let toBackpackPairs = body.outpostToTheaterItems;
  if (body.transferOperations !== undefined && body.transferOperations !== null) {
    if (!Array.isArray(body.transferOperations)) invalid("transferOperations isn't a list");
    toStoragePairs = [...(toStoragePairs ?? []), ...body.transferOperations.filter((operation) => operation?.toStorage === true)];
    toBackpackPairs = [...(toBackpackPairs ?? []), ...body.transferOperations.filter((operation) => operation?.toStorage !== true)];
  }
  const hints = new Map();
  const toStorage = takings(theater.profile, toStoragePairs, "theaterToOutpostItems", hints);
  const toBackpack = takings(outpost.profile, toBackpackPairs, "outpostToTheaterItems", hints);
  if (!toStorage.length && !toBackpack.length) invalid("No items to transfer");

  const account = session.profile("profile0").profile;
  const storageBefore = storageState(outpost.profile, account);
  const backpackBefore = backpackState(theater.profile, account);

  // What leaves each profile goes first, so a swap can use the room it makes.
  const emptied = move(theater, outpost, toStorage, hints);
  move(outpost, theater, toBackpack, hints);
  unslot(theater, emptied);

  const storage = storageState(outpost.profile, account);
  if (storage.count > storage.limit && storage.count > storageBefore.count) {
    throw new McpError("errors.com.epicgames.fortnite.storage_full", `Storage holds ${storage.limit} items, the transfer would make ${storage.count}`);
  }
  const backpack = backpackState(theater.profile, account);
  if ((backpack.count > backpack.limit && backpack.count > backpackBefore.count) || (backpack.stacks > worldStackCap && backpack.stacks > backpackBefore.stacks)) {
    throw new McpError("errors.com.epicgames.fortnite.inventory_full", `The backpack holds ${backpack.limit}, the transfer would make ${backpack.count}`);
  }
}
