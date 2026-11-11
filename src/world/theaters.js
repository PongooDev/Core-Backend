import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { blockbuster2018, cramSession2018, currentEventsConfig, isEventActive, passiveMiniBosses, spring2018, storm2018 } from "../events/events.js";
import { blockbusterTickets, miniBossTicketsFor } from "../events/blockbuster2018.js";
import { cramSessionMiniBossRewards } from "../events/cramsession2018.js";
import { candy } from "../events/fortnitemares.js";
import { miniBossesStay, mutantStorms, mutantStorms2018, stormTickets } from "../events/mutantstorms.js";
import { firecrackerTickets } from "../events/spring2018.js";
import { snowflakeTickets, winter2017 } from "../events/winter2017.js";
import { getItem } from "../gamedata/items.js";
import { perBuild } from "../gamedata/read.js";
import { elementalZones, getDifficulty, megaAlertCategory, missionAlertSpread, missionAlertTier } from "../gamedata/world.js";
import { hasEventStore, seasonalGold } from "../store/eventstore.js";
import { candyReward, hexsylvania, isHexsylvania } from "./hexsylvania.js";
import { hordeAlertRewards, hordeMissionRewards } from "../events/roadtrip2018.js";
import { hordeTheater, hordeWeeklyTheater, isHorde, isHordeTierGroup } from "./horde.js";
import { linkedQuests, questPath } from "./quests.js";
import { isSurvival, survivalAlertGenerators, survivalReward, survivalTheater } from "./survival.js";

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
// A main theater's zone, 1 (Stonewood, Stat.Theater.PvE01) to 4 (Twine Peaks); 0 for any other theater.
const theaterZone = (data) => Number((data.runtimeInfo.theaterTags?.gameplayTags ?? [])
  .map(({ tagName }) => /^Stat\.Theater\.PvE0(\d)$/.exec(tagName)?.[1]).find(Boolean) ?? 0);

// 2.3's "Mini-boss Alerts can now be played in higher-difficulty missions that you have not unlocked yet." The client
// reads that per theater: FFortTheaterRuntimeData MissionAlertCategoryRequirements, an array of
// FFortMissionAlertRuntimeData {MissionAlertCategoryName (an FName from 2.2), bRespectTileRequirements, bAllowQuickplay}
// (2.3's SDK), the tile's region requirements (the zone gates above) being what a category with bRespectTileRequirements
// off skips (🟡: read from the field names, the check is native). Epic's world info sends the same entry shape
// ({"missionAlertCategoryName": "Survival3DayCategory", "bRespectTileRequirements": true, "bAllowQuickplay": true}). So
// while 2.3's storms keep the Mini-Bosses (2.4's and 2.4.2's too), each main theater sends MiniBossCategory with bRespectTileRequirements false.
const miniBossesUnlocked = [{ missionAlertCategoryName: "MiniBossCategory", bRespectTileRequirements: false, bAllowQuickplay: true }];
const withAlertCategoryRequirements = (data) => (theaterZone(data) && miniBossesStay()
  ? { ...data, runtimeInfo: { ...data.runtimeInfo, missionAlertCategoryRequirements: miniBossesUnlocked } } : data);

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
// A Hexsylvania mission (world/hexsylvania.js) also gives Candy, which world info shows with its other rewards. A Survive
// the Storm mission's group (Mission_Select_Survival_T0<n>) is in no world info: it gives its Survival Rewards pack.
// A group mission (groupMissions) draws from its solo tier's pool (soloTierGroup) twice over.
function missionRewards(seed, tierGroupName, theaterId, rowName, soloTierGroup = null) {
  const { count: soloCount = 0, pool: worldPool = [] } = layout().rewards[soloTierGroup ?? tierGroupName] ?? {};
  const pool = perkRewardPool(soloTierGroup ?? tierGroupName, outpostVouchers(tierGroupName, worldPool));
  const count = soloTierGroup ? 2 * soloCount : soloCount;
  const drawn = pool.reduce((total, reward) => total + reward.weight, 0);
  const items = drawn <= count ? pool.flatMap(({ itemType, quantity, weight }) => Array(weight * (soloTierGroup ? 2 : 1)).fill({ itemType, quantity }))
    : Array.from({ length: count }, (_, index) => weighted(pool, `${seed}:reward:${index}`));
  if (isHexsylvania(theaterId)) items.push({ itemType: candy, quantity: candyReward(rowName) });
  const survival = isSurvival(theaterId) && survivalReward(tierGroupName);
  if (survival) items.push(survival);
  // A Challenge the Horde mission's (5.0, world/horde.js): its zone's Horde Points and perk pack (events/roadtrip2018.js).
  if (isHordeTierGroup(tierGroupName)) items.push(...hordeMissionRewards(rowName));
  const gold = seasonalGoldPack(soloTierGroup ?? tierGroupName);
  if (gold) items.push({ itemType: gold, quantity: 1 });
  return { tierGroupName, items: items.map(({ itemType, quantity }) => ({ itemType, quantity })) };
}

// 4.2's (CL-4072250) "Updated Mission Rewards and Mini-Boss Mission Alerts to sometimes award RE-PERK and PERK-UP as
// secondary loot rewards, beginning in early Plankerton. As a result: Crafting Materials (Ore, Gizmos, etc.) will appear
// significantly less often in later zones. XP and Evolution Materials (Drops of Rain, Lightning in a Bottle, etc.) will
// appear slightly less often." (Core-Backend #272). Epic's world info Core draws mission rewards from predates 4.2, so
// from 4.2 a mission of tier 6 on (Mission_Select_T06, early Plankerton, and up) draws from its pool reweighted: its
// crafting materials (ZCP_Ore_*, ZCP_Crystal_*, ZCP_Improvised_*) at half the weight in Plankerton and a quarter later,
// its XP and evolution materials (ZCP_*XP_*, ZCP_Reagent_C_*) at 85%, and the perk packs in: RE-PERK!
// (ZCP_Reagent_Alteration_Generic, Low in Plankerton, Medium in Canny Valley, High in Twine Peaks) at weight 2 and the
// zone's PERK-UP! at 1 between them (the packs' own descriptions: Uncommon "Found in Plankerton and Canny Valley", Rare
// "Found in Canny Valley", Epic "Found in Canny Valley and Twine Peaks", Legendary "Found in Twine Peaks"). 🟡 The weights
// are Core's: the notes give only the direction.
export const perkRewardsBuild = 4072250;
const perkUpRarities = [[], [], ["uc"], ["uc", "r", "vr"], ["vr", "sr"]];
const perkLevels = ["", "", "low", "medium", "high"];
const missionZone = (tier) => (tier <= 5 ? 1 : tier <= 10 ? 2 : tier <= 15 ? 3 : 4);
const perkRewardsOn = () => Number(currentBuild()) >= perkRewardsBuild && Boolean(getItem("CardPack:zcp_reagent_alteration_generic_low"));
export function perkRewardPool(tierGroupName, pool) {
  const tier = Number(/^Mission_Select_T(\d\d)$/.exec(tierGroupName ?? "")?.[1]);
  if (!tier || tier < 6 || !perkRewardsOn()) return pool;
  const zone = missionZone(tier);
  const reweighted = pool.map((reward) => {
    const id = reward.itemType.toLowerCase();
    const scale = /^cardpack:zcp_(ore|crystal|improvised)_/.test(id) ? (zone === 2 ? 0.5 : 0.25)
      : /^cardpack:zcp_(\w+xp_|reagent_c_)/.test(id) ? 0.85 : 1;
    return { ...reward, weight: reward.weight * scale };
  });
  const ups = perkUpRarities[zone];
  return [...reweighted, { itemType: `CardPack:zcp_reagent_alteration_generic_${perkLevels[zone]}`, quantity: 1, weight: 2 },
    ...ups.map((rarity) => ({ itemType: `CardPack:zcp_reagent_alteration_upgrade_${rarity}`, quantity: 1, weight: 1 / ups.length }))];
}
// A Mini-Boss alert from Plankerton on (4.2 on): one perk pack besides its rewards, RE-PERK! or the zone's PERK-UP! by its
// seed.
function miniBossPerkPack(zone, seed) {
  if (zone < 2 || !perkRewardsOn()) return [];
  const choices = [`CardPack:zcp_reagent_alteration_generic_${perkLevels[zone]}`, ...perkUpRarities[zone].map((rarity) => `CardPack:zcp_reagent_alteration_upgrade_${rarity}`)];
  return [[choices[Math.floor(fraction(digest(`${seed}:perk`)) * choices.length)], 1]];
}

