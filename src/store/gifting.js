import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { McpError } from "../errors.js";
import { log } from "../log.js";
import { grantCosmetic, ownsCosmetic } from "../profiles/athena.js";
import { lootEntry, spendMtx } from "../profiles/items.js";
import { giftBoxProfile } from "../profiles/giftboxes.js";

// Item shop gifting, Epic's of 6.31 (CL-4573279; 830f4e5's sweep of 6.31's requests found the client's GiftCatalogEntry
// unanswered).
//
// When: Epic opened gifting to players with the 6.31 update, on 27 November 2018, for a week ("Gifting is coming to
// Battle Royale", fortnite.com news): an item in the shop could be bought for a friend of 48 hours or more, three gifts in
// 24 hours, not on iOS. The 6.31 client has every piece already, off as it ships: UFortRuntimeOptions' constructor
// (0x14783B0) sets bDisableGifting (+0x13D) and bCanGiftYourself (+0x141), GiftLimitAmount (+0x144) 3 and
// DaysOfFriendshipBeforeCanGift (+0x148) 2, and Epic's hotfix (DefaultRuntimeOptions.ini) turned it on. 5.0 to 6.30 have
// the same client code (UFortMcpContext::PurchaseOfferAsGift, the gifting screen) but no player ever had it there, so
// only 6.31 and later are offered it.
//
// The client (6.31):
// - An offer is giftable when its catalog entry's giftInfo.bIsEnabled (FCatalogGiftInfo {bIsEnabled,
//   forcedGiftBoxTemplateId, purchaseRequirements}, FCatalogOffer +0x1F8) is set: UFortMcpContext::CanGiftOffer
//   (0x1163EE0) answers CannotGiftItem without it, AccountNotEligible without common_core's allowed_to_send_gifts,
//   MFANotEnabled without its mfa_enabled (Core's accounts always have it: profiles/defaults.js), then compares the
//   receivers' count times the price with the V-Bucks held (0x1164270).
// - The gift limit: the screen's "{0} daily gifts remaining" counts common_core's gift_history.gifts whose date is in the
//   last 24 hours against GiftLimitAmount (0x11B1C00, FGiftHistory).
// - The request: GiftCatalogEntry (0x984F00) with FCatalogPurchaseInfoGift {offerId, currency, currencySubType,
//   expectedTotalPrice, gameContext, receiverAccountIds, giftWrapTemplateId, personalMessage}.
// - The answer (OnGiftComplete, 0x982BC0): a profile update is success, "All gifts were delivered successfully."
//   errors.com.epicgames.modules.gamesubcatalog.gift_recipient_not_eligible reads messageVars[0], the receivers turned
//   down, and messageVars[1], one error code each (split at spaces, commas and brackets, 0x983970); the screen
//   (0x300C890) words each: gift_recipient_is_not_eligible_friend (errors.com.epicgames.fortnite.) "has not been your
//   friend for long enough", receiver_will_not_accept_gifts (errors.com.epicgames.modules.gamesubcatalog.) "has opted-out",
//   purchase_not_allowed (the same module) "already owns this item", gift_recipient_has_reached_limit and
//   gift_recipient_on_different_platform (errors.com.epicgames.fortnite.); any other refusal is "An unexpected error
//   occurred ... you were not charged."
// - The receiver: the sender's own client tells each receiver over XMPP (com.epicgames.gift.received, 0x4FB280, unless
//   bDisableGiftXMPPMessageSend), and the receiver's frontend (HandleGiftXmppReceived) refreshes common_core, where the
//   gift box is (FortGiftBoxItem's profile, profiles/giftboxes.js). Core's XMPP passes such messages on, and a receiver
//   subscribed to its STOMP profile topic hears of the box from this backend too (services/mcp/profile.js). The box is
//   FGiftBoxInfo {giftedOn, fromAccountId, lootList, params}; ItemReceivedFriendGiftHeader shows the sender's name and
//   params' usermessage (read by UFortGiftBoxItem, 0x1066A10). Its template is the wrap the sender picked
//   (GiftBox:GB_GiftWrap1 to 4, UserFree), or GiftBox:GB_Default.
//
// The backend's rules, as Epic's service had them: the receivers are the sender's friends of DaysOfFriendshipBeforeCanGift
// days (the admin panel's, 2 by default, Epic's), not the sender; who turned gifts off (SetReceiveGiftsEnabled) or owns
// what the offer gives is turned down; the sender's gifts in 24 hours stay within GiftLimitAmount, 3. Only the item
// shop's cosmetics are giftable, as at Epic's launch (not the Battle Pass, the Season Shop or the llamas). A refusal
// charges nothing and gives nothing.
export const giftingBuild = 4573279;
export const giftLimitAmount = 3;
export const defaultGiftingFriendDays = 2;
export const maxGiftingFriendDays = 30;
export const defaultGiftBox = "GiftBox:GB_Default";
const giftWraps = ["GiftBox:GB_GiftWrap1", "GiftBox:GB_GiftWrap2", "GiftBox:GB_GiftWrap3", "GiftBox:GB_GiftWrap4"];
const dayMs = 24 * 60 * 60 * 1000;
const maxMessageLength = 100;

