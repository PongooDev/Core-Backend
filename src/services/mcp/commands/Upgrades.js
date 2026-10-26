import { lootEntry } from "../../../profiles/items.js";
import { convertItem, recycleItem, upgradeItem } from "../../../profiles/upgrades.js";

export function upgradeItemCommand({ req, session }) {
  upgradeItem(session, req.body?.targetItemId);
}

// The client's evolve callback (sub_64CB50 in Cert) reads the primary notification as
// FFortConversionResultNotification {itemsGranted: [FMcpLootEntry]}, finds each item by itemGuid and hands them to
// OnConversionComplete. The item screen (ItemInspectScreen_C.HandleEvolutionComplete) then shows the first one and
// leaves the evolve panel; with none it stays on the evolve button of an item that was already evolved (#43). The type
// string is never compared, and Epic's isn't in the client.
export const conversionResult = (evolved) =>
  ({ type: "conversionResult", primary: true, itemsGranted: [lootEntry(evolved)] });

export function convertItemCommand({ req, session, notifications }) {
  notifications.push(conversionResult(convertItem(session, req.body?.targetItemId, req.body?.conversionIndex ?? 0)));
}

export function recycleItemCommand({ req, session }) {
  recycleItem(session, req.body?.targetItemId);
}

export function recycleItemBatchCommand({ req, session }) {
  for (const itemId of Array.isArray(req.body?.targetItemIds) ? req.body.targetItemIds : []) recycleItem(session, itemId);
}