// 4.2's (CL-4072250) "Mini Llama rewards now scale for Storm Shield Defenses. Before, players could earn a fixed amount of
// Mini Llamas (1-4) based on mission performance, as it didn't take difficulty into account. The new reward breakdown for
// Mini Llamas is as follows: Stonewood: 1 to 4, Plankerton: 2 to 5, Canny Valley: 3 to 6, Twine Peaks: 4 to 7" (Core-Backend
// #273). 4.2's data adds a Mini Reward Llama pack for each zone's defenses, ZCP_Voucher_BasicPack_Outpost_Theater1-4 (loot
// tier 1 to 4 of ZCP_Voucher_BasicPack_Outpost), so on a build that has them a storm shield defense
// (Outpost_Select_Theater<n>) gives its zone's pack in place of the plain ZCP_Voucher_BasicPack Epic's world info shows,
// and the reward chest's level (missionLootLevel, 1 to 6: the "mission performance") sets how many, n - 1 more than the
// level, the level counted to 4: missionRewardQuantity. Earlier builds keep the plain pack, as many as the chest's level.
const outpostVoucherPack = (theater) => `CardPack:zcp_voucher_basicpack_outpost_theater${theater}`;
function outpostVouchers(tierGroupName, pool) {
  const theater = /^Outpost_Select_Theater(\d)$/.exec(tierGroupName ?? "")?.[1];
  if (!theater || !getItem(outpostVoucherPack(theater))) return pool;
  return pool.map((reward) => (reward.itemType.toLowerCase() === "cardpack:zcp_voucher_basicpack" ? { ...reward, itemType: outpostVoucherPack(theater) } : reward));
}
// How many of a won mission's reward the player gets at the reward chest's level: the reward's quantity times the level
// (🟡 Core-Backend #53), but a defense's zone Mini Llama pack (4.2, above): the zone's base and the level up to 4.
export function missionRewardQuantity(itemType, quantity, lootLevel) {
  const theater = /^cardpack:zcp_voucher_basicpack_outpost_theater(\d)$/i.exec(itemType ?? "")?.[1];
  return theater ? quantity * (Number(theater) - 1 + Math.min(lootLevel, 4)) : quantity * lootLevel;
}

// Seasonal Gold from every mission while the Event Store is open (1.11 to 3.3 and 3.5.1, store/eventstore.js): 1.11's "Play any
// mission and earn Seasonal Gold", 2.3's "All missions will continue to award Seasonal Gold". The game's own pack for it
// is ZCP_EventScaling_T01-T20 ("Seasonal Gold", "Special currency found throughout the world. Can be traded for items in
// the Event Store."), one a mission tier as the XP packs: Mission_Select_T<nn> takes T<nn>, a storm shield defense
// (Outpost_Select_Theater<n>) its zone's last tier (T05, T10, T15, T20). How much it holds is cardpacks/contents.js's.
function seasonalGoldPack(tierGroupName) {
  if (!hasEventStore()) return undefined;
  const mission = /^Mission_Select_T(\d\d)$/.exec(tierGroupName)?.[1];
  const outpost = /^Outpost_Select_Theater(\d)$/.exec(tierGroupName)?.[1];
  const tier = mission ?? (outpost ? String(5 * Number(outpost)).padStart(2, "0") : undefined);
  const templateId = tier && `CardPack:zcp_eventscaling_t${tier}`;
  return templateId && getItem(templateId) ? templateId : undefined;
}

function mission(seed, theaterId, tileIndex, missionGenerator, missionDifficultyInfo, tierGroupName, availableUntil, soloTierGroup = null) {
  return {
    missionGuid: missionGuid(seed),
    missionRewards: missionRewards(seed, tierGroupName, theaterId, missionDifficultyInfo.rowName, soloTierGroup),
    missionModifiers: { tierGroupName: "", items: [] },
    missionGenerator,
    missionDifficultyInfo,
    tileIndex,
    availableUntil
  };
}

