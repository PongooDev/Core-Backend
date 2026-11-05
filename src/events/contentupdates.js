import { currentBuild } from "../builds/context.js";
import { athenaLootTables, athenaSeason } from "../gamedata/athena.js";
import { seasonMoment } from "../store/itemshop.js";
import { currentEventsConfig } from "./events.js";

// Battle Royale's content updates of Season 2 (Core-Backend #156). Epic added 1.11's new items without a patch: "There
// will be no downtime, and no update required." Each was a hotfix to the loot tables the build already had, as 1.11's
// own data shows: its AthenaLootPackages_Client ships the Small Shield Potion, the Boogie Bomb, the Suppressed Pistol, the
// Damage Trap (TID_ContextTrap_Athena) and the Cozy Campfire at weight 0, and the old traps on. 2.1 (CL-3825894) ships the
// same tables (the Boogie Bomb's stack aside), so its loot needs the same hotfixes, and its own Cozy Campfire too. 2.2
// (CL-3841827) needs none: its own tables have them all in, at Epic's weights (the Small Shield Potion at 1, the Damage
// Trap at 4.5 with the old traps and jump pads at 0, the Launch Pad at 0.5, the Cozy Campfire at 0.5, the Boogie Bomb at
// 0.3 among the chests' and supply drops' consumables, the Suppressed Pistol at 0.075 and 0.01875 on the floor and 0.1
// from chests; and its own: the Scoped AR out of supply drops, "Removed the Scoped AR from Supply Drops"), so it gets
// no [AssetHotfix], which would put Core's weights over Epic's.
//
// 2.3 (CL-3847564) ships 2.2's tables unchanged, the Chug Jug (Athena_SuperMedkit) among the consumables at weight 0
// (WorldList.AthenaConsumables.06 on the floor, WorldList.AthenaHighConsumables.06 in chests and supply drops), and its
// notes release it: "Chug Jug is a new consumable that releases with this patch. It is a Legendary item and can only be
// found in chests or supply drops. Max stack is 1." So 2.3 takes that one hotfix, always (it shipped with the patch, as
// 2.1's Cozy Campfire): the chests' and supply drops' row at 0.2 (🟡 Core's: half the Slurp Juice's 0.4, a legendary
// rarer than the epic), the floor's left at 0, its stack (Count) 1 as shipped.
//
// 2.4 (CL-3858292) ships 2.3's tables with the Chug Jug in (the chests' and supply drops' row at 0.2, as Core's hotfix
// had it), so it needs that hotfix no more, and its notes bring two of their own:
// - "Minigun: Found in Chests and Supply drops". 2.4's tables have it at weight 0: WID_Assault_LMG_Athena_VR/SR_Ore_T03
//   in the SMG list (WorldList.AthenaLoot.Weapon.SMG.10 and .11, which chests, Loot_AthenaTreasure_06, and the floor
//   share) and a supply drop of its own (Loot_AthenaSupplyDrop_02, WorldPKG.AthenaSupplyDrop.Weapon.SMG, the Legendary
//   one). Core's weights (🟡): the Epic at 0.025 (the Epic Tactical SMG's), the Legendary at a quarter of that, 0.00625
//   (as the Suppressed Pistol's Legendary to its Epic), and the supply drop at 1 (the Assault Rifle drop's). With the
//   floor sharing the chests' list, it shows up on the floor too.
// - "Suppressed Pistol: Reduced drop chances of Epic variant by 20%. Reduced drop chances of Legendary variant by 33%."
//   2.4's rows are still 2.3's (SuppressedHandgun.01/.02 from chests: 0.075 and 0.01875), so 2.4 takes the cut as Epic's
//   2.4.2 tables write it down: 0.06 and 0.012, on the chests' rows only (the floor's WorldList.AthenaLoot.Weapon.
//   Handgun.04/.05 stay at 0.075 and 0.01875 in 2.4.2's).
// Both shipped with the patch, so 2.4 always has them.
//
// 2.4.2 (CL-3870737) ships both in its tables, the Minigun in a list of its own (WorldList.AthenaLoot.Weapon.LMG, the
// Epic at 0.6 and the Legendary at 0.3; chests call it through Loot_AthenaTreasure_06 at 0.08, the floor's
// Loot_AthenaFloorLoot_10 at 0, its supply drop at 1), so it needs neither. Its notes' "Crossbow: ... Found from floor
// loot and treasure chests. This weapon comes in both Rare and Epic variants" isn't in its paks, so it takes no update:
// its two Crossbow items (WID_Sniper_Crossbow_Athena_R_Ore_T03_2, _VR_Ore_T03) are the Fortnite Wiki's unused early
// version ("Added an early version" in 2.41, "Removed the early version" in 2.42), a Bolt-Action Sniper firing the
// Crossbow's arrow: their WeaponStatHandle is AthenaRangedWeapons' Sniper_BoltAction_Scope_Athena_R/VR_Ore_T03 (105
// and 110 damage, one round), their AmmoData Heavy Bullets, their actor and mesh the sniper's (B_Rifle_Sniper_Athena,
// Sniper_01). The Crossbow Epic dropped (75/79 damage, five bolts, infinite Crossbow Bolts) has no item, stats row,
// weapon actor, mesh or ammo in 2.4.2: B_Crossbow_Athena, SK_Crossbow_01, AmmoInfiniteCrossbow_Athena and the
// Crossbow_Athena_R/VR_Ore_T03 rows are 2.5's.
//
// 2.5 (CL-3889387) ships the Crossbow and its own notes' loot changes in its tables, so it needs no update: the Crossbow
// in a list of its own (WorldList.AthenaLoot.Weapon.Crossbow, WID_Sniper_Crossbow_Athena_R_Ore_T03 at 1 and _VR_Ore_T03
// at 0.25, their stats AthenaRangedWeapons' Crossbow_Athena_R/VR_Ore_T03; chests at 0.1 through Loot_AthenaTreasure_06,
// the floor's Loot_AthenaFloorLoot_10 at 0.1; 2.4.2's _R_Ore_T03_2 is gone), "Minigun drop chance decreased by 12.5%"
// (chests' Loot_AthenaTreasure_02 at 0.07, was 0.08), "Chug Jug drop chance decreased by 15%"
// (WorldList.AthenaHighConsumables.06 at 0.17, was 0.2), the Impulse Grenade "Found in Treasure Chests and Supply Drops
// only" (Athena_KnockGrenade, x3, at 0.3 in WorldList.AthenaHighConsumables, which chests and supply drops call, 0 in the
// floor's WorldList.AthenaConsumables), "The Common/Uncommon/Rare SMG is rotating out"
// (WorldList.AthenaLoot.Weapon.SMG.01-.03 at 0) and "Revolver now uses Medium ammo" (WorldPKG.AthenaLoot.Weapon.Revolver,
// WorldList.AthenaLoot.Ammo.MediumRevolver).
//
// 3.5.2 (CL-4008490, Season 3) is Content Update v3.50's build: "Light Machine Gun added. Rare and Epic rarities. Can be
// found in Floor Loot, Treasure Chests, and Vending Machines." Its tables (3.5.1's, unchanged) ship it at weight 0:
// WID_Assault_LMGSAW_Athena_R/VR_Ore_T03 in WorldList.AthenaLoot.Weapon.AssaultAuto (.08, .09), which the floor
// (Loot_AthenaFloorLoot_09) and chests (Loot_AthenaTreasure_05) call, in the vending machines' Rare and Epic medium-ammo
// lists (WorldList.AthenaLoot.VendingMachine.Weapons.Rare.Medium.05, Epic.Medium.03) and in the supply drops' Assault
// list (WorldList.AthenaSupplyDrop.Weapon.Assault.03), which the notes don't name and so stays at 0. Its weights are
// Epic's as 3.6 (CL-4019403, 24 April 2018) ships them in its own tables: the Rare at 0.075 and the Epic at 0.0275, 1 in
// the vending lists (the supply drop row still 0). It shipped with the build's update, so 3.5.2 always has it; 3.5.1, a
// week earlier, doesn't, and 3.6 has it in its tables (inTablesFrom), so takes none.
//
// 3.6's own notes change no loot the backend owns: its tables have the Clinger (Athena_StickyGrenade, "Floor Loot, Supply
// Drops, Supply Llamas, and Treasure Chests": WorldList.AthenaConsumables.14 at 0.25, AthenaHighConsumables.14 at 0.5) and
// the Remote Explosives' chest cut ("~40%": AthenaHighConsumables.09, 0.5 to 0.3) in, so it takes no content update.
//
// Epic's updates (the Fortnite Wiki's Season 2 pages and Epic's notes on them):
// - 19 December 2017, 13:00 GMT, the Small Shield Potion update: the Small Shield Potion ("Drops in stacks of 3", "found in
//   floor loot, treasure chests, and supply drops") and the trap usability update ("The Spike Trap, Wall Zapper, and
//   Ceiling Zapper have been combined into a single Damage Trap", "The Launch Pad, Vertical Jump Pad, and Horizontal Jump
//   Pad has been combined to just Launch Pad");
// - 23 December 2017, 16:00 GMT, the Boogie Bomb ("Drops in stacks of 1", "found in treasure chests and supply drops");
// - 2 January 2018, 13:00 GMT, the Suppressed Pistol ("found as Epic and Legendary rarity", "in treasure chests, supply
//   drops or as floor loot");
// - 10 January 2018, 2.1: the Cozy Campfire.
//
// Each update's rows set what the shipped tables hold at 0. Epic's hotfix values were never in a build, so the weights
// are Core's (🟡), each from the table's own: the Small Shield Potion at 1 among the floor's and chests' consumables (the
// Shield Potion's are 1.25 and 1.5); the Damage Trap at the three traps' 3.75 it replaces and the Launch Pad at the three
// pads' 1, so traps drop as often as before; the Boogie Bomb at 0.5 in the chests' and supply drops' consumables, as the
// Medkit, and its stack at 1 in 1.11 (2.1 ships 1); the Suppressed Pistol on the floor at the weights its own chest list
// gives it (0.075 Epic, 0.01875 Legendary), and its chest drop (Loot_AthenaTreasure_01) at 0.125, as the Sniper's; the Cozy
// Campfire at 0.5 among the traps, the Launch Pad's weight before the merge.
const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
const tiers = "/Game/Items/Datatables/AthenaLootTierData_Client.AthenaLootTierData_Client";
const season2 = 3807424;
const build21 = 3825894;
const build22 = 3841827;
const build23 = 3847564;
const build24 = 3858292;
const build242 = 3870737;
const build352 = 4008490;
const build36 = 4019403;
// The first UE 4.20 build (2.5): its hotfix manager takes [AssetHotfix] lines as "<asset>;RowUpdate;<row>;<column>;<value>"
// or "<asset>;TableUpdate;<json>" ("Expected a hotfix type of RowUpdate with 5 tokens or TableUpdate with 3 tokens.", in
// 2.5's and 3.6's exes), not 4.19's "(\"<asset>\",\"<json>\")".
export const rowUpdateBuild = 3889387;

