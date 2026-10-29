import crypto from "node:crypto";
import { fortnitemares, isEventActive } from "../events/events.js";
import { perBuild } from "../gamedata/read.js";
import { difficultyOf, missionMeets, missionObjectives, questPath } from "./quests.js";

// Hexsylvania, Fortnitemares' theater (1.8). Its missions are what the event's quests ask for: every Hexsylvania
// objective names the theater tag Stat.Theater.Transylvania (ObjectiveStatTable ContextTags: complete_trv_landmark,
// complete_trv_trapthestorm, halloween_completemissions_1-14, the quest_reactive_*_halloween ones), the Halloween
// quest missions only spawn in a theater with it (SharedMissionLists: Halloween_Tertiary and the LocationDiscovery
// missions, TheaterTagQuery ANY(Stat.Theater.Transylvania)) and the HalloweenCategory mission alerts belong to it
// (MissionAlertCategories CategoryTagsContainer). No theater layout ships with the client and the world info the other
// theaters come from (tools/theaters) is from after the event, so this layout is Core's (🟡), built from what 1.8 ships
// for it:
// - zone themes: BP_ZT_TRV_HF (Zone_TRV_HForest_Castle), BP_ZT_TRV_HF_Castle and _CastleB (Zone_TRV_HForest_TwoTowers,
//   _B) and BP_ZT_TRV_HF_Intro (Zone_TRV_HForest_Intro, the event's opening map); Trap the Storm only on the maps
//   with both of its trap sites (trapThemes below);
// - missions: Explore the Mist (MissionGen_TRV_Landmark, TRV_Landmark: Stat.Mission.Primary.TRV.Landmark, the
//   Opener's "Explore the mists of Hexsylvania"), the first Trap the Storm (MissionGen_1stTrapTheStorm, with its
//   tutorial; TtS_Intro's objective), and Trap the Storm, Fight the Storm, Destroy the Encampments and Rescue the
//   Survivors (MissionGen_TrapTheStorm, MissionGen_TRV_GateSingle, MissionGen_TRV_DestroyTheEncampments,
//   MissionGen_EvacuateTheSurvivors_TRV: the TRV variants of their primary missions, no time of day);
// - difficulties: "Vlad World" (halloween_completemissions_1-14) asks for Hexsylvania missions from 5+ to 32+ power,
//   the main theaters' zone rows (Start_Zone3 to Nightmare_Zone1), so there is a region for each theater's rows, the
//   later ones opening with that theater (its story gate: Plankerton's after Stonewood's Launch the Rocket and so on);
// - the world map pin WM_PinHalloween.
// The theater is only in world info while the event runs on the requesting build.
export const transylvania = "Stat.Theater.Transylvania";
export const hexsylvaniaId = crypto.createHash("sha1").update("Core:Hexsylvania").digest("hex").slice(0, 32).toUpperCase();

const spooky = (name) => `/Game/World/ZoneThemes/TestZoneThemes/Spooky/${name}.${name}_C`;
const zoneThemes = { forest: spooky("BP_ZT_TRV_HF"), castle: spooky("BP_ZT_TRV_HF_Castle"), castleB: spooky("BP_ZT_TRV_HF_CastleB"), intro: spooky("BP_ZT_TRV_HF_Intro") };
const generator = (path) => `/Game/World/MissionGens/${path}.${path.split("/").pop()}_C`;
const generators = {
  landmark: generator("TRV/MissionGen_TRV_Landmark"),
  firstTrapTheStorm: generator("TRV/MissionGen_1stTrapTheStorm"),
  trapTheStorm: generator("TRV/MissionGen_TrapTheStorm"),
  gate: generator("TRV/MissionGen_TRV_GateSingle"),
  encampments: generator("TRV/MissionGen_TRV_DestroyTheEncampments"),
  evacuate: generator("MissionGen_EvacuateTheSurvivors_TRV")
};
const difficultyTable = "/Game/Balance/DataTables/GameDifficultyGrowthBounds.GameDifficultyGrowthBounds";
const zones = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, index) => `Theater_${prefix}_Zone${from + index}`);

