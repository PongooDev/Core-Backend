import { perBuild } from "../gamedata/read.js";

// What quests ask of a mission, and which missions a theater's tiles can carry, from the requesting build's game data.
const data = perBuild((read) => {
  const { missionGenerators = {}, primaryMissions = {}, difficulties = {}, questPaths = {} } = read("world", {});
  return {
    missionGenerators, primaryMissions, difficulties, questPaths,
    quests: read("quests", {}),
    objectiveStats: read("objectivestats", {}),
    generatorsByClass: new Map(Object.keys(missionGenerators).map((path) => [path.split(".").pop(), path]))
  };
});

// The MissionTags of the primary mission a generator runs (FortMissionGenerator PrimaryMissionInfo, inherited from the
// parent generator class when the child doesn't set it), e.g. Stat.Mission.Primary.EvacuateTheSurvivors.
export function generatorMissionTags(generator) {
  const { missionGenerators, primaryMissions, generatorsByClass } = data();
  for (let path = generator, depth = 0; path && depth < 16; depth += 1) {
    const entry = missionGenerators[path];
    if (!entry) return [];
    if (entry.primaryMission) return primaryMissions[entry.primaryMission]?.tags ?? [];
    path = generatorsByClass.get(entry.parent);
  }
  return [];
}

export const difficultyOf = (rowName) => data().difficulties[rowName]?.difficulty ?? 0;

export function questPath(questId) {
  return data().questPaths[questId.toLowerCase()];
}

// A tag matches a query tag when it is that tag or one of its children (Gate.Gate_Double counts for Gate).
const matchesTag = (tag, query) => tag === query || tag.startsWith(`${query}.`);

// The Complete objectives of a quest that name one kind of primary mission ("Complete a Rescue the Survivors mission in
// a 5+ zone": Stat.Mission.Primary.EvacuateTheSurvivors, Zone.Difficulty >=5), with the theater they must be in, if any.
export function missionObjectives(questId) {
  const { quests, objectiveStats } = data();
  const quest = quests[questId.toLowerCase()];
  return (quest?.objectives ?? []).flatMap((objective) => {
    const stat = objective.stat && objectiveStats[objective.stat];
    if (stat?.type !== "Complete" || !/^Stat\.Mission\.Primary\.\w/.test(stat.targetTags)) return [];
    if (stat.sourceTags) return []; // Done as a hero class or on a critical mission: any tile of the kind can't promise it.
    return [{
      name: objective.name,
      stat: objective.stat,
      count: objective.count ?? 1,
      missionTag: stat.targetTags,
      minimumDifficulty: Number(/Zone\.Difficulty\s*>=\s*(\d+(?:\.\d+)?)/.exec(stat.condition)?.[1] ?? 0),
      theaterTag: stat.contextTags?.startsWith("Stat.Theater.") ? stat.contextTags : undefined
    }];
  });
}

// Whether a mission (its generator and difficulty row) counts for an objective. The theater is checked by the caller.
export function missionMeets(objective, generator, rowName) {
  return difficultyOf(rowName) >= objective.minimumDifficulty &&
    generatorMissionTags(generator).some((tag) => matchesTag(tag, objective.missionTag));
}

// The objectives done on a critical mission ("Complete 3 missions in Stonewood with Play with others": quick_complete_*,
// SourceTags Stat.Source.OnCriticalMission), with their theater if they name one.
function criticalObjectives(questId) {
  const { quests, objectiveStats } = data();
  const quest = quests[questId.toLowerCase()];
  return (quest?.objectives ?? []).flatMap((objective) => {
    const stat = objective.stat && objectiveStats[objective.stat];
    if (stat?.type !== "Complete" || !stat.sourceTags?.split(",").includes("Stat.Source.OnCriticalMission")) return [];
    return [{ theaterTag: stat.contextTags?.startsWith("Stat.Theater.") ? stat.contextTags : undefined }];
  });
}

const theaterOfName = { stonewoodquest: "Stat.Theater.PvE01", plankertonquest: "Stat.Theater.PvE02", cannyvalleyquest: "Stat.Theater.PvE03", twinepeaksquest: "Stat.Theater.PvE04" };
const questTheater = (questId) => theaterOfName[questId.split("_")[0]];

