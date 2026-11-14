// Canny Valley's first act in the desert (5.10, CL-4240749; Core-Backend #341). Update v5.10 reworked Canny Valley's
// story: its first act moved into a desert. 5.10's paks (and every build after it Core has, to 6.20) ship what that act
// is made of, and no layout for it:
// - its quests, Quests/CannyValley/Act1 (21 of them): Storm Shield Defense 1 (OutpostQuest_T3_L1) grants
//   CannyValley_Landmark_Welcome, whose chain runs through Road Trip (CannyValley_Reactive_Route99: "Visit a diner, motel,
//   gas station, and a truck stop. Can be only completed in a Thunder Route 99 zone."), the Vinderman Memorial and the
//   desert's reactive quests (Seebot, the survey, oil samples, dinosaur bones, rock formations, glyphs) to
//   CannyValleyQuest_Outpost_L2 (Storm Shield Defense 2 done), then the periscopes and bases (the bunkers), rusted cars,
//   servers, tabs, jukeboxes, trail, water towers, the constructor and the tumbleweeds to CannyValley_Landmark_HighNoon
//   and CannyValleyQuest_Outpost_L3. Their objectives ask for Zone.Difficulty >= 22 before the second defense and >= 24
//   after it: the rows of Canny Valley's first two zones (Theater_Hard_Zone1, 22, and Theater_Hard_Zone2, 24; regions
//   Stat.Theater.PvE03.Difficulty01 and Difficulty02, opened by Storm Shield Defense 1 and 2);
// - its three landmark missions, which world/landmarks.js places (#339);
// - its zones (World/ZoneThemes), each drawn on the world map by its TheaterMapTileClass (world.json tileClass):
//   ZT_Arid's BP_ZT_Desert ("Canny Valley's vast desert landscapes", Zone_Arid_Desert) and BP_ZT_Desert_Bunker
//   (Zone_Arid_Desert_B, Stat.ZoneTheme.Desert.Bunkers), on the desert tile BP_Hex_Arid01; ZT_Route99's BP_ZT_Route99_1
//   and _2 ("Thunder Route 99", Zone_Arid_ThunderRoute99_01 and _02, built of Maps/*/Arid's ThunderRoute99 diners,
//   motels, gas stations, truck stops, houses and junkyards: the Activities.Placement.LocationUnique tags Road Trip's
//   Mission_CannyValley_Reactive_Route99 looks for) and _Bunker_1 and _2 (their _B maps, Stat.ZoneTheme.Route99.Bunkers),
//   on the highway tile BP_Hex_Route99; and the arid twins of the town zones, BP_ZT_TheCity_Arid and
//   BP_ZT_TheIndustrialPark_Arid (Zone_Arid_Urban, Zone_Arid_Industrial, drawn on the town tiles BP_Hex_TheCity and
//   BP_Hex_TheIndustrialPark).
// Acts 2 and 3 are in none of them (6.20's paks start Act2 with one quest), so the rest of Canny Valley stays as it was.
//
// Its second act is 6.31's (CL-4573279; Core-Backend 830f4e5's data). 6.31's paks ship it as Act 1 was shipped:
// - its quests, Quests/CannyValley/Act2 (21 of them): Storm Shield Defense 3 (CannyValleyQuest_Outpost_L3, done with
//   OutpostQuest_T3_L3) grants CannyValley_Reactive_Truther, whose chain runs through the pamphlets, the spas (Pueblos,
//   "Visit spas in a [UIRating]+ Ghost Town zone"), the coaches, the telegraph ("... in a [UIRating]+ Ghost Town or Thunder
//   Route 99 zone"), the oil lamps, outhouses, movies and records, forts and rifts at Zone.Difficulty >= 26 (and
//   CannyValley_Mechanical_Exploration: an exploration secondary mission, ContextTags Stat.ZoneTheme.GhostTown) to
//   CannyValleyQuest_Outpost_L4; then the stores, tubs, auto-gold-sieves (Dredgers), Stabilize the Rift's landmark
//   (CannyValley_Landmark_Rift, world/landmarks.js), the cards, music halls, Rescue the Survivors in a shelter
//   (ShelterRescue, Stat.Mission.Primary.EvacuateTheShelter), pianos, telescopes and train stations at >= 28 to
//   CannyValleyQuest_Outpost_L5. Those are the rows of Canny Valley's third and fourth zones (Theater_Hard_Zone3, 26, and
//   Theater_Hard_Zone4, 28; regions Stat.Theater.PvE03.Difficulty03 and Difficulty04, opened by Storm Shield Defense 3
//   and 4, so the client shows each zone once the quest that opens it is held: theaters.js zoneGate);
// - its zones: ZT_GhostTown's BP_ZT_GhostTown_A and _B ("Ghost Town", "Canny Valley's historic early settlement",
//   Zone_Arid_WildWest_01 and _02, Stat.ZoneTheme.GhostTown, on the ghost town tile BP_Hex_GhostTown), new in 6.31's
//   world data; and Act 1's arid twins of the town zones;
// - its landmark, Stabilize the Rift (MissionGen_StabilizeTheRift in BP_ZT_StabilizeTheRift), which world/landmarks.js
//   places.
// Most of the act's quests ask for a Ghost Town zone, so on a build whose data has the Ghost Town zones (6.31 on) Core
// lays the act out the same way (🟡 Core's placement: Epic's 6.31 world info isn't recorded either):
// - zones 3 and 4: the wilds and the suburbs the Ghost Town's two maps in turn (each zone's AlwaysActive grassland tile
//   becomes one, so there's a Ghost Town mission at 26 and at 28 every day), the city and the industrial park their arid
//   twins;
// - the scenery around them desert, as Act 1's.
// 6.30's data (CL-4573096) already has the act's 21 quests, but not the Ghost Town zones or the landmark's generator and
// zone, so 6.30 keeps Act 1's map. Zone 5 (Act 3: 6.31's paks start Act3 with a few quests and no zones) stays as it was.
//
// No theater layout ships with the client (World/Theaters has only Theater_Athena and Theater_TEST_PerfMem), and the world
// info the layouts come from (tools/theaters) is Epic's of 2017-07-25, before the rework: its Canny Valley is forest,
// grassland and town, the storm shield the only desert tile (its BP_Hex_Outpost_Theater3 redrawn by 5.10). So on a build
// whose data has the act's zones, Core lays the act out on that map (🟡 Core's placement: Epic's 5.10 world info isn't
// recorded): each tile of the first two zones takes the act's zone for what it was, and world/landmarks.js's three
// landmark tiles keep theirs.
// - Zone 1 is Thunder Route 99: the wilds (forest, grassland) the desert, and everything built (suburbs, city,
//   industrial park) the highway, Route 99's two maps in turn, so Road Trip always has a Route 99 mission at 22 (the
//   zone's AlwaysActive city tile becomes one).
// - Zone 2 is where the bunkers are (the periscopes and bases ask for >= 24): the wilds the desert's bunker map, the
//   suburbs the highway's bunker maps, the city and the industrial park their arid twins.
// - The map's scenery (NonMission tiles) whose nearest playable tile is one of those zones' or the storm shield is desert.
// An older build, or one missing any of these zones, keeps the 2017 map.
export const cannyValleyId = "E6ECBD064B153234656CB4BDE6743870";

