import crypto from "node:crypto";
import { candy } from "../events/fortnitemares.js";
import { perBuild } from "../gamedata/read.js";
import { getDifficulty, missionAlertTier } from "../gamedata/world.js";
import { candyReward, hexsylvania, isHexsylvania } from "./hexsylvania.js";
import { linkedQuests, questPath } from "./quests.js";

// The story opens each later theater: the client's TheaterSelect shows "Requires completing quest: {Quest}" for
// RuntimeInfo.Requirements.QuestDefinition and only enables Select once AFortPlayerController::IsRequirementsMet
// (sub_755C40: that quest held and completed) passes. The dump the layouts come from has its requirements emptied,
// so the gates are restored from the quest chain: each zone's Launch the Rocket quest grants the next zone's first
// storm shield quest ("Onward to Canny Valley!").
const storyGates = {
  D477605B4FA48648107B649CE97FCF27: "/Game/Quests/Stonewood/StonewoodQuest_LaunchRocket_D5.StonewoodQuest_LaunchRocket_D5",
  E6ECBD064B153234656CB4BDE6743870: "/Game/Quests/Plankerton/PlankertonQuest_LaunchRocket_D5.PlankertonQuest_LaunchRocket_D5",
  D9A801C5444D1C74D1B7DAB5C7C12C5B: "/Game/Quests/CannyValley/CannyValleyQuest_LaunchRocket_D5.CannyValleyQuest_LaunchRocket_D5"
};

// The storm shield opens each zone of a theater: the client hides a region's tiles under the storm until
// IsRequirementsMet(region Requirements) passes (sub_812C00), and every zone's story quests (tag
// Stat.Theater.PvE0<t>.Difficulty0<n>, objectives complete_pve0<t>_diff<n>) start from Storm Shield Defense <n>
// (OutpostQuest_T<t>_L<n>, bExpandsStormShield). The dump's regions have their requirements emptied, so each zone
// gets that defense's quest as Requirements.QuestDefinition again.
const outpostQuest = (theater, defense) =>
  `/Game/Quests/Outpost/OutpostQuest_T${theater}_L${defense}.OutpostQuest_T${theater}_L${defense}`;
function zoneGate(region) {
  for (const { tagName } of region.regionTags?.gameplayTags ?? []) {
    const zone = /^Stat\.Theater\.PvE0(\d)\.Difficulty0(\d)$/.exec(tagName);
    if (zone) return outpostQuest(Number(zone[1]), Number(zone[2]));
  }
  return undefined;
}

// The story quests each tile was placed for: the client marks a tile whose linked quest is in progress
// (AFortTheaterMapTile::IsTileQuestRecommended, sub_813150), shows the pin on it while that quest is the marked one
// (IsTileValidForMarkedQuest → sub_8136B0 → sub_812E90) and goes there first when the quest log's Play picks a tile
// (SelectTileForQuest, sub_819190: a linked tile is validity 2 in GetMissionQuestValidity, ahead of tiles whose mission
// only meets the objectives, 3). The dump kept these entries without their quests; see linkedQuests for the rebuild.
//
// Theater layouts come from Epic's world info (see tools/theaters/import.mjs); the client ships none. Every build has
// the same layouts, finished with the requesting build's quests.
//
// 1.7.2 tags the campaign's theaters Theater.MainProgression (its ActivitiesTags define the tag), and only a theater with
// it takes quest driven missions (SharedMissionLists TheaterTagQuery: the tapes of ReactiveQuest_DistressCalls and the
// like), so without it the client found no mission for those quests and hid their Play Now (Core-Backend #45). The
// dump predates the tag; the main theaters (Stonewood to Twine Peaks) get it in builds that define it.
const mainProgression = "Theater.MainProgression";
const isMainTheater = (data) => data.runtimeInfo.theaterType === "Standard" &&
  (data.runtimeInfo.theaterTags?.gameplayTags ?? []).some(({ tagName }) => /^Stat\.Theater\.PvE0\d$/.test(tagName));

const layout = perBuild((read) => {
  const { theaters = [], rewards = {} } = read("theaters", {});
  const { theaterTags = [] } = read("world", {});
  for (const { data } of theaters) {
    if (theaterTags.includes(mainProgression) && isMainTheater(data)) {
      data.runtimeInfo.theaterTags = { gameplayTags: [...data.runtimeInfo.theaterTags.gameplayTags, { tagName: mainProgression }] };
    }
    const questDefinition = storyGates[data.uniqueId];
    if (questDefinition) data.runtimeInfo.requirements = { ...data.runtimeInfo.requirements, questDefinition };
    for (const region of data.regions) {
      const zoneQuest = zoneGate(region);
      if (zoneQuest) region.requirements = { ...region.requirements, questDefinition: zoneQuest };
    }
    const links = linkedQuests(data);
    data.tiles.forEach((tile, index) => {
      tile.linkedQuests = (links.get(index) ?? []).flatMap((questId) => {
        const linked = questPath(questId);
        return linked ? [{ questDefinition: linked }] : [];
      });
    });
  }
  return { theaters, rewards };
});

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

