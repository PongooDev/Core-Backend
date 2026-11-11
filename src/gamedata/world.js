import { currentEventsConfig, isEventActive } from "../events/events.js";
import { miniBossesStay } from "../events/mutantstorms.js";
import { perBuild } from "./read.js";

// 4.2's (CL-4072250) Elemental Storm Mission Alerts (Core-Backend #277): "Elemental Storm Mission Alerts are now available.
// All elemental Husks in these zones will be locked to the zone's element. Each zone awards Elemental Perk currencies for
// their respective elements: FIRE-UP, AMP-UP, and FROST-UP. ... Quota: 2 each", and "Elemental Husks can be found in
// Plankerton or higher areas". 4.2's MissionAlertCategories has their three categories (ElemementalZoneFireCategory,
// ...NatureCategory, ...WaterCategory, Epic's spelling, quota 2 each, not repeatable) and its GameplayModifiers the zones'
// modifiers (ElementalZoneFireEnableItem, ...Nature..., ...Water...), but its MissionAlerts rows are cooked out of the
// client (tools/extractor: 4.2's rows are 4.0's), so the rows are Core's: one for each element in each zone from
// Plankerton (tile difficulty 12-21, 22-31, 32-50, as the other categories' rows), no event flag, the loot tier group
// MissionAlert_Elemental<Element> (world/theaters.js rewards) and the modifier group ElementalZone.<Element>.
export const elementalZones = [["Fire", "ElemementalZoneFireCategory"], ["Nature", "ElemementalZoneNatureCategory"],
  ["Water", "ElemementalZoneWaterCategory"]];
const elementalZoneRows = (world) => {
  const categories = world.missionAlertCategories ?? {};
  const rows = world.missionAlerts ?? [];
  return elementalZones.filter(([, category]) => categories[category] && !rows.some((row) => row.category === category))
    .flatMap(([element, category]) => [[12, 21], [22, 31], [32, 50]].map(([minimumDifficulty, maximumDifficulty], index) => ({
      category, lootTier: 0, lootTierGroup: `MissionAlert_Elemental${element}`, maximumDifficulty, minimumDifficulty, missionGenerator: "",
      modifierTierGroup: `ElementalZone.${element}`, name: `MissionAlert_${category}_0${index + 2}`, onlyUsedForSpreading: false,
      requiredEventFlag: "", spreadRowName: "", zoneThemes: [] })));
};
// 5.40's (CL-4352937) Mega Alerts (Core-Backend #317): "New Mega Alerts now show up on all group missions. A Mega Alert
// combines Elemental Storms with Mutant Storm modifiers, and has a Miniboss too! They may grant XP, evolution materials,
// perk materials, schematics or survivors. The amounts granted are considerably higher than normal Mission Alerts. These
// rewards can be earned 3 times every 24 hours." 5.40's MissionAlertCategories adds MegaAlertCategory (Priority 20, Quota
// 3, not repeatable, Stat.MissionAlert.MegaAlert, MissionAlert.Visual.MegaAlert: the storm icon and the storm swirl on
// the hex, BP_Hex_PARENT HandleMissionAlert and MissionAlertIndicator), but its MissionAlerts rows are cooked out of the
// client (its alert rows are 5.30's), so the rows are Core's: one a zone (tile difficulty 1-11, so Stonewood's first
// group missions too, 12-21, 22-31, 32-50), no event flag, the loot tier group MissionAlert_MegaAlert and the modifier
// group MegaAlert.ZoneMods_<zone> (world/theaters.js gives both their items). world/theaters.js keeps them to group missions.
export const megaAlertCategory = "MegaAlertCategory";
const megaAlertZones = [["Stonewood", 1, 11], ["Plankerton", 12, 21], ["CanneyValley", 22, 31], ["TwinePeaks", 32, 50]];
const megaAlertRows = (world) => {
  if (!world.missionAlertCategories?.[megaAlertCategory] || (world.missionAlerts ?? []).some((row) => row.category === megaAlertCategory)) return [];
  return megaAlertZones.map(([zone, minimumDifficulty, maximumDifficulty], index) => ({
    category: megaAlertCategory, lootTier: 0, lootTierGroup: "MissionAlert_MegaAlert", maximumDifficulty, minimumDifficulty, missionGenerator: "",
    modifierTierGroup: `MegaAlert.ZoneMods_${zone}`, name: `MissionAlert_${megaAlertCategory}_0${index + 1}`, onlyUsedForSpreading: false,
    requiredEventFlag: "", spreadRowName: "", zoneThemes: [] }));
};
const data = perBuild((read) => {
  const world = { difficulties: {}, missionAlerts: [], dailyMissionAlertQuota: 0, missionAlertCategories: {},
    missionAlertSpreads: {}, zoneThemes: {}, ...read("world", {}) };
  const added = [...elementalZoneRows(world), ...megaAlertRows(world)];
  return added.length ? { ...world, missionAlerts: [...world.missionAlerts, ...added] } : world;
});

