import { missionMeets, missionObjectives, questPath } from "./quests.js";

// 5.10's (CL-4240749) Canny Valley Act 1 (Core-Backend #339). Its main quests start at the first Storm Shield Defense
// (OutpostQuest_T3_L1 gives CannyValley_Landmark_Welcome, "Please Hold": "Can be only completed in Thunder Route 99",
// objective "Discover Landmark in a [UIRating]+ zone") and lead through three landmark missions, each a mission generator
// of its own whose primary mission is the quest's objective (ObjectiveStatTable Complete, TargetTags
// Stat.Mission.Primary.Landmark.*), each on a zone of its own (6.02's FModel):
// - Welcome: MissionGen_HitTheRoad ("Hit the Road", "Welcome to Route 99"; CV_Landmark_HitTheRoad,
//   Stat.Mission.Primary.Landmark.HitTheRoad, Zone.Difficulty >=22) in BP_ZT_Route99_Landmark ("Thunder Route 99",
//   Zone_TheCannyValleyDiscovery, Stat.ZoneTheme.Route99);
// - Memorial (given by CannyValley_Reactive_Route99): MissionGen_BuildTheMemorial (Landmark.BuildTheMonument, >=22) in
//   BP_ZT_Desert_Monument (Zone_TheVindermanMemorial);
// - HighNoon (given by CannyValley_Reactive_Tumbleweed): MissionGen_FightTheGunslinger (Landmark.FightTheGunslinger,
//   >=24) in BP_ZT_GhostTown_HighNoon ("Ghost Town", Zone_Arid_TheGhostTown).
// Epic's world info placed them; the layouts Core has (world/theaters.js, LawinServer's copy of Epic's world info) are
// older than 5.10 and have none, so no mission on the map met these quests: the quest log had no Play for them and the
// pinned quest's Find found nothing (#339's client log: every Canny Valley tile 0 or 1 for CannyValley_Landmark_Welcome).
// 6.02's client (IDA 13338) looks for one this way:
// - AFortTheaterMapViewer::GetMissionQuestValidity (sub_13172B0) is InvalidNotPlayable while the tile's region or the
//   tile's own Requirements aren't met (IsRequirementsMet, AFortPlayerControllerFrontEnd slot 6520 -> sub_11EF1F0), or
//   while the tile's Requirements.ActiveQuestDefinition is a quest the player has completed (sub_1326040); ValidLinked
//   when the tile's LinkedQuests name the quest (sub_1327EC0); ValidObjectiveCondition when the mission meets an objective
//   (CanProgressQuest, sub_1309430); Invalid otherwise.
// - The quest log's Play and the pinned quest's Find (SelectValidTileForQuest, sub_132F4F0) take the missions that are
//   valid (2 and up) across the theaters (sub_1324C90); the marked quest's pin goes on each tile that is (sub_1328A00).
// - IsRequirementsMet's ActiveQuestDefinition (+0x18) passes while the player holds the quest, and a tile whose quest is
//   completed can't be picked (AFortTheaterMapTile, sub_1328710 -> sub_1326040): the client's own quest tile.
// So, from 5.10, each landmark gets a tile of Canny Valley (🟡 which tile is Core's: Epic's 5.10 layout isn't kept): the
// first Normal tile, in the region's order, of the lowest zone whose difficulty its objective accepts (Welcome and
// Memorial in zone 1, Theater_Hard_Zone1, difficulty 22; HighNoon in zone 2, 24), made an AlwaysActive tile of its zone
// theme running only its generator at that zone's difficulty, no mission alert, with the quest as its
// ActiveQuestDefinition. world/quests.js linkedQuests then links the quest to it, as any fixed tile.
// The zones around them (Thunder Route 99's, the desert's and the bunkers' tiles, which the Act 1 reactive quests such as
// Road Trip, "Can be only completed in a Thunder Route 99 zone", need) are world/cannyvalley.js's (#341), which keeps
// these tiles: the Welcome tile ends up among zone 1's Route 99 tiles, the Memorial in its desert, High Noon's ghost town
// in zone 2's desert.
export const landmarkMissions = [
  {
    questId: "cannyvalley_landmark_welcome",
    missionGenerator: "/Game/World/MissionGens/CannyValley/CV_Landmarks/MissionGen_HitTheRoad.MissionGen_HitTheRoad_C",
    zoneTheme: "/Game/World/ZoneThemes/ZT_Route99/BP_ZT_Route99_Landmark.BP_ZT_Route99_Landmark_C"
  },
  {
    questId: "cannyvalley_landmark_memorial",
    missionGenerator: "/Game/World/MissionGens/CannyValley/CV_Landmarks/MissionGen_BuildTheMemorial.MissionGen_BuildTheMemorial_C",
    zoneTheme: "/Game/World/ZoneThemes/ZT_Arid/BP_ZT_Desert_Monument.BP_ZT_Desert_Monument_C"
  },
  {
    questId: "cannyvalley_landmark_highnoon",
    missionGenerator: "/Game/World/MissionGens/CannyValley/CV_Landmarks/MissionGen_FightTheGunslinger.MissionGen_FightTheGunslinger_C",
    zoneTheme: "/Game/World/ZoneThemes/ZT_GhostTown/BP_ZT_GhostTown_HighNoon.BP_ZT_GhostTown_HighNoon_C"
  },
  // 6.31's (CL-4573279) Act 2 landmark: CannyValley_Landmark_Rift (given by CannyValley_Reactive_Dredgers; objective
  // Stat.Mission.Primary.Landmark.Rift, Zone.Difficulty >=28) is MissionGen_StabilizeTheRift ("Stabilize the Rift", "Use
  // lasers to stabilize a rift"; StR_Landmark) in BP_ZT_StabilizeTheRift ("The Desert", Zone_StabilizeTheRift, the desert
  // tile BP_Hex_Arid01), 6.31's FModel. 28 is zone 4's (Theater_Hard_Zone4), so it goes there, among world/cannyvalley.js's
  // Ghost Town zones. Builds before 6.31 have neither the generator nor the quest.
  {
    questId: "cannyvalley_landmark_rift",
    missionGenerator: "/Game/World/MissionGens/CannyValley/CV_Landmarks/MissionGen_StabilizeTheRift.MissionGen_StabilizeTheRift_C",
    zoneTheme: "/Game/World/ZoneThemes/Landmarks/ZT_StabilizeTheRift/BP_ZT_StabilizeTheRift.BP_ZT_StabilizeTheRift_C"
  }
];

