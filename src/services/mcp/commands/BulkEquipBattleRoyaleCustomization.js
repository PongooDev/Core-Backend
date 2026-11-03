import { McpError } from "../../../errors.js";
import { equipCustomization } from "../../../profiles/athena.js";

// 3.0's (CL-3901517) locker equips several slots at once (Core-Backend #204): BulkEquipBattleRoyaleCustomization
// {loadoutData: [FFortAthenaLoadoutData {slotName, itemToSlot, indexWithinSlot}]}, each as EquipBattleRoyaleCustomization
// equips one (profiles/athena.js). #204's client sent it as the player equipped an outfit they had just bought.
export function bulkEquipBattleRoyaleCustomization({ req, session }) {
  const loadout = req.body?.loadoutData;
  if (!Array.isArray(loadout)) throw new McpError("errors.com.epicgames.fortnite.invalid_parameter", "loadoutData isn't a list");
  for (const entry of loadout) equipCustomization(session, entry?.slotName, entry?.itemToSlot, entry?.indexWithinSlot);
}
