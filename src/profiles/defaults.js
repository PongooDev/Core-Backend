const never = "0001-01-01T00:00:00.000Z";

const templates = {
  profile0: () => ({
    level: 1,
    xp: 0,
    homebase: { townName: "", bannerIconId: "", bannerColorId: "", flagPattern: 0, flagColor: 0, playerXP: 0 },
    default_hero_squad_id: "Squad_Combat_AdventureSquadOne",
    gameplay_stats: [],
    mode_loadouts: [],
    quest_manager: { dailyLoginInterval: never, dailyQuestRerolls: 0 },
    client_settings: { pinnedQuestInstances: [] },
    current_mtx_platform: "Epic",
    mission_alert_redemption_record: {
      lastClaimedGuidPerTheater: [],
      lastClaimTimes: [],
      oldestClaimIndex: 0,
      pendingMissionAlertRewards: { tierGroupName: "", items: [] }
    },
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
  return added;
}
