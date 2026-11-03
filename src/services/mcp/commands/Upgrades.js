import { lootEntry } from "../../../profiles/items.js";
import { convertItem, recycleItem, upgradeItem, upgradeItemRarity } from "../../../profiles/upgrades.js";

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

// The client's rarity upgrade callback (2.5's sub_CC5C60, from UFortMcpContext::UpgradeItemRarity) reads the primary
// notification as FFortUpgradeItemRarityNotification {itemsGranted: [FMcpLootEntry]}, finds each item by itemGuid and
// broadcasts OnRarityUpgraded with them, as the evolve callback does. The type string is never compared.
export function upgradeItemRarityCommand({ req, session, notifications }) {
  const upgraded = upgradeItemRarity(session, req.body?.targetItemId);
  notifications.push({ type: "upgradeItemRarity", primary: true, itemsGranted: [lootEntry(upgraded)] });
}

export function recycleItemCommand({ req, session }) {
  recycleItem(session, req.body?.targetItemId);
}

export function recycleItemBatchCommand({ req, session }) {
  for (const itemId of Array.isArray(req.body?.targetItemIds) ? req.body.targetItemIds : []) recycleItem(session, itemId);
}
