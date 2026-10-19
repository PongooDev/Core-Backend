import crypto from "node:crypto";
import { getDifficulty, hasGlobeSocket, mapPinPath, missionGeneratorPath, zoneThemePath } from "../gamedata/world.js";
import { stonewood } from "./stonewood.js";

const difficultyTable = "/Game/Balance/DataTables/GameDifficultyGrowthBounds.GameDifficultyGrowthBounds";
const hash = (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 32).toUpperCase();
const difficultyHandle = (rowName) => ({ dataTable: difficultyTable, rowName });

function resolve(lookup, name, kind) {
  const path = lookup(name);
  if (!path) throw new Error(`${kind} ${name} is not in gamedata/world.json`);
  return path;
}

// Axial hex coordinates of one ring around the centre tile.
function ring(radius) {
  const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  let [x, y] = [-radius, radius];
  const coordinates = [];
  for (const [dx, dy] of directions) {
    for (let step = 0; step < radius; step++) {
      coordinates.push([x, y]);
      x += dx;
      y += dy;
    }
  }
  return coordinates;
}

function region(name, tileIndices, generators, difficulty) {
  return {
    displayName: name,
    tileIndices,
    missionData: {
      missionWeights: generators.map((generator) => ({ missionGenerator: generator, weight: 1 })),
      difficultyWeights: [{ difficultyInfo: difficultyHandle(difficulty), lootTierGroup: getDifficulty(difficulty).lootTierGroup, weight: 1 }],
      numMissionsAvailable: tileIndices.length,
      numMissionsToChange: 0,
      missionChangeFrequency: 0
    }
  };
}

// The layout is fixed; the generators and difficulty of each region are kept alongside for mission rolls.
function buildTheater(definition) {
  const id = hash(`core:theater:${definition.key}`);
  const coordinates = [...ring(1), ...ring(2), ...ring(3)];
  const outpost = definition.outpost;
  const tiles = [{
    tileType: "Outpost",
    zoneTheme: resolve(zoneThemePath, outpost.zoneTheme, "Zone theme"),
    xCoordinate: 0,
    yCoordinate: 0,
    canBeMissionAlert: false
  }];
  const regions = [region(`${definition.name} Storm Shield`, [0],
    [resolve(missionGeneratorPath, outpost.missionGenerator, "Mission generator")], outpost.difficulty)];
  const rolls = [{ tileIndices: [0], generators: regions[0].missionData.missionWeights.map((w) => w.missionGenerator), difficulty: outpost.difficulty }];

  let next = 0;
  definition.regions.forEach((zone, index) => {
    const tileIndices = [];
    for (let i = 0; i < definition.tilesPerRegion[index]; i++) {
      const [x, y] = coordinates[next++];
      tileIndices.push(tiles.length);
      tiles.push({
        tileType: "Normal",
        zoneTheme: resolve(zoneThemePath, zone.zoneThemes[i % zone.zoneThemes.length], "Zone theme"),
        xCoordinate: x,
        yCoordinate: y,
        canBeMissionAlert: false
      });
    }
    const generators = zone.missionGenerators.map((name) => resolve(missionGeneratorPath, name, "Mission generator"));
    regions.push(region(zone.name, tileIndices, generators, zone.difficulty));
    rolls.push({ tileIndices, generators, difficulty: zone.difficulty });
  });

  if (!hasGlobeSocket(definition.socket)) throw new Error(`WM_Globe has no socket ${definition.socket}`);
  const data = {
    displayName: definition.name,
    uniqueId: id,
    theaterSlot: definition.slot,
    bIsTestTheater: false,
    description: definition.description,
    threatDisplayName: definition.name,
    runtimeInfo: {
      theaterType: "Standard",
      worldMapPinClass: resolve(mapPinPath, definition.mapPin, "Map pin"),
      socket: definition.socket,
      theaterColorInfo: { bUseDifficultyToDetermineColor: true }
    },
    tiles,
    regions
  };
  return { id, data, rolls };
}

const theaters = [buildTheater(stonewood)];

const nextUtcMidnight = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

// One mission per tile, rolled from the UTC day so every player (and later the gameserver) sees the same ones.
function rollMissions(theater, now) {
  const day = now.toISOString().slice(0, 10);
  const availableUntil = nextUtcMidnight(now).toISOString();
  const missions = [];
  for (const { tileIndices, generators, difficulty } of theater.rolls) {
    for (const tileIndex of tileIndices) {
      const missionGuid = hash(`${theater.id}:${day}:${tileIndex}`);
      missions.push({
        missionGuid,
        missionRewards: { tierGroupName: getDifficulty(difficulty).lootTierGroup, items: [] },
        missionModifiers: { tierGroupName: "", items: [] },
        missionGenerator: generators[parseInt(missionGuid.slice(0, 8), 16) % generators.length],
        missionDifficultyInfo: difficultyHandle(difficulty),
        tileIndex,
        availableUntil
      });
    }
  }
  return missions;
}

// FFortActiveTheaterInfo, the body of GET /fortnite/api/game/v2/world/info.
export function worldInfo(now = new Date()) {
  const nextRefresh = nextUtcMidnight(now).toISOString();
  return {
    theaters: theaters.map((theater) => theater.data),
    missions: theaters.map((theater) => ({ theaterId: theater.id, availableMissions: rollMissions(theater, now), nextRefresh })),
    missionAlerts: theaters.map((theater) => ({ theaterId: theater.id, availableMissionAlerts: [], nextRefresh }))
  };
}
