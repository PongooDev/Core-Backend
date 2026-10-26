// Maintainer tool: turns Epic's world info as kept by LawinServer (responses/Campaign/worldstw.json, GPL-3.0) into
// gamedata/theaters.json for this build. No theater layout ships with the client, so this is where layouts come from.
// Keeps only the fields the Cert build's structs have, and checks every asset against the extracted game data.
//
//   node tools/theaters/import.mjs <path to worldstw.json>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, "gamedata", `${name}.json`), "utf8"));
const source = process.argv[2];
if (!source) {
  console.error("usage: node tools/theaters/import.mjs <path to worldstw.json>");
  process.exit(1);
}

const dump = JSON.parse(fs.readFileSync(source, "utf8"));
const world = read("world");
const quests = read("quests");
const items = new Set(Object.keys(read("items")).map((id) => id.toLowerCase()));
const problems = [];

// FFortTheaterMapData and the structs below it, as the Cert SDK declares them (JSON keys are lowercase-first).
const fields = {
  theater: ["displayName", "uniqueId", "theaterSlot", "bIsTestTheater", "description", "threatDisplayName", "runtimeInfo", "tiles", "regions"],
  runtimeInfo: ["theaterType", "theaterTags", "theaterVisibilityRequirements", "requirements", "worldMapPinClass", "theaterImage", "theaterColorInfo", "socket", "missionAlertRequirements"],
  requirements: ["commanderLevel", "personalPowerRating", "partyPowerRating", "activeQuestDefinition", "questDefinition", "objectiveStatHandle", "itemDefinition"],
  tile: ["tileType", "zoneTheme", "requirements", "linkedQuests", "xCoordinate", "yCoordinate", "missionWeightOverrides", "difficultyWeightOverrides", "canBeMissionAlert", "tileTags"],
  linkedQuest: ["questDefinition", "objectiveStatHandle"],
  region: ["displayName", "regionTags", "tileIndices", "regionThemeIcon", "missionData", "requirements"],
  missionData: ["missionWeights", "difficultyWeights", "numMissionsAvailable", "numMissionsToChange", "missionChangeFrequency"],
  missionWeight: ["missionGenerator", "weight"],
  difficultyWeight: ["difficultyInfo", "lootTierGroup", "weight"],
  rowHandle: ["dataTable", "rowName"],
  colorInfo: ["bUseDifficultyToDetermineColor", "color"]
};

// "BlueprintGeneratedClass'/Game/X.X_C'" -> "/Game/X.X_C"; "None" means unset.
function reference(value) {
  if (typeof value !== "string" || value === "None" || value === "") return undefined;
  return value.match(/^\w+'(.*)'$/)?.[1] ?? value;
}

