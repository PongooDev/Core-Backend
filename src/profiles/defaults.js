import crypto from "node:crypto";
import { isChoicePack, rollOptions } from "../cardpacks/contents.js";
import { starterBanners } from "../gamedata/banners.js";
import { emptyAlertRecord, withQuotaSlots } from "./alerts.js";
import { restQuotaAttributes } from "./boosts.js";
import { fillHeroAttributes } from "./heroes.js";
import { isMtxCurrency, mtxPlatform } from "./items.js";
import { fillWorkerAttributes } from "./workers.js";

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
    daily_rewards: { nextDefaultReward: 0, totalDaysLoggedIn: 0, lastClaimDate: never, additionalSchedules: {} },
    // 1.7.2's front end reads it without checking it is there (sub_70F330 from sub_2D76C70, entering Battle Royale):
    // a profile without it crashes the client. Counters are {currentCount, lastIncrementedTime}
    // (IncrementNamedCounterStat).
    named_counters: {}
  }),
  // The gameserver reads the backpack profile's own player_loadout into UFortMcpProfileWorld::CachedPlayerLoadout and
  // won't save the profile while bPlayerIsNew is set; InitializeTheater clears it on the player's first zone.
  theater0: () => ({
    player_loadout: { bPlayerIsNew: true, pinnedSchematicInstances: [], zonesCompleted: 0 }
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
// editor only lists banners the player owns, so the starter banners (the requesting build's) are starting items too.
const startingItems = () => ({
  profile0: [
    { templateId: "HomebaseNode:startnode_commandcenter", attributes: { level: 1, item_seen: 0 }, quantity: 1 },
    ...starterBanners().map((templateId) => ({ templateId, attributes: { item_seen: 1 }, quantity: 1 })),
    // Rest XP (Quota:RestXP) starts full; the client shows its balance from this item.
    { templateId: "Quota:restxp", attributes: (profile) => restQuotaAttributes(profile.stats.attributes.level ?? 1), quantity: 1 }
  ]
});

export function addMissingItems(profile) {
  let added = false;
  const wanted = startingItems()[profile.profileId] ?? [];
  if (!wanted.length) return false;
  const held = new Set(Object.values(profile.items).map((existing) => existing.templateId.toLowerCase()));
  for (const item of wanted) {
    if (!held.has(item.templateId.toLowerCase())) {
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
    if (fillWorkerAttributes(item)) changed = true;
    if (fillHeroAttributes(item)) changed = true;
    // V-Bucks made before the platform attribute showed as 0 in the game.
    if (isMtxCurrency(item.templateId) && item.attributes.platform !== mtxPlatform) {
      item.attributes.platform = mtxPlatform;
      changed = true;
    }
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
