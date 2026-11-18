import crypto from "node:crypto";
import { currentBuild, inBuild, onTheServer } from "../builds/context.js";
import { battleRoyaleBuilds, versionOf } from "../builds/detect.js";
import { McpError } from "../errors.js";
import { log } from "../log.js";
import { grantCosmetic, ownsCosmetic, seasonRewardFunctions } from "../profiles/athena.js";
import { lootEntry, spendMtx } from "../profiles/items.js";
import { giftBoxProfile } from "../profiles/giftboxes.js";
import { buyBattlePass, profileSeason, seasonNumber } from "../profiles/seasons.js";
import { hasSeasonHistory, seasonMoment, seasonOfBuild } from "./itemshop.js";

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
// what the offer gives is turned down; the sender's gifts in 24 hours stay within GiftLimitAmount, 3. The item shop's
// cosmetics are giftable, as at Epic's launch (not the Season Shop or the llamas), and the Battle Pass by its own switch
// (below). A refusal charges nothing and gives nothing.
//
// The admin panel's switches (Core-Backend #386, 90sNath's list): item gifting (settings gifting, on by default, as
// before), Battle Pass gifting (giftingBattlePass, off by default, as before) and Original dates (giftingOriginalDates,
// off by default). With Original dates on, each kind is allowed only on Epic's dates, on the season's replay clock
// (store/itemshop.js seasonMoment, as the LTMs' Original dates: events/ltms.js), and a switch that is off keeps its kind
// off whatever the dates say. Epic's dates (the issue's list, checked against the Fortnite Wiki's Gifting page, its
// History section):
// - Items: "Introduced Gifting as a limited-time experimental feature" with Update v6.31 (27 November 2018), "December
//   4th 2018: Disabled Gifting"; "February 18th 2019: Enabled Gifting" (Update v7.40, Share the Love), and on from then
//   (the issue's "kept in the game afterwards"; 🟡 the wiki calls the February return "for a limited time" and gives no
//   end, so Core keeps it on from there). Each window is whole UTC days, its end the day it went off.
// - The Battle Pass: "The Battle Pass can now be gifted" with Update v10.00 (Season X, 1 August 2019). No build Core
//   supports reaches Season X, so with Original dates on the Battle Pass isn't giftable on any of them.
// 🟡 On 7.00 to 7.20 the February return is on Season 7's replay too, though Epic's clients by then were 7.40's: these
// builds have the same gifting code (UFortRuntimeOptions' bDisableGifting, the gifting screen), and the dates are what the
// issue asks to follow.
//
// The Battle Pass on these clients: 6.31's and 7.20's season tab has a Gift Battle Pass action (AthenaSeasonTab's
// Handle_GiftBattlePass, USeasonPassScreenBase::OnSetGiftability, the BattlePassGiftReceived screen; their SDKs), but
// Epic never turned it on then, so whether it shows from the pass offer's giftInfo alone isn't confirmed. The backend
// answers a GiftCatalogEntry for the pass offer (battlepass/season2.js, battlePass "pass"; not the bundle or tiers, which
// the wiki lists as never giftable, "Battle Pass Levels" and "Battle Pass Level bundles") while the switch allows it: the
// receiver is given the sender's season's pass (profiles/seasons.js buyBattlePass), and turned down as owning it if they
// have it.
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

const utcDay = (date) => Date.parse(`${date}T00:00:00.000Z`);
// Epic's dates (above), [start, end) in ms UTC.
export const itemGiftingDates = [{ start: utcDay("2018-11-27"), end: utcDay("2018-12-04") }, { start: utcDay("2019-02-18"), end: Infinity }];
export const battlePassGiftingDates = [{ start: utcDay("2019-08-01"), end: Infinity }];
// 🟡 The first day of a season Core has no shop history of yet (none it supports), where the replay can't say the day.
const seasonFirstDays = { 8: utcDay("2019-02-28"), 9: utcDay("2019-05-09"), 10: utcDay("2019-08-01") };

export const giftingOriginalDatesOn = (settingsValue = settingsProvider()) => settingsValue?.giftingOriginalDates === true;

// The moment of Epic's calendar the build's season replay stands at now (ms UTC).
export function giftingMoment(build = currentBuild(), now = new Date()) {
  const season = inBuild(String(build), seasonOfBuild);
  if (hasSeasonHistory(season)) return inBuild(String(build), () => seasonMoment(now, null, season)).getTime();
  return seasonFirstDays[season] ?? (season > 10 ? Infinity : -Infinity);
}
const inDates = (dates, moment) => dates.some(({ start, end }) => moment >= start && moment < end);

