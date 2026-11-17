import crypto from "node:crypto";
import { frostnite2018, frostniteTheaterSlot, frostniteWeekNow, frostniteWeeks } from "../events/frostnite2018.js";
import { isEventActive } from "../events/events.js";
import { perBuild } from "../gamedata/read.js";
import { questPath } from "./quests.js";

// Frostnite's theater (7.10, CL-4667333; events/frostnite2018.js, Core-Backend for CoreV2 #478). 7.10 ships what it is
// made of:
// - the mission, MissionGen_Endless ("Frostnite", "Survive the Night": MissionInfo_Endless, Mission_Endless, a tiered
//   waves mission whose Burner, EndlessMainGenerator, the players keep fed with BluGlo; its secondaries the BluGlo nodes,
//   Whack-a-Troll, rifts, the BluGlo memo and Exploration; its tertiaries the Mimics, the four Lone Krampus targets
//   (MissionInfo_LoneWolf: SpawnGroups/PvE/Endless/LoneWolf_Krampus) and the badges);
// - its zone, BP_ZT_Endless_Winter ("Frostnite", "Battle the frozen horde and keep your BluGlo furnace burning bright":
//   Maps/Zones/Events/Winter2018/Zone_Endless_Winter_Polar, Endless_GameMode, teams of 4, the snowed-in tile
//   BP_Hex_TheForestWinter);
// - its difficulties, GameDifficultyGrowthBounds' Theater_Endless_*: Start_Zone5 (15 power), Normal_Zone3 and _Zone5 (28,
//   40), Hard_Zone3 and _Zone5 (58, 70), Nightmare_Zone3 and _Zone5 (88, 100), each its loot tier group
//   Mission_Select_Endless_T01-T07, whose reward is the Frostnite Rewards pack of that tier (ZCP_Endless_T01-T07); 7.20
//   adds Endgame_Zone5 (128, T08: "a new Power Level 128 zone for end-game players ... available to players who have
//   reached the end of Twine Peaks");
// - the weekly challenges' missions (MissionGen_Endless_Challenge_*, events/frostnite2018.js frostniteWeeks);
// - the quests' context: every Frostnite stat row counts Stat.Theater.Endless, a week's challenge Stat.Theater.Endless.Week0<n>.
// No theater layout ships with the client and the world info the other theaters come from (tools/theaters) predates it, so
// the layout is Core's (🟡), as Survive the Storm's and Challenge the Horde's (world/survival.js, world/horde.js): a row of
// the zones, each a region of one tile hosting its Frostnite mission every day, and below it the week's challenge, a tile
// at each band's top difficulty (the Zone5 rows) in a region carrying the week's tag. The theater carries
// Stat.Theater.Endless, which a week's tag is a child of, so a challenge counts for the Frostnite quests too. Zones open
// with the campaign as Survive the Storm's: Normal after Stonewood's Launch the Rocket, Hard after Plankerton's, Nightmare
// after Canny Valley's, Endgame after Twine Peaks' last Storm Shield Defense (🟡 Update v7.20 "Changed which Storm Shield
// Defense quests unlock the Frostnite zones": 7.10's gates were Storm Shield Defenses, which aren't recorded). The globe's
// socket is Survive the Storm's (Survival_Mode, which 7.10 doesn't run), the pin the holiday one, the button
// T-EventButton-Frostnite (in 7.20's paks; 🟡 7.10's not opened). The theater is only in world info while the requesting
// build runs Frostnite.
export const frostniteTag = "Stat.Theater.Endless";
export const frostniteId = crypto.createHash("sha1").update("Core:Frostnite").digest("hex").slice(0, 32).toUpperCase();

export const frostniteZoneTheme = "/Game/World/ZoneThemes/Endless/BP_ZT_Endless_Winter.BP_ZT_Endless_Winter_C";
const generator = (name) => `/Game/World/MissionGens/${name}.${name}_C`;
export const frostniteGenerator = generator("MissionGen_Endless");
const pin = "/Game/Environments/WorldMap/Blueprints/WM_PinHoliday.WM_PinHoliday_C";
const image = "/Game/UI/Frontend/Campaign/Textures/T-EventButton-Frostnite.T-EventButton-Frostnite";
const difficultyTable = "/Game/Balance/DataTables/GameDifficultyGrowthBounds.GameDifficultyGrowthBounds";

// The band of a Theater_Endless_<band>_Zone<n> row, and the quest that opens it.
const bandGates = { Start: null, Normal: "stonewoodquest_launchrocket_d5", Hard: "plankertonquest_launchrocket_d5",
  Nightmare: "cannyvalleyquest_launchrocket_d5", Endgame: "outpostquest_t4_l10" };
const bandOf = (rowName) => /^Theater_Endless_([A-Za-z]+)_Zone\d$/.exec(rowName)?.[1] ?? null;

const noRequirements = () => ({ commanderLevel: 0, personalPowerRating: 0, partyPowerRating: 0 });
const everyLanguage = (text) => Object.fromEntries(["de", "ru", "ko", "zh-hant", "pt-br", "en", "it", "fr", "zh-cn", "es", "ar", "ja",
  "pl", "es-419", "tr"].map((language) => [language, text]));
const withQuest = (questId) => {
  const questDefinition = questId && questPath(questId);
  return questDefinition ? { ...noRequirements(), questDefinition } : noRequirements();
};
const tagged = (tag) => ({ gameplayTags: tag ? [{ tagName: tag }] : [] });

