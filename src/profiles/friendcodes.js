import { McpError } from "../errors.js";
import { getItem } from "../gamedata/items.js";
import { findItem, grantItem } from "./items.js";

// Founder's friend codes (Core-Backend #35). The Super Deluxe, Limited and Ultimate founders quests give
// ConsumableAccountItem:FoundersFriendCode ("Founder's Friend Code", "Gift a Standard Edition to a friend!"), whose
// definition is bIsAutomaticallyConsumed. That flag is only exported to the MCP service as the template's
// static_bIsAutomaticallyConsumed (sub_5D2E20); nothing in the client uses one. What the client issues codes from is a
// code token: GetNumFriendCodesToIssue and IssueFriendCode (UFortMcpContext, sub_64B230 / sub_6505E0) count profile0's
// FortCodeTokenItems whose FortCodeTokenItemDefinition allows the PC (AllowedPlatforms, default PC and PS4).
// CodeToken:FounderFriendInvite is one ("Founder's Pack Code", "Free Founder's Pack Friend Code"; _XBOX is Xbox only).
// 🟡 So Epic's service consumed the friend code on its grant into a FounderFriendInvite token, which Core now does.
const automaticallyConsumed = {
  "consumableaccountitem:foundersfriendcode": "CodeToken:founderfriendinvite"
};

export const consumedInto = (templateId) => automaticallyConsumed[String(templateId).toLowerCase()] ?? null;

const heldConsumables = (profile) => Object.entries(profile.items).filter(([, item]) => consumedInto(item.templateId));

// Friend codes granted before Core consumed them (or bought with an edition, #32) are consumed when the profile loads.
export const friendCodesNeedSetUp = (profile) => heldConsumables(profile).length > 0;

export function setUpFriendCodes(session) {
  const tracker = session.profile("profile0");
  for (const [itemId, item] of heldConsumables(tracker.profile)) consume(session, itemId, item.quantity);
}

// Turns `quantity` of the consumable itemId into its code tokens.
export function consume(session, itemId, quantity = 1) {
  const tracker = session.profile("profile0");
  const item = tracker.profile.items[itemId];
  const left = item.quantity - quantity;
  const into = consumedInto(item.templateId);
  if (left > 0) tracker.setQuantity(itemId, left);
  else tracker.removeItem(itemId);
  return grantItem(session, into, quantity);
}

// IssueFriendCode {codeTokenType} (UFortMcpProfileAccount). The client sends one for each code token it holds,
// codeTokenType being the token item's templateId, whenever the main menu opens (TopBar.OpenMainMenu →
// MainMenu.ProcessPartyBar → FullPartyBar.ProcessFriendCodes → UFortMcpContext::IssueFriendCode). The reply's primary
// notification is read as FFriendCodeIssuedNotification {Code, CodeType} (callback sub_64CE80, struct sub_106EBC0) and
// added to UFortMcpContext.CachedFriendCodes; 🟡 the type, never compared, is Core's (the exe holds "FriendCodeIssued").
// The token is used up and the code kept with the account (friendcodes/store.js).
export function issueFriendCode(session, friendCodes, codeTokenType) {
  const tracker = session.profile("profile0");
  const itemId = typeof codeTokenType === "string" && codeTokenType ? findItem(tracker.profile, codeTokenType) : null;
  const item = itemId && tracker.profile.items[itemId];
  if (!item || getItem(item.templateId)?.class !== "FortCodeTokenItemDefinition") {
    throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No code token ${codeTokenType}`);
  }
  if (item.quantity > 1) tracker.setQuantity(itemId, item.quantity - 1);
  else tracker.removeItem(itemId);
  const { code, codeType } = friendCodes.issue(session.accountId, item.templateId);
  return { type: "friendCodeIssued", primary: true, code, codeType };
}
