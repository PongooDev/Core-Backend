import { equipCustomization } from "../../../profiles/athena.js";

// The Battle Royale locker (UFortMcpProfileAthena::EquipBattleRoyaleCustomization {slotName, itemToSlot,
// indexWithinSlot}): an athena item id for a slot, or "" for the slot's default; indexWithinSlot picks one of 1.11's six
// emote slots (profiles/athena.js); 4.0's variantUpdates, the item's styles (profiles/variants.js).
export function equipBattleRoyaleCustomization({ req, session }) {
  equipCustomization(session, req.body?.slotName, req.body?.itemToSlot, req.body?.indexWithinSlot, req.body?.variantUpdates);
}