// Four 5x4 blocks of mission tiles on an 11x10 map, with non-mission tiles between them. Explore the Mist and the
// first Trap the Storm are always up in the first region, at its lowest row.
const regions = [
  { name: "Hexsylvania_Start", rows: zones("Start", 3, 5), x: 1, y: 6 },
  { name: "Hexsylvania_Normal", rows: zones("Normal", 1, 5), x: 7, y: 6, gate: "stonewoodquest_launchrocket_d5" },
  { name: "Hexsylvania_Hard", rows: zones("Hard", 1, 5), x: 1, y: 1, gate: "plankertonquest_launchrocket_d5" },
  { name: "Hexsylvania_Nightmare", rows: zones("Nightmare", 1, 5), x: 7, y: 1, gate: "cannyvalleyquest_launchrocket_d5" }
];
const fixedTiles = [
  { x: 2, y: 8, zoneTheme: zoneThemes.intro, generator: generators.landmark },
  { x: 4, y: 8, zoneTheme: zoneThemes.castle, generator: generators.firstTrapTheStorm }
];
const missionsPerRegion = 8;
const spookyThemes = [zoneThemes.forest, zoneThemes.castle, zoneThemes.castleB];
const regionGenerators = [generators.trapTheStorm, generators.gate, generators.encampments, generators.evacuate];

// Trap the Storm (TrapTheStorm's MissionPlacementInfo, Mission_TrapTheStorm) has two storm traps: one at the castle
// (TtS_CastleMissionPlacementQuery: a FortPlacementActor tagged Activities.Placement.LocationUnique.Castle) and one at
// the mansion (TtS_MansionMissionPlacementQuery: LocationUnique.Mansion). Those placement actors are only in the 9x9
// castle and mansion levels (TRV_HAF_9x9_Castle_0x, TRV_HAF_9x9_Mansion_0x). Zone_TRV_HForest_TwoTowers and _B have
// both (their BG_TRV_HAF_Castle_Outer and BG_TRV_HAF_MansionOuter tiles), and so does Zone_TRV_HForest_Intro (both
// LFs placed in the map), but Zone_TRV_HForest_Castle (BP_ZT_TRV_HF) has the castle only. There the mansion query found
// nothing, the mission spawned the castle's trap alone and, once it was defended, sent the players to "Locate 2nd Storm
// Trap Location" for a trap that wasn't on the map (CoreV2 #133). So the first Trap the Storm is on the castle theme,
// and the region tiles of the forest theme roll every Hexsylvania mission but Trap the Storm (a tile's own weights).
const trapThemes = new Set([zoneThemes.castle, zoneThemes.castleB, zoneThemes.intro]);
const generatorsOn = (zoneTheme) => (trapThemes.has(zoneTheme) ? regionGenerators
  : regionGenerators.filter((path) => path !== generators.trapTheStorm));

const noRequirements = () => ({ commanderLevel: 0, personalPowerRating: 0, partyPowerRating: 0 });
const row = (rowName) => ({ dataTable: difficultyTable, rowName });
const everyLanguage = (text) => Object.fromEntries(["de", "ru", "ko", "zh-hant", "pt-br", "en", "it", "fr", "zh-cn", "es", "ar", "ja",
  "pl", "es-419", "tr"].map((language) => [language, text]));

function tile(tileType, x, y, zoneTheme, overrides = {}) {
  return {
    tileType, zoneTheme, requirements: noRequirements(), linkedQuests: [], xCoordinate: x, yCoordinate: y,
    missionWeightOverrides: (overrides.generators ?? (overrides.generator ? [overrides.generator] : []))
      .map((missionGenerator) => ({ missionGenerator, weight: 1 })),
    difficultyWeightOverrides: overrides.rowName ? [{ difficultyInfo: row(overrides.rowName), weight: 1 }] : [],
    canBeMissionAlert: tileType === "Normal", tileTags: { gameplayTags: [] }
  };
}

// The event quests a fixed tile's mission does, as tiles' LinkedQuests (world/quests.js linkedQuests for the main
// theaters): the Opener on Explore the Mist, TtS_Intro on the first Trap the Storm.
function eventLinks(read, tiles) {
  const quests = read("quests", {});
  tiles.forEach((candidate) => {
    const [only] = candidate.missionWeightOverrides;
    const [rowWeight] = candidate.difficultyWeightOverrides;
    if (candidate.missionWeightOverrides.length !== 1 || !rowWeight) return;
    candidate.linkedQuests = Object.keys(quests).filter((questId) => !quests[questId].deprecated && missionObjectives(questId)
      .some((objective) => objective.theaterTag === transylvania && missionMeets(objective, only.missionGenerator, rowWeight.difficultyInfo.rowName)))
      .flatMap((questId) => (questPath(questId) ? [{ questDefinition: questPath(questId) }] : []));
  });
}

