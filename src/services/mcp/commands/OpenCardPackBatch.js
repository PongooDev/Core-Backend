import { lootEntry } from "../../../profiles/items.js";
import { McpError } from "../../../errors.js";
import { log } from "../../../log.js";
import { openPack } from "./OpenCardPack.js";

// The after-mission rewards screen (UFortMcpContext::OpenMissionRewards) opens every "Mission" pack at once:
// {cardPackItemIds}. A pack that can't be opened (an unknown id, or nothing in it could be given) is skipped and kept.
// When none opens, the batch is refused rather than answered with no items (#40).
export function openCardPackBatch({ req, session, notifications }) {
  const items = [];
  let refused;
  for (const packId of req.body?.cardPackItemIds ?? []) {
    try {
      items.push(...openPack(session, String(packId), 0).granted.map(lootEntry));
    } catch (error) {
      if (!(error instanceof McpError)) throw error;
      log("MCP", `OpenCardPackBatch: ${packId} not opened: ${error.message}`);
      refused ??= error;
    }
  }
  if (!items.length) throw refused ?? new McpError("errors.com.epicgames.fortnite.card_pack_empty", "No card pack to open");
  notifications.push({ type: "cardPackResult", primary: true, lootGranted: { tierGroupName: "", items }, displayLevel: 0 });
}