// The story: main quests (Task, Onboarding) and a theater's side quests (Optional, <theater>quest_side_*), not the
// achievements, challenges or event quests.
function isStory(questId, quest) {
  if (quest.deprecated || /^(test|progressiontest)/.test(questId)) return false;
  return ["Task", "Onboarding"].includes(quest.type) || (quest.type === "Optional" && Boolean(questTheater(questId)));
}

// The story quests a tile is placed for (FFortTheaterMapTileData.LinkedQuests). Epic's world info had them, but the
// dump the layouts come from kept only their empty objective handles, so they are rebuilt from the quests:
// - a storm shield tile: the theater's ten Storm Shield Defense quests (OutpostQuest_T<t>_L1-10);
// - the critical mission tile: the quests done on a critical mission in that theater (quick_complete_pve0<t>, and the
//   daily High Priority, quick_complete in any theater);
// - a tile with one fixed generator (MissionWeightOverrides): each story quest whose objective that mission meets, in
//   the quest's theater, when the tile is among the quest's lowest-difficulty such tiles.
// These give the dump's tiles and counts wherever this build has the quest (Stonewood's tile 28 and Canny Valley's 67
// and 72 get links the dump's later build didn't have; its tiles 17, 20, 21, 38 and Canny Valley's 97 were linked to
// quests Cert doesn't have).
export function linkedQuests(theater) {
  const { quests } = data();
  const theaterTag = theater.regions.flatMap((region) => region.regionTags?.gameplayTags ?? [])
    .map(({ tagName }) => /^Stat\.Theater\.PvE0\d/.exec(tagName)?.[0]).find(Boolean);
  const links = new Map();
  const link = (tileIndex, questId) => {
    const list = links.get(tileIndex) ?? [];
    if (!list.includes(questId)) list.push(questId);
    links.set(tileIndex, list);
  };
  const regionOf = new Map(theater.regions.flatMap((region) => region.tileIndices.map((index) => [index, region])));
  const difficultyRow = (tile, index) => (tile.difficultyWeightOverrides?.length ? tile.difficultyWeightOverrides
    : regionOf.get(index)?.missionData?.difficultyWeights ?? []);

  const number = theaterTag?.slice(-1);
  theater.tiles.forEach((tile, index) => {
    if (tile.tileType === "Outpost" && number) {
      for (let level = 1; level <= 10; level += 1) {
        const questId = `outpostquest_t${number}_l${level}`;
        if (quests[questId]) link(index, questId);
      }
    }
    if (tile.tileType === "CriticalMission") {
      for (const [questId, quest] of Object.entries(quests)) {
        if (!isStory(questId, quest) && quest.type !== "DailyQuest") continue;
        if (criticalObjectives(questId).some((objective) => (objective.theaterTag ?? questTheater(questId) ?? theaterTag) === theaterTag)) link(index, questId);
      }
    }
  });

  const fixed = theater.tiles.flatMap((tile, index) => {
    const rows = difficultyRow(tile, index);
    if (tile.missionWeightOverrides?.length !== 1 || rows.length !== 1 || tile.tileType === "Outpost") return [];
    return [{ index, generator: tile.missionWeightOverrides[0].missionGenerator, rowName: rows[0].difficultyInfo.rowName }];
  });
  for (const [questId, quest] of Object.entries(quests)) {
    if (!isStory(questId, quest)) continue;
    for (const objective of missionObjectives(questId)) {
      if ((objective.theaterTag ?? questTheater(questId) ?? theaterTag) !== theaterTag) continue;
      const tiles = fixed.filter((tile) => missionMeets(objective, tile.generator, tile.rowName));
      if (!tiles.length) continue;
      const lowest = Math.min(...tiles.map((tile) => difficultyOf(tile.rowName)));
      for (const tile of tiles.filter((candidate) => difficultyOf(candidate.rowName) === lowest)) link(tile.index, questId);
    }
  }
  return links;
}