function pick(object, keys, convert = {}) {
  const out = {};
  for (const key of keys) {
    if (object?.[key] === undefined) continue;
    const value = convert[key] ? convert[key](object[key]) : object[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function rowHandle(handle, where) {
  const table = reference(handle?.dataTable);
  const rowName = handle?.rowName;
  if (!table || !rowName || rowName === "None") return undefined;
  if (table.endsWith("GameDifficultyGrowthBounds") && !world.difficulties[rowName]) problems.push(`${where}: difficulty ${rowName}`);
  return { dataTable: table, rowName };
}

function questReference(value, where) {
  const ref = reference(value);
  if (ref && !quests[ref.split(".").pop().toLowerCase()]) problems.push(`${where}: quest ${ref}`);
  return ref;
}

const requirements = (value, where) => pick(value, fields.requirements, {
  activeQuestDefinition: (v) => questReference(v, where),
  questDefinition: (v) => questReference(v, where),
  objectiveStatHandle: (v) => rowHandle(v, where),
  itemDefinition: reference
});

function generators(list, where) {
  return (list ?? []).map((entry) => pick(entry, fields.missionWeight, { missionGenerator: reference }))
    .filter((entry) => {
      if (!entry.missionGenerator) return false;
      if (world.missionGenerators[entry.missionGenerator]) return true;
      problems.push(`${where}: mission generator ${entry.missionGenerator}`);
      return false;
    });
}

const difficulties = (list, where) => (list ?? []).map((entry) => pick(entry, fields.difficultyWeight, { difficultyInfo: (v) => rowHandle(v, where) }));

function convertTheater(theater) {
  const name = theater.displayName?.en ?? theater.uniqueId;
  const runtimeInfo = pick(theater.runtimeInfo, fields.runtimeInfo, {
    theaterVisibilityRequirements: (v) => requirements(v, `${name} visibility`),
    requirements: (v) => requirements(v, `${name} requirements`),
    missionAlertRequirements: (v) => requirements(v, `${name} mission alerts`),
    worldMapPinClass: reference,
    theaterImage: reference,
    theaterColorInfo: (v) => pick(v, fields.colorInfo)
  });
  if (runtimeInfo.worldMapPinClass && !world.mapPins.includes(runtimeInfo.worldMapPinClass)) problems.push(`${name}: map pin ${runtimeInfo.worldMapPinClass}`);
  if (runtimeInfo.socket && !world.globeSockets.includes(runtimeInfo.socket)) problems.push(`${name}: socket ${runtimeInfo.socket}`);

  const tiles = theater.tiles.map((tile, index) => {
    const where = `${name} tile ${index}`;
    const out = pick(tile, fields.tile, {
      zoneTheme: reference,
      requirements: (v) => requirements(v, where),
      linkedQuests: (v) => v.map((quest) => pick(quest, fields.linkedQuest, {
        questDefinition: (q) => questReference(q, where),
        objectiveStatHandle: (h) => rowHandle(h, where)
      })),
      missionWeightOverrides: (v) => generators(v, where),
      difficultyWeightOverrides: (v) => difficulties(v, where)
    });
    if (!world.zoneThemes[out.zoneTheme]) problems.push(`${where}: zone theme ${out.zoneTheme}`);
    return out;
  });

  const regions = theater.regions.map((region, index) => {
    const where = `${name} region ${index}`;
    return pick(region, fields.region, {
      regionThemeIcon: reference,
      requirements: (v) => requirements(v, where),
      missionData: (v) => pick(v, fields.missionData, {
        missionWeights: (w) => generators(w, where),
        difficultyWeights: (d) => difficulties(d, where)
      })
    });
  });

  return pick({ ...theater, runtimeInfo, tiles, regions }, fields.theater);
}

// Missions on tiles no region rolls for (the storm shield, the tutorial) are fixed in Epic's data; keep those.
function fixedMissions(theater, missions) {
  const rolled = new Set(theater.regions.filter((r) => r.missionData?.numMissionsAvailable > 0).flatMap((r) => r.tileIndices));
  return (missions?.availableMissions ?? [])
    .filter((mission) => !rolled.has(mission.tileIndex))
    .map((mission) => ({
      tileIndex: mission.tileIndex,
      missionGenerator: reference(mission.missionGenerator),
      missionDifficultyInfo: rowHandle(mission.missionDifficultyInfo, `${theater.uniqueId} fixed mission`),
      tierGroupName: mission.missionRewards?.tierGroupName ?? ""
    }))
    .filter((mission) => world.missionGenerators[mission.missionGenerator]);
}

// Each loot tier group's rewards, from the missions in the dump; only items this build has. Epic's MCP rolled each
// mission's rewards (Mission_Select_T<n> isn't in the client's loot tables): in the dump a group's missions carry two
// zone card packs each, drawn from the group's XP packs and, less often, materials, so a group keeps every pack its
// missions showed with how many times it was drawn (weight) and how many a mission got (count).
const rewards = {};
for (const theaterMissions of dump.missions) {
  for (const mission of theaterMissions.availableMissions) {
    const group = mission.missionRewards?.tierGroupName;
    if (!group) continue;
    const drawn = (mission.missionRewards.items ?? []).filter((item) => items.has(item.itemType.toLowerCase()));
    const entry = rewards[group] ??= { count: drawn.length, pool: [] };
    entry.count = Math.max(entry.count, drawn.length);
    for (const { itemType, quantity } of drawn) {
      const known = entry.pool.find((reward) => reward.itemType === itemType && reward.quantity === quantity);
      if (known) known.weight += 1;
      else entry.pool.push({ itemType, quantity, weight: 1 });
    }
  }
}
for (const entry of Object.values(rewards)) entry.pool.sort((a, b) => a.itemType.localeCompare(b.itemType));

const theaters = dump.theaters.map((theater) => ({
  data: convertTheater(theater),
  fixedMissions: fixedMissions(theater, dump.missions.find((m) => m.theaterId === theater.uniqueId))
}));

const output = {
  source: "Epic's world info as kept by LawinServer (responses/Campaign/worldstw.json, GPL-3.0), converted by tools/theaters/import.mjs",
  theaters,
  rewards
};
fs.writeFileSync(path.join(root, "gamedata", "theaters.json"), JSON.stringify(output, null, 2) + "\n");

for (const { data, fixedMissions: fixed } of theaters) {
  console.log(`${data.displayName?.en ?? data.uniqueId}: ${data.tiles.length} tiles, ${data.regions.length} regions, ${fixed.length} fixed missions`);
}
console.log(`${Object.keys(rewards).length} reward groups`);
if (problems.length) console.log(`Not in this build's data (left out or kept as is):\n  ${[...new Set(problems)].join("\n  ")}`);
