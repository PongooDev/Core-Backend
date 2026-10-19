import { lootEntry } from "../../../profiles/items.js";
import { McpError } from "../../../errors.js";
import { openPack } from "./OpenCardPack.js";

// The after-mission rewards screen opens every "Mission" pack at once: {cardPackItemIds}. Unknown ids are skipped.
export function openCardPackBatch({ req, session, notifications }) {
  const items = [];
  for (const packId of req.body?.cardPackItemIds ?? []) {
    try {
      items.push(...openPack(session, String(packId), 0).granted.map(lootEntry));
    } catch (error) {
      if (!(error instanceof McpError)) throw error;
    }
  }
  notifications.push({ type: "cardPackResult", primary: true, lootGranted: { tierGroupName: "", items }, displayLevel: 0 });
}
