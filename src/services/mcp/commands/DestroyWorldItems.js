import { McpError } from "../../../errors.js";
import { unslot } from "./DisassembleWorldItems.js";

// DestroyWorldItems {itemIds: [string]}, from 1.10 (UFortMcpProfileWorld::DestroyWorldItems, TArray<FString> ItemIds;
// the same through 2.5): the Save the World backpack's Destroy throws world items away whole, with nothing given back.
// The front end sends it on theater0 (UFortInventoryContext::DestroyWorldItem, 2.2's sub_208B260: a UFortWorldItem,
// its owning player controller's MyPlayerInfo->WorldProfile, the item's id), one item at a time, after taking the
// item off its own copy of the profile (2.2's sub_777030). UFortMcpProfileWorld is outpost0's class too, so the
// command is taken on either world profile.
// - Every id is checked before anything goes: the item is in the profile (any case, with or without dashes).
// - The whole stack goes, whatever its quantity; an item that leaves the backpack leaves its quickbar slot.
// 🟡 Epic's service isn't in the client: the refusal (Core's error code) is Core's.
const guidKey = (itemId) => String(itemId).replace(/-/g, "").toLowerCase();

function findItemId(profile, itemId) {
  if (typeof itemId !== "string" || !itemId) return undefined;
  if (profile.items[itemId]) return itemId;
  const wanted = guidKey(itemId);
  return Object.keys(profile.items).find((id) => guidKey(id) === wanted);
}

export function destroyWorldItems({ req, tracker, profileId }) {
  if (!/^(theater|outpost)\d+$/.test(profileId)) {
    throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", "DestroyWorldItems is a theater or outpost profile command");
  }
  const itemIds = req.body?.itemIds;
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw new McpError("errors.com.epicgames.validation.validation_failed", "No items to destroy");

  const destroying = new Set();
  for (const wanted of itemIds) {
    const itemId = findItemId(tracker.profile, wanted);
    if (!itemId) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `Item ${wanted} not found in ${profileId}`);
    destroying.add(itemId);
  }
  for (const itemId of destroying) tracker.removeItem(itemId);
  if (profileId.startsWith("theater")) unslot(tracker, [...destroying]);
}
