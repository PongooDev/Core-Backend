import { currentBuild } from "../builds/context.js";
import { currentEventsConfig } from "./events.js";

// Siphon and the material changes in Solo, Duos and Squads (PongooDev/CoreV2#557): Update v7.40 (14 February 2019) brought
// the Pop-up Cup's rules to the default playlists ("50 shield or health back on kills ... 50 units of each material ... only
// 500 units of each resource ... resources 40 percent faster"), and Update v8.20 (27 March 2019) took them out of every
// core mode, keeping them in the new Arena. All of it is the paks' data, read on the gameserver:
// - GAS_DefaultPlayer grants GA_SiphonEffect_OnKillGrant. It triggers on Event.EarnedElimination (CoreV2 sends it from the
//   restored death handler, the game's sender being stripped) and reads AthenaGameData's Default.Siphon rows: Enabled (1
//   for anything), HealAmount (health, the rest shield), GrantMatsOnKillEnabled and GrantWood/Stone/MetalOnKill.
// - The cap is the ItemMaxStack attribute: on 7.40 the default playlists' ResourceCapModifier_DefaultSolos/Duos/Squads with
//   Default.MaxStack.Resources.Solos/Duos/Squads.* rows; from 8.00 GAS_DefaultPlayer's GE_DefaultResourceCap with
//   Default.MaxStack.Resources.Wood/Stone/Metal.
// - Harvesting is AthenaResourceRates (Athena/Balance/DataTables), which a playlist without ResourceRates of its own (the
//   default ones) plays; the Pop-up Cup's own table (Athena/Playlists/Showdown/AthenaResourceRates) is it times 1.4.
// What each build ships, and so what Epic's hotfix must have set:
// - 7.40 (CL-5046157): Siphon.Enabled 0, the caps 999, the base rates, so its paks are pre-change; GrantMatsOnKillEnabled 1
//   and the 50s are in. The notes' change came by hotfix, with the Pop-up Cup's values from the same build (its
//   Showdown/OverrideGameData: Enabled 1, the caps 500; its rates table): those rows are served here.
// - 8.00 (CL-5203069): Enabled 1, HealAmount 50, GE_DefaultResourceCap's 500 and the 1.4 rates are in its paks, but
//   GrantMatsOnKillEnabled is 0 and the default playlists drop nothing. v8.20's notes revert the elimination materials
//   from the core modes, so they were on until then: 8.00 is served GrantMatsOnKillEnabled 1 (its 50s are in).
// - 8.20 (CL-5625478): still ships it on (Enabled 1, the cap 500, the 1.4 rates, and MaterialDropOnElim_Default dropping
//   Default.Siphon.Drop*OnKill, 50 each), but its notes revert it in the core modes, so Epic turned it off by hotfix. The
//   rows that reach only playlists without data of their own are served off: Enabled 0 (Arena's game data sets 1 over it)
//   and the base rates (Arena has its own table). 🟡 The cap (GE_DefaultResourceCap reads the same base row Arena plays)
//   and the drops (the mutator reads Arena's own game data) can't be reverted for the core modes alone by a row, and how
//   Epic did it isn't recorded, so they stay as the paks have them.
// The events config's siphon: "build" (the default: as Epic ran each build), "on" (the change on 7.40, 8.00 and 8.20) or
// "off" (none on 7.40; on 8.00 and 8.20 the rows that reach the core modes alone, as for 8.20 above). Not a seasonal event: the seasonal events switch leaves it alone. Served by the [AssetHotfix]
// RowUpdate lines (events/contentupdates.js curveRowHotfixLine); a gameserver takes them when it starts.
export const siphonBuilds = { v740: 5046157, v800: 5203069, v820: 5625478 };
export const siphonModes = ["build", "on", "off"];
export const defaultSiphon = "build";
const gameData = "/Game/Athena/Balance/DataTables/AthenaGameData.AthenaGameData";
const resourceRates = "/Game/Athena/Balance/DataTables/AthenaResourceRates.AthenaResourceRates";

export const sanitizeSiphon = (value, current = defaultSiphon) =>
  (typeof value === "string" && siphonModes.includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() : current);

// AthenaResourceRates' amounts at key 0: 7.40's (and 8.00's and 8.20's own, divided by 1.4), and the Pop-up Cup's 1.4
// times them (7.40's Showdown/AthenaResourceRates, 8.00's and 8.20's base table). The key at 1 (0.15) is the same in both.
const baseRates = {
  ResourceLow: 10, ResourceSmall: 11, ResourceMedium: 19, ResourceHigh: 33, ResourceSuper: 72,
  ResourceMetalLow: 11, ResourceMetalMedium: 22, ResourceMetalHigh: 36, ResourceMetalVeryHigh: 79,
  ResourceStoneLow: 12, ResourceStoneMedium: 26, ResourceStoneHigh: 43, ResourceStoneVeryHigh: 98,
  ResourceWoodLow: 15, ResourceWoodMedium: 31, ResourceWoodHigh: 53, ResourceWoodVeryHigh: 117,
  LDBuildingNormal: 15, LDBuildingThick: 22,
  PropWoodLow: 2, PropWoodMedium: 5, PropWoodHigh: 7, PropWoodVeryHigh: 15,
  PropStoneLow: 2, PropStoneMedium: 5, PropStoneHigh: 7, PropStoneVeryHigh: 14,
  PropMetalLow: 2, PropMetalMedium: 5, PropMetalHigh: 7, PropMetalVeryHigh: 14
};
export const siphonRates = Object.fromEntries(Object.entries(baseRates).map(([row, value]) => [row, Math.round(value * 14) / 10]));

const row = (table, name, value) => ({ table, row: name, column: "0", value });
const rateRows = (rates) => Object.entries(rates).map(([name, value]) => row(resourceRates, name, value));
const materials = ["Wood", "Stone", "Metal"];

// Whether the change is on for the build: true, false, or null for a build without it.
export function siphonOn(changelist = currentBuild(), config = currentEventsConfig()) {
  const build = Number(changelist);
  if (!Object.values(siphonBuilds).includes(build)) return null;
  const mode = sanitizeSiphon(config?.siphon);
  if (mode !== "build") return mode === "on";
  return build !== siphonBuilds.v820;
}

// The curve rows the build's hotfix sets: [{table, row, column, value}], only where they differ from its paks.
export function siphonRows(changelist = currentBuild(), config = currentEventsConfig()) {
  const on = siphonOn(changelist, config);
  if (on === null) return [];
  const build = Number(changelist);
  if (build === siphonBuilds.v740) {
    if (!on) return [];
    const caps = ["Solos", "Duos", "Squads"].flatMap((mode) => materials.map((material) => row(gameData, `Default.MaxStack.Resources.${mode}.${material}`, 500)));
    return [row(gameData, "Default.Siphon.Enabled", 1), ...caps, ...rateRows(siphonRates)];
  }
  if (build === siphonBuilds.v800) {
    if (on) return [row(gameData, "Default.Siphon.GrantMatsOnKillEnabled", 1)];
  }
  // 8.00's and 8.20's paks have it on (see above): off serves the rows that reach the core modes alone.
  return on ? [] : [row(gameData, "Default.Siphon.Enabled", 0), ...rateRows(baseRates)];
}
