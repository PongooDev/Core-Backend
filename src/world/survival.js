import crypto from "node:crypto";
import { isEventActive, winter2017 } from "../events/events.js";
import { perBuild } from "../gamedata/read.js";
import { questPath } from "./quests.js";

// Survive the Storm, Survive the Holidays' theater (1.11, CL-3807424; Core-Backend #172). The event's map was a theater
// of its own on the world map, beside the campaign's, and 1.11 ships what it is made of:
// - the event's quests ask for its missions: WinterQuest_2017_CompleteSurviveAny (complete_survivalmode_any:
//   Stat.Mission.Survival.Survival in Stat.Theater.Survival) and CompleteSurvive7Day_D1-D3
//   (complete_survivalmode_pve0<n>_7day: Stat.Mission.Survival.Survival7Day in Stat.Theater.Survival.Difficulty0<n>,
//   Zone.Difficulty >= 10, 20, 30), and nothing else is tagged Stat.Theater.Survival;
// - its difficulties: GameDifficultyGrowthBounds' Theater_Survival_Start_Zone5 (difficulty 10, 15 power),
//   Theater_Survival_Normal_Zone5 (20, 40) and Theater_Survival_Hard_Zone5 (30, 70), the three the quests ask for;
// - its missions: MissionGen_Survival_3Day and MissionGen_Survival_7Day ("Survive the Storm: 3 Days" / "7 Days", "Create
//   a diversion for the Storm", FortniteSurvival3Day/7Day_NoVote, loading screen FORT_Load_SurviveTheStorm_Winter);
// - its zone: BP_ZT_Survival (Zone_Survival_Winter_Temperate, the snowed-in map tile BP_Hex_TheForestWinter);
// - its alerts: MissionAlertCategories Survival3DayCategory (3 a day) and Survival7DayCategory (1 a day), whose
//   MissionAlerts rows (MissionAlert_Survival3DayCategory_01, _Survival7DayCategory_01) require EventFlag.Winter2017;
// - its pin and button: WM_PinHoliday (new in 1.11, beside WM_PinHalloween), T-Button-WinterHoliday-Mode, and the globe
//   socket Survival_Mode (WM_Globe's).
// No theater layout ships with the client and the world info the other theaters come from (tools/theaters) has no
// Survival theater, so the layout is Core's (🟡), as Hexsylvania's (world/hexsylvania.js): a region per difficulty
// (tagged Stat.Theater.Survival.Difficulty0<n>, what the 7 Day quests' objectives name), the later two opening with the
// campaign, as Hexsylvania's: Normal after Stonewood's Launch the Rocket, Hard after Plankerton's.
// The theater is only in world info while the event runs on the requesting build.
export const survivalTag = "Stat.Theater.Survival";
export const survivalId = crypto.createHash("sha1").update("Core:SurviveTheStorm").digest("hex").slice(0, 32).toUpperCase();

const zoneTheme = "/Game/World/ZoneThemes/FortniteSurvival/BP_ZT_Survival.BP_ZT_Survival_C";
const pin = "/Game/Environments/WorldMap/Blueprints/WM_PinHoliday.WM_PinHoliday_C";
export const survivalGenerators = {
  threeDay: "/Game/World/MissionGens/MissionGen_Survival_3Day.MissionGen_Survival_3Day_C",
  sevenDay: "/Game/World/MissionGens/MissionGen_Survival_7Day.MissionGen_Survival_7Day_C"
};
// Each alert category goes on its own missions: a 3 Day alert on a 3 Day mission, a 7 Day one on a 7 Day mission (the
// rows name no generator; Core's reading of the category names).
export const survivalAlertGenerators = {
  Survival3DayCategory: survivalGenerators.threeDay,
  Survival7DayCategory: survivalGenerators.sevenDay
};
const difficultyTable = "/Game/Balance/DataTables/GameDifficultyGrowthBounds.GameDifficultyGrowthBounds";

// Three 4x3 blocks of mission tiles side by side on a 14x5 map, with non-mission tiles around them.
const regions = [
  { name: "Survival_Start", rowName: "Theater_Survival_Start_Zone5", tag: `${survivalTag}.Difficulty01`, x: 1 },
  { name: "Survival_Normal", rowName: "Theater_Survival_Normal_Zone5", tag: `${survivalTag}.Difficulty02`, x: 6, gate: "stonewoodquest_launchrocket_d5" },
  { name: "Survival_Hard", rowName: "Theater_Survival_Hard_Zone5", tag: `${survivalTag}.Difficulty03`, x: 10, gate: "plankertonquest_launchrocket_d5" }
];
const width = 14;
const height = 5;
const missionsPerRegion = 6;