const theme = (folder, name) => `/Game/World/ZoneThemes/${folder}/${name}.${name}_C`;
export const act1Zones = {
  desert: theme("ZT_Arid", "BP_ZT_Desert"),
  desertBunker: theme("ZT_Arid", "BP_ZT_Desert_Bunker"),
  route99: [theme("ZT_Route99", "BP_ZT_Route99_1"), theme("ZT_Route99", "BP_ZT_Route99_2")],
  route99Bunker: [theme("ZT_Route99", "BP_ZT_Route99_Bunker_1"), theme("ZT_Route99", "BP_ZT_Route99_Bunker_2")],
  city: theme("ZT_TheCity", "BP_ZT_TheCity_Arid"),
  industrial: theme("ZT_TheIndustrialPark", "BP_ZT_TheIndustrialPark_Arid")
};
export const act2Zones = {
  ghostTown: [theme("ZT_GhostTown", "BP_ZT_GhostTown_A"), theme("ZT_GhostTown", "BP_ZT_GhostTown_B")]
};
// Each zone's themes by the 2017 tile's kind; several take turns in the region's tile order.
const act1Layout = {
  "Stat.Theater.PvE03.Difficulty01": { wilds: [act1Zones.desert], homes: act1Zones.route99, city: act1Zones.route99, industrial: act1Zones.route99 },
  "Stat.Theater.PvE03.Difficulty02": { wilds: [act1Zones.desertBunker], homes: act1Zones.route99Bunker, city: [act1Zones.city], industrial: [act1Zones.industrial] }
};
const ghostTownZone = { wilds: act2Zones.ghostTown, homes: act2Zones.ghostTown, city: [act1Zones.city], industrial: [act1Zones.industrial] };
const act2Layout = { "Stat.Theater.PvE03.Difficulty03": ghostTownZone, "Stat.Theater.PvE03.Difficulty04": ghostTownZone };
// The kind of a tile by its 2017 zone theme's folder; the act's own zones (landmarks) have none.
const kindOf = (zoneTheme) => ({ ZT_TheForest: "wilds", ZT_TheGrasslands: "wilds", ZT_TheSuburbs: "homes", ZT_TheCity: "city",
  ZT_TheIndustrialPark: "industrial" })[/^\/Game\/World\/ZoneThemes\/(\w+)\/BP_ZT_\w+\.BP_ZT_\w+_C$/.exec(zoneTheme ?? "")?.[1]];
