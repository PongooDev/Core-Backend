// Epic served theater layouts from its own servers, so no layout ships with the client: this one is Core's design.
// Every zone theme, mission generator and difficulty row it names exists in the paks (gamedata/world.json).
// Regions follow the difficulty rows Theater_Start_Zone1-5; the T1 mission generators come in LT/MT/HT/VHT threat
// variants, matched to the zones in that order (inferred from the names).
export const stonewood = {
  key: "stonewood",
  name: "Stonewood",
  description: "The first theater. Its storm shield is your homebase.",
  slot: 0,
  // The frontend globe spawns this pin class at this socket of WM_Globe; a missing class crashes the client.
  // Sockets PvE_01-04 match the theaters' Stat.Theater.PvE01-04 tags.
  mapPin: "WM_PinEasy",
  socket: "PvE_01",
  outpost: {
    zoneTheme: "BP_ZT_TheOutpost_PvE_01",
    missionGenerator: "MissionGen_TheOutpost_PvE_01",
    difficulty: "Theater_Start_Outpost1"
  },
  regions: [
    { name: "Stonewood Zone 1", difficulty: "Theater_Start_Zone1", zoneThemes: ["BP_ZT_TheGrasslands", "BP_ZT_TheForest"],
      missionGenerators: ["MissionGen_T1_LT_Cat1FtS", "MissionGen_T1_LT_LtB"] },
    { name: "Stonewood Zone 2", difficulty: "Theater_Start_Zone2", zoneThemes: ["BP_ZT_TheForest", "BP_ZT_TheSuburbs"],
      missionGenerators: ["MissionGen_T1_MT_Cat1FtS", "MissionGen_T1_MT_LtB", "MissionGen_T1_MT_RtD"] },
    { name: "Stonewood Zone 3", difficulty: "Theater_Start_Zone3", zoneThemes: ["BP_ZT_TheSuburbs", "BP_ZT_TheGrasslands"],
      missionGenerators: ["MissionGen_T1_HT_Cat1FtS", "MissionGen_T1_HT_LtB", "MissionGen_T1_HT_RtD", "MissionGen_T1_HT_EvacuateTheSurvivors"] },
    { name: "Stonewood Zone 4", difficulty: "Theater_Start_Zone4", zoneThemes: ["BP_ZT_TheIndustrialPark", "BP_ZT_TheCity"],
      missionGenerators: ["MissionGen_T1_VHT_Cat1FtS", "MissionGen_T1_VHT_LtB", "MissionGen_T1_VHT_RtD", "MissionGen_T1_VHT_EvacuateTheSurvivors"] },
    { name: "Stonewood Zone 5", difficulty: "Theater_Start_Zone5", zoneThemes: ["BP_ZT_TheCity", "BP_ZT_TheIndustrialPark"],
      missionGenerators: ["MissionGen_T1_VHT_Cat1FtS", "MissionGen_T1_VHT_RtD", "MissionGen_T1_VHT_LtR", "MissionGen_BuildtheRadarGrid", "MissionGen_DestroyTheEncampments"] }
  ],
  // Hex rings around the storm shield: ring 1 holds zones 1-2, ring 2 zones 3-5.
  tilesPerRegion: [3, 3, 4, 4, 4]
};
