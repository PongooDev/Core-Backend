import { equipCustomization } from "../../../profiles/athena.js";

// The Battle Royale locker (UFortMcpProfileAthena::EquipBattleRoyaleCustomization {slotName, itemToSlot}): an athena
// item id for a slot, or "" for the slot's default (profiles/athena.js).
export function equipBattleRoyaleCustomization({ req, session }) {
  equipCustomization(session, req.body?.slotName, req.body?.itemToSlot);
}