const tempered = (zoneTheme) => Boolean(kindOf(zoneTheme)) && !/_Arid\./.test(zoneTheme);

export const act1ZoneThemes = [...new Set(Object.values(act1Zones).flat())];
export const hasAct1Zones = ({ zoneThemes = {} } = {}) => act1ZoneThemes.every((path) => zoneThemes[path]);
export const act2ZoneThemes = [...new Set(Object.values(act2Zones).flat())];
export const hasAct2Zones = (world = {}) => hasAct1Zones(world) && act2ZoneThemes.every((path) => world.zoneThemes?.[path]);

// Gives each tile of the layout's zones its act zone (landmark tiles, whose themes aren't the 2017 ones, keep theirs), then
// the scenery (NonMission tiles) whose nearest playable tile is one of those zones' or the storm shield the desert.
function drawAct(data, layout) {
  const shield = data.tiles.find((tile) => tile.tileType === "Outpost");
  if (!shield) return;
  const actTiles = new Set();
  for (const region of data.regions) {
    const zone = (region.regionTags?.gameplayTags ?? []).map(({ tagName }) => layout[tagName]).find(Boolean);
    if (!zone) continue;
    const turns = {};
    for (const index of region.tileIndices) {
      actTiles.add(index);
      const tile = data.tiles[index];
      const kind = tempered(tile.zoneTheme) && kindOf(tile.zoneTheme);
      if (!kind) continue;
      const choices = zone[kind];
      const turn = turns[choices[0]] ?? 0;
      turns[choices[0]] = turn + 1;
      tile.zoneTheme = choices[turn % choices.length];
    }
  }
  const distance = (a, b) => Math.hypot(a.xCoordinate - b.xCoordinate, a.yCoordinate - b.yCoordinate);
  const playable = data.tiles.map((tile, index) => ({ tile, index })).filter(({ tile }) => tile.tileType !== "NonMission");
  for (const tile of data.tiles) {
    if (tile.tileType !== "NonMission" || !tempered(tile.zoneTheme)) continue;
    const [nearest] = [...playable].sort((a, b) => distance(a.tile, tile) - distance(b.tile, tile) || a.index - b.index);
    if (nearest && (actTiles.has(nearest.index) || nearest.tile === shield)) tile.zoneTheme = act1Zones.desert;
  }
}

// Redraws Canny Valley's theater data (FFortTheaterMapData, tools/theaters' shape) in place for the requesting build's
// world data; any other theater, or a build without the act's zones, is left alone. Runs after world/landmarks.js.
export function drawCannyValleyAct1(data, world) {
  if (data.uniqueId !== cannyValleyId || !hasAct1Zones(world)) return;
  drawAct(data, act1Layout);
}

// The second act's Ghost Town zones (6.31 on), the same way; runs after drawCannyValleyAct1.
export function drawCannyValleyAct2(data, world) {
  if (data.uniqueId !== cannyValleyId || !hasAct2Zones(world)) return;
  drawAct(data, act2Layout);
}