export const contentUpdates = [
  { id: "smallShieldPotion", name: "Small Shield Potion and the Damage Trap", at: "2017-12-19T13:00:00Z", firstBuild: season2, rows: [
    [packages, "WorldList.AthenaConsumables.10", { Weight: 1 }],
    [packages, "WorldList.AthenaHighConsumables.10", { Weight: 1 }],
    [packages, "WorldList.AthenaTraps.01", { Weight: 3.75 }],
    [packages, "WorldList.AthenaTraps.03", { Weight: 0 }],
    [packages, "WorldList.AthenaTraps.04", { Weight: 0 }],
    [packages, "WorldList.AthenaTraps.05", { Weight: 0 }],
    [packages, "WorldList.AthenaTraps.06", { Weight: 1 }],
    [packages, "WorldList.AthenaTraps.07", { Weight: 0 }],
    [packages, "WorldList.AthenaTraps.08", { Weight: 0 }]
  ] },
  { id: "boogieBomb", name: "Boogie Bomb", at: "2017-12-23T16:00:00Z", firstBuild: season2, rows: [
    [packages, "WorldList.AthenaHighConsumables.03", { Weight: 0.5, Count: 1 }],
    [packages, "WorldList.AthenaConsumables.03", { Count: 1 }]
  ] },
  { id: "suppressedPistol", name: "Suppressed Pistol", at: "2018-01-02T13:00:00Z", firstBuild: season2, rows: [
    [packages, "WorldList.AthenaLoot.Weapon.Handgun.04", { Weight: 0.075 }],
    [packages, "WorldList.AthenaLoot.Weapon.Handgun.05", { Weight: 0.01875 }],
    [tiers, "Loot_AthenaTreasure_01", { Weight: 0.125 }]
  ] },
  { id: "cozyCampfire", name: "Cozy Campfire", at: "2018-01-10T00:00:00Z", firstBuild: build21, rows: [
    [packages, "WorldList.AthenaTraps.02", { Weight: 0.5 }]
  ] },
  { id: "chugJug", name: "Chug Jug", at: "2018-01-25T00:00:00Z", firstBuild: build23, inTablesFrom: build24, rows: [
    [packages, "WorldList.AthenaHighConsumables.06", { Weight: 0.2 }]
  ] },
  { id: "minigun", name: "Minigun", at: "2018-01-31T00:00:00Z", firstBuild: build24, inTablesFrom: build242, rows: [
    [packages, "WorldList.AthenaLoot.Weapon.SMG.10", { Weight: 0.025 }],
    [packages, "WorldList.AthenaLoot.Weapon.SMG.11", { Weight: 0.00625 }],
    [tiers, "Loot_AthenaSupplyDrop_02", { Weight: 1 }]
  ] },
  { id: "suppressedPistolNerf", name: "Suppressed Pistol drop chances", at: "2018-01-31T00:00:00Z", firstBuild: build24, inTablesFrom: build242, rows: [
    [packages, "WorldList.AthenaLoot.Weapon.SuppressedHandgun.01", { Weight: 0.06 }],
    [packages, "WorldList.AthenaLoot.Weapon.SuppressedHandgun.02", { Weight: 0.012 }]
  ] },
  { id: "lightMachineGun", name: "Light Machine Gun", at: "2018-04-19T00:00:00Z", firstBuild: build352, inTablesFrom: build36, rows: [
    [packages, "WorldList.AthenaLoot.Weapon.AssaultAuto.08", { Weight: 0.075 }],
    [packages, "WorldList.AthenaLoot.Weapon.AssaultAuto.09", { Weight: 0.0275 }],
    [packages, "WorldList.AthenaLoot.VendingMachine.Weapons.Rare.Medium.05", { Weight: 1 }],
    [packages, "WorldList.AthenaLoot.VendingMachine.Weapons.Epic.Medium.03", { Weight: 1 }]
  ] }
];
export const contentUpdateIds = contentUpdates.map(({ id }) => id);

