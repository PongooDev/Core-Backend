import crypto from "node:crypto";
import { hordeFlag, isEventActive } from "../events/events.js";
import { perBuild } from "../gamedata/read.js";
import { questPath } from "./quests.js";

// Challenge the Horde's theater (5.0, CL-4204761 and CL-4214610, Road Trip: events/roadtrip2018.js, Core-Backend #298).
// Update v5.00: "Challenge the Horde comes to the desert! This map focuses on a tighter experience, with less running from
// base to base between waves", "Reduced the total number of Challenge the Horde missions available on the map from 16 to
// 9", and "Challenge the Horde missions now become unlocked based upon your Storm Shield Defense progression or your Horde
// Quest progression in the Campaign. This means that players who are currently playing in Twine Peaks can expect the
// entire Challenge the Horde map to be unlocked. However, individual challenges within a Horde mission must still be
// unlocked in order." 5.0 ships what the map is made of:
// - nine zone themes, World/ZoneThemes/Horde's BP_ZT_ChallengeTheHorde_SW_H, _SW_VH, _Plank_VL, _Plank_M, _Plank_VH,
//   _Canny_VL, _Canny_M, _Canny_VH and _Twine ("Tier 1" to "Tier 4", the desert tile BP_Hex_Arid01, the map
//   Maps/Horde/HordeProto_003, BP_DeployableBaseGameMode, each with its TieredCollectionLayout: SW_Hard_Layout...
//   Twine_Infinite_Layout), and BP_ZT_BuildTheBase_Desert ("Fort Setup", BP_Hex_BuildTheBase_Desert);
// - the missions MissionGen_ChallengeTheHorde (MissionInfo_ChallengeTheHorde, Stat.Mission.Primary.Horde: what every
//   HordeQuest_Progression objective counts) and MissionGen_BuildTheBase ("Build the Fort": MissionInfo_BuildTheBase,
//   HordeQuest_BuildBase's);
// - the difficulty rows, GameDifficultyGrowthBounds' Theater_Horde_*: the nine zones' powers 9, 15, 19, 28, 40, 46, 58, 70
//   and 76 (Stonewood_High, _VeryHigh, Plankerton_VeryLow, _Medium, _VeryHigh, Uncanny_VeryLow, _Medium, _VeryHigh and
//   Final), the progression quests' "9+ Power zone" to "76+" (their stat rows' Zone.Difficulty 7 to 32);
// - the zone gates, HordeQuest_Hidden_0 to _7: each done by a Storm Shield Defense (OutpostQuest_T1_L4 ... T4_L1) or a
//   Horde progression quest (Stonewood_1 ... Canny_5), one of the two (ObjectiveCompletionCount 1);
// - the map pin WM_PinHorde and the Horde alerts' category, MissionAlertCategories' HordeCategory (quota 10, repeatable;
//   its MissionAlerts row requires EventFlag.Horde).
// No theater layout ships with the client and the world info the other theaters come from (tools/theaters) has no Horde
// theater, so the layout is Core's (🟡), as Survive the Storm's (world/survival.js): a row of the nine zones, each a region
// of one tile hosting its Challenge the Horde mission every day, the first open and each later one behind its hidden gate
// quest, and the Fort Setup tile before them; the theater opens with Storm Shield Defense 3 (OutpostQuest_T1_L3), the
// quest of the Horde Skill Tree's first node (T1_Horde_99587FCCD, which HordeQuest_HordeUnlock asks for). 5.0's globe has
// no Horde socket, so the theater sits in Survive the Storm's (Survival_Mode), which 5.0 doesn't run.
// The theater is in world info while the requesting build serves EventFlag.Horde.
export const hordeId = crypto.createHash("sha1").update("Core:ChallengeTheHorde").digest("hex").slice(0, 32).toUpperCase();

const theme = (path) => `/Game/World/ZoneThemes/Horde/${path}.${path.split("/").pop()}_C`;
const generator = (name) => `/Game/World/MissionGens/${name}.${name}_C`;
export const hordeGenerators = { horde: generator("MissionGen_ChallengeTheHorde"), fort: generator("MissionGen_BuildTheBase") };
const fortTheme = theme("BP_ZT_BuildTheBase_Desert");
const pin = "/Game/Environments/WorldMap/Blueprints/WM_PinHorde.WM_PinHorde_C";
const image = "/Game/2dAssets/Loadingscreens/Season5/T-LS-StW-Horde.T-LS-StW-Horde";
const difficultyTable = "/Game/Balance/DataTables/GameDifficultyGrowthBounds.GameDifficultyGrowthBounds";
const theaterGate = "outpostquest_t1_l3";

