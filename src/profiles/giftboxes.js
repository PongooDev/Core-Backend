import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { log } from "../log.js";
import { lootEntry } from "./items.js";

// Gift boxes (UFortGiftBoxItem, Core-Backend #202): 3.0's (CL-3901517) frontend shows a gift box profile0 gets as its
// ItemReceived screen (ItemReceived_Base). profile0, not athena (Core-Backend #212): on each inventory update the
// frontend (UI/Foundation/StateLayouts/FrontEnd, OnGiftNotifyReceived) asks UFortMcpContext::GetNextGiftBox
// (sub_CDD120), which looks only among the items of type GiftBox (sub_D2F340) of the account profile,
// UFortMcpProfileAccount (the player controller's +0x2280), the class that also holds the RemoveGiftBox command; a box in
// athena is never seen. The frontend then sends RemoveGiftBox {giftBoxItemId} for the box, to profile0, and shows the
// screen once that succeeds (OnGiftBoxRemoved bSuccess).
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
export const giftBoxProfile = "profile0";
const typeOf = (templateId) => String(templateId).split(":")[0].toLowerCase();

export const showsGiftBoxes = () => Number(currentBuild()) >= firstGiftBoxBuild;

// A gift box of loot (grants: {profileId, itemId, templateId, quantity}) in profile0, on a build that shows one. Returns
// its item id, or null.
export function giveGiftBox(session, templateId, grants) {
  if (!showsGiftBoxes() || !grants.length) return null;
  const itemId = crypto.randomUUID();
  session.profile(giftBoxProfile).addItem(itemId, {
    templateId,
    attributes: { fromAccountId: "", lootList: grants.map(lootEntry), params: {}, giftedOn: new Date().toISOString() },
    quantity: 1
  });
  log("Battle Royale", `${session.accountId} got the gift box ${templateId} (${grants.length} items)`);
  return itemId;
}

// The gift boxes a profile holds, as [itemId, item].
export const heldGiftBoxes = (profile) => Object.entries(profile.items).filter(([, item]) => typeOf(item.templateId) === "giftbox");

// The boxes 16dbcd3 put in the athena profile, where 3.0 never shows them (Core-Backend #212), move to profile0 under
// their item ids, so the screen of a purchase made then still shows. An account without profile0 keeps them for now.
export function moveAthenaGiftBoxes(session) {
  if (!session.hasProfile(giftBoxProfile)) return;
  const athena = session.profile("athena");
  const account = session.profile(giftBoxProfile);
  for (const [itemId, item] of heldGiftBoxes(athena.profile)) {
    athena.removeItem(itemId);
    if (!account.profile.items[itemId]) account.addItem(itemId, item);
  }
}