// The admin's choice (events config contentUpdates): mode "season", each update from its date on Season 2's replay
// (store/itemshop.js seasonMoment: day 1 is 14 December 2017, so the Small Shield Potion comes on day 6 at 13:00 UTC past
// the rotation hour, and all three are in from day 20 to the season's end; the replay starting over takes them out again,
// as the shop starts over), or "all", every one in from day 1; overrides {<id>: "on" | "off"} turn one on or off whatever
// the mode. They are 1.11's: 2.1 shipped after all three and with its campfire, so 2.1 has all of them,
// always (and 2.2 has them in its own tables).
export const contentUpdateModes = ["season", "all"];
export const defaultContentUpdates = { mode: "season", overrides: {} };

export function sanitizeContentUpdates(input, current = defaultContentUpdates) {
  const result = { mode: current?.mode ?? defaultContentUpdates.mode, overrides: { ...(current?.overrides ?? {}) } };
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  if (typeof input.mode === "string" && contentUpdateModes.includes(input.mode)) result.mode = input.mode;
  if (input.overrides && typeof input.overrides === "object" && !Array.isArray(input.overrides)) {
    for (const id of contentUpdateIds) {
      const value = input.overrides[id];
      if (value === "on" || value === "off") result.overrides[id] = value;
      else if (value === "auto" || value === null) delete result.overrides[id];
    }
  }
  return result;
}