// The nine zones, in order, each with its gate (none for the first).
export const hordeZones = [
  { theme: theme("Stonewood/BP_ZT_ChallengeTheHorde_SW_H"), rowName: "Theater_Horde_Stonewood_High" },
  { theme: theme("Stonewood/BP_ZT_ChallengeTheHorde_SW_VH"), rowName: "Theater_Horde_Stonewood_VeryHigh", gate: "hordequest_hidden_0" },
  { theme: theme("Plankerton/BP_ZT_ChallengeTheHorde_Plank_VL"), rowName: "Theater_Horde_Plankerton_VeryLow", gate: "hordequest_hidden_1" },
  { theme: theme("Plankerton/BP_ZT_ChallengeTheHorde_Plank_M"), rowName: "Theater_Horde_Plankerton_Medium", gate: "hordequest_hidden_2" },
  { theme: theme("Plankerton/BP_ZT_ChallengeTheHorde_Plank_VH"), rowName: "Theater_Horde_Plankerton_VeryHigh", gate: "hordequest_hidden_3" },
  { theme: theme("Canny/BP_ZT_ChallengeTheHorde_Canny_VL"), rowName: "Theater_Horde_Uncanny_VeryLow", gate: "hordequest_hidden_4" },
  { theme: theme("Canny/BP_ZT_ChallengeTheHorde_Canny_M"), rowName: "Theater_Horde_Uncanny_Medium", gate: "hordequest_hidden_5" },
  { theme: theme("Canny/BP_ZT_ChallengeTheHorde_Canny_VH"), rowName: "Theater_Horde_Uncanny_VeryHigh", gate: "hordequest_hidden_6" },
  { theme: theme("Twinepeaks/BP_ZT_ChallengeTheHorde_Twine"), rowName: "Theater_Horde_Final", gate: "hordequest_hidden_7" }
];
// The Fort Setup mission's row (🟡 Core's: the fort is built at no threat), the first zone's lowest, and no rewards: building
// the fort is HordeQuest_BuildBase's (150 tickets).
const fortRow = "Theater_Horde_Stonewood_VeryLow";

// 5.21's (CL-4288479) Weekly Horde Challenges (Update v5.20 and v5.21; events/roadtrip2018.js): each week's mission,
// MissionGen_WeeklyHordeChallenge_0<n>, in four zones, World/ZoneThemes/Horde/Challenges' week's themes (week 1's
// MiniBossArmy, "Minibosses"; week 2's RangeImmune, "Bullet Proof Husks": "bulletproof enemies that must be defeated with
// melee weapons, traps, or Hero abilities") at the Theater_Horde_*_Weekly rows (15, 28, 58 and 76 power). 🟡 The layout is
// Core's, as the nine zones': the Stonewood one opens with the theater (Storm Shield Defense 3, the week's hidden quest's
// objective), and the Plankerton, Canny Valley and Twine Peaks ones with the nine zones' gates to those tiers
// (HordeQuest_Hidden_1, _4 and _7). Update v5.21's "Removed the Power Rating restrictions on Challenge the Horde missions"
// is Core's already: no Horde mission has power requirements.
const weeklyGenerator = (week) => generator(`MissionGen_WeeklyHordeChallenge_0${week}`);
const weeklyNames = { 1: "Minibosses", 2: "Bullet Proof Husks" };
const weeklyThemes = { 1: "MiniBossArmy", 2: "RangeImmune" };
const weeklyZones = (week) => [["SW", "Stonewood", null], ["Plank", "Plankerton", "hordequest_hidden_1"], ["Canny", "Uncanny", "hordequest_hidden_4"],
  ["Twine", "Final", "hordequest_hidden_7"]].map(([themeTier, rowTier, gate]) => ({
  theme: theme(`Challenges/${weeklyThemes[week]}/BP_ZT_ChallengeTheHorde_Challenge_${weeklyThemes[week]}_${themeTier}`),
  rowName: `Theater_Horde_${rowTier}_Weekly`, gate
}));

const noRequirements = () => ({ commanderLevel: 0, personalPowerRating: 0, partyPowerRating: 0 });
const everyLanguage = (text) => Object.fromEntries(["de", "ru", "ko", "zh-hant", "pt-br", "en", "it", "fr", "zh-cn", "es", "ar", "ja",
  "pl", "es-419", "tr"].map((language) => [language, text]));
const withQuest = (questId) => {
  const questDefinition = questId && questPath(questId);
  return questDefinition ? { ...noRequirements(), questDefinition } : noRequirements();
};

function tile(tileType, zoneTheme, x, y, canBeMissionAlert) {
  return {
    tileType, zoneTheme, requirements: noRequirements(), linkedQuests: [], xCoordinate: x, yCoordinate: y,
    missionWeightOverrides: [], difficultyWeightOverrides: [], canBeMissionAlert, tileTags: { gameplayTags: [] }
  };
}

