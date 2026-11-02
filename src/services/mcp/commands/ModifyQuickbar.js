import { McpError } from "../../../errors.js";

// ModifyQuickbar {primaryQuickbarChoices, secondaryQuickbarChoice}, from 1.11 (UFortMcpProfileWorld::ModifyQuickbar):
// the Save the World backpack's equip and unequip send the item id in each of the primary quickbar's weapon slots 1-3
// and in the secondary's first trap slot 4, "" for an empty slot. The rest of DefaultGameData's QuickBarDefinitions
// (the harvest tool, hero abilities, gadgets, building pieces and the other traps) are the gameserver's to fill.
// theater0's player_loadout keeps them as FQuickBar records; the front end reads that stat straight into
// CachedPlayerLoadout, finds a slot's item only while its bEnabled is set (FQuickBar::IsValidSlot) and parses each
// item as FGuid text, which FGuid::ImportTextItem reads as 32 hex digits.
const slotCounts = { primaryQuickBarRecord: 9, secondaryQuickBarRecord: 7 };
const weaponSlots = [1, 2, 3];
const trapSlot = 4;

function findItemId(tracker, itemId) {
  if (tracker.profile.items[itemId]) return itemId;
  const wanted = itemId.toLowerCase();
  return Object.keys(tracker.profile.items).find((id) => id.toLowerCase() === wanted);
}

// The item id as the record's FGuid ("" is an empty slot).
function choice(tracker, itemId) {
  if (itemId === "") return null;
  const found = typeof itemId === "string" && findItemId(tracker, itemId);
  const digits = found && found.replace(/-/g, "");
  if (!found || !/^[0-9a-f]{32}$/i.test(digits)) {
    throw new McpError("errors.com.epicgames.fortnite.item_not_found", `Item ${itemId} not found in the backpack`);
  }
  return digits.toUpperCase();
}

function record(existing, count) {
  const slots = Array.isArray(existing?.slots) ? existing.slots : [];
  return {
    currentFocusedSlot: existing?.currentFocusedSlot ?? 0,
    previousFocusedSlot: existing?.previousFocusedSlot ?? 0,
    secondaryFocusedSlot: existing?.secondaryFocusedSlot ?? 0,
    slots: Array.from({ length: Math.max(count, slots.length) }, (_, index) => ({
      items: Array.isArray(slots[index]?.items) ? slots[index].items : [],
      bEnabled: true
    }))
  };
}

export function modifyQuickbar({ req, tracker, profileId }) {
  if (!profileId.startsWith("theater")) throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", "ModifyQuickbar is a theater profile command");
  const primary = Array.isArray(req.body?.primaryQuickbarChoices) ? req.body.primaryQuickbarChoices : [];
  if (primary.length > weaponSlots.length) throw new McpError("errors.com.epicgames.validation.validation_failed", `${primary.length} primary quickbar choices for ${weaponSlots.length} slots`);
  const primaryItems = primary.map((itemId) => choice(tracker, itemId));
  const trapItem = choice(tracker, req.body?.secondaryQuickbarChoice ?? "");
  const chosen = [...primaryItems, trapItem].filter(Boolean);
  if (new Set(chosen).size !== chosen.length) throw new McpError("errors.com.epicgames.validation.validation_failed", "An item can only be in one quickbar slot");

  const loadout = tracker.profile.stats.attributes.player_loadout ?? {};
  const primaryRecord = record(loadout.primaryQuickBarRecord, slotCounts.primaryQuickBarRecord);
  const secondaryRecord = record(loadout.secondaryQuickBarRecord, slotCounts.secondaryQuickBarRecord);
  weaponSlots.forEach((slot, index) => {
    if (index < primaryItems.length) primaryRecord.slots[slot].items = primaryItems[index] ? [primaryItems[index]] : [];
  });
  secondaryRecord.slots[trapSlot].items = trapItem ? [trapItem] : [];

  const next = { ...loadout, primaryQuickBarRecord: primaryRecord, secondaryQuickBarRecord: secondaryRecord };
  if (JSON.stringify(next) !== JSON.stringify(loadout)) tracker.setStat("player_loadout", next);
}
