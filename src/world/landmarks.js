import { difficultyOf, missionMeets, missionObjectives, questPath } from "./quests.js";

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
  },
  // 7.00's (CL-4629139) Act 3 landmarks, Update v7.00's "Canny Valley Act 3 ... 2 new landmark zones". 6.31's data already
  // has Act 3's quests (Quests/CannyValley/Act3: their objectives all at Zone.Difficulty >= 30, zone 5's row,
  // Theater_Hard_Zone5), the two landmarks' among them, but not their generators or zones; 7.00's world data adds both:
  // - CannyValley_Landmark_DeployTheProbe (objective Stat.Mission.Primary.Landmark.DeployTheProbe, >= 30): MissionGen_DeployTheProbe
  //   (CannyValleyLandmarks/DeployTheProbe) in BP_ZT_Desert_DeployProbe ("Desert", Stat.ZoneTheme.Desert, the desert tile
  //   BP_Hex_Arid01);
  // - CannyValley_Landmark_Mansion (Landmark.Mansion, >= 30): MissionGen_VindermanMansion (CannyValleyLandmarks/
  //   VindermanMansion) in BP_ZT_TheGrasslands_Mansion.
  // Both go in zone 5, as Act 2's went in zones 3 and 4. Act 3's last landmark, CannyValley_Landmark_BossFight
  // (Landmark.BossFight, the campaign's end: "We're working on an ending song and video that will be added in at a later
  // date"), has no generator in 7.00's data, so it stays unplayable here, as it was in Epic's 7.00.
  {
    questId: "cannyvalley_landmark_deploytheprobe",
    missionGenerator: "/Game/World/MissionGens/CannyValley/CV_Landmarks/MissionGen_DeployTheProbe.MissionGen_DeployTheProbe_C",
    zoneTheme: "/Game/World/ZoneThemes/ZT_Arid/BP_ZT_Desert_DeployProbe.BP_ZT_Desert_DeployProbe_C"
  },
  {
    questId: "cannyvalley_landmark_mansion",
    missionGenerator: "/Game/World/MissionGens/CannyValley/CV_Landmarks/MissionGen_VindermanMansion.MissionGen_VindermanMansion_C",
    zoneTheme: "/Game/World/ZoneThemes/ZT_TheGrasslands/BP_ZT_TheGrasslands_Mansion.BP_ZT_TheGrasslands_Mansion_C"
  }
];

// 6.30's (CL-4573096) Stonewood and Plankerton landmarks, Update v6.30's "Added new Landmark Zones and Missions: Build
// Off!, Plank Harbor, Steel Icarus" (Core-Backend #368). Each is a story quest of 6.30's reworked quest line whose
// objective is a landmark mission (ObjectiveStatTable Complete, Stat.Mission.Primary.Landmark.*), and like Canny Valley's
// no tile of the layouts Core has (older than 6.30) runs one, so the quest line stopped there:
// - StonewoodQuest_Landmark_BuildOff ("Build Off!", given by StonewoodQuest_Fetch_ResearchCrates after Stonewood's SSD 3,
//   Zone.Difficulty >=5; it leads to StonewoodQuest_Filler_1_D3 and Stonewood's SSD 4): MissionGen_BuildOff
//   (StonewoodLandmarks/ConstructorBuildOff/BuildOff_Gate, Stat.Mission.Primary.Landmark.BuildOff) in BP_ZT_BuildOff ("The
//   Durr Burger Build-Off");
// - PlankertonQuest_Landmark_PlankHarbor (given by PlankertonQuest_Outpost_L5, >=20): MissionGen_PlankHarbor3Gate
//   (PlankertonLandmarks/LiberatePlankHarbor, Landmark.PlankHarbor) in BP_ZT_PlankHarbor ("Plank Harbor");
// - PlankertonQuest_Landmark_Lars ("Steel Icarus", "Launch Lars deep into the storm!", given by
//   PlankertonQuest_Reactive_Speakers, >=20; it leads to PlankertonQuest_Outpost_L6): the only generator whose mission is
//   Stat.Mission.Primary.Landmark.Lars, Into the Storm's MissionGen_RtL_StormQuest2018Landmark (3.5's
//   LaunchTheBalloon/RtL_Stormquest_2018), in the zone theme that event gave it, ZT_IntotheStorm's BP_ZT_LaunchingLars.
// They take their tiles as Canny Valley's do (🟡 which tile is Core's: Epic's 6.30 layout isn't kept): Build Off in
// Stonewood's zone 3 (Theater_Start_Zone3, 5), the two Plankerton ones in the first of its zones at 20
// (Theater_Normal_Zone5, zone 4's harder region). Builds before 6.30 have none of the quests: those layouts stay as they
// were. 6.30's world data lacked these missions' MissionInfo (its extraction kept 6.22's: no BuildOff_Gate or
// LiberatePlankHarbor, RtL_Stormquest_2018 still Into the Storm's LaunchWeatherBalloon tag); gamedata/4573096/world.json
// has them as 6.30's paks do (BuildOff_Gate Stat.Mission.Primary.Landmark.BuildOff, LiberatePlankHarbor
// Landmark.PlankHarbor, RtL_Stormquest_2018 Landmark.Lars, "Steel Icarus"), as 6.31's data already had.
export const stonewoodLandmarks = [
  {
    questId: "stonewoodquest_landmark_buildoff",
    missionGenerator: "/Game/World/MissionGens/Stonewood/SW_Landmarks/MissionGen_BuildOff.MissionGen_BuildOff_C",
    zoneTheme: "/Game/World/ZoneThemes/Onboarding/BP_ZT_BuildOff.BP_ZT_BuildOff_C"
  }
];
export const plankertonLandmarks = [
  {
    questId: "plankertonquest_landmark_plankharbor",
    missionGenerator: "/Game/World/MissionGens/Plankerton/Plank_Landmarks/MissionGen_PlankHarbor3Gate.MissionGen_PlankHarbor3Gate_C",
    zoneTheme: "/Game/World/ZoneThemes/Landmarks/ZT_PlankHarbor/BP_ZT_PlankHarbor.BP_ZT_PlankHarbor_C"
  },
  {
    questId: "plankertonquest_landmark_lars",
    missionGenerator: "/Game/World/MissionGens/MissionGen_RtL_StormQuest2018Landmark.MissionGen_RtL_StormQuest2018Landmark_C",
    zoneTheme: "/Game/World/ZoneThemes/ZT_IntotheStorm/BP_ZT_LaunchingLars.BP_ZT_LaunchingLars_C"
  }
];

