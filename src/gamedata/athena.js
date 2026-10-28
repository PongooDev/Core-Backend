import { perBuild } from "./read.js";

// Battle Royale's game data (gamedata/athena.json, tools/extractor): its cosmetics, quests, season levels and the
// objective stat rows its quests count. 1.8 (CL-3724489) is the first build with an athena profile and the file holds
// its data; no earlier build asks for it. Once 1.8 has an overlay of its own (gamedata/3724489), this can move into it
// as a patch of Cert's empty file, which is what the extractor makes from Cert.
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