// 3.1's (CL-3915963) group missions: "We have added new group missions to all theaters. Currently the mission is 'Fight
// the Storm' with encounters designed for 4 players. These missions allow 4 extra Defenders to be used. Rewards for group
// missions should be roughly double, except for Spring It On! Gold (the latter remains unchanged)." Its data has the
// mission, MissionGen_1Gate_Group (GroupGate_Single, a child of Stonewood's MissionGen_1Gate), and its difficulty rows,
// Theater_<Start|Normal|Hard|Nightmare>_Group_Zone<1-5> ("<power> - 4 Players", loot tier groups Mission_Select_Group_T01
// to T20), which no world info Core has places (tools/theaters is 2.x's). So, on a build whose data has them (🟡 Core's
// layout): each main theater region that rolls missions also hosts one group mission a day, on one more of its Normal
// tiles, at the group row of the difficulty it rolls (Theater_Normal_Zone3 → Theater_Normal_Group_Zone3), its rewards
// twice the solo tier's draw (the group tiers have no world info pool) and its Seasonal Gold the solo tier's.
//
// 3.2 (CL-3935073): "Group Missions now include Fight the Storm Category 1, 2, 3 and 4, Retrieve the Data, Ride the
// Lightning, Evacuate the Shelter, Repair the Shelter and Deliver the Bomb. Which missions a player sees depends on their
// progression." Its data adds a group generator for each: MissionGen_2Gates_Group, _3Gates_Group and _4Gates_Group
// (GroupGate_Double, _Triple, _Quadruple), MissionGen_RetrieveTheData_Group (GroupRetrieveTheData),
// MissionGen_RideTheLightning_Group (LaunchTheBalloon/GroupRideTheStorm), and Plankerton's MissionGen_EtShelter_Group,
// MissionGen_RtS_Group and MissionGen_DtB_Group (children of MissionGen_T2_EtShelter, MissionGen_T2_RtS and
// _MissionGen_T2_PARENT); the 1Gate, Retrieve the Data and Ride the Lightning ones have _PVE02on children whose secondary
// missions are Plankerton's and on (BluGlo_Nodes_PVE_02). No world info Core has places them, so progression is the map's
// (🟡 Core's reading): a group mission is the group kind of a mission its region rolls (the region's weights, so
// Stonewood's are Category 1 and 2, Plankerton's add the shelters and bombs, Twine Peaks' Category 3 and 4), the _PVE02on
// one outside Stonewood, and every region waits for its zone's Storm Shield Defense quest (zoneGate above), which is
// the notes' "Group Missions now require Storm Shield Defense quest progression to unlock". Stonewood's regions have no
// Normal tiles (all AlwaysActive), so 3.1 placed none there; from 3.2 a region without a spare Normal tile gives one of
// its AlwaysActive tiles that no story quest links to over to its group mission (🟡 Core's).
const groupGenerator = "/Game/World/MissionGens/MissionGen_1Gate_Group.MissionGen_1Gate_Group_C";
const groupMissions = perBuild((read) => Boolean(read("world", {}).missionGenerators?.[groupGenerator]));
const groupRowOf = (rowName) => {
  const match = /^Theater_(Start|Normal|Hard|Nightmare)_Zone(\d)$/.exec(rowName ?? "");
  return match ? `Theater_${match[1]}_Group_Zone${match[2]}` : null;
};
// A solo generator's kind, by its class name's parts (MissionGen_T2_R5_RtS_C, MissionGen_T1_HT_Cat1FtS_C), and the
// group generator of that kind.
const groupKinds = [
  [["1Gate", "Cat1FtS"], "MissionGen_1Gate_Group"],
  [["2Gates", "Cat2FtS"], "MissionGen_2Gates_Group"],
  [["3Gates"], "MissionGen_3Gates_Group"],
  [["4Gates"], "MissionGen_4Gates_Group"],
  [["RtD", "RetrieveTheData"], "MissionGen_RetrieveTheData_Group"],
  [["RtL", "LtB", "LaunchTheBalloon"], "MissionGen_RideTheLightning_Group"],
  [["EtShelter"], "MissionGen_EtShelter_Group"],
  [["RtS"], "MissionGen_RtS_Group"],
  [["DtB"], "MissionGen_DtB_Group"]
];
// 3.2's group generators by class name (MissionGen_RtS_Group_C → its path), from the build's data; none before 3.2.
const groupGenerators = perBuild((read) => {
  const paths = Object.keys(read("world", {}).missionGenerators ?? {});
  if (!paths.some((path) => path.endsWith(".MissionGen_RetrieveTheData_Group_C"))) return new Map();
  return new Map(paths.filter((path) => /_Group(_PVE02on)?_C$/.test(path)).map((path) => [path.split(".").pop(), path]));
});
export const groupMissionTypes = () => groupGenerators().size > 0;
export const isGroupMission = (missionGenerator) => /\/MissionGen_[^/]*_Group(_PVE02on)?\.[^/]*$/.test(missionGenerator ?? "");
function groupGeneratorOf(missionGenerator, zone) {
  const parts = (missionGenerator.split(".").pop() ?? "").replace(/^MissionGen_|_C$/g, "").split("_");
  if (parts.includes("Tutorial") || parts.includes("NoSecondary")) return undefined;
  const kind = groupKinds.find(([names]) => names.some((name) => parts.includes(name)));
  if (!kind) return undefined;
  return (zone > 1 && groupGenerators().get(`${kind[1]}_PVE02on_C`)) || groupGenerators().get(`${kind[1]}_C`);
}
// The group generators a tile's region rolls (3.2), weighted as their solo kinds; 3.1's one generator before.
function groupGeneratorsFor(generators, zone) {
  if (!groupMissionTypes()) return [{ missionGenerator: groupGenerator, weight: 1 }];
  const weights = new Map();
  for (const { missionGenerator, weight = 1 } of generators) {
    const group = groupGeneratorOf(missionGenerator, zone);
    if (group) weights.set(group, (weights.get(group) ?? 0) + weight);
  }
  return [...weights].map(([missionGenerator, weight]) => ({ missionGenerator, weight }));
}