const landmarksByTheater = { 1: stonewoodLandmarks, 2: plankertonLandmarks, 3: landmarkMissions };
// A main theater's number (Stat.Theater.PvE0<n>), 0 for the others.
const theaterOf = (data) => (data.runtimeInfo.theaterType === "Standard" ? Number((data.runtimeInfo.theaterTags?.gameplayTags ?? [])
  .map(({ tagName }) => /^Stat\.Theater\.PvE0(\d)$/.exec(tagName)?.[1]).find(Boolean) ?? 0) : 0);
// A zone region's number (Stat.Theater.PvE0<theater>.Difficulty0<n>), 0 for the theater's other regions.
const zoneOf = (region, theater) => Number((region.regionTags?.gameplayTags ?? [])
  .map(({ tagName }) => /^Stat\.Theater\.PvE0(\d)\.Difficulty0(\d)$/.exec(tagName))
  .find((match) => Number(match?.[1]) === theater)?.[2] ?? 0);

// Places the build's landmark missions on their theater's layout (a theater's FFortTheaterMapData, changed in place),
// before its tiles are linked to their quests. world is the build's world data (missionGenerators, zoneThemes). Builds
// without a landmark's quest, generator or zone theme (before 5.10 for Canny Valley's, before 6.31 for Stabilize the
// Rift, before 7.00 for Deploy the Probe and the Vinderman Mansion, before 6.30 for Stonewood's and Plankerton's) leave its
// theater as it was.
export function placeLandmarks(data, world) {
  const theater = theaterOf(data);
  const landmarks = landmarksByTheater[theater];
  if (!landmarks) return;
  // A zone's regions by zone, then by difficulty (Stonewood's zone 3 is Theater_Start_Zone3 and a harder Start_Zone4 region).
  const rowOf = (region) => region.missionData.difficultyWeights[0].difficultyInfo.rowName;
  const zones = data.regions.filter((region) => zoneOf(region, theater) && region.missionData?.difficultyWeights?.length === 1)
    .sort((a, b) => zoneOf(a, theater) - zoneOf(b, theater) || difficultyOf(rowOf(a)) - difficultyOf(rowOf(b)));
  const taken = new Set();
  // A Normal tile of the zone; Stonewood's zones have none (every one of their tiles is AlwaysActive), so there one of those.
  const freeTile = (region) => ["Normal", "AlwaysActive"].map((type) => region.tileIndices
    .find((index) => data.tiles[index].tileType === type && !data.tiles[index].requirements?.activeQuestDefinition && !taken.has(index)))
    .find((index) => index !== undefined);
  for (const landmark of landmarks) {
    const quest = questPath(landmark.questId);
    const [objective] = missionObjectives(landmark.questId);
    if (!quest || !objective || !world.missionGenerators?.[landmark.missionGenerator] || !world.zoneThemes?.[landmark.zoneTheme]) continue;
    const zone = zones.find((region) => missionMeets(objective, landmark.missionGenerator, rowOf(region)) && freeTile(region) !== undefined);
    const tileIndex = zone && freeTile(zone);
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