export function getDifficulty(rowName) {
  return data().difficulties[rowName];
}

// The MissionAlerts row of a category (its CategoryRowName, a MissionAlertCategories row: GeneralCategory, StormCategory,
// StormLowCategory, HordeCategory, HalloweenCategory) a mission of this difficulty can carry an alert from, if any.
// Rows for an event flag Core doesn't run (EventFlag.FirstStorm's Storm rows, EventFlag.Horde's) and rows only used to
// spread storms are left out.
// 2.3's Mini-Boss rows still require EventFlag.Winter2017, which 2.3 doesn't run, but its notes keep them through the
// storms' return (events/mutantstorms.js miniBossesStay): Epic's servers placed the alerts, so Core reads the rows as
// on while those storms run. 2.4's and 2.4.2's wait for EventFlag.ActiveMiniBosses, which their storms run (events/events.js).
export function missionAlertTier(rowName, category = "GeneralCategory") {
  const difficulty = data().difficulties[rowName]?.difficulty;
  if (difficulty === undefined) return undefined;
  const flagOn = (row) => !row.requiredEventFlag || isEventActive(row.requiredEventFlag)
    || ((row.category ?? "GeneralCategory") === miniBossCategory && miniBossesStay());
  return data().missionAlerts.find((row) => (row.category ?? "GeneralCategory") === category && !row.onlyUsedForSpreading
    && flagOn(row) && difficulty >= row.minimumDifficulty && difficulty <= row.maximumDifficulty);
}

// 2.3's Mini-Boss quota: "Quota: 3 per day" (its data's MiniBossCategory row still says Survive the Holidays' 10; the
// quota was Epic's hotfix), while its storms run. 2.4's row still says 10 (its General row says 3), so 2.4 keeps it, and so does 2.4.2 (2.4's rows).
const miniBossCategory = "MiniBossCategory";
const stormsMiniBossQuota = 3;
const withMiniBossQuota = (rowName, cat) => (rowName === miniBossCategory && miniBossesStay() ? { ...cat, quota: stormsMiniBossQuota } : cat);

// A MissionAlerts row by name.
export function missionAlertRow(name) {
  return data().missionAlerts.find((row) => row.name === name);
}

export const dailyMissionAlertQuota = () => data().dailyMissionAlertQuota;

// From 1.7.2 an alert's category (a MissionAlertCategories row: GeneralCategory, StormCategory...) is an
// EFortMissionAlertCategory with its own daily quota, and the profile keeps the claims of each category apart
// (profiles/alerts.js). Cert and 1.2 have no categories: one quota (DailyMissionAlertQuota) for every alert. 2.2 has no
// enum: its category is the row's own name (CategoryRowName), which its record keys the claims by.
export const hasMissionAlertCategories = () => Object.keys(data().missionAlertCategories).length > 0;

// {category, quota, repeatable} of a MissionAlertCategories row.
export function missionAlertCategory(rowName) {
  const cat = data().missionAlertCategories[rowName];
  if (!cat) return undefined;
  if (rowName === "StormCategory") {
    const customQuota = currentEventsConfig()?.stormAlertQuota;
    if (Number.isInteger(customQuota) && customQuota >= 1) {
      return { ...cat, quota: customQuota };
    }
  }
  return withMiniBossQuota(rowName, cat);
}

export function missionAlertCategories() {
  const all = data().missionAlertCategories;
  const customQuota = currentEventsConfig()?.stormAlertQuota;
  const quotas = all[miniBossCategory] ? { ...all, [miniBossCategory]: withMiniBossQuota(miniBossCategory, all[miniBossCategory]) } : all;
  if (Number.isInteger(customQuota) && customQuota >= 1 && all.StormCategory) {
    return {
      ...quotas,
      StormCategory: { ...all.StormCategory, quota: customQuota }
    };
  }
  return quotas;
}

// A MissionAlertSpreadDatas row (1.9.1's Mutant Storms): {chanceToSpread, totalChancesToSpread, maxNumTilesToSpreadTo,
// spreadInterval (minutes), missionAlertRowName}.
export function missionAlertSpread(name) {
  return data().missionAlertSpreads[name];
}

// The outpost item a storm shield zone theme belongs to (its CloudSaveItemDefinition), if it is one.
export function zoneOutpost(zoneTheme) {
  return data().zoneThemes[zoneTheme]?.cloudSaveItem;
}
