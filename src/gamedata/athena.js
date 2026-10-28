import { perBuild } from "./read.js";

// Battle Royale's game data (gamedata/athena.json, tools/extractor): its cosmetics, quests, season levels and the
// objective stat rows its quests count. 1.8 (CL-3724489) is the first build with an athena profile and the base file
// holds its data (the extractor makes it empty from Cert; no earlier build asks for it) rather than 1.8's overlay:
// CoreV2's own match reports (battleroyale/recordresults, User-Agent "Core V2") name no build, so they are read with
// Cert's data, and they need the season levels and challenges. A later build whose data differs overlays it as usual.
const data = perBuild((read) => {
  const { cosmetics = {}, quests = {}, levels = [], objectiveStats = {} } = read("athena", {});
  return {
    cosmetics,
    quests,
    levels: [...levels].sort((a, b) => a.level - b.level),
    objectiveStats,
    // The daily challenges the quest log offers (EFortQuestType::AthenaDailyQuest). The others of their folder are the
    // Archive's (type Athena, weight 0, Battle Bucks rewards), which 1.8 no longer gives.
    dailies: Object.keys(quests).filter((id) => quests[id].type === "AthenaDailyQuest")
  };
});

// templateId -> {class, name, rarity}.
export const athenaCosmetics = () => data().cosmetics;

export const getAthenaQuest = (questId) => data().quests[String(questId).toLowerCase()];

export const athenaDailyIds = () => data().dailies;

// A daily's chance against the others (FortQuestItemDefinition Weight, 1 unless the asset says).
export const dailyWeight = (questId) => getAthenaQuest(questId)?.weight ?? 1;

// SeasonXpTable (FAthenaLevelUpData): [{level, xpToNextLevel, xpTotal, chaseReward?}], by level.
export const seasonLevels = () => data().levels;

export const athenaObjectiveStat = (stat) => data().objectiveStats[String(stat).toLowerCase()];
