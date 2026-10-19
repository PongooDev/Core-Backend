import crypto from "node:crypto";
import { readGameData } from "../gamedata/read.js";
import { getDifficulty } from "../gamedata/world.js";

// Theater layouts come from Epic's world info (see tools/theaters/import.mjs); the client ships none.
const { theaters = [], rewards = {} } = readGameData("theaters", {});

const digest = (text) => crypto.createHash("sha1").update(text).digest();
const fraction = (bytes) => bytes.readUInt32BE(0) / 0x100000000;

// Missions are rolled from the theater, UTC day and tile, so everyone (and later the gameserver) sees the same ones.
function missionGuid(seed) {
  const hex = digest(`guid:${seed}`).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function weighted(entries, seed) {
  const total = entries.reduce((sum, entry) => sum + (entry.weight ?? 1), 0);
  let roll = fraction(digest(seed)) * total;
  for (const entry of entries) {
    roll -= entry.weight ?? 1;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

function shuffled(list, seed) {
  return [...list].sort((a, b) => fraction(digest(`${seed}:${a}`)) - fraction(digest(`${seed}:${b}`)));
}

function mission(seed, tileIndex, missionGenerator, missionDifficultyInfo, tierGroupName, availableUntil) {
  return {
    missionGuid: missionGuid(seed),
    missionRewards: { tierGroupName, items: rewards[tierGroupName] ?? [] },
    missionModifiers: { tierGroupName: "", items: [] },
    missionGenerator,
    missionDifficultyInfo,
    tileIndex,
    availableUntil
  };
}

// As in Epic's data: every AlwaysActive tile hosts a mission, and each region adds numMissionsAvailable missions on
// its Normal tiles. A tile's own weights override the region's.
function rollMissions({ data, fixedMissions }, day, availableUntil) {
  const missions = fixedMissions.map((fixed) => mission(`${data.uniqueId}:${day}:fixed:${fixed.tileIndex}`, fixed.tileIndex,
    fixed.missionGenerator, fixed.missionDifficultyInfo, fixed.tierGroupName, availableUntil));

  data.regions.forEach((region, regionIndex) => {
    const missionData = region.missionData ?? {};
    if (!missionData.numMissionsAvailable) return;
    const seed = `${data.uniqueId}:${day}:region:${regionIndex}`;
    const ofType = (type) => region.tileIndices.filter((index) => data.tiles[index].tileType === type);
    const normal = shuffled(ofType("Normal"), seed).slice(0, missionData.numMissionsAvailable);
    for (const tileIndex of [...ofType("AlwaysActive"), ...normal]) {
      const tile = data.tiles[tileIndex];
      const generators = tile.missionWeightOverrides?.length ? tile.missionWeightOverrides : missionData.missionWeights ?? [];
      const difficulties = tile.difficultyWeightOverrides?.length ? tile.difficultyWeightOverrides : missionData.difficultyWeights ?? [];
      if (!generators.length || !difficulties.length) continue;
      const tileSeed = `${seed}:tile:${tileIndex}`;
      const { difficultyInfo } = weighted(difficulties, `${tileSeed}:difficulty`);
      const tierGroupName = getDifficulty(difficultyInfo.rowName)?.lootTierGroup ?? "";
      missions.push(mission(tileSeed, tileIndex, weighted(generators, `${tileSeed}:generator`).missionGenerator,
        difficultyInfo, tierGroupName, availableUntil));
    }
  });
  return missions;
}

// FFortActiveTheaterInfo, the body of GET /fortnite/api/game/v2/world/info.
export function worldInfo(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const availableUntil = `${day}T23:59:59.999Z`;
  return {
    theaters: theaters.map((theater) => theater.data),
    missions: theaters.map((theater) => ({
      theaterId: theater.data.uniqueId,
      availableMissions: rollMissions(theater, day, availableUntil),
      nextRefresh: availableUntil
    })),
    missionAlerts: theaters.map((theater) => ({ theaterId: theater.data.uniqueId, availableMissionAlerts: [], nextRefresh: availableUntil }))
  };
}

// A mission by its guid: today's, or yesterday's for a match that started before UTC midnight.
export function findMission(missionGuid, now = new Date()) {
  if (!missionGuid) return null;
  for (const day of [now, new Date(now.getTime() - 24 * 60 * 60 * 1000)]) {
    for (const theater of worldInfo(day).missions) {
      const found = theater.availableMissions.find((candidate) => candidate.missionGuid === missionGuid);
      if (found) return { theaterId: theater.theaterId, ...found };
    }
  }
  return null;
}