// As in Epic's data: every AlwaysActive tile hosts a mission, and each region adds numMissionsAvailable missions on
// its Normal tiles. A tile's own weights override the region's.
function rollMissions({ data, fixedMissions }, day, availableUntil) {
  const missions = fixedMissions.map((fixed) => mission(`${data.uniqueId}:${day}:fixed:${fixed.tileIndex}`, data.uniqueId, fixed.tileIndex,
    fixed.missionGenerator, fixed.missionDifficultyInfo, fixed.tierGroupName, availableUntil));
  const zone = theaterZone(data);

  data.regions.forEach((region, regionIndex) => {
    const missionData = region.missionData ?? {};
    if (!missionData.numMissionsAvailable) return;
    const seed = `${data.uniqueId}:${day}:region:${regionIndex}`;
    const ofType = (type) => region.tileIndices.filter((index) => data.tiles[index].tileType === type);
    const shuffledNormal = shuffled(ofType("Normal"), seed);
    const normal = shuffledNormal.slice(0, missionData.numMissionsAvailable);
    const spareAlwaysActive = () => shuffled(ofType("AlwaysActive").filter((index) => !data.tiles[index].linkedQuests?.length), `${seed}:group`)[0];
    const groupTile = zone && groupMissions()
      ? shuffledNormal[missionData.numMissionsAvailable] ?? (groupMissionTypes() ? spareAlwaysActive() : undefined) : undefined;
    let grouped = false;
    if (groupTile !== undefined) {
      const tile = data.tiles[groupTile];
      const difficulties = tile.difficultyWeightOverrides?.length ? tile.difficultyWeightOverrides : missionData.difficultyWeights ?? [];
      const generators = groupGeneratorsFor(tile.missionWeightOverrides?.length ? tile.missionWeightOverrides : missionData.missionWeights ?? [], zone);
      const tileSeed = `${seed}:group:${groupTile}`;
      const solo = difficulties.length ? weighted(difficulties, `${tileSeed}:difficulty`).difficultyInfo : null;
      const groupRow = groupRowOf(solo?.rowName);
      const group = groupRow && getDifficulty(groupRow);
      if (group && generators.length) {
        // 3.1's one generator keeps its seeds.
        const { missionGenerator } = generators.length === 1 ? generators[0] : weighted(generators, `${tileSeed}:generator`);
        missions.push(mission(tileSeed, data.uniqueId, groupTile, missionGenerator, { ...solo, rowName: groupRow },
          group.lootTierGroup ?? "", availableUntil, getDifficulty(solo.rowName)?.lootTierGroup ?? ""));
        grouped = true;
      }
    }
    for (const tileIndex of [...ofType("AlwaysActive"), ...normal]) {
      if (grouped && tileIndex === groupTile) continue;
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
//
// 1.9.1 renamed the rows (MissionAlert_<Category>_0N) and gave its storm rows, StormLowCategory's and the Mutant Storms'
// StormCategory (EventFlag.Vindertech), one loot tier group, MissionAlert_Storm, a row per zone (tile difficulty 5-11
// Stonewood, 12-21 Plankerton, 22-31 Canny Valley, 32-50 Twine Peaks, named by the row's ModifierTierGroup). Core's
// table had no such group, so 1.9.1 had no storm alerts and no storm swirls (Core-Backend #129). Its rewards (🟡 Core's):
// the zone's reagents (high) and, while the Mutant Storms run, Storm Tickets (EventCurrency_StormZone), 10 per tile
// difficulty: 1.9.1's notes say the Storm Tickets Mutant Storms give are the same on every hex of a difficulty.
//
// 1.11 (CL-3807424) gives StormLowCategory its own group, MissionAlert_StormLow (EventFlag.PassiveStorms): the storms
// left on the map once the Mutant Storms end, "to provide evolution materials, these do not reward event tickets", so
// the zone's reagents (high) alone. Its Survive the Holidays' Mini-Boss alerts (MiniBossCategory, MissionAlert_MiniBoss,
// EventFlag.Winter2017, a row per zone by tile difficulty as the storm rows) "reward event tickets": Snowflake Tickets
// (EventCurrency_Snowballs), 10 per tile difficulty as the Mutant Storms' (🟡 Core's), and the zone's reagents (high).
// Its Survive the Storm alerts (Survival3DayCategory, MissionAlert_Survival3Day; Survival7DayCategory,
// MissionAlert_Survival7Day; EventFlag.Winter2017) go on the Survive the Storm theater's missions (world/survival.js,
// Core-Backend #172), 3 Day alerts on 3 Day missions and 7 Day ones on 7 Day missions. They "reward event tickets" too:
// Snowflake Tickets, 10 per tile difficulty as the Mini-Boss ones for a 3 Day alert and twice that for a 7 Day one
// (🟡 Core's).
//
// 2.3 (CL-3847564) brings the Mutant Storms back (events/mutantstorms.js mutantStorms2018): its StormCategory rows
// (EventFlag.ActiveStorms) give Storm Tickets again, "Up to 5 Mutant Storms ... in Stonewood, and up to 25 Active Storms
// ... in Plankerton, Canny Valley, and Twine Peaks" (each zone's fixed target, as 1.10's, 🟡: read as each zone's), and
// its ticketless StormLow ones stop (events/events.js). Its Mini-Boss alerts stay without Survive the Holidays: "These
// Mini-boss alerts have replaced the old generic Mission Alerts", "Up to 3 of these Mini-Boss mission alerts can appear
// in Stonewood at a time and up to 6 at a time in Plankerton, Canny and Twine": no General alerts there, each theater's
// Mini-Bosses placed up to its target, and no Snowflake Tickets (the event is over). "Mini-boss Alerts reward a wide
// array of items, including transform keys, schematics, survivors, and more!" No shipped table has their loot tier group
// (MissionAlert_MiniBoss), so beside the zone's reagents and the General alerts' V-Bucks each gives one item rolled from
// the alert's seed (miniBossItems): a transform key, a weapon or trap schematic, a survivor, a hero or a defender, Rare in
// Stonewood, Epic in Plankerton and Canny Valley, Legendary in Twine Peaks (🟡 the odds and rarities are Core's).
//
// 2.4 (CL-3858292) runs the same storms and Mini-Bosses (events/events.js): its Mini-Boss rows wait for
// EventFlag.ActiveMiniBosses, which its storms run, and its notes change neither the targets nor the rewards, so its map
// is 2.3's. So is 2.4.2's (CL-3870737): its mission alert rows are 2.4's and its notes leave the storms alone.
//
// 2.5 (CL-3889387) ends them (events/events.js): "Both have returned to their lower "passive" levels of activity, and
// neither awards event tickets. Up to 3 Mutant Storms in Stonewood, 10 in other locations. | Quota: 4 per day. Up to 3
// Miniboss Alerts in Stonewood, 6 in other locations. | Quota: 3 per day." Its storms are its StormLowCategory rows
// (EventFlag.PassiveStorms, quota 4, the zone's reagents), its Mini-Bosses its General rows (EventFlag.PassiveMiniBosses,
// quota 3, the Mini-Boss modifier on the General alerts' V-Bucks and reagents), each theater placing up to its target of
// each, as 2.3's targets were read (passiveStormTargets, passiveMiniBossTargets). The quotas are the data's, not Core's:
// 2.5's and 3.0's MissionAlertCategories give StormLowCategory Quota 4 and GeneralCategory Quota 3, the General row
// tagged Stat.MissionAlert.MiniBoss and MissionAlert.Visual.Miniboss (profiles/alerts.js enforces them). The targets are
// the notes' (Epic's servers placed the alerts). Like 2.3 to 2.4.2's storms, they are placed once a UTC day.
//
// 3.5.1 (CL-4000805) runs Into the Storm (events/events.js storm2018): its Mutant Storms are the StormCategory rows again
// (EventFlag.ActiveStorms, quota 10), "award between 100 and 240 Storm Tickets, scaled based on difficulty", here Storm
// Tickets as 2.3's storms gave them (🟡 Core's amount, 10 per tile difficulty); its Survive the Storm alerts
// (EventFlag.SurviveTheStorm) "award between 300 and 1500 tickets, scaled based on Survival length and difficulty": Storm
// Tickets, 30 per tile difficulty for a 3 Day alert and 50 for a 7 Day one (🟡 Core's: 300 to 900 and 500 to 1,500 on
// the theater's difficulties 10 to 30). Its passive Mini-Bosses are 2.5's.
//
// 4.0 (CL-4039451) runs Blockbuster (events/events.js blockbuster2018): its Mini-Bosses are the MiniBossCategory rows
// (EventFlag.ActiveMiniBosses, quota 10), placed by 2.3's targets with 2.3's rewards (miniBossesStay) and "between 50 and
// 120 Blockbuster Tickets, scaled based on difficulty ... in addition to their normal rewards" (miniBossTicketsFor); its
// storms the passive StormLowCategory rows, which "no longer reward event tickets".
//
// 5.40 (CL-4352937) puts a Mega Alert (MegaAlertCategory, gamedata/world.js's rows, Core-Backend #317) on every group
// mission, in place of the group alert (a tile carries one alert: AFortTheaterMapTile MissionAlertData), so 5.40's
// group missions run no EventFlag.GroupMission (events/events.js). What it gives is megaAlertItems' and what it
// brings into the mission alertModifiers' (below).
//
// 6.00 (CL-4402180; CL-4395664 plays on its data) runs Cram Session (events/cramsession2018.js): "Mini-Boss Mission Alerts
// are active, and up to 10 can be completed per day" (MiniBossCategory, EventFlag.ActiveMiniBosses, quota 10), placed by
// 2.3's targets as Blockbuster's (miniBossesStay) and rewarded by cramSessionAlertItems: two XP, evolution or perk packs
// and Gold instead of tickets, and none of the hero, schematic, survivor, transform key or V-Bucks rewards.
const halloweenAlerts = "Halloween2017_MissionAlert";
// The elemental perk currencies (4.2's FIRE-UP!, AMP-UP!, FROST-UP!) and the zone modifiers that lock elemental husks to
// an element (GameplayModifier:ElementalZone<Element>EnableItem).
const elementalCurrency = { Fire: "AccountResource:reagent_alteration_ele_fire", Nature: "AccountResource:reagent_alteration_ele_nature",
  Water: "AccountResource:reagent_alteration_ele_water" };
const elementalModifier = (element) => `GameplayModifier:elementalzone${element.toLowerCase()}enableitem`;
const groupCategory = "GroupMissionCategory";
const stormTier = (tier) => (tier <= 5 ? 1 : tier <= 10 ? 2 : tier <= 15 ? 3 : 4);
const zones = ["Stonewood", "Plankerton", "CanneyValley", "TwinePeaks"];
const zoneOfModifierGroup = (group) => Math.max(zones.findIndex((zone) => group?.endsWith(`_${zone}`)), 0) + 1;
// A row's zone: its STMZ.ZoneMods_<zone> group, else (1.11's Mini-Boss rows, MinibossTG.EnablePrimaryMission) the zone
// its lowest tile difficulty is in (5 Stonewood, 12 Plankerton, 22 Canny Valley, 32 Twine Peaks).
const zoneOfRow = (row) => (row.modifierTierGroup?.startsWith("STMZ.ZoneMods_") ? zoneOfModifierGroup(row.modifierTierGroup)
  : row.minimumDifficulty >= 32 ? 4 : row.minimumDifficulty >= 22 ? 3 : row.minimumDifficulty >= 12 ? 2 : 1);
export const stormTicketsFor = (rowName) => {
  const base = Math.max(1, getDifficulty(rowName)?.difficulty ?? 1) * 10;
  const multiplier = currentEventsConfig()?.stormTicketMultiplier ?? 1.0;
  return Math.round(base * multiplier);
};
// 3.2's group mission alerts (GroupMissionCategory rows, loot tier group MissionAlert_GroupMission, see
// rollAlerts): "every Group Mission now has a Mission Alert that awards Firecracker Tickets. The ticket amount scales
// with difficulty." No shipped table has the group, so the amount is Core's (🟡): 10 Firecracker Tickets
// (AccountResource:eventcurrency_spring) per tile difficulty of the group row, as the event tickets of the storm and
// Mini-Boss alerts (Theater_Normal_Group_Zone1, difficulty 12: 120; Theater_Nightmare_Group_Zone5, 40: 400).
export const groupTicketsFor = (rowName) => Math.max(1, getDifficulty(rowName)?.difficulty ?? 1) * 10;
const alertRewards = {
  [halloweenAlerts]: () => [[candy, 100]],
  // 5.0's Challenge the Horde alerts (MissionAlert_HordeCategory_01, EventFlag.Horde; world/horde.js): Road Trip Tickets,
  // Horde Points and perk resources (events/roadtrip2018.js).
  HordeBash_MissionAlert: (row, mission) => hordeAlertRewards(mission.missionDifficultyInfo.rowName,
    getDifficulty(mission.missionDifficultyInfo.rowName)?.difficulty),
  MissionAlert_Proto_01: () => [["CardPack:zcp_mtx_boost50", 1], ["CardPack:zcp_reagent_c_t01_medium", 1]],
  MissionAlert_Proto_02: () => [["CardPack:zcp_mtx_boost50", 1], ["CardPack:zcp_reagent_c_t02_medium", 1]],
  MissionAlert_Proto_03: () => [["CardPack:zcp_mtx_boost100", 1], ["CardPack:zcp_reagent_c_t03_medium", 1]],
  MissionAlert_Proto_04: () => [["CardPack:zcp_mtx_boost100", 1], ["CardPack:zcp_reagent_c_t04_medium", 1]],
  ...Object.fromEntries(Array.from({ length: 17 }, (_, index) => index + 4).map((tier) =>
    [`MissionAlert_Storm_T${String(tier).padStart(2, "0")}`, () => [[`CardPack:zcp_reagent_c_t0${stormTier(tier)}_high`, 1]]])),
  MissionAlert_Storm: (row, mission) => [
    [`CardPack:zcp_reagent_c_t0${zoneOfModifierGroup(row.modifierTierGroup)}_high`, 1],
    ...(isEventActive(mutantStorms) || isEventActive(mutantStorms2018) || isEventActive(storm2018) ? [[stormTickets, stormTicketsFor(mission.missionDifficultyInfo.rowName)]] : [])
  ],
  MissionAlert_StormLow: (row) => [[`CardPack:zcp_reagent_c_t0${zoneOfRow(row)}_high`, 1]],
  // Outside Spring It On! (4.2's, Core-Backend #277) a group alert pays two of its zone's evolution material packs: 🟡 Epic's
  // group alert rewards past 3.3 aren't recorded; 3.1's notes have group missions' rewards "roughly double".
  MissionAlert_GroupMission: (row, mission) => (isEventActive(spring2018)
    ? [[firecrackerTickets, groupTicketsFor(mission.missionDifficultyInfo.rowName)]]
    : [[`CardPack:zcp_reagent_c_t0${zoneOfRow(row)}_high`, 2]]),
  // 4.2's Elemental Storm alerts (gamedata/world.js elementalZoneRows): the element's perk currency, more in later zones.
  // 🟡 Epic's amounts aren't recorded: Core's 30, 40 and 50 (Plankerton, Canny Valley, Twine Peaks).
  ...Object.fromEntries(elementalZones.map(([element]) => [`MissionAlert_Elemental${element}`, (row) =>
    [[elementalCurrency[element], 10 * (zoneOfRow(row) + 1)]]])),
  MissionAlert_Survival3Day: (row, mission) => (isEventActive(storm2018)
    ? [[stormTickets, 3 * stormTicketsFor(mission.missionDifficultyInfo.rowName)]] : [[snowflakeTickets, stormTicketsFor(mission.missionDifficultyInfo.rowName)]]),
  MissionAlert_Survival7Day: (row, mission) => (isEventActive(storm2018)
    ? [[stormTickets, 5 * stormTicketsFor(mission.missionDifficultyInfo.rowName)]] : [[snowflakeTickets, 2 * stormTicketsFor(mission.missionDifficultyInfo.rowName)]]),
  MissionAlert_MiniBoss: (row, mission, seed) => (isEventActive(cramSession2018) ? cramSessionAlertItems(zoneOfRow(row), mission, seed) : [
    [`CardPack:zcp_reagent_c_t0${zoneOfRow(row)}_high`, 1],
    ...(isEventActive(winter2017) ? [[snowflakeTickets, stormTicketsFor(mission.missionDifficultyInfo.rowName)]]
      : [[`CardPack:zcp_mtx_boost${zoneOfRow(row) <= 2 ? 50 : 100}`, 1], ...(miniBossesStay() ? miniBossItem(zoneOfRow(row), seed) : [])]),
    // 4.0's Blockbuster (events/blockbuster2018.js): 50 to 120 Blockbuster Tickets on top.
    ...(isEventActive(blockbuster2018) && getItem(blockbusterTickets) ? [[blockbusterTickets, miniBossTicketsFor(zoneOfRow(row))]] : []),
    // 4.2's perk resources (#272, perkRewardPool).
    ...miniBossPerkPack(zoneOfRow(row), seed)
  ]),
  // 5.40's Mega Alerts (#317, megaAlertItems).
  MissionAlert_MegaAlert: (row, mission, seed) => megaAlertItems(zoneOfRow(row), mission, seed)
};

// 5.40's Mega Alert rewards: "They may grant XP, evolution materials, perk materials, schematics or survivors. The amounts
// granted are considerably higher than normal Mission Alerts." No shipped table has their loot tier group
// (MissionAlert_MegaAlert), so each alert gives one kind, rolled from its seed, from the client's own packs (🟡 the odds
// and amounts are Core's; a storm alert gives one evolution pack, 2 of the zone's material):
// - XP: five Hero, Schematic or Survivor XP packs of the mission's tier (ZCP_HeroXP/SchematicXP/PersonnelXP_T<nn>, the
//   tier of its Mission_Select_Group_T<nn>: 500 XP at tier 1, 7,000 from tier 6);
// - evolution materials: three of the zone's ZCP_Reagent_C_T0<zone>_VeryHigh (9 of its material);
// - perk materials, from Plankerton ("Found in Plankerton and above"): three RE-PERK! packs a level above the Mini-Boss
//   alerts' (Medium in Plankerton, High in Canny Valley, VeryHigh in Twine Peaks: 45, 60, 90) and three of one of the
//   zone's PERK-UP! (30);
// - a schematic (CardPack_Ranged/Melee/Trap_<rarity>) or a survivor (CardPack_Worker_<rarity>), Epic in Stonewood and
//   Plankerton and Legendary from Canny Valley, a rarity above the Mini-Boss alerts' item.
// The mission's tier (01 to 20) by its reward tier group (Mission_Select_Group_T<nn>), else the zone's last.
const missionTierOf = (zone, mission) => {
  const tierGroup = mission.missionRewards?.tierGroupName ?? getDifficulty(mission.missionDifficultyInfo.rowName)?.lootTierGroup ?? "";
  return /_T(\d\d)$/.exec(tierGroup)?.[1] ?? String(5 * zone).padStart(2, "0");
};
// 6.00's Cram Session Mini-Boss alerts (events/cramsession2018.js): two XP, evolution or perk packs, and Gold, in place of
// the alert's item, V-Bucks and tickets.
function cramSessionAlertItems(zone, mission, seed) {
  const perkPacks = zone < 2 || !perkRewardsOn() ? []
    : [`CardPack:zcp_reagent_alteration_generic_${perkLevels[zone]}`, ...perkUpRarities[zone].map((rarity) => `CardPack:zcp_reagent_alteration_upgrade_${rarity}`)]
      .map((templateId) => [templateId, 1]);
  return cramSessionMiniBossRewards(zone, missionTierOf(zone, mission), seed, { perkPacks, gold: seasonalGold,
    pick: (choices, pickSeed) => choices[Math.floor(fraction(digest(pickSeed)) * choices.length)] });
}
const megaRarities = ["vr", "vr", "sr", "sr"];
const megaPerkLevels = ["", "", "medium", "high", "veryhigh"];
const megaKinds = [
  { weight: 30, items: (zone, tier) => ["heroxp", "schematicxp", "personnelxp"].map((kind) => [[`CardPack:zcp_${kind}_t${tier}`, 5]]) },
  { weight: 25, items: (zone) => [[[`CardPack:zcp_reagent_c_t0${zone}_veryhigh`, 3]]] },
  { weight: 20, items: (zone) => (zone < 2 || !perkRewardsOn() ? [] : perkUpRarities[zone].map((rarity) =>
    [[`CardPack:zcp_reagent_alteration_generic_${megaPerkLevels[zone]}`, 3], [`CardPack:zcp_reagent_alteration_upgrade_${rarity}`, 3]])) },
  { weight: 15, items: (zone) => ["ranged", "melee", "trap"].map((kind) => [[`CardPack:cardpack_${kind}_${megaRarities[zone - 1]}`, 1]]) },
  { weight: 10, items: (zone) => [[[`CardPack:cardpack_worker_${megaRarities[zone - 1]}`, 1]]] }
];
export function megaAlertItems(zone, mission, seed) {
  const tierGroup = mission.missionRewards?.tierGroupName ?? getDifficulty(mission.missionDifficultyInfo.rowName)?.lootTierGroup ?? "";
  const tier = /_T(\d\d)$/.exec(tierGroup)?.[1] ?? String(5 * zone).padStart(2, "0");
  const kinds = megaKinds.map((kind) => ({ ...kind, items: kind.items(zone, tier).filter((choice) => choice.every(([templateId]) => getItem(templateId))) }))
    .filter((kind) => kind.items.length);
  if (!kinds.length) return [];
  const { items } = weighted(kinds, `${seed}:mega`);
  return items[Math.floor(fraction(digest(`${seed}:mega:pick`)) * items.length)];
}

// 2.3's Mini-Boss items (see above), by kind: the core transform keys (CCK_<kind>_Consumable_<rarity>, "<Kind> Transform
// Schematic"), the generic schematic, survivor, hero and defender packs (CardPack_Ranged/Melee/Trap/Worker/Hero/
// Defender_<rarity>, "One random ...").
const miniBossRarities = ["r", "vr", "vr", "sr"];
const transformKeys = ["hero_core", "worker_core", "manager_core", "defender_core", "trap_core", "ranged_assault", "ranged_pistol",
  "ranged_shotgun", "ranged_sniper", "melee_sword", "melee_axe", "melee_club", "melee_scythe", "melee_spear", "melee_tool"];
const miniBossKinds = [
  { weight: 30, items: (rarity) => transformKeys.map((key) => `ConversionControl:cck_${key}_consumable_${rarity}`) },
  { weight: 30, items: (rarity) => ["ranged", "melee", "trap"].map((kind) => `CardPack:cardpack_${kind}_${rarity}`) },
  { weight: 25, items: (rarity) => [`CardPack:cardpack_worker_${rarity}`] },
  { weight: 10, items: (rarity) => [`CardPack:cardpack_hero_${rarity}`] },
  { weight: 5, items: (rarity) => [`CardPack:cardpack_defender_${rarity}`] }
];
export function miniBossItem(zone, seed) {
  const rarity = miniBossRarities[zone - 1] ?? "r";
  const kinds = miniBossKinds.map((kind) => ({ ...kind, items: kind.items(rarity).filter((templateId) => getItem(templateId)) }))
    .filter((kind) => kind.items.length);
  if (!kinds.length) return [];
  const { items } = weighted(kinds, `${seed}:item`);
  return [[items[Math.floor(fraction(digest(`${seed}:item:pick`)) * items.length)], 1]];
}

const rewardsOf = (row, mission, seed) => alertRewards[row.lootTierGroup](row, mission, seed).map(([itemType, quantity]) => ({ itemType, quantity }));

// An alert's modifiers (FFortAvailableMissionAlertData MissionAlertModifiers: the mission's modifiers on the map and,
// through the zone's details, the zone's; see world/validate): the gameplay modifiers of its row's ModifierTierGroup.
// The storm rows name STMZ.ZoneMods_<zone>, a group no shipped table has (Epic's servers rolled it), so the modifiers
// are Core's (🟡): the storm mutations the storm events' quests hunt (FirstStorm's and 1.9.1's Vindertech quests
// KillEnragedHusks, KillQuickenedPitchers, KillWallWeakeningLobbers, KillHealingDeathburstHusks,
// KillExplodingDeathburstHusks, KillLifeLeechAttackHusks, KillMetalCorrosionHusks: the GM_* items whose tags their
// objectives target), one in Stonewood, two in Plankerton and Canny Valley, three in Twine Peaks, picked per alert.
const stormMutations = [
  "GameplayModifier:gm_enemy_onlowhealth_enrage",
  "GameplayModifier:gm_enemy_ondmgreceived_speedbuff",
  "GameplayModifier:gm_enemy_onhitweakenbuildings",
  "GameplayModifier:gm_enemy_ondeath_areaheal",
  "GameplayModifier:gm_basehusk_ondeath_explode",
  "GameplayModifier:gm_enemy_ondmgdealt_lifeleech",
  "GameplayModifier:gm_basehusk_ondmgdealt_metalcorrosion"
];
const modifierCounts = [1, 2, 2, 3];
const noLoot = () => ({ tierGroupName: "", items: [] });
// 1.11's Mini-Boss rows name MinibossTG.EnablePrimaryMission, whose one gameplay modifier is
// MiniBossEnablePrimaryMissionItem (GameplayModifier:minibossenableprimarymissionitem): what brings the Mini-Boss into
// the mission.
const miniBossModifier = "GameplayModifier:minibossenableprimarymissionitem";

// 5.40's Mega Alerts' modifiers (MegaAlert.ZoneMods_<zone>, gamedata/world.js): "A Mega Alert combines Elemental Storms with
// Mutant Storm modifiers, and has a Miniboss too!": one of the Elemental Storms' zone modifiers (ElementalZone<Element>
// EnableItem, its mutator turning the mission's elemental husks to that element), the zone's count of storm mutations
// as the storm alerts', and the Mini-Boss modifier. 🟡 Which element and which mutations are Core's, rolled per alert.
function megaAlertModifiers(row, seed) {
  const elements = elementalZones.map(([element]) => elementalModifier(element)).filter((templateId) => getItem(templateId));
  const element = elements.length ? [elements[Math.floor(fraction(digest(`${seed}:element`)) * elements.length)]] : [];
  const mutations = shuffled(stormMutations.filter((templateId) => getItem(templateId)), `${seed}:modifiers`)
    .slice(0, modifierCounts[zoneOfModifierGroup(row.modifierTierGroup) - 1]);
  const miniBoss = getItem(miniBossModifier) ? [miniBossModifier] : [];
  return { tierGroupName: row.modifierTierGroup, items: [...element, ...mutations, ...miniBoss].map((itemType) => ({ itemType, quantity: 1 })) };
}

function alertModifiers(row, seed) {
  if (row.modifierTierGroup?.startsWith("MegaAlert.")) return megaAlertModifiers(row, seed);
  const element = /^ElementalZone\.(\w+)$/.exec(row.modifierTierGroup ?? "")?.[1];
  if (element && getItem(elementalModifier(element))) {
    return { tierGroupName: row.modifierTierGroup, items: [{ itemType: elementalModifier(element), quantity: 1 }] };
  }
  if (row.modifierTierGroup?.startsWith("MinibossTG.") && getItem(miniBossModifier)) {
    return { tierGroupName: row.modifierTierGroup, items: [{ itemType: miniBossModifier, quantity: 1 }] };
  }
  if (!row.modifierTierGroup?.startsWith("STMZ.ZoneMods_")) return noLoot();
  const known = stormMutations.filter((templateId) => getItem(templateId));
  return {
    tierGroupName: row.modifierTierGroup,
    items: shuffled(known, `${seed}:modifiers`).slice(0, modifierCounts[zoneOfModifierGroup(row.modifierTierGroup) - 1])
      .map((itemType) => ({ itemType, quantity: 1 }))
  };
}

function alertFor(data, mission, category) {
  const tile = data.tiles[mission.tileIndex];
  const tier = missionAlertTier(mission.missionDifficultyInfo.rowName, category);
  // "Every Group Mission now has a Mission Alert": a group alert goes on its mission's tile whatever the tile says, and so
  // does 5.40's Mega Alert, which only group missions carry.
  const onGroupMission = category === groupCategory || category === megaAlertCategory;
  if (category === megaAlertCategory && !isGroupMission(mission.missionGenerator)) return undefined;
  if (!(tile?.canBeMissionAlert || (tile && onGroupMission)) || !tier || !alertRewards[tier.lootTierGroup]) return undefined;
  if (tier.zoneThemes.length && !tier.zoneThemes.includes(tile.zoneTheme)) return undefined;
  if (tier.missionGenerator && tier.missionGenerator !== mission.missionGenerator) return undefined;
  if (survivalAlertGenerators[category] && survivalAlertGenerators[category] !== mission.missionGenerator) return undefined;
  return tier;
}

const never = "0001-01-01T00:00:00.000Z";

// FFortAvailableMissionAlertData. From 1.7.2 it also has SpreadDataName and RefreshSpreadAt (earlier clients skip them).
function alertOn(mission, row, category, seed, availableUntil, spreadDataName = "") {
  return {
    categoryName: category,
    spreadDataName,
    missionAlertGuid: missionGuid(seed),
    tileIndex: mission.tileIndex,
    availableUntil,
    refreshSpreadAt: never,
    missionAlertRewards: { tierGroupName: row.lootTierGroup, items: rewardsOf(row, mission, seed) },
    missionAlertModifiers: alertModifiers(row, seed)
  };
}

// A storm that spreads (1.9.1's Mutant Storms: their StormCategory rows name a MissionAlertSpreadDatas row) gets
// TotalChancesToSpread chances, one every SpreadInterval minutes from the day's start, each spreading with
// ChanceToSpread to up to MaxNumTilesToSpreadTo of the nearest missions that can carry its category: new storm alerts
// that appear on the map as the day goes on, the storm's RefreshSpreadAt saying when it may next spread. This is Core's
// reading of the rows (Epic's server did the spreading); every roll comes from the storm's seed and the time window,
// so everyone sees the same storms.
const nearbyTiles = 2.5;

// 1.10 (CL-3790078) stopped the spreading: "Mutant Storm Mission Alerts no longer spread. Instead, the number of Mission
// Alerts available at a time are set to a fixed target number. Stonewood: 5, Plankerton: 15, Canny Valley: 15, Twine
// Peaks: 15. Mutant Storm Mission Alert quota remains unchanged at 10 per day." Its StormCategory rows still name their
// spread rows (the targets were Epic's server's), so from 1.10 each zone gets its target of storms at the day's start
// and none spreads. A zone there is a theater, the map's Stonewood to Twine Peaks (its Stat.Theater.PvE0<n> tag,
// theaterZone): a theater's missions run into the next zone's difficulties (Stonewood's last regions are Plankerton's
// rows), so a target per row put more than the notes' storms on a map, 7 in Stonewood and 28 in Plankerton on 2.3. The
// storms go on any of the theater's missions a StormCategory row fits, each with that row's rewards.
const fixedStormsBuild = 3790078;
const stormTargets = [5, 15, 15, 15];
// 2.3's (and 2.4's and 2.4.2's) storms and Mini-Bosses, by theater (see alertRewards above).
const stormTargets2018 = [5, 25, 25, 25];
const miniBossTargets2018 = [3, 6, 6, 6];
// 2.5's passive storms and Mini-Bosses, by theater.
const passiveStormTargets = [3, 10, 10, 10];
const passiveMiniBossTargets = [3, 6, 6, 6];
export const stormsSpread = (changelist = currentBuild()) => !(Number(changelist) >= fixedStormsBuild);

function spreadStorm(data, missions, storm, dayStart, now, taken, availableUntil) {
  const spread = missionAlertSpread(storm.row.spreadRowName);
  if (!spread || !(spread.spreadInterval > 0)) return { spreads: [], refreshAt: undefined };
  const at = (chance) => new Date(dayStart.getTime() + chance * spread.spreadInterval * 60 * 1000);
  const origin = data.tiles[storm.mission.tileIndex];
  const distance = (mission) => Math.hypot(data.tiles[mission.tileIndex].xCoordinate - origin.xCoordinate,
    data.tiles[mission.tileIndex].yCoordinate - origin.yCoordinate);
  const spreads = [];
  for (let chance = 1; chance <= spread.totalChancesToSpread; chance++) {
    if (at(chance) > now) return { spreads, refreshAt: at(chance).toISOString() };
    if (fraction(digest(`${storm.seed}:spread:${chance}`)) >= spread.chanceToSpread) continue;
    const targets = missions
      .filter((mission) => !taken.has(mission.missionGuid) && distance(mission) <= nearbyTiles && alertFor(data, mission, storm.category))
      .sort((a, b) => distance(a) - distance(b)
        || fraction(digest(`${storm.seed}:${a.missionGuid}`)) - fraction(digest(`${storm.seed}:${b.missionGuid}`)))
      .slice(0, spread.maxNumTilesToSpreadTo);
    targets.forEach((mission, index) => {
      taken.add(mission.missionGuid);
      spreads.push(alertOn(mission, alertFor(data, mission, storm.category), storm.category, `${storm.seed}:spread:${chance}:${index}`,
        availableUntil));
    });
  }
  return { spreads, refreshAt: undefined };
}

// Core's placement (the client's theater info would say how many, and none ships): each region gets one alert of each
// category the theater has, on missions whose tile can carry one and whose difficulty has a row of that category, one
// alert a mission. A main theater's are a general one (MissionAlert_1-4) and a storm one (StormLowCategory), and while
// the Mutant Storms run (1.9.1) each of its zones gets a Mutant Storm (StormCategory) that spreads; while Survive the
// Holidays runs (1.11) each region also gets a Mini-Boss one (MiniBossCategory); Hexsylvania's are Halloween ones, and
// each Survive the Storm region gets a 3 Day and a 7 Day one, and each Challenge the Horde zone (5.0, world/horde.js) a
// Horde one (HordeCategory: "Quota: 10 per day", repeatable, profiles/alerts.js). The alert names its category
// (FFortAvailableMissionAlertData CategoryName), which the map tile looks up in MissionAlertCategories (AFortTheaterMapTile::GetMissionAlertCategory, 1.8 0x8F3D40, the tile's alert's category
// name): BP_Hex_PARENT's HandleMissionAlert shows every alert's indicator and, for Storm and StormLow, the storm swirl
// (P_StormAffected) and its timer (Core-Backend #91). Without a name every alert was General.
// Returns the alerts and when the theater's alerts next change (a storm's next spread, else the day's end).
function rollAlerts({ data }, missions, day, dayStart, now, availableUntil) {
  const stormsMiniBosses = miniBossesStay();
  const passive = isEventActive(passiveMiniBosses);
  const categories = isHexsylvania(data.uniqueId) ? ["HalloweenCategory"]
    : isSurvival(data.uniqueId) ? ["Survival3DayCategory", "Survival7DayCategory"]
      : isHorde(data.uniqueId) ? ["HordeCategory"]
      : stormsMiniBosses ? ["StormLowCategory"] : passive ? [] : ["GeneralCategory", "StormLowCategory", "MiniBossCategory"];
  const taken = new Set();
  const storms = [];
  const spreading = stormsSpread();
  const place = (category, seed, inScope) => {
    const candidates = missions.filter((mission) => inScope(mission) && !taken.has(mission.missionGuid) && alertFor(data, mission, category));
    if (!candidates.length) return [];
    const [mission] = shuffled(candidates.map((candidate) => candidate.missionGuid), seed)
      .map((guid) => candidates.find((candidate) => candidate.missionGuid === guid));
    taken.add(mission.missionGuid);
    const row = alertFor(data, mission, category);
    const spreadRow = spreading ? row.spreadRowName ?? "" : "";
    const alert = alertOn(mission, row, category, seed, availableUntil, spreadRow);
    if (spreadRow) storms.push({ alert, mission, row, seed, category });
    return [alert];
  };
  // 3.2's group alerts first, one on every group mission a GroupMissionCategory row fits (tile difficulty 5 and up;
  // EventFlag.GroupMission): the category's Quota of 10 and MissionAlertRepeatable are profiles/alerts.js's. From 5.40
  // every group mission carries a Mega Alert there instead (MegaAlertCategory, Quota 3, not repeatable).
  const groupAlerts = isHexsylvania(data.uniqueId) || isSurvival(data.uniqueId) || isHorde(data.uniqueId) ? [] : missions
    .filter((mission) => isGroupMission(mission.missionGenerator))
    .flatMap((mission) => {
      const category = [megaAlertCategory, groupCategory].find((name) => alertFor(data, mission, name));
      if (!category) return [];
      taken.add(mission.missionGuid);
      return [alertOn(mission, alertFor(data, mission, category), category, `${mission.missionGuid}:alert:${category}`, availableUntil)];
    });
  // The general alert keeps the seed alerts had before categories, so a day's alerts kept their guids.
  const alerts = [...groupAlerts, ...data.regions.flatMap((region, regionIndex) => categories.flatMap((category) =>
    place(category, `${data.uniqueId}:${day}:alert:${regionIndex}${category === "GeneralCategory" ? "" : `:${category}`}`,
      (mission) => region.tileIndices.includes(mission.tileIndex))))];
  // A Mutant Storm starts in each of the theater's zones (one per StormCategory row its missions can carry, each row a
  // zone and a spread) and spreads from there; from 1.10 each theater has its fixed target of storms instead.
  if (!isHexsylvania(data.uniqueId) && !isSurvival(data.uniqueId) && !isHorde(data.uniqueId)) {
    const zone = theaterZone(data);
    const anyRow = (category) => (mission) => Boolean(alertFor(data, mission, category));
    if (spreading) {
      const rows = [...new Map(missions.map((mission) => alertFor(data, mission, "StormCategory")).filter(Boolean)
        .map((row) => [row.name, row])).values()];
      for (const row of rows) {
        alerts.push(...place("StormCategory", `${data.uniqueId}:${day}:alert:storm:${row.name}`,
          (mission) => alertFor(data, mission, "StormCategory")?.name === row.name));
      }
    } else if (zone) {
      const target = (isEventActive(mutantStorms2018) ? stormTargets2018 : stormTargets)[zone - 1];
      for (let index = 0; index < target; index++) {
        alerts.push(...place("StormCategory", `${data.uniqueId}:${day}:alert:storm:${index}`, anyRow("StormCategory")));
      }
    }
    // 2.3's Mini-Bosses: the theater's target, in place of the general alerts.
    if (stormsMiniBosses && zone) {
      for (let index = 0; index < miniBossTargets2018[zone - 1]; index++) {
        alerts.push(...place("MiniBossCategory", `${data.uniqueId}:${day}:alert:miniboss:${index}`, anyRow("MiniBossCategory")));
      }
    }
    // 4.2's Elemental Storm alerts (Core-Backend #277): one of each element in every main theater from Plankerton on (🟡
    // Core's count: the notes give the quota, 2 each a day, not how many the map showed).
    if (zone >= 2) {
      for (const [element, category] of elementalZones) {
        alerts.push(...place(category, `${data.uniqueId}:${day}:alert:elemental:${element}`, anyRow(category)));
      }
    }
    // 2.5's passive storms and Mini-Bosses (General alerts with the Mini-Boss modifier): the theater's targets.
    if (passive && zone) {
      for (let index = 0; index < passiveStormTargets[zone - 1]; index++) {
        alerts.push(...place("StormLowCategory", `${data.uniqueId}:${day}:alert:passivestorm:${index}`, anyRow("StormLowCategory")));
      }
      for (let index = 0; index < passiveMiniBossTargets[zone - 1]; index++) {
        alerts.push(...place("GeneralCategory", `${data.uniqueId}:${day}:alert:passiveminiboss:${index}`, anyRow("GeneralCategory")));
      }
    }
  }
  let nextRefresh = availableUntil;
  for (const storm of storms) {
    const { spreads, refreshAt } = spreadStorm(data, missions, storm, dayStart, now, taken, availableUntil);
    alerts.push(...spreads);
    storm.alert.refreshSpreadAt = refreshAt ?? availableUntil;
    if (refreshAt && refreshAt < nextRefresh) nextRefresh = refreshAt;
  }
  return { alerts, nextRefresh };
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

// Missions and alerts are the UTC day's; a Mutant Storm's spreads join its alerts as the day goes on, and the theater's
// alerts' nextRefresh is the next spread, so the client asks again then.
export function worldInfo(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const availableUntil = `${day}T23:59:59.999Z`;
  const theaters = [...layout().theaters, ...[hexsylvania(), survivalTheater(), hordeTheater(now), hordeWeeklyTheater(now)].filter(Boolean)];
  const missions = theaters.map((theater) => rollMissions(theater, day, availableUntil));
  const alerts = theaters.map((theater, index) => rollAlerts(theater, missions[index], day, dayStart, now, availableUntil));
  return {
    theaters: theaters.map((theater) => withAlertCategoryRequirements(theater.data)),
    missions: theaters.map((theater, index) => ({
      theaterId: theater.data.uniqueId,
      availableMissions: missions[index],
      nextRefresh: availableUntil
    })),
    missionAlerts: theaters.map((theater, index) => ({
      theaterId: theater.data.uniqueId,
      availableMissionAlerts: alerts[index].alerts,
      nextRefresh: alerts[index].nextRefresh
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
  // Yesterday's as it ended, with all its storms' spreads.
  const yesterday = new Date(Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`) - 1);
  for (const day of [now, yesterday]) {
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