const noRequirements = () => ({ commanderLevel: 0, personalPowerRating: 0, partyPowerRating: 0 });
const everyLanguage = (text) => Object.fromEntries(["de", "ru", "ko", "zh-hant", "pt-br", "en", "it", "fr", "zh-cn", "es", "ar", "ja",
  "pl", "es-419", "tr"].map((language) => [language, text]));

function tile(tileType, x, y) {
  return {
    tileType, zoneTheme, requirements: noRequirements(), linkedQuests: [], xCoordinate: x, yCoordinate: y,
    missionWeightOverrides: [], difficultyWeightOverrides: [], canBeMissionAlert: tileType === "Normal", tileTags: { gameplayTags: [] }
  };
}

const layout = perBuild((read) => {
  const { missionGenerators = {}, zoneThemes = {}, difficulties = {}, mapPins = [] } = read("world", {});
  // A build without the event's content (1.10 has the missions but no holiday pin) has no Survival theater.
  if (!Object.values(survivalGenerators).every((path) => missionGenerators[path]) || !zoneThemes[zoneTheme]
    || !mapPins.includes(pin) || !regions.every((region) => difficulties[region.rowName])) return null;

  const tiles = [];
  const taken = new Set();
  const missionRegions = regions.map((region) => {
    const indices = [];
    for (let y = 2; y < 5; y += 1) {
      for (let x = region.x; x < region.x + 4; x += 1) {
        taken.add(`${x},${y}`);
        indices.push(tiles.push(tile("Normal", x, y)) - 1);
      }
    }
    const gate = region.gate && questPath(region.gate);
    return {
      displayName: region.name,
      regionTags: { gameplayTags: [{ tagName: region.tag }] },
      tileIndices: indices,
      missionData: {
        missionWeights: Object.values(survivalGenerators).map((missionGenerator) => ({ missionGenerator, weight: 1 })),
        difficultyWeights: [{ difficultyInfo: { dataTable: difficultyTable, rowName: region.rowName }, weight: 1 }],
        numMissionsAvailable: missionsPerRegion,
        numMissionsToChange: missionsPerRegion,
        missionChangeFrequency: 0.5
      },
      requirements: gate ? { ...noRequirements(), questDefinition: gate } : noRequirements()
    };
  });
  const filler = [];
  for (let y = 1; y <= height; y += 1) {
    for (let x = 1; x <= width; x += 1) {
      if (!taken.has(`${x},${y}`)) filler.push(tiles.push(tile("NonMission", x, y)) - 1);
    }
  }

  return {
    data: {
      displayName: everyLanguage("Survive the Storm"),
      uniqueId: survivalId,
      theaterSlot: 0,
      bIsTestTheater: false,
      // The missions' own description.
      description: everyLanguage("Create a diversion for the Storm"),
      runtimeInfo: {
        theaterType: "Standard",
        theaterTags: { gameplayTags: [{ tagName: survivalTag }] },
        theaterVisibilityRequirements: noRequirements(),
        requirements: noRequirements(),
        worldMapPinClass: pin,
        theaterImage: "/Game/UI/Foundation/Textures/Buttons/T-Button-WinterHoliday-Mode.T-Button-WinterHoliday-Mode",
        // The Holiday Survival Llama's PackColor.
        theaterColorInfo: { bUseDifficultyToDetermineColor: false, color: { specifiedColor: { r: 1, g: 0.464813, b: 0.063542, a: 1 }, colorUseRule: "UseColor_Specified" } },
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

// The Survive the Storm theater, when the requesting build runs Survive the Holidays and has its content (a fresh
// copy: world info hands out the theater's objects).
export function survivalTheater() {
  if (!isEventActive(winter2017)) return null;
  const made = layout();
  return made ? structuredClone(made) : null;
}

export const isSurvival = (theaterId) => theaterId === survivalId;

// A Survive the Storm mission's reward: the "Survival Rewards" pack of its difficulty's loot tier group
// (Mission_Select_Survival_T0<n> -> ZCP_Survival_T0<n>, "Storm Coins and rare items based on how long you survive!").
export function survivalReward(tierGroupName) {
  const tier = /^Mission_Select_Survival_T(\d\d)$/.exec(tierGroupName ?? "");
  return tier ? { itemType: `CardPack:zcp_survival_t${tier[1]}`, quantity: 1 } : undefined;
}