const layout = perBuild((read) => {
  const { missionGenerators = {}, zoneThemes = {}, difficulties = {}, mapPins = [] } = read("world", {});
  // A build without 5.0's desert horde (1.7.2's Horde Bash had other themes and generators' rows) has no Horde theater.
  if (!Object.values(hordeGenerators).every((path) => missionGenerators[path]) || !zoneThemes[fortTheme] || !mapPins.includes(pin)
    || !hordeZones.every((zone) => zoneThemes[zone.theme] && difficulties[zone.rowName]) || !difficulties[fortRow]) return null;

  // The fort at the row's start, then the nine zones across two rows of a 7x3 map.
  const tiles = [tile("AlwaysActive", fortTheme, 1, 2, false)];
  const fixedMissions = [{ tileIndex: 0, missionGenerator: hordeGenerators.fort,
    missionDifficultyInfo: { dataTable: difficultyTable, rowName: fortRow }, tierGroupName: "" }];
  const regions = [{ displayName: "Fort Setup", regionTags: { gameplayTags: [] }, tileIndices: [0], requirements: noRequirements() }];
  hordeZones.forEach((zone, index) => {
    const tileIndex = tiles.push(tile("AlwaysActive", zone.theme, 2 + Math.floor(index / 2), 1 + 2 * (index % 2) + (index === 8 ? 1 : 0), true)) - 1;
    fixedMissions.push({ tileIndex, missionGenerator: hordeGenerators.horde,
      missionDifficultyInfo: { dataTable: difficultyTable, rowName: zone.rowName }, tierGroupName: difficulties[zone.rowName].lootTierGroup ?? "" });
    regions.push({ displayName: `${zoneThemes[zone.theme].name ?? "Challenge the Horde"} (${difficulties[zone.rowName].recommendedRating}+)`,
      regionTags: { gameplayTags: [] }, tileIndices: [tileIndex], requirements: withQuest(zone.gate) });
  });
  // The week's Weekly Horde Challenge (events/roadtrip2018.js), when the build's data has it: its four zones in a row below
  // the nine, each a region of one tile hosting the week's mission every day.
  const week = [2, 1].find((candidate) => missionGenerators[weeklyGenerator(candidate)]
    && weeklyZones(candidate).every((zone) => zoneThemes[zone.theme] && difficulties[zone.rowName]));
  for (const [index, zone] of (week ? weeklyZones(week) : []).entries()) {
    const tileIndex = tiles.push(tile("AlwaysActive", zone.theme, 2 + index, 5, false)) - 1;
    fixedMissions.push({ tileIndex, missionGenerator: weeklyGenerator(week),
      missionDifficultyInfo: { dataTable: difficultyTable, rowName: zone.rowName }, tierGroupName: difficulties[zone.rowName].lootTierGroup ?? "" });
    regions.push({ displayName: `Weekly Horde Challenge: ${weeklyNames[week]} (${difficulties[zone.rowName].recommendedRating}+)`,
      regionTags: { gameplayTags: [] }, tileIndices: [tileIndex], requirements: withQuest(zone.gate) });
  }

  return {
    data: {
      displayName: everyLanguage("Challenge the Horde"),
      uniqueId: hordeId,
      theaterSlot: 0,
      bIsTestTheater: false,
      // The missions' own description (MissionGen_ChallengeTheHorde's MissionDescription).
      description: everyLanguage("Defend your deployable forts from the unrelenting horde!"),
      runtimeInfo: {
        theaterType: "Standard",
        theaterTags: { gameplayTags: [] },
        theaterVisibilityRequirements: noRequirements(),
        requirements: withQuest(theaterGate),
        worldMapPinClass: pin,
        theaterImage: image,
        theaterColorInfo: { bUseDifficultyToDetermineColor: false, color: { specifiedColor: { r: 0.85, g: 0.45, b: 0.15, a: 1 }, colorUseRule: "UseColor_Specified" } },
        socket: "Survival_Mode",
        missionAlertRequirements: noRequirements()
      },
      tiles,
      regions
    },
    fixedMissions
  };
});

// The Horde theater, when the requesting build serves EventFlag.Horde and has 5.0's horde (a fresh copy: world info hands
// out the theater's objects).
export function hordeTheater() {
  if (!isEventActive(hordeFlag)) return null;
  const made = layout();
  return made ? structuredClone(made) : null;
}

export const isHorde = (theaterId) => theaterId === hordeId;
export const isHordeTierGroup = (tierGroupName) => /^HordeBash_/.test(tierGroupName ?? "");
