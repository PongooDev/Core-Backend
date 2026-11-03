import { perBuild } from "./read.js";

// Battle Royale's game data (gamedata/athena.json, tools/extractor): its cosmetics, the item shop's display assets, its
// quests, season levels and the objective stat rows its quests count. 1.8 (CL-3724489) is the first build with an athena
// profile and the base file holds its data (the extractor makes it empty from Cert; no earlier build asks for it) rather
// than 1.8's overlay: CoreV2's own match reports (battleroyale/recordresults, User-Agent "Core V2") name no build, so
// they are read with Cert's data, and they need the season levels and challenges. A later build whose data differs
// overlays it as usual.
const data = perBuild((read) => {
  const { cosmetics = {}, displayAssets = {}, quests = {}, levels = [], objectiveStats = {}, season, loot = {}, challengeSchedules = {},
    challengeBundles = {} } = read("athena", {});
  return {
    cosmetics,
    season,
    displayAssets,
    quests,
    levels: [...levels].sort((a, b) => a.level - b.level),
    objectiveStats,
    // The daily challenges the quest log offers (EFortQuestType::AthenaDailyQuest). The others of their folder are the
    // Archive's (type Athena, weight 0, Battle Bucks rewards), which 1.8 no longer gives.
    dailies: Object.keys(quests).filter((id) => quests[id].type === "AthenaDailyQuest"),
    // From 1.11 (Season 2), the Battle Pass's daily challenges (EFortQuestType::AthenaBattlePassQuest,
    // Athena/Items/Quests/BattlePass), one a day for its owners besides the three above.
    battlePassDailies: Object.keys(quests).filter((id) => quests[id].type === "AthenaBattlePassQuest"),
    loot,
    challengeSchedules,
    challengeBundles
  };
});

// templateId -> {class, name, rarity}.
export const athenaCosmetics = () => data().cosmetics;

// The item shop's display assets (FortMtxOfferData with Battle Royale tile art) by the cosmetic the extractor matched
// them to, as object paths: "AthenaGlider:glider_voyager" -> "/Game/Catalog/DisplayAssets/DA_Featured_GliderVoyager.DA_Featured_GliderVoyager".
export const athenaDisplayAssets = () => data().displayAssets;

export const getAthenaQuest = (questId) => data().quests[String(questId).toLowerCase()];

export const athenaDailyIds = () => data().dailies;

export const athenaBattlePassDailyIds = () => data().battlePassDailies;

// A daily's chance against the others (FortQuestItemDefinition Weight, 1 unless the asset says).
export const dailyWeight = (questId) => getAthenaQuest(questId)?.weight ?? 1;

// SeasonXpTable (FAthenaLevelUpData): [{level, xpToNextLevel, xpTotal, chaseReward?}], by level.
export const seasonLevels = () => data().levels;

export const athenaObjectiveStat = (stat) => data().objectiveStats[String(stat).toLowerCase()];

// The season's Battle Pass, from 1.11 (CL-3807424, Season 2; tools/extractor): AthenaSeason2 (UAthenaSeasonItemDefinition)
// {seasonNumber, numSeasonLevels, numBookLevels, storefront, bookLevels: [{level, xpToNextLevel, xpTotal}] (BookXpCurve,
// the Battle Stars each tier takes), seasonRewards, bookFreeRewards, bookPaidRewards: [{level, rewards: [{templateId,
// quantity}]}] (SeasonXpScheduleFree: what reaching a season level gives; BookXpScheduleFree / BookXpSchedulePaid: what
// reaching a tier gives the free pass and the Battle Pass)}. Undefined for 1.8 to 1.10, Season 1's builds, whose
// AthenaGameData names the season levels itself and which have no Battle Pass.
export const athenaSeason = () => data().season;

// Battle Royale's loot tables, whole (tools/extractor): {"/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client":
// {<row name>: {<property>: value}}, ...}, every property in the form UDataTable::CreateTableFromJSONString reads. Only
// the builds whose data was extracted with them have them (1.11 and 2.1); the others get {}.
export const athenaLootTables = () => data().loot;

// Season 3's challenges (3.0, tools/extractor; profiles/challenges.js), by id: the schedules the season grants
// ({category, bundles: [{bundle, unlockType, unlockValue}]}) and their bundles ({quests: [{quest, grantWithBundle}],
// completionThreshold, completionRewards, visualStyle}). Empty for earlier builds.
export const athenaChallengeSchedules = () => data().challengeSchedules;
export const athenaChallengeBundles = () => data().challengeBundles;
