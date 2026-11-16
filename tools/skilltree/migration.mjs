// Maintainer tool: writes gamedata/skilltree630.json, what Update v6.30's skill tree migration reads (profiles/skilltree.js):
// the last skill tree's nodes, 6.22's (CL-4543176, the build before 6.30 removed the tree), with the gameplay effect rows
// each one applies and the squad slots it unlocks, and the effect rows that those nodes and 6.30's (CL-4573096) nodes
// name, from 6.30's effect table, with the attribute each changes and the tags it grants, and the 6.22 squad slots a squad
// 6.30 added stands for.
//
// Its inputs are FModel's JSON exports of three data tables (FModel's "Save Properties", or the fmodel tools' JSON):
//   6.22  FortniteGame/Content/CommandConsole/CCNodes                                           (HomebaseNodeDataTable)
//   6.22  FortniteGame/Content/Abilities/CommandConsole/CommandConsole_GEImporter              (HomebaseNodeGameplayEffectDataTable)
//   6.30  FortniteGame/Content/Abilities/CommandConsole/CommandConsole_GEImporter_NewSkillTree (6.30's effect table)
//
//   node tools/skilltree/migration.mjs <6.22 CCNodes.json> <6.22 CommandConsole_GEImporter.json> <6.30 CommandConsole_GEImporter_NewSkillTree.json>
//
// It checks that every 6.22 effect row is in 6.30's table unchanged (6.30 kept all 426 and added its own), that the nodes'
// squad slots are the ones gamedata/4543176's skill tree has, and that every effect a 6.30 node names is in the table.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch } from "../../src/gamedata/patch.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [nodesFile, oldEffectsFile, newEffectsFile] = process.argv.slice(2);
if (!nodesFile || !oldEffectsFile || !newEffectsFile) {
  console.error("usage: node tools/skilltree/migration.mjs <6.22 CCNodes.json> <6.22 CommandConsole_GEImporter.json> <6.30 CommandConsole_GEImporter_NewSkillTree.json>");
  process.exit(1);
}

// A data table's rows, from FModel's export (an array of exports) or the fmodel tools' result ({json: "<that array>"}).
function rowsOf(file) {
  let data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof data?.json === "string") data = JSON.parse(data.json);
  const table = (Array.isArray(data) ? data : [data]).find((entry) => entry?.Rows);
  if (!table) throw new Error(`${file} has no data table rows`);
  return table.Rows;
}
const gameData = (name, build) => {
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const base = read(path.join(root, "gamedata", `${name}.json`));
  const overlay = path.join(root, "gamedata", build, `${name}.json`);
  return fs.existsSync(overlay) ? applyPatch(base, read(overlay)) : base;
};

const oldNodes = rowsOf(nodesFile);
const oldEffects = rowsOf(oldEffectsFile);
const newEffects = rowsOf(newEffectsFile);
const problems = [];

const summary = (row) => ({
  attribute: row.Attribute?.AttributeName ?? "",
  tags: [...(row.GrantedTagsContainer ?? [])].sort()
});
// What a row does (6.30's rows add an AssetTagsContainer; the Associated*Idx fields are the importer's bookkeeping).
const semantics = (row) => JSON.stringify([row.Attribute?.AttributeName ?? "", row.Operation, row.Magnitude,
  ...["ApplicationRequiredTagsContainer", "RequiredSourceTagsContainer", "RequiredTargetTagsContainer", "GrantedTagsContainer",
    "IgnoreSourceTagsContainer"].map((key) => [...(row[key] ?? [])].sort())]);
for (const [name, row] of Object.entries(oldEffects)) {
  if (!newEffects[name]) problems.push(`6.22's effect ${name} isn't in 6.30's table`);
  else if (semantics(newEffects[name]) !== semantics(row)) problems.push(`6.22's effect ${name} differs in 6.30's table`);
}

const committed = gameData("homebasenodes", "4543176").nodes ?? {};
const nodes = {};
const used = new Set();
for (const [id, row] of Object.entries(oldNodes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  const effects = (row.GameplayEffectRowNames ?? []).filter((name) => name && name !== "None");
  const squadSlots = (row.UnlockedSquadSlots ?? []).map((slot) => ({ slot: slot.SquadSlotIndex ?? 0, squadId: slot.SquadId }));
  for (const name of effects) {
    if (!oldEffects[name]) problems.push(`${id}'s effect ${name} isn't in 6.22's table`);
    used.add(name);
  }
  if (JSON.stringify(squadSlots) !== JSON.stringify(committed[id]?.squadSlots ?? [])) problems.push(`${id}'s squad slots aren't gamedata/4543176's`);
  if (!effects.length && !squadSlots.length) continue;
  nodes[id] = { ...(effects.length ? { effects } : {}), ...(squadSlots.length ? { squadSlots } : {}) };
}

for (const [id, node] of Object.entries(gameData("homebasenodes", "4573096").nodes ?? {})) {
  for (const level of node.levels ?? []) {
    for (const name of level.effects ?? []) {
      if (!newEffects[name]) problems.push(`6.30's ${id} names ${name}, not in 6.30's table`);
      used.add(name);
    }
  }
}

// 6.30's Squad_Defender_MissionDefender (three Defender slots, QuestReward_Mission_Defender to _3) takes over the mission
// defenders, which 6.22 slotted in the hero squad's Defender slots (Squad_Combat_AdventureSquadOne's, 3 to 5, unlocked by
// T1_Main_20D6FB134, _904080840 and _FD10816B3): its slot i is that squad's i-th Defender slot.
const oldSquads = gameData("squads", "4543176");
const newSquads = gameData("squads", "4573096");
const defenderSlots = (oldSquads.Squad_Combat_AdventureSquadOne?.slots ?? []).flatMap((slot, index) => (slot.types.includes("Defender") ? [index] : []));
if (newSquads.Squad_Defender_MissionDefender?.slots?.length !== defenderSlots.length) problems.push("6.30's mission defender squad isn't the hero squad's Defender slots");
const squadSlotsSince630 = { Squad_Defender_MissionDefender: defenderSlots.map((slot) => ({ slot, squadId: "Squad_Combat_AdventureSquadOne" })) };

const effects = {};
for (const name of [...used].sort()) {
  if (!newEffects[name]) continue;
  effects[name] = { ...summary(newEffects[name]), ...(oldEffects[name] ? {} : { since630: true }) };
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const out = path.join(root, "gamedata", "skilltree630.json");
fs.writeFileSync(out, JSON.stringify({ nodes, effects, squadSlotsSince630 }, null, 2) + "\n");
console.log(`${Object.keys(nodes).length} nodes, ${Object.keys(effects).length} effects -> ${path.relative(root, out)}`);