export const notEligibleError = "errors.com.epicgames.modules.gamesubcatalog.gift_recipient_not_eligible";
export const receiverErrors = {
  notFriend: "errors.com.epicgames.fortnite.gift_recipient_is_not_eligible_friend",
  optedOut: "errors.com.epicgames.modules.gamesubcatalog.receiver_will_not_accept_gifts",
  owned: "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed"
};

let settingsProvider = () => undefined;
export function configureGifting(provider) {
  settingsProvider = typeof provider === "function" ? provider : () => provider;
}

// The admin panel's days of friendship (0 to 30), or undefined for anything else.
export function giftingFriendDaysValue(value) {
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= maxGiftingFriendDays ? days : undefined;
}

export const giftingFriendDays = (settingsValue = settingsProvider()) =>
  giftingFriendDaysValue(settingsValue?.giftingFriendDays) ?? defaultGiftingFriendDays;

// Whether the build has gifting (it shipped it) and the admin panel has it on (the default).
export const hasGifting = (build = currentBuild()) => Number(build) >= giftingBuild;
export const giftingOn = (build = currentBuild(), settingsValue = settingsProvider()) => hasGifting(build) && settingsValue?.gifting !== false;

// A catalog offer that can be gifted: the item shop's cosmetics, for V-Bucks.
export const isGiftableOffer = (offer) => Boolean(offer?.athena) && !offer.seasonLevel && offer.currencyType === "MtxCurrency";

const grantsOf = (offer) => offer.itemGrants ?? [{ templateId: offer.templateId, quantity: 1 }];

// The catalog entry's giftInfo (store/catalog.js offerJson): on for a giftable offer while gifting is on, with Epic's
// requirement that the receiver doesn't own what it gives. A build without gifting is sent none.
export function giftInfoOf(offer, build = currentBuild(), settingsValue = settingsProvider()) {
  if (!hasGifting(build)) return undefined;
  const enabled = giftingOn(build, settingsValue) && isGiftableOffer(offer);
  return {
    bIsEnabled: enabled,
    forcedGiftBoxTemplateId: "",
    purchaseRequirements: enabled
      ? grantsOf(offer).map(({ templateId }) => ({ requirementType: "DenyOnItemOwnership", requiredId: templateId, minQuantity: 1 }))
      : []
  };
}

// The FortRuntimeOptions lines of the hotfix (services/fortnite/cloudstorage.js) for a build with gifting: Epic's
// switch, its limits, and no gifts to yourself; off again when the admin panel turns gifting off.
export function giftingRuntimeOptions(build, settingsValue = settingsProvider()) {
  if (!hasGifting(build)) return [];
  if (!giftingOn(build, settingsValue)) return ["bDisableGifting=true"];
  return ["bDisableGifting=false", "bCanGiftYourself=false", `GiftLimitAmount=${giftLimitAmount}`,
    `DaysOfFriendshipBeforeCanGift=${giftingFriendDays(settingsValue)}`];
}

const historyOf = (tracker) => {
  const history = tracker.profile.stats.attributes.gift_history;
  return history && typeof history === "object" ? history : {};
};

// The sender's gifts in the 24 hours before now, as the client counts them.
export function giftsInLastDay(tracker, now = new Date()) {
  const gifts = Array.isArray(historyOf(tracker).gifts) ? historyOf(tracker).gifts : [];
  return gifts.filter((gift) => Date.parse(gift?.date) >= now.getTime() - dayMs).length;
}

// Why a receiver can't be sent the offer, as the error code the gifting screen words, or null.
function receiverRefusal({ senderId, receiverId, receiver, friends, offer, now, friendDays }) {
  if (!receiver || receiverId === senderId) return receiverErrors.notFriend;
  const friend = friends?.get?.(senderId, receiverId);
  if (friend?.status !== "ACCEPTED") return receiverErrors.notFriend;
  const since = Date.parse(friend.created);
  if (friendDays > 0 && !(since <= now.getTime() - friendDays * dayMs)) return receiverErrors.notFriend;
  if (receiver.profile(giftBoxProfile).profile.stats.attributes.allowed_to_receive_gifts === false) return receiverErrors.optedOut;
  if (grantsOf(offer).some(({ templateId }) => ownsCosmetic(receiver, templateId))) return receiverErrors.owned;
  return null;
}

