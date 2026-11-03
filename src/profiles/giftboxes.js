import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { log } from "../log.js";
import { lootEntry } from "./items.js";

// Gift boxes (UFortGiftBoxItem, Core-Backend #202): 3.0's (CL-3901517) frontend shows a gift box the athena profile gets
// as its ItemReceived screen (ItemReceived_Base), and the client removes it with RemoveGiftBox once the player closes it.
// The box's template (UFortGiftBoxItemDefinition) names the screen's header: GiftBox:GB_BattlePass's is
// ItemReceivedBattlePassHeader, "{Number} items have been unlocked!" over the box's items. 3.0's FortGiftBoxItem keeps
// {lootList: [{itemType, itemGuid, itemProfile, quantity}], fromAccountId, giftedOn, params} (sub_C547F0), and the screen
// shows lootList's items one card each. ItemReceived_Base's "Check if Battlepass upgrade" plays the "Battle Pass
// UPGRADED!" animation when lootList holds CID_080_Athena_Commando_M_Space, the Mission Specialist the pass's first tier
// gives, so a box with the pass's rewards is the purchase screen of Epic's Season 3.
// 2.5 (CL-3889387) and earlier have no such screen: 2.5's GB_BattlePass names no header and its paks have no
// ItemReceived widgets, 1.11 to 2.4.2 no gift boxes at all, so their purchases give none.
const firstGiftBoxBuild = 3901517;
export const battlePassGiftBox = "GiftBox:gb_battlepass";
const typeOf = (templateId) => String(templateId).split(":")[0].toLowerCase();

export const showsGiftBoxes = () => Number(currentBuild()) >= firstGiftBoxBuild;

// A gift box of loot (grants: {profileId, itemId, templateId, quantity}) in the athena profile, on a build that shows
// one. Returns its item id, or null.
export function giveGiftBox(session, templateId, grants) {
  if (!showsGiftBoxes() || !grants.length) return null;
  const itemId = crypto.randomUUID();
  session.profile("athena").addItem(itemId, {
    templateId,
    attributes: { fromAccountId: "", lootList: grants.map(lootEntry), params: {}, giftedOn: new Date().toISOString() },
    quantity: 1
  });
  log("Battle Royale", `${session.accountId} got the gift box ${templateId} (${grants.length} items)`);
  return itemId;
}

// The gift boxes a profile holds, as [itemId, item].
export const heldGiftBoxes = (profile) => Object.entries(profile.items).filter(([, item]) => typeOf(item.templateId) === "giftbox");