// A mission's rewards: its loot tier group's count of zone card packs, each drawn by weight from the packs that group's
// missions carried in Epic's world info (tools/theaters/import.mjs), so missions of one difficulty mostly show its XP
// packs and now and then materials, as Epic's did. A group seen on one mission only (storm shields, the tutorial) keeps
// that mission's packs.
// A Hexsylvania mission (world/hexsylvania.js) also gives Candy, which world info shows with its other rewards.
function missionRewards(seed, tierGroupName, theaterId, rowName) {
  const { count = 0, pool = [] } = layout().rewards[tierGroupName] ?? {};
  const drawn = pool.reduce((total, reward) => total + reward.weight, 0);
  const items = drawn <= count ? pool.flatMap(({ itemType, quantity, weight }) => Array(weight).fill({ itemType, quantity }))
    : Array.from({ length: count }, (_, index) => weighted(pool, `${seed}:reward:${index}`));
  if (isHexsylvania(theaterId)) items.push({ itemType: candy, quantity: candyReward(rowName) });
  return { tierGroupName, items: items.map(({ itemType, quantity }) => ({ itemType, quantity })) };
}

function mission(seed, theaterId, tileIndex, missionGenerator, missionDifficultyInfo, tierGroupName, availableUntil) {
  return {
    missionGuid: missionGuid(seed),
    missionRewards: missionRewards(seed, tierGroupName, theaterId, missionDifficultyInfo.rowName),
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
  const missions = fixedMissions.map((fixed) => mission(`${data.uniqueId}:${day}:fixed:${fixed.tileIndex}`, data.uniqueId, fixed.tileIndex,
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
      missions.push(mission(tileSeed, data.uniqueId, tileIndex, weighted(generators, `${tileSeed}:generator`).missionGenerator,
        difficultyInfo, tierGroupName, availableUntil));
    }
  });
  return missions;
}

// What an alert gives, by the loot tier group of its MissionAlerts row. No shipped loot table has these groups (Epic
// rolled them on its servers), so this is Core's: V-bucks and the tier's reagents, as the client's own zone packs.
//
// Hexsylvania's alerts come from the HalloweenCategory row (MissionAlert_41, LootTierGroup Halloween2017_MissionAlert,
// every difficulty), whose category is the Transylvania theater's (MissionAlertCategories). What it gave was Epic's
// too; Core's is Candy (🟡: 100, a few missions' worth).
//
// The storm alerts (StormLowCategory rows, MissionAlert_23-39: MissionAlert_Storm_T04 to T20, one tile difficulty each
// from 8 to 40) are Core's too (🟡): no V-Bucks, the zone's reagents at the "high" size (T04-T05 Stonewood's, T06-T10
// Plankerton's, T11-T15 Canny Valley's, T16-T20 Twine Peaks').
const halloweenAlerts = "Halloween2017_MissionAlert";
const stormTier = (tier) => (tier <= 5 ? 1 : tier <= 10 ? 2 : tier <= 15 ? 3 : 4);
const alertRewards = {
  [halloweenAlerts]: [[candy, 100]],
  MissionAlert_Proto_01: [["CardPack:zcp_mtx_boost50", 1], ["CardPack:zcp_reagent_c_t01_medium", 1]],
  MissionAlert_Proto_02: [["CardPack:zcp_mtx_boost50", 1], ["CardPack:zcp_reagent_c_t02_medium", 1]],
  MissionAlert_Proto_03: [["CardPack:zcp_mtx_boost100", 1], ["CardPack:zcp_reagent_c_t03_medium", 1]],
  MissionAlert_Proto_04: [["CardPack:zcp_mtx_boost100", 1], ["CardPack:zcp_reagent_c_t04_medium", 1]],
  ...Object.fromEntries(Array.from({ length: 17 }, (_, index) => index + 4).map((tier) =>
    [`MissionAlert_Storm_T${String(tier).padStart(2, "0")}`, [[`CardPack:zcp_reagent_c_t0${stormTier(tier)}_high`, 1]]]))
};

