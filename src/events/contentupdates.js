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
  { id: "chugJug", name: "Chug Jug", at: "2018-01-25T00:00:00Z", firstBuild: build23, rows: [
    [packages, "WorldList.AthenaHighConsumables.06", { Weight: 0.2 }]
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
  if (!(number >= season2) || athenaSeason()?.seasonNumber !== 2) return [];
  const { mode, overrides } = configOf(config);
  const moment = number >= build21 ? null : seasonMoment(now, null, 2);
  // From 2.2 a build's own tables have the updates before it in; only its own patch's are left (2.3's Chug Jug).
  const inTables = (update) => number >= build22 && update.firstBuild <= build22;
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
// nothing is in.
export function lootHotfixSection(now = new Date(), config = null) {
  const lines = [];
  for (const [table, rows] of Object.entries(updatedLootTables(now, config))) {
    const unsafe = rows.some((row) => Object.values(row).some((value) => typeof value === "string" && /[{}|\\]|\/\//.test(value)));
    if (unsafe) continue;
    const json = JSON.stringify(rows).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    lines.push(`+DataTable=("${table}","${json}")`);
  }
  return lines.length ? ["[AssetHotfix]", ...lines, ""].join("\r\n") : "";
}