const cannyValley = "Stat.Theater.PvE03";
const isCannyValley = (data) => data.runtimeInfo.theaterType === "Standard"
  && (data.runtimeInfo.theaterTags?.gameplayTags ?? []).some(({ tagName }) => tagName === cannyValley);
// A zone region's number (Stat.Theater.PvE03.Difficulty0<n>), 0 for the theater's other regions.
const zoneOf = (region) => Number((region.regionTags?.gameplayTags ?? [])
  .map(({ tagName }) => /^Stat\.Theater\.PvE03\.Difficulty0(\d)$/.exec(tagName)?.[1]).find(Boolean) ?? 0);

// Places the build's landmark missions on Canny Valley's layout (a theater's FFortTheaterMapData, changed in place),
// before its tiles are linked to their quests. world is the build's world data (missionGenerators, zoneThemes). Builds
// before 5.10 have none of the generators (and before 6.31 not Stabilize the Rift's): those layouts stay as they were.
export function placeLandmarks(data, world) {
  if (!isCannyValley(data)) return;
  const zones = data.regions.filter((region) => zoneOf(region) && region.missionData?.difficultyWeights?.length === 1)
    .sort((a, b) => zoneOf(a) - zoneOf(b));
  const taken = new Set();
  for (const landmark of landmarkMissions) {
    const quest = questPath(landmark.questId);
    const [objective] = missionObjectives(landmark.questId);
    if (!quest || !objective || !world.missionGenerators?.[landmark.missionGenerator] || !world.zoneThemes?.[landmark.zoneTheme]) continue;
    const zone = zones.find((region) => missionMeets(objective, landmark.missionGenerator, region.missionData.difficultyWeights[0].difficultyInfo.rowName));
    const tileIndex = zone?.tileIndices.find((index) => data.tiles[index].tileType === "Normal" && !taken.has(index));
    if (tileIndex === undefined) continue;
    taken.add(tileIndex);
    const tile = data.tiles[tileIndex];
    const [row] = zone.missionData.difficultyWeights;
    Object.assign(tile, {
      tileType: "AlwaysActive",
      zoneTheme: landmark.zoneTheme,
      requirements: { ...tile.requirements, activeQuestDefinition: quest },
      missionWeightOverrides: [{ missionGenerator: landmark.missionGenerator, weight: 1 }],
      difficultyWeightOverrides: [{ ...row, difficultyInfo: { ...row.difficultyInfo } }],
      canBeMissionAlert: false
    });
  }
}