const configOf = (config) => sanitizeContentUpdates(config ?? currentEventsConfig()?.contentUpdates);

// The updates the requesting build has, and whether each is in now: [{id, name, at, on, why}].
export function contentUpdateStates(now = new Date(), config = null, build = currentBuild()) {
  const number = Number(build);
  // Season 2's and, from 3.5.2, Season 3's (the Light Machine Gun).
  if (!(number >= season2) || !(athenaSeason()?.seasonNumber >= 2)) return [];
  const { mode, overrides } = configOf(config);
  const moment = number >= build21 ? null : seasonMoment(now, null, 2);
  // From 2.2 a build's own tables have the updates before it in; only its own patch's are left (2.3's Chug Jug, which
  // 2.4's tables have in; 2.4's Minigun and Suppressed Pistol cut, which 2.4.2's have in).
  const inTables = (update) => number >= (update.inTablesFrom ?? (update.firstBuild <= build22 ? build22 : Infinity));
  return contentUpdates.filter((update) => number >= update.firstBuild && !inTables(update)).map((update) => {
    const shipped = number >= build21;
    const why = shipped ? "shipped" : overrides[update.id] ?? (mode === "all" ? "all" : "season");
    const on = shipped || why === "on" || why === "all" || (why === "season" && moment.getTime() >= Date.parse(update.at));
    return { id: update.id, name: update.name, at: update.at, on, why };
  });
}