// A GiftCatalogEntry (services/mcp/commands/GiftCatalogEntry.js) {offerId, currency, currencySubType, expectedTotalPrice, gameContext, receiverAccountIds,
// giftWrapTemplateId, personalMessage} (FCatalogPurchaseInfoGift): the sender pays the offer's price for each receiver,
// and each receiver gets the offer's cosmetics in their locker and a gift box of them in common_core.
export function giveCatalogGift({ req, session, sessionFor, context, offer, now = new Date() }) {
  const settingsValue = context?.settings?.get?.() ?? settingsProvider();
  if (!giftingOn(currentBuild(), settingsValue)) {
    throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", "Gifting is off");
  }
  const { offerId, currency, expectedTotalPrice, receiverAccountIds, giftWrapTemplateId, personalMessage } = req.body ?? {};
  if (!offer) throw new McpError("errors.com.epicgames.modules.gamesubcatalog.catalog_out_of_date", `Offer ${offerId} isn't in the store`);
  if (!isGiftableOffer(offer)) throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", `${offerId} can't be gifted`);
  if (currency !== undefined && currency !== offer.currencyType) {
    throw new McpError("errors.com.epicgames.common.invalid_parameter", `${offerId} is sold for V-Bucks`);
  }
  const receivers = [...new Set(Array.isArray(receiverAccountIds) ? receiverAccountIds.filter((id) => typeof id === "string" && id) : [])];
  if (!receivers.length) throw new McpError("errors.com.epicgames.common.invalid_parameter", "A gift needs a receiver");
  const tracker = session.profile(giftBoxProfile);
  const sent = giftsInLastDay(tracker, now);
  if (sent + receivers.length > giftLimitAmount) {
    throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed",
      `You can send ${giftLimitAmount} gifts in 24 hours and have sent ${sent}`);
  }
  const total = offer.price * receivers.length;
  if (Number.isInteger(expectedTotalPrice) && expectedTotalPrice !== total) {
    throw new McpError("errors.com.epicgames.modules.gamesubcatalog.price_mismatch", `The price is ${total}, not ${expectedTotalPrice}`);
  }

  const friendDays = giftingFriendDays(settingsValue);
  const targets = receivers.map((receiverId) => ({ receiverId, receiver: sessionFor?.(receiverId) ?? null }));
  const refused = targets.map(({ receiverId, receiver }) => ({
    receiverId,
    code: receiverRefusal({ senderId: session.accountId, receiverId, receiver, friends: context?.friends, offer, now, friendDays })
  })).filter(({ code }) => code);
  if (refused.length) {
    log("Gifting", `${session.accountId}'s ${offerId} for ${refused.map(({ receiverId, code }) => `${receiverId} (${code.split(".").pop()})`).join(", ")} is turned down`);
    throw new McpError(notEligibleError, "One or more receivers can't be sent this gift",
      [`[${refused.map(({ receiverId }) => receiverId).join(", ")}]`, `[${refused.map(({ code }) => code).join(", ")}]`]);
  }

  spendMtx(tracker, total);
  const wrap = giftWraps.find((id) => id.toLowerCase() === String(giftWrapTemplateId ?? "").toLowerCase()) ?? defaultGiftBox;
  const message = String(personalMessage ?? "").slice(0, maxMessageLength);
  const date = now.toISOString();
  for (const { receiverId, receiver } of targets) {
    const before = new Set(Object.keys(receiver.profile("athena").profile.items));
    for (const { templateId } of grantsOf(offer)) {
      if (!ownsCosmetic(receiver, templateId)) grantCosmetic(receiver, templateId);
    }
    const lootList = Object.entries(receiver.profile("athena").profile.items).filter(([itemId]) => !before.has(itemId))
      .map(([itemId, item]) => lootEntry({ profileId: "athena", itemId, templateId: item.templateId, quantity: item.quantity ?? 1 }));
    const receiverTracker = receiver.profile(giftBoxProfile);
    receiverTracker.addItem(crypto.randomUUID(), {
      templateId: wrap,
      attributes: { fromAccountId: session.accountId, lootList, params: { userMessage: message }, giftedOn: date },
      quantity: 1
    });
    const theirs = historyOf(receiverTracker);
    receiverTracker.setStat("gift_history", { ...theirs, num_received: (theirs.num_received ?? 0) + 1,
      receivedFrom: { ...(theirs.receivedFrom ?? {}), [session.accountId]: date } });
    log("Gifting", `${session.accountId} gave ${receiverId} ${offerId} (${offer.price} V-Bucks) in ${wrap}`);
  }
  const mine = historyOf(tracker);
  const gifts = (Array.isArray(mine.gifts) ? mine.gifts : []).filter((gift) => Date.parse(gift?.date) >= now.getTime() - dayMs);
  tracker.setStat("gift_history", {
    ...mine,
    num_sent: (mine.num_sent ?? 0) + receivers.length,
    sentTo: { ...(mine.sentTo ?? {}), ...Object.fromEntries(receivers.map((id) => [id, date])) },
    gifts: [...gifts, ...receivers.map((toAccountId) => ({ date, offerId, toAccountId, giftWrap: wrap, personalMessage: message }))]
  });
}
