import { rollContents } from "../../../cardpacks/contents.js";
import { McpError } from "../../../errors.js";
import { getCardPack } from "../../../gamedata/items.js";
import { lootEntry } from "../../../profiles/items.js";
import { grant, itemEvent, statEvent } from "../../../profiles/progress.js";

// Opens one pack: a choice pack gives the option picked (selectionIdx), any other pack rolls its contents. Granted
// packs keep the opened pack's source. Returns what was granted.
export function openPack(session, packId, selectionIdx) {
  const tracker = session.profile("profile0");
  const pack = tracker.profile.items[packId];
  const info = pack && pack.templateId.toLowerCase().startsWith("cardpack:") ? getCardPack(pack.templateId) : undefined;
  if (!info) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No card pack ${packId}`);

  let contents;
  if (info.choice) {
    const option = (pack.attributes.options ?? [])[selectionIdx];
    if (!Number.isInteger(selectionIdx) || !option) throw new McpError("errors.com.epicgames.fortnite.invalid_parameter", `No option ${selectionIdx}`);
    contents = [{ templateId: option.itemType, quantity: option.quantity ?? 1 }];
  } else {
    contents = rollContents(pack.templateId);
  }
  if (!contents.length) throw new McpError("errors.com.epicgames.fortnite.card_pack_empty", `Core has no contents for ${pack.templateId} yet`);

  if (pack.quantity > 1) tracker.setQuantity(packId, pack.quantity - 1);
  else tracker.removeItem(packId);
  const packSource = pack.attributes.pack_source ?? "Store";
  const granted = contents.flatMap(({ templateId, quantity }) => grant(session, templateId, quantity, { packSource }));
  itemEvent(session, ["OpenCardPack"], pack.templateId, 1);
  statEvent(session, "OpenCardPack", pack.templateId, 1);
  return { info, granted };
}

// The llama store: {cardPackItemId, selectionIdx}. The client finds each card's item by itemGuid in profile0 and plays
// the pinata by displayLevel (0 normal, 1 silver, 2 gold).
export function openCardPack({ req, session, notifications }) {
  const { info, granted } = openPack(session, String(req.body?.cardPackItemId ?? ""), req.body?.selectionIdx ?? 0);
  notifications.push({
    type: "cardPackResult",
    primary: true,
    lootGranted: { tierGroupName: info.lootTierGroup, items: granted.map(lootEntry) },
    displayLevel: info.displayRarityLevel
  });
}
