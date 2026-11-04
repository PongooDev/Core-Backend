import { activeBuild, buildGameData, dataBuilds, perBuild } from "./read.js";

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

// templateId -> {class, name, rarity}; an outfit whose hero wears a back bling built in also has backpackParts, and a
// back bling its CharacterParts as parts (tools/extractor).
export const athenaCosmetics = () => data().cosmetics;

// The back blings 3.0 (CL-3901517) split off outfits (Core-Backend #203): outfit templateId -> the back bling
// (AthenaBackpack template id) of the requesting build that took the place of the back bling the outfit wore built in on
// an earlier build and no longer does on this one. The outfits are the game data's: those whose hero wore a Backpack part
// on an earlier build (2.5's HS_032_Athena_Commando_M_Medieval wore Male_Commando_10) and doesn't on this one. Their back
// bling is the one wearing that same part (3.0's BID_001_BlueSquire wears Male_Commando_10). 3.0 remade three parts,
// though: the Ski Dudes' and Ski Girls' back blings share the Ski Dudes' Male_Commando_13 (the Ski Girls wore
// Female_Commando_08) and Raptor's wears Male_Commando_UR01_ATH (Raptor wore Male_Commando_UR01). Where the part names
// no one back bling, the back bling is the one whose asset name (BID_<n>_<name>) the outfit's asset or display name holds,
// the longest such name: BID_014_SkiGirl for CID_061_Athena_Commando_F_SkiGirl, BID_015_SkiGirl_USA for its _USA,
// BID_005_Raptor for "Raptor". Empty for builds with no such back bling.
const nameKey = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
const splitBackpacks = perBuild((read) => {
  const { cosmetics = {} } = read("athena", {});
  const backpacks = Object.entries(cosmetics).filter(([, cosmetic]) => cosmetic.parts?.length)
    .map(([id, cosmetic]) => ({ id, parts: cosmetic.parts, key: nameKey(id.split(":")[1].replace(/^bid_\d+_/, "")) }));
  const result = {};
  if (!backpacks.length) return result;
  const earlier = dataBuilds.filter((build) => Number(build) < Number(activeBuild()));
  for (const build of earlier) {
    for (const [outfit, cosmetic] of Object.entries(buildGameData(build, "athena", {}).cosmetics ?? {})) {
      const worn = new Set(cosmetics[outfit]?.backpackParts ?? []);
      const split = (cosmetic.backpackParts ?? []).filter((part) => !worn.has(part));
      if (!split.length || result[outfit.toLowerCase()]) continue;
      const byPart = backpacks.filter((backpack) => backpack.parts.some((part) => split.includes(part)));
      const names = [nameKey(outfit.split(":")[1]), nameKey(cosmetics[outfit]?.name ?? cosmetic.name ?? "")];
      const byName = (byPart.length ? byPart : backpacks).filter((backpack) => names.some((name) => name.includes(backpack.key)))
        .sort((a, b) => b.key.length - a.key.length);
      const backpack = byPart.length === 1 ? byPart[0] : byName[0];
      if (backpack) result[outfit.toLowerCase()] = backpack.id;
    }
  }
  return result;
});
export const splitOffBackpacks = (outfitId) => [splitBackpacks()[String(outfitId).toLowerCase()]].filter(Boolean);

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

// Rows Epic corrected in the next build, given as that build has them (Core-Backend #221). 3.0's (CL-3901517)
// complete_athena_with_a_killingblow, the Tier 100 challenges' "Play matches with at least one elimination", has the
// squad rows' ContextTags (Athena.Playlist.Squad, as complete_athena_squad_top_3 beside it), so only a squad match
// counted, though the challenge names no mode; 3.1's AthenaObjectiveStatTable has Athena.Playlist, any match.
const correctedStats = { complete_athena_with_a_killingblow: { "athena.playlist.squad": "Athena.Playlist" } };
export function athenaObjectiveStat(stat) {
  const name = String(stat).toLowerCase();
  const row = data().objectiveStats[name];
  const contextTags = row && correctedStats[name]?.[String(row.contextTags).toLowerCase()];
  return contextTags ? { ...row, contextTags } : row;
}

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
