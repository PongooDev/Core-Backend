import crypto from "node:crypto";
import { readGameData } from "../gamedata/read.js";
import { getDifficulty, missionAlertTier } from "../gamedata/world.js";

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

// What an alert gives, by the loot tier group of its MissionAlerts row. No shipped loot table has these groups (Epic
// rolled them on its servers), so this is Core's: V-bucks and the tier's reagents, as the client's own zone packs.
const alertRewards = {
  MissionAlert_Proto_01: [["CardPack:zcp_mtx_boost50", 1], ["CardPack:zcp_reagent_c_t01_medium", 1]],
  MissionAlert_Proto_02: [["CardPack:zcp_mtx_boost50", 1], ["CardPack:zcp_reagent_c_t02_medium", 1]],
  MissionAlert_Proto_03: [["CardPack:zcp_mtx_boost100", 1], ["CardPack:zcp_reagent_c_t03_medium", 1]],
  MissionAlert_Proto_04: [["CardPack:zcp_mtx_boost100", 1], ["CardPack:zcp_reagent_c_t04_medium", 1]]
};

function alertFor(data, mission) {
  const tile = data.tiles[mission.tileIndex];
  const tier = missionAlertTier(mission.missionDifficultyInfo.rowName);
  if (!tile?.canBeMissionAlert || !tier || !alertRewards[tier.lootTierGroup]) return undefined;
  if (tier.zoneThemes.length && !tier.zoneThemes.includes(tile.zoneTheme)) return undefined;
  if (tier.missionGenerator && tier.missionGenerator !== mission.missionGenerator) return undefined;
  return tier;
}

// Core's placement (the client's theater info would say how many, and none ships): each region gets one alert, on one
// of its missions whose tile can carry one and whose difficulty has a MissionAlerts row.
function rollAlerts({ data }, missions, day, availableUntil) {
  return data.regions.flatMap((region, regionIndex) => {
    const seed = `${data.uniqueId}:${day}:alert:${regionIndex}`;
    const candidates = missions.filter((mission) => region.tileIndices.includes(mission.tileIndex) && alertFor(data, mission));
    if (!candidates.length) return [];
    const [mission] = shuffled(candidates.map((candidate) => candidate.missionGuid), seed)
      .map((guid) => candidates.find((candidate) => candidate.missionGuid === guid));
    const { lootTierGroup } = alertFor(data, mission);
    return [{
      missionAlertGuid: missionGuid(seed),
      tileIndex: mission.tileIndex,
      availableUntil,
      missionAlertRewards: {
        tierGroupName: lootTierGroup,
        items: alertRewards[lootTierGroup].map(([itemType, quantity]) => ({ itemType, quantity }))
      }
    }];
  });
}

// FFortActiveTheaterInfo, the body of GET /fortnite/api/game/v2/world/info.
export function worldInfo(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const availableUntil = `${day}T23:59:59.999Z`;
  const missions = theaters.map((theater) => rollMissions(theater, day, availableUntil));
  return {
    theaters: theaters.map((theater) => theater.data),
    missions: theaters.map((theater, index) => ({
      theaterId: theater.data.uniqueId,
      availableMissions: missions[index],
      nextRefresh: availableUntil
    })),
    missionAlerts: theaters.map((theater, index) => ({
      theaterId: theater.data.uniqueId,
      availableMissionAlerts: rollAlerts(theater, missions[index], day, availableUntil),
      nextRefresh: availableUntil
    }))
  };
}

// A mission by its guid (and the alert on it, by the alert's guid): today's, or yesterday's for a match that started
// before UTC midnight.
export function findMission(missionGuid, now = new Date(), missionAlertGuid = "") {
  if (!missionGuid) return null;
  for (const day of [now, new Date(now.getTime() - 24 * 60 * 60 * 1000)]) {
    const info = worldInfo(day);
    for (const [index, theater] of info.missions.entries()) {
      const found = theater.availableMissions.find((candidate) => candidate.missionGuid === missionGuid);
      if (!found) continue;
      const alert = missionAlertGuid && info.missionAlerts[index].availableMissionAlerts
        .find((candidate) => candidate.missionAlertGuid === missionAlertGuid && candidate.tileIndex === found.tileIndex);
      const zoneTheme = info.theaters[index].tiles[found.tileIndex]?.zoneTheme;
      return { theaterId: theater.theaterId, ...found, zoneTheme, ...(alert && { missionAlert: alert }) };
    }
  }
  return null;
}