// Whether the build has gifting (it shipped it); whether the admin panel allows item gifting (on by default) and Battle
// Pass gifting (off by default) now, with Original dates the dates too; and whether either is (the hotfix's switch).
export const hasGifting = (build = currentBuild()) => Number(build) >= giftingBuild;
export const itemGiftingOn = (build = currentBuild(), settingsValue = settingsProvider(), now = new Date()) =>
  hasGifting(build) && settingsValue?.gifting !== false
  && (!giftingOriginalDatesOn(settingsValue) || inDates(itemGiftingDates, giftingMoment(build, now)));
export const battlePassGiftingOn = (build = currentBuild(), settingsValue = settingsProvider(), now = new Date()) =>
  hasGifting(build) && settingsValue?.giftingBattlePass === true
  && (!giftingOriginalDatesOn(settingsValue) || inDates(battlePassGiftingDates, giftingMoment(build, now)));
export const giftingOn = (build = currentBuild(), settingsValue = settingsProvider(), now = new Date()) =>
  itemGiftingOn(build, settingsValue, now) || battlePassGiftingOn(build, settingsValue, now);

// A catalog offer that can be gifted: the item shop's cosmetics, for V-Bucks; and the Battle Pass itself.
export const isGiftableOffer = (offer) => Boolean(offer?.athena) && !offer.seasonLevel && offer.currencyType === "MtxCurrency";
export const isGiftableBattlePass = (offer) => offer?.battlePass === "pass" && offer.currencyType === "MtxCurrency";
// Whether the offer may be gifted now, by its kind's switch (and dates).
export const offerGiftingOn = (offer, build = currentBuild(), settingsValue = settingsProvider(), now = new Date()) =>
  (isGiftableOffer(offer) && itemGiftingOn(build, settingsValue, now))
  || (isGiftableBattlePass(offer) && battlePassGiftingOn(build, settingsValue, now));

const grantsOf = (offer) => offer.itemGrants ?? [{ templateId: offer.templateId, quantity: 1 }];

// The catalog entry's giftInfo (store/catalog.js offerJson): on for a giftable offer while gifting is on, with Epic's
// requirement that the receiver doesn't own what it gives. A build without gifting is sent none.
export function giftInfoOf(offer, build = currentBuild(), settingsValue = settingsProvider(), now = new Date()) {
  if (!hasGifting(build)) return undefined;
  const enabled = offerGiftingOn(offer, build, settingsValue, now);
  return {
    bIsEnabled: enabled,
    forcedGiftBoxTemplateId: "",
    // 🟡 The pass names no item to deny on (its ownership is a stat, book_purchased): the backend turns an owner down.
    purchaseRequirements: enabled && !isGiftableBattlePass(offer)
      ? grantsOf(offer).map(({ templateId }) => ({ requirementType: "DenyOnItemOwnership", requiredId: templateId, minQuantity: 1 }))
      : []
  };
}

// The FortRuntimeOptions lines of the hotfix (services/fortnite/cloudstorage.js) for a build with gifting: Epic's
// switch, its limits, and no gifts to yourself; off again when the admin panel turns gifting off.
// With Original dates, the switch is as the dates stand when the client reads the hotfix (at login); the catalog's
// giftInfo and GiftCatalogEntry follow the dates as they move.
export function giftingRuntimeOptions(build, settingsValue = settingsProvider(), now = new Date()) {
  if (!hasGifting(build)) return [];
  if (!giftingOn(build, settingsValue, now)) return ["bDisableGifting=true"];
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
  if (isGiftableBattlePass(offer) ? ownsSeasonPass(receiver, seasonNumber())
    : grantsOf(offer).some(({ templateId }) => ownsCosmetic(receiver, templateId))) return receiverErrors.owned;
  return null;
}

// Whether an account has a season's Battle Pass: in its athena profile's season, or in the season's record it keeps aside
// (profiles/seasons.js coreSeasons).
function ownsSeasonPass(session, season) {
  const { profile } = session.profile("athena");
  return (profileSeason(profile) === season ? profile.stats.attributes.book_purchased : profile.coreSeasons?.[season]?.book_purchased) === true;
}

// The sender's season's pass for a receiver: bought in their athena profile when it is in that season (with the tier
// rewards reached); else kept in that season's record, its rewards given once they play the season and earn (🟡 Core's
// choice: the profile holds one season at a time). Returns the loot the pass gave now.
function giveSeasonPass(receiver, season) {
  const { profile } = receiver.profile("athena");
  if (profileSeason(profile) === season) return buyBattlePass(receiver, seasonRewardFunctions());
  profile.coreSeasons ??= {};
  profile.coreSeasons[season] = { ...(profile.coreSeasons[season] ?? {}), book_purchased: true };
  return [];
}

