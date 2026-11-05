import { currentBuild } from "../builds/context.js";

// 3.5 (3.5.1, CL-4000805, the first build after 3.3 that Core knows: there is no 3.4) splits profile0 three ways.
// Its UFortRegisteredPlayerInfo holds CommonPublicProfile, CommonCoreProfile, AccountProfile (UFortMcpProfileCampaign),
// MetadataProfile and AthenaProfile (SDK +0xD8 to +0x108), and the player controller's profile cheat knows "campaign",
// "athena", "common_core", "common_public" and "metadata" (3.5.1 0xED37B0); the exe has no "profile0" left. Its login
// asks for common_public and common_core first and gives up on either ("Failed to synchronize a profile ... Unknown
// profile common_public"):
// - common_core (UFortMcpProfileCommonCore): the account's own. The V-Bucks the lobby shows are its
//   (UFortMcpContext::GetLocalAccountInfo 0x1139380 -> 0xD9F710: MtxBalance from the controller's +0x2388, the
//   cheat's common_core slot), the store buys through it (PurchaseOffer 0xDB6CC0 sends PurchaseCatalogEntry from the
//   same profile), its gift boxes are its (FortGiftBoxItem's static_profile_type, 0xCE52F0) and RemoveGiftBox,
//   SetMtxPlatform, SetReceiveGiftsEnabled, IssueFriendCode and ClaimImportFriendsReward are its commands. Tokens say
//   their profile in their data (UFortTokenType ProfileType, EItemProfileType Common / Campaign / Athena; exported as
//   common_core / campaign / athena, 0xCF4550): of the ones Core grants, CampaignAccess, the founder's packs, the
//   founder's chat unlock and Battle Royale's access tokens are Common.
// - common_public (UFortMcpProfileCommonPublic): what other players see, read for every registered player, the party's
//   too (SynchronizeProfile 0xC86520 queries it always, common_core and campaign only for the local player): the
//   stats banner_icon, banner_color and homebase_name (0xD79800, the party banner's GetHomeBaseInfoForPlayer), set by
//   SetHomebaseBanner and SetHomebaseName, its commands.
// - campaign (UFortMcpProfileCampaign): Save the World's own, everything else profile0 held, with profile0's commands
//   but SetDefaultHeroSquad, SetHomebaseMeta and IncrementNamedCounterStat, which 3.5 dropped.
//
// Core keeps profile0 as the one saved profile and serves the three as views of it (profiles/session.js): a 3.3 account
// keeps its V-Bucks, banners and homebase on 3.5.1 with nothing to move, every build before 3.5 is served profile0 as
// it was, and the same account can go back and forth. Each view has its own revision (profile0's coreViews, never sent),
// counted from the changes that are its, so a client's copy of one is only replaced when that one changed.
const lastProfile0Build = 3942182;

export const accountViews = ["campaign", "common_core", "common_public"];
export const isAccountView = (profileId) => accountViews.includes(profileId);

// The account's client's build, by the last of its own MCP requests: what the profile notifications of a change made
// outside a game's request (the admin panel, the V-Bucks pack purchase page) are named for.
const clientBuilds = new Map();
export const noteClientBuild = (accountId, build) => {
  if (/^\d+$/.test(String(build ?? ""))) clientBuilds.set(accountId, String(build));
};

const isChangelist = (build) => /^\d+$/.test(String(build ?? ""));

// Whether the requesting build (or, outside a game's request, the account's client's) has the split profiles.
export function usesCommonProfiles(accountId) {
  const build = isChangelist(currentBuild()) ? currentBuild() : clientBuilds.get(accountId);
  return isChangelist(build) && Number(build) > lastProfile0Build;
}

// The profile the client names for what Core keeps in profile0: profile0's own id before 3.5.
export const mtxProfileId = (accountId) => (usesCommonProfiles(accountId) ? "common_core" : "profile0");

// Items of profile0 that are common_core's, by template type (and, for tokens, their ProfileType).
const coreTypes = new Set(["homebasebannericon", "homebasebannercolor", "giftbox", "codetoken"]);
const coreTokens = new Set(["token:campaignaccess", "token:founderspack_1", "token:founderspack_2", "token:founderspack_3",
  "token:founderspack_4", "token:founderspack_5", "token:founderchatunlock", "token:athenaaccess_token",
  "token:athenacancreatecustomgames_token"]);

export function itemView(templateId) {
  const id = String(templateId ?? "").toLowerCase();
  const type = id.split(":")[0];
  if (id.startsWith("currency:mtx") || coreTypes.has(type) || coreTokens.has(id)) return "common_core";
  return "campaign";
}

// profile0's stats that are common_core's (the account's purchases, gifts and platform). common_public's come from
// profile0's homebase stat {townName, bannerIconId, bannerColorId}, which campaign keeps too.
const coreStats = new Set(["current_mtx_platform", "in_app_purchases", "daily_purchases", "weekly_purchases", "monthly_purchases",
  "mtx_purchase_history", "mtx_affiliate", "gift_history", "allowed_to_receive_gifts", "allowed_to_send_gifts",
  "import_friends_claimed"]);

export const statView = (name) => (coreStats.has(name) ? "common_core" : "campaign");

const publicStats = (homebase = {}) => ({
  banner_icon: homebase.bannerIconId ?? "",
  banner_color: homebase.bannerColorId ?? "",
  homebase_name: homebase.townName ?? ""
});

// One view's part of profile0 as fullProfile gives it: {version, wipeNumber, stats, items}.
export function viewProfile({ version, wipeNumber, stats, items }, viewId) {
  if (viewId === "common_public") return { version, wipeNumber, stats: { attributes: publicStats(stats.attributes.homebase) }, items: {} };
  const attributes = Object.fromEntries(Object.entries(stats.attributes).filter(([name]) => statView(name) === viewId));
  const viewItems = Object.fromEntries(Object.entries(items).filter(([, item]) => itemView(item.templateId) === viewId));
  return { version, wipeNumber, stats: { attributes }, items: viewItems };
}

// One view's part of profile0's changes (templateOf: the item a change is about). A change of the homebase stat is
// common_public's three stats as they are now.
export function viewChanges(changes, viewId, profile, templateOf) {
  const out = [];
  for (const change of changes) {
    if (change.changeType === "statModified") {
      if (viewId === "common_public") {
        if (change.name !== "homebase" || out.length) continue;
        for (const [name, value] of Object.entries(publicStats(profile.stats.attributes.homebase))) out.push({ changeType: "statModified", name, value });
      } else if (statView(change.name) === viewId) out.push(change);
    } else if (viewId !== "common_public" && itemView(templateOf(change)) === viewId) out.push(change);
  }
  return out;
}

// A view's revision: profile0's coreViews, or profile0's own until the view first changes.
export const viewRevision = (profile, viewId) => profile.coreViews?.[viewId] ?? { rvn: profile.rvn, commandRevision: profile.commandRevision };

// Loot as the client is told it ({itemType, itemGuid, itemProfile, quantity}): an item in profile0 is in its view.
export function wireItemProfile(profileId, templateId, accountId) {
  return profileId === "profile0" && usesCommonProfiles(accountId) ? itemView(templateId) : profileId;
}