function tile(x, y) {
  return {
    tileType: "AlwaysActive", zoneTheme: frostniteZoneTheme, requirements: noRequirements(), linkedQuests: [], xCoordinate: x, yCoordinate: y,
    missionWeightOverrides: [], difficultyWeightOverrides: [], canBeMissionAlert: false, tileTags: { gameplayTags: [] }
  };
}

const layout = perBuild((read) => {
  const { missionGenerators = {}, zoneThemes = {}, difficulties = {}, mapPins = [] } = read("world", {});
  const objectiveStats = read("objectivestats", {});
  // A build without Frostnite (7.00 has the rows, not the mission or the zone) has no Frostnite theater.
  if (!missionGenerators[frostniteGenerator] || !zoneThemes[frostniteZoneTheme] || !mapPins.includes(pin)) return null;
  const zones = Object.entries(difficulties)
    .filter(([rowName]) => bandOf(rowName) in bandGates)
    .sort(([, a], [, b]) => (a.recommendedRating ?? 0) - (b.recommendedRating ?? 0))
    .map(([rowName, row]) => ({ rowName, row, gate: bandGates[bandOf(rowName)] }));
  if (!zones.length) return null;

  const tiles = [];
  const fixedMissions = [];
  const regions = [];
  const host = (missionGenerator, zone, x, y) => {
    const tileIndex = tiles.push(tile(x, y)) - 1;
    fixedMissions.push({ tileIndex, missionGenerator, missionDifficultyInfo: { dataTable: difficultyTable, rowName: zone.rowName },
      tierGroupName: zone.row.lootTierGroup ?? "" });
    return tileIndex;
  };
  zones.forEach((zone, index) => {
    const tileIndex = host(frostniteGenerator, zone, 1 + index, 2);
    regions.push({ displayName: `Frostnite (${zone.row.recommendedRating}+)`, regionTags: tagged(null), tileIndices: [tileIndex],
      requirements: withQuest(zone.gate) });
  });
  // Each week's challenge the build's data has, under its bands' top zones (the Zone5 rows).
  const tops = zones.map((zone, index) => ({ zone, x: 1 + index })).filter(({ zone }) => /_Zone5$/.test(zone.rowName));
  const weeks = Object.fromEntries(frostniteWeeks.filter(({ generator: name }) => missionGenerators[generator(name)]).map(({ week, name, generator: missionName }) => {
    const tag = objectiveStats[`winterquest_2018_frostnite_challenge_0${week}_minor`]?.contextTags || `${frostniteTag}.Week0${week}`;
    return [week, { tag, zones: tops.map(({ zone, x }) => ({ zone, x, name, missionGenerator: generator(missionName) })) }];
  }));

  return {
    data: {
      displayName: everyLanguage("Frostnite"),
      uniqueId: frostniteId,
      // Its own backpack, theater1 (events/frostnite2018.js).
      theaterSlot: frostniteTheaterSlot,
      bIsTestTheater: false,
      // The zone's own description (BP_ZT_Endless_Winter's ZoneDescription).
      description: everyLanguage("Battle the frozen horde and keep your BluGlo furnace burning bright."),
      runtimeInfo: {
        theaterType: "Standard",
        theaterTags: tagged(frostniteTag),
        theaterVisibilityRequirements: noRequirements(),
        requirements: noRequirements(),
        worldMapPinClass: pin,
        theaterImage: image,
        theaterColorInfo: { bUseDifficultyToDetermineColor: false, color: { specifiedColor: { r: 0.25, g: 0.62, b: 1, a: 1 }, colorUseRule: "UseColor_Specified" } },
        socket: "Survival_Mode",
        missionAlertRequirements: noRequirements()
      },
      tiles,
      regions
    },
    fixedMissions,
    weeks
  };
});

// The week's challenge zones added to a theater's tiles, regions and missions.
function withWeek(theater, { tag, zones }) {
  for (const { zone, x, name, missionGenerator } of zones) {
    const tileIndex = theater.data.tiles.push(tile(x, 4)) - 1;
    theater.fixedMissions.push({ tileIndex, missionGenerator, missionDifficultyInfo: { dataTable: difficultyTable, rowName: zone.rowName },
      tierGroupName: zone.row.lootTierGroup ?? "" });
    theater.data.regions.push({ displayName: `Weekly Frostnite Challenge: ${name} (${zone.row.recommendedRating}+)`, regionTags: tagged(tag),
      tileIndices: [tileIndex], requirements: withQuest(zone.gate) });
  }
  return theater;
}

// The Frostnite theater, when the requesting build runs Frostnite and has its content (a fresh copy: world info hands out
// the theater's objects), with the week's challenge once one runs (events/frostnite2018.js).
export function frostniteTheater(now = new Date()) {
  if (!isEventActive(frostnite2018)) return null;
  const made = layout();
  if (!made) return null;
  const theater = structuredClone({ data: made.data, fixedMissions: made.fixedMissions });
  const week = frostniteWeekNow(now, (name) => Boolean(made.weeks[frostniteWeeks.find((candidate) => candidate.generator === name)?.week]));
  return week ? withWeek(theater, structuredClone(made.weeks[week.week])) : theater;
}

export const isFrostnite = (theaterId) => theaterId === frostniteId;

// A Frostnite mission's reward: the Frostnite Rewards pack of its difficulty's loot tier group (Mission_Select_Endless_T0<n>
// -> ZCP_Endless_T0<n>).
export function frostniteReward(tierGroupName) {
  const tier = /^Mission_Select_Endless_T(\d\d)$/.exec(tierGroupName ?? "");
  return tier ? { itemType: `CardPack:zcp_endless_t${tier[1]}`, quantity: 1 } : undefined;
}