// The build's loot tables with the updates that are in: {<table path>: [{Name, ...row}]}, only the tables they change,
// rows in the asset's order.
export function updatedLootTables(now = new Date(), config = null) {
  const shipped = athenaLootTables();
  const on = new Set(contentUpdateStates(now, config).filter((state) => state.on).map((state) => state.id));
  const changed = {};
  for (const update of contentUpdates.filter((candidate) => on.has(candidate.id))) {
    for (const [table, row, values] of update.rows) {
      if (!shipped[table]?.[row]) continue;
      changed[table] ??= structuredClone(shipped[table]);
      Object.assign(changed[table][row], values);
    }
  }
  return Object.fromEntries(Object.entries(changed).map(([table, rows]) => [table, Object.entries(rows).map(([Name, row]) => ({ Name, ...row }))]));
}

// The [AssetHotfix] section of DefaultGame.ini that applies them, in the 4.19 hotfix's form (UOnlineHotfixManager::
// PatchAssetsFromIniFiles): "+DataTable=(\"<asset path>\",\"<the table's rows as JSON>\")", the JSON quoted with \" and \\
// (FParse::QuotedString), which UDataTable::CreateTableFromJSONString imports over the loaded table, whole. The section has
// to come last: HotfixIniFile stops looking for classes to reload at "[AssetHotfix]". The config merge reads the file a
// line at a time (FParse::LineExtended), where a JSON string's contents count as outside quotes, so a value holding a
// brace, a bar, "//" or a backslash would be cut; none of the tables' does, and one that did is left out. Empty when
// nothing is in. Other tables Epic hotfixed the same way (more: [{table, rows}], Shooting Test #1's weapon stats,
// events/shootingtest.js) share the section. From 2.5 (UE 4.20, rowUpdateBuild) the updates are RowUpdate lines, one a
// changed value, "+DataTable=<asset>;RowUpdate;<row>;<column>;<value>", as Epic's 4.20 hotfixes set them (the whole-table
// form would need TableUpdate, whose ";"-split tokens the rows' Annotation strings break); curve rows ([{table, row, column,
// value}], Season 3's finale, events/meteorstrike.js) are "+CurveTable=<asset>;RowUpdate;<row>;<time>;<value>".
export function lootHotfixSection(now = new Date(), config = null, more = [], curveRows = [], build = currentBuild()) {
  const updates = Number(build) >= rowUpdateBuild
    ? contentUpdateRowLines(now, config)
    : Object.entries(updatedLootTables(now, config)).map(([table, rows]) => dataTableHotfixLine(table, rows));
  const lines = [...updates, ...more.map(({ table, rows }) => dataTableHotfixLine(table, rows)), ...curveRows.map(curveRowHotfixLine)]
    .filter(Boolean);
  return lines.length ? ["[AssetHotfix]", ...lines, ""].join("\r\n") : "";
}

// The updates that are in as 4.20 RowUpdate lines, a row's value once (the last update's), rows the build's tables have.
function contentUpdateRowLines(now, config) {
  const shipped = athenaLootTables();
  const on = new Set(contentUpdateStates(now, config).filter((state) => state.on).map((state) => state.id));
  const values = new Map();
  for (const update of contentUpdates.filter((candidate) => on.has(candidate.id))) {
    for (const [table, row, changes] of update.rows) {
      if (!shipped[table]?.[row]) continue;
      for (const [column, value] of Object.entries(changes)) values.set(`${table};RowUpdate;${row};${column}`, value);
    }
  }
  return [...values].map(([key, value]) => `+DataTable=${key};${value}`);
}

// A curve table row's [AssetHotfix] RowUpdate line (UE 4.20).
export const curveRowHotfixLine = ({ table, row, column, value }) => `+CurveTable=${table};RowUpdate;${row};${column};${value}`;

// A table's [AssetHotfix] line, its rows [{Name, ...row}], or null for one whose values the config merge would cut.
export function dataTableHotfixLine(table, rows) {
  const unsafe = rows.some((row) => Object.values(row).some((value) => typeof value === "string" && /[{}|\\]|\/\//.test(value)));
  if (unsafe) return null;
  const json = JSON.stringify(rows).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `+DataTable=("${table}","${json}")`;
}
