import crypto from "node:crypto";
import { isChoicePack, rollOptions } from "../cardpacks/contents.js";
import { starterBanners } from "../gamedata/banners.js";
import { emptyAlertRecord, withQuotaSlots } from "./alerts.js";
import { restQuotaAttributes } from "./boosts.js";

const never = "0001-01-01T00:00:00.000Z";

// The client only counts a player's homebase as set up once townName, bannerIconId or bannerColorId has a value
// (GetHomeBaseInfoForPlayer, FortMcpContext.cpp: FFortHomeBaseInfo.ValidData); until then their party banner spins
// forever ("Got bad homebase data"). New homebases get the first rows of the BannerIcons and BannerColors tables.
export const defaultBanner = { bannerIconId: "StandardBanner1", bannerColorId: "DefaultColor1" };

const templates = {
  profile0: () => ({
    level: 1,
    xp: 0,
    homebase: { townName: "", ...defaultBanner, flagPattern: 0, flagColor: 0, playerXP: 0 },
    default_hero_squad_id: "Squad_Combat_AdventureSquadOne",
    gameplay_stats: [],
    mode_loadouts: [],
    quest_manager: { dailyLoginInterval: never, dailyQuestRerolls: 0 },
    client_settings: { pinnedQuestInstances: [] },
    current_mtx_platform: "Epic",
    mission_alert_redemption_record: emptyAlertRecord(),
    player_loadout: { bPlayerIsNew: true, pinnedSchematicInstances: [], zonesCompleted: 0 },
    in_app_purchases: { receipts: [], fulfillmentCounts: {} },
    daily_purchases: { lastInterval: never, purchaseList: {} },
    weekly_purchases: { lastInterval: never, purchaseList: {} },
    collection_book: { pages: [], maxBookXpLevelAchieved: 0 },
    daily_rewards: { nextDefaultReward: 0, totalDaysLoggedIn: 0, lastClaimDate: never, additionalSchedules: {} }
  })
};

export function defaultStats(profileId) {
  return templates[profileId]?.() ?? {};
}

export function addMissingStats(profile) {
  let added = false;
  for (const [name, value] of Object.entries(defaultStats(profile.profileId))) {
    if (!(name in profile.stats.attributes)) {
      profile.stats.attributes[name] = value;
      added = true;
    }
  }
  // Homebases made before the default banner existed have none.
  const homebase = profile.stats.attributes.homebase;
  if (homebase && !homebase.bannerIconId && !homebase.bannerColorId) {
    Object.assign(homebase, defaultBanner);
    added = true;
  }
  const alerts = profile.stats.attributes.mission_alert_redemption_record;
  if (alerts && withQuotaSlots(alerts) !== alerts) {
    profile.stats.attributes.mission_alert_redemption_record = withQuotaSlots(alerts);
    added = true;
  }
  return added;
}

// Nothing in the game data grants the skill tree's start node, yet it unlocks the first hero slot, Commando slotting
// and the starting storage, so every profile0 owns it (inferred: it can't be bought and sits on no page). The banner
// editor only lists banners the player owns, so the starter banners are starting items too.
const startingItems = {
  profile0: [
    { templateId: "HomebaseNode:startnode_commandcenter", attributes: { level: 1, item_seen: 0 }, quantity: 1 },
    ...starterBanners.map((templateId) => ({ templateId, attributes: { item_seen: 1 }, quantity: 1 })),
    // Rest XP (Quota:RestXP) starts full; the client shows its balance from this item.
    { templateId: "Quota:restxp", attributes: (profile) => restQuotaAttributes(profile.stats.attributes.level ?? 1), quantity: 1 }
  ]
};

export function addMissingItems(profile) {
  let added = false;
  for (const item of startingItems[profile.profileId] ?? []) {
    const held = Object.values(profile.items).some((existing) => existing.templateId.toLowerCase() === item.templateId.toLowerCase());
    if (!held) {
      const attributes = typeof item.attributes === "function" ? item.attributes(profile) : item.attributes;
      profile.items[crypto.randomUUID()] = structuredClone({ ...item, attributes });
      added = true;
    }
  }
  return added;
}

export function upgradeItems(profile) {
  let changed = false;
  for (const item of Object.values(profile.items)) {
    if (!item.templateId.toLowerCase().startsWith("cardpack:")) continue;
    if (typeof item.attributes.pack_source !== "string") {
      item.attributes.pack_source = "Store";
      changed = true;
    }
    if (isChoicePack(item.templateId) && !Array.isArray(item.attributes.options)) {
      item.attributes.options = rollOptions(item.templateId);
      changed = true;
    }
  }
  return changed;
}