// A GiftCatalogEntry (services/mcp/commands/GiftCatalogEntry.js) {offerId, currency, currencySubType, expectedTotalPrice, gameContext, receiverAccountIds,
// giftWrapTemplateId, personalMessage} (FCatalogPurchaseInfoGift): the sender pays the offer's price for each receiver,
// and each receiver gets the offer's cosmetics in their locker and a gift box of them in common_core.
export function giveCatalogGift({ req, session, sessionFor, context, offer, now = new Date() }) {
  const settingsValue = context?.settings?.get?.() ?? settingsProvider();
  if (!giftingOn(currentBuild(), settingsValue, now)) {
    throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", "Gifting is off");
  }
  const { offerId, currency, expectedTotalPrice, receiverAccountIds, giftWrapTemplateId, personalMessage } = req.body ?? {};
  if (!offer) throw new McpError("errors.com.epicgames.modules.gamesubcatalog.catalog_out_of_date", `Offer ${offerId} isn't in the store`);
  const pass = isGiftableBattlePass(offer);
  if (!isGiftableOffer(offer) && !pass) throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", `${offerId} can't be gifted`);
  if (!offerGiftingOn(offer, currentBuild(), settingsValue, now)) {
    throw new McpError("errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed", pass ? "Battle Pass gifting is off" : "Item gifting is off");
  }
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
  // The receivers' profiles are read and given to in the sender's build, which isn't theirs: they keep their season (and
  // Commander XP scale) until their own client asks (builds/context.js onTheServer).
  const refused = onTheServer(() => targets.map(({ receiverId, receiver }) => ({
    receiverId,
    code: receiverRefusal({ senderId: session.accountId, receiverId, receiver, friends: context?.friends, offer, now, friendDays })
  }))).filter(({ code }) => code);
  if (refused.length) {
    log("Gifting", `${session.accountId}'s ${offerId} for ${refused.map(({ receiverId, code }) => `${receiverId} (${code.split(".").pop()})`).join(", ")} is turned down`);
    throw new McpError(notEligibleError, "One or more receivers can't be sent this gift",
      [`[${refused.map(({ receiverId }) => receiverId).join(", ")}]`, `[${refused.map(({ code }) => code).join(", ")}]`]);
  }

  spendMtx(tracker, total);
  const wrap = giftWraps.find((id) => id.toLowerCase() === String(giftWrapTemplateId ?? "").toLowerCase()) ?? defaultGiftBox;
  const message = String(personalMessage ?? "").slice(0, maxMessageLength);
  const date = now.toISOString();
  const season = seasonNumber();
  for (const { receiverId, receiver } of targets) onTheServer(() => {
    const before = new Set(Object.keys(receiver.profile("athena").profile.items));
    const passLoot = pass ? giveSeasonPass(receiver, season) : [];
    if (!pass) {
      for (const { templateId } of grantsOf(offer)) {
        if (!ownsCosmetic(receiver, templateId)) grantCosmetic(receiver, templateId);
      }
    }
    const lootList = pass ? passLoot.map(lootEntry)
      : Object.entries(receiver.profile("athena").profile.items).filter(([itemId]) => !before.has(itemId))
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
  });
  const mine = historyOf(tracker);
  const gifts = (Array.isArray(mine.gifts) ? mine.gifts : []).filter((gift) => Date.parse(gift?.date) >= now.getTime() - dayMs);
  tracker.setStat("gift_history", {
    ...mine,
    num_sent: (mine.num_sent ?? 0) + receivers.length,
    sentTo: { ...(mine.sentTo ?? {}), ...Object.fromEntries(receivers.map((id) => [id, date])) },
    gifts: [...gifts, ...receivers.map((toAccountId) => ({ date, offerId, toAccountId, giftWrap: wrap, personalMessage: message }))]
  });
}

// The admin panel's view of a season (admin/routes.js shop): its newest build with gifting, and whether items and the Battle
// Pass may be gifted there now (with Original dates, by the season replay's day), or null for a season without gifting.
export function giftingStateOf(season, settingsValue = settingsProvider(), now = new Date()) {
  const build = battleRoyaleBuilds.filter((changelist) => hasGifting(changelist) && inBuild(changelist, seasonOfBuild) === Number(season))
    .reduce((newest, changelist) => (newest && Number(newest) > Number(changelist) ? newest : changelist), null);
  if (!build) return null;
  const moment = giftingMoment(build, now);
  return { build, version: versionOf(build), items: itemGiftingOn(build, settingsValue, now), battlePass: battlePassGiftingOn(build, settingsValue, now),
    replayDay: Number.isFinite(moment) ? new Date(moment).toISOString().slice(0, 10) : null };
}
