import { rollContents, upgradedPack } from "../../../cardpacks/contents.js";
import { McpError } from "../../../errors.js";
import { getCardPack } from "../../../gamedata/items.js";
import { heldOwnedOnce, lootEntry } from "../../../profiles/items.js";
import { grant, itemEvent, statEvent } from "../../../profiles/progress.js";
import { prerolledContents } from "../../../store/preroll.js";

// Opens one pack: a choice pack gives the option picked (selectionIdx), any other pack rolls its contents (in the
// store, those of the silver or gold llama it may turn into). Granted packs keep the opened pack's source. Returns the
// pack definition that was rolled and what was granted.
export function openPack(session, packId, selectionIdx, { upgrade = false } = {}) {
  const tracker = session.profile("profile0");
  const pack = tracker.profile.items[packId];
  const info = pack && pack.templateId.toLowerCase().startsWith("cardpack:") ? getCardPack(pack.templateId) : undefined;
  if (!info) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No card pack ${packId}`);

  let contents;
  let rolled = info;
  if (info.choice) {
    const option = (pack.attributes.options ?? [])[selectionIdx];
    if (!Number.isInteger(selectionIdx) || !option) throw new McpError("errors.com.epicgames.fortnite.invalid_parameter", `No option ${selectionIdx}`);
    contents = [{ templateId: option.itemType, quantity: option.quantity ?? 1 }];
  } else if (prerolledContents(pack)) {
    // An X-Ray llama holds what its tile showed (store/preroll.js).
    ({ info: rolled, contents } = prerolledContents(pack));
  } else {
    if (upgrade) rolled = upgradedPack(pack.templateId);
    contents = rollContents(rolled.templateId);
  }
  const granted = grantPackContents(session, pack.templateId, contents, pack.attributes.pack_source ?? "Store");
  if (pack.quantity > 1) tracker.setQuantity(packId, pack.quantity - 1);
  else tracker.removeItem(packId);
  return { info: rolled, granted };
}

// Gives what a pack of templateId held and counts it as opened; the granted entries. Also used for an X-Ray llama, whose
// roll is given as it is bought (PurchaseCatalogEntry).
export function grantPackContents(session, templateId, contents, packSource = "Store") {
  if (!contents.length) throw new McpError("errors.com.epicgames.fortnite.card_pack_empty", `Core has no contents for ${templateId} yet`);
  // The client shows an opened pack from what it reports, and one that reports nothing is an error there (#40). An
  // owned-once item the account already has (a second Founders Banners pack's banners) is reported as the one it holds.
  // A pack that gives nothing at all (its items unknown to this build) is refused before it is used up, and a grant
  // that gives nothing adds nothing, so a batch that goes on without it keeps the pack as it was.
  const granted = contents.flatMap(({ templateId: itemType, quantity }) => {
    const entries = grant(session, itemType, quantity, { packSource });
    const held = entries.length ? undefined : heldOwnedOnce(session, itemType);
    return held ? [held] : entries;
  });
  if (!granted.length) throw new McpError("errors.com.epicgames.fortnite.card_pack_empty", `Nothing in ${templateId} could be given`);
  itemEvent(session, ["OpenCardPack"], templateId, 1);
  statEvent(session, "OpenCardPack", templateId, 1);
  return granted;
}

// The llama store: {cardPackItemId, selectionIdx}. The client finds each card's item by itemGuid in profile0 and plays
// the pinata by displayLevel (0 normal, 1 silver, 2 gold).
export function openCardPack({ req, session, notifications }) {
  const { info, granted } = openPack(session, String(req.body?.cardPackItemId ?? ""), req.body?.selectionIdx ?? 0, { upgrade: true });
  notifications.push({
    type: "cardPackResult",
    primary: true,
    lootGranted: { tierGroupName: info.lootTierGroup, items: granted.map(lootEntry) },
    displayLevel: info.displayRarityLevel
  });
}