function alertFor(data, mission, category) {
  const tile = data.tiles[mission.tileIndex];
  const tier = missionAlertTier(mission.missionDifficultyInfo.rowName, category);
  if (!tile?.canBeMissionAlert || !tier || !alertRewards[tier.lootTierGroup]) return undefined;
  if (tier.zoneThemes.length && !tier.zoneThemes.includes(tile.zoneTheme)) return undefined;
  if (tier.missionGenerator && tier.missionGenerator !== mission.missionGenerator) return undefined;
  return tier;
}

// Core's placement (the client's theater info would say how many, and none ships): each region gets one alert of each
// category the theater has, on missions whose tile can carry one and whose difficulty has a row of that category, one
// alert a mission. A main theater's are a general one (MissionAlert_1-4) and a storm one (StormLowCategory), Hexsylvania's
// a Halloween one. The alert names its category (FFortAvailableMissionAlertData CategoryName), which the map tile looks
// up in MissionAlertCategories (AFortTheaterMapTile::GetMissionAlertCategory, 1.8 0x8F3D40, the tile's alert's category
// name): BP_Hex_PARENT's HandleMissionAlert shows every alert's indicator and, for Storm and StormLow, the storm swirl
// (P_StormAffected) and its timer (Core-Backend #91). Without a name every alert was General.
function rollAlerts({ data }, missions, day, availableUntil) {
  const categories = isHexsylvania(data.uniqueId) ? ["HalloweenCategory"] : ["GeneralCategory", "StormLowCategory"];
  return data.regions.flatMap((region, regionIndex) => {
    const taken = new Set();
    return categories.flatMap((category) => {
      // The general alert keeps the seed alerts had before categories, so a day's alerts kept their guids.
      const seed = `${data.uniqueId}:${day}:alert:${regionIndex}${category === "GeneralCategory" ? "" : `:${category}`}`;
      const candidates = missions.filter((mission) => region.tileIndices.includes(mission.tileIndex) && !taken.has(mission.missionGuid)
        && alertFor(data, mission, category));
      if (!candidates.length) return [];
      const [mission] = shuffled(candidates.map((candidate) => candidate.missionGuid), seed)
        .map((guid) => candidates.find((candidate) => candidate.missionGuid === guid));
      taken.add(mission.missionGuid);
      const { lootTierGroup } = alertFor(data, mission, category);
      return [{
        categoryName: category,
        missionAlertGuid: missionGuid(seed),
        tileIndex: mission.tileIndex,
        availableUntil,
        missionAlertRewards: {
          tierGroupName: lootTierGroup,
          items: alertRewards[lootTierGroup].map(([itemType, quantity]) => ({ itemType, quantity }))
        }
      }];
    });
  });
}

// FFortActiveTheaterInfo, the body of GET /fortnite/api/game/v2/world/info.
// The mission's reward chest level, from the badges' mission points: the client's "Level N Loot" (Results_Summary
// PointsPerLootLevel 5, InitializeLootChest; 1.7.2 sub_5DDB80 caps it): points / 5 + 1, up to 6.
export function missionLootLevel(missionPoints) {
  return Math.min(Math.floor(wholePoints(missionPoints) / 5), 5) + 1;
}

// The pack_source of a won mission's reward packs. Back in the lobby the rewards screen's chest takes its level from
// them, not from the mission: 1.7.2's AreMissionRewardsAvailable (sub_6FB500) reads the number after "Mission" and one
// more character of each "Mission" pack's pack_source, and puts the largest into the cached reward report's mission
// points (+0x64), which sub_5DDB80 turns into the level as above. A bare "Mission" is 0 points, a level 1 chest (#53).
export function missionPackSource(missionPoints) {
  return `Mission_${wholePoints(missionPoints)}`;
}

const wholePoints = (missionPoints) => (Number.isFinite(missionPoints) && missionPoints > 0 ? Math.floor(missionPoints) : 0);

export function worldInfo(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const availableUntil = `${day}T23:59:59.999Z`;
  const event = hexsylvania();
  const theaters = event ? [...layout().theaters, event] : layout().theaters;
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

// A mission played at another difficulty row (Core's): its rewards are that row's loot tier group's, as rolled missions'.
export function atDifficulty(mission, rowName) {
  if (!rowName || rowName === mission.missionDifficultyInfo.rowName) return mission;
  const tierGroupName = getDifficulty(rowName)?.lootTierGroup ?? "";
  return {
    ...mission,
    missionDifficultyInfo: { ...mission.missionDifficultyInfo, rowName },
    missionRewards: missionRewards(`${mission.missionGuid}:${rowName}`, tierGroupName, mission.theaterId, rowName)
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