const layout = perBuild((read) => {
  const { missionGenerators = {}, zoneThemes: themes = {}, difficulties = {} } = read("world", {});
  // A build without the event's content has no Hexsylvania.
  if (!Object.values(generators).every((path) => missionGenerators[path]) || !Object.values(zoneThemes).every((path) => themes[path])) return null;

  const tiles = [];
  const byCell = new Map();
  const add = (made) => {
    byCell.set(`${made.xCoordinate},${made.yCoordinate}`, tiles.length);
    tiles.push(made);
    return tiles.length - 1;
  };
  const lowestRow = regions[0].rows.find((rowName) => difficulties[rowName]);
  for (const fixed of fixedTiles) add(tile("AlwaysActive", fixed.x, fixed.y, fixed.zoneTheme, { generator: fixed.generator, rowName: lowestRow }));
  const missionRegions = regions.map((region, regionIndex) => {
    const indices = [];
    for (let y = region.y; y < region.y + 4; y += 1) {
      for (let x = region.x; x < region.x + 5; x += 1) {
        const existing = byCell.get(`${x},${y}`);
        const zoneTheme = spookyThemes[(x + y + regionIndex) % spookyThemes.length];
        const own = generatorsOn(zoneTheme);
        indices.push(existing ?? add(tile("Normal", x, y, zoneTheme, own.length < regionGenerators.length ? { generators: own } : {})));
      }
    }
    const gate = region.gate && questPath(region.gate);
    return {
      displayName: region.name,
      regionTags: { gameplayTags: [] },
      tileIndices: indices,
      missionData: {
        missionWeights: regionGenerators.map((missionGenerator) => ({ missionGenerator, weight: 1 })),
        difficultyWeights: region.rows.filter((rowName) => difficulties[rowName]).map((rowName) => ({ difficultyInfo: row(rowName), weight: 1 })),
        numMissionsAvailable: missionsPerRegion,
        numMissionsToChange: missionsPerRegion,
        missionChangeFrequency: 0.5
      },
      requirements: gate ? { ...noRequirements(), questDefinition: gate } : noRequirements()
    };
  });
  const filler = [];
  for (let y = 1; y <= 10; y += 1) {
    for (let x = 1; x <= 11; x += 1) {
      if (!byCell.has(`${x},${y}`)) filler.push(add(tile("NonMission", x, y, zoneThemes.forest)));
    }
  }
  eventLinks(read, tiles);

  return {
    data: {
      displayName: everyLanguage("Hexsylvania"),
      uniqueId: hexsylvaniaId,
      theaterSlot: 0,
      bIsTestTheater: false,
      // The Opener's own description.
      description: everyLanguage("Explore the mists of Hexsylvania"),
      runtimeInfo: {
        theaterType: "Standard",
        theaterTags: { gameplayTags: [{ tagName: transylvania }] },
        theaterVisibilityRequirements: noRequirements(),
        requirements: noRequirements(),
        worldMapPinClass: "/Game/Environments/WorldMap/Blueprints/WM_PinHalloween.WM_PinHalloween_C",
        theaterImage: "/Game/UI/Icons/Icon-Halloween-DirectAcquisition/Icon-Halloween-DirectAcquisition.Icon-Halloween-DirectAcquisition",
        // The Fortnitemares Llama's PackColor.
        theaterColorInfo: { bUseDifficultyToDetermineColor: false, color: { specifiedColor: { r: 1, g: 0.464813, b: 0.063542, a: 1 }, colorUseRule: "UseColor_Specified" } },
        // A globe socket no other theater uses (WM_Globe's StaticMeshSockets).
        socket: "Survival_Mode",
        missionAlertRequirements: noRequirements()
      },
      tiles,
      regions: [...missionRegions, {
        displayName: "Non Mission", regionTags: { gameplayTags: [] }, tileIndices: filler, requirements: noRequirements()
      }]
    },
    fixedMissions: []
  };
});

// Hexsylvania, when the requesting build runs Fortnitemares and has its content (a fresh copy: world info hands out
// the theater's objects).
export function hexsylvania() {
  if (!isEventActive(fortnitemares)) return null;
  const made = layout();
  return made && structuredClone(made);
}

export const isHexsylvania = (theaterId) => theaterId === hexsylvaniaId;

// Candy (EventCurrency_Candy, "Candy found during the Fortnitemares Event.") a won Hexsylvania mission adds to its
// rewards. No shipped table says how much (Epic's mission rewards were its world info's). Footage of a 2017 mission
// shows 50 Candy among its rewards (Core-Backend #66), so Core's (🟡) is 45 plus the zone's difficulty (50 in a 5 zone,
// 85 in a 40 one), before the reward chest's level multiplies it.
export function candyReward(rowName) {
  return 45 + difficultyOf(rowName);
}
