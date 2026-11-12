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
// screen once that succeeds (OnGiftBoxRemoved bSuccess). From 3.5 the boxes are common_core's (FortGiftBoxItem's
// static_profile_type, 3.5.1 0xCE52F0), which Core serves from profile0 (profiles/common.js).
// The box's template (UFortGiftBoxItemDefinition) names the screen's header: GiftBox:GB_BattlePass's is
// ItemReceivedBattlePassHeader, "{Number} items have been unlocked!" over the box's items. 3.0's FortGiftBoxItem keeps
// {lootList: [{itemType, itemGuid, itemProfile, quantity}], fromAccountId, giftedOn, params} (sub_C547F0), and the screen
// shows lootList's items one card each. ItemReceived_Base's "Check if Battlepass upgrade" plays the "Battle Pass
// UPGRADED!" animation when lootList holds CID_080_Athena_Commando_M_Space, the Mission Specialist the pass's first tier
// gives, so a box with the pass's rewards is the purchase screen of Epic's Season 3.
// 2.5 (CL-3889387) and earlier have no such screen: 2.5's GB_BattlePass names no header and its paks have no
// ItemReceived widgets, 1.11 to 2.4.2 no gift boxes at all, so their purchases give none.
//
// The Battle Pass purchase's own box (Core-Backend #326): from Season 5 the purchase animation plays only for a
// GiftBox:GB_BattlePassPurchased. Its definition (5.21's and 6.00's paks) names a GiftBoxPreMessageWidget,
// BP_BattlePassUnlockAnim (a UFortItemReceivedPrePrompt whose Intro plays BattlePass_Buy_Cue), and once RemoveGiftBox
// succeeds UFortUIStateWidget_Frontend::HandleGiftBoxRemoved (6.00 CL-4395664 0x2FFB8A0, 5.21 0x2F12EE0) creates that
// widget and queues it ahead of the box; when its Intro ends it pushes ItemReceived_Base with the box, the list of what the
// purchase gave. GB_BattlePass names no such widget, so a purchase in one is the list alone, and ItemReceived_Base's own
// "Check if Battlepass upgrade" can't stand in: 5.21's and 6.00's still look for Season 4's tier 1,
// CID_115_Athena_Commando_M_CarbideBlue, which no later pass gives. So from 5.0 (CL-4204761) the pass, or the pass with 25
// tiers, comes in a GB_BattlePassPurchased; 3.0 to 4.5 keep GB_BattlePass, whose ItemReceived_Base animation their tier 1
// (the Mission Specialist, Carbide) plays. Tiers bought on their own stay a GB_BattlePass, the screen of the tiers reached.
const firstGiftBoxBuild = 3901517;
const firstPurchasedGiftBoxBuild = 4204761;
export const battlePassGiftBox = "GiftBox:gb_battlepass";
export const battlePassPurchasedGiftBox = "GiftBox:gb_battlepasspurchased";
export const giftBoxProfile = "profile0";
const typeOf = (templateId) => String(templateId).split(":")[0].toLowerCase();

export const showsGiftBoxes = () => Number(currentBuild()) >= firstGiftBoxBuild;

// The box a purchase of the Battle Pass itself (not tiers alone) comes in, on the request's build.
export const battlePassPurchaseGiftBox = () => (Number(currentBuild()) >= firstPurchasedGiftBoxBuild ? battlePassPurchasedGiftBox : battlePassGiftBox);

// The boxes of a season's Battle Pass, which its admin reset takes back unopened (battlepass/reset.js).
export const isBattlePassGiftBox = (templateId) => [battlePassGiftBox, battlePassPurchasedGiftBox]
  .some((id) => id.toLowerCase() === String(templateId).toLowerCase());

// A gift box of loot (grants: {profileId, itemId, templateId, quantity}) in profile0, on a build that shows one. Returns
// its item id, or null.
//
// One screen for the tiers reached between two visits to the lobby (Core-Backend #268): a match's Battle Stars and season
// XP come in several reports and challenge completions, each settling the tiers it reached (profiles/seasons.js), and
// each made a box of its own, so two tiers in one match showed two screens, one after the other. A GB_BattlePass box the
// client hasn't taken yet (RemoveGiftBox takes it before its screen shows) takes the new loot instead, an item already in
// it gaining the quantity, so the lobby shows every tier reached since in one screen, as Epic's one box of a batch of
// tier-ups did. Other boxes (GB_BattlePassPromise) stay one each.
// params: the box's own (FortGiftBoxItem's params, strings by name), which a header reads with
// UFortGiftBoxItem::RetrieveItemDefintionFromParam (6.02 0xF95F50: the named param as a template id, to its item
// definition): GB_ChallengeComplete's HeaderTemplateId, the challenge bundle its reward is for (profiles/challenges.js).
export function giveGiftBox(session, templateId, grants, params = {}) {
  if (!showsGiftBoxes() || !grants.length) return null;
  const tracker = session.profile(giftBoxProfile);
  const pending = templateId.toLowerCase() === battlePassGiftBox.toLowerCase()
    ? heldGiftBoxes(tracker.profile).find(([, item]) => item.templateId.toLowerCase() === battlePassGiftBox.toLowerCase()) : undefined;
  if (pending) {
    const [pendingId, box] = pending;
    const lootList = (box.attributes.lootList ?? []).map((loot) => ({ ...loot }));
    for (const loot of grants.map(lootEntry)) {
      const same = lootList.find((held) => held.itemGuid === loot.itemGuid && held.itemType === loot.itemType && held.itemProfile === loot.itemProfile);
      if (same) same.quantity = (same.quantity ?? 0) + (loot.quantity ?? 0);
      else lootList.push(loot);
    }
    tracker.setItemAttribute(pendingId, "lootList", lootList);
    log("Battle Royale", `${session.accountId}'s gift box ${templateId} takes ${grants.length} more items`);
    return pendingId;
  }
  const itemId = crypto.randomUUID();
  session.profile(giftBoxProfile).addItem(itemId, {
    templateId,
    attributes: { fromAccountId: "", lootList: grants.map(lootEntry), params: { ...params }, giftedOn: new Date().toISOString() },
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
