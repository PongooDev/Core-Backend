import crypto from "node:crypto";
import { bannerIds } from "../gamedata/banners.js";
import { getCardPack } from "../gamedata/items.js";
import { hasItem, isKnownKind, namedSchematics, pool, rarities } from "./pools.js";

// What a card pack holds. Epic decided pack contents on its servers and no loot table for them ships with the client,
// so these rules are Core's design (chosen by the user), built from what the game data says about each pack: its loot
// tier group name ("CardPack_Generic_Worker_VR", "ZCP_HeroXP"), its description ("One random survivor.",
// "Choose one of two random heroes.") and its rarity.

const pick = (list) => list[crypto.randomInt(list.length)];

function weighted(table) {
  let roll = Math.random() * table.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of table) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return table[table.length - 1][0];
}

function one(kind, sub, rarity) {
  const choices = pool(kind, sub, rarity);
  return choices.length ? [{ templateId: pick(choices), quantity: 1 }] : [];
}

// Upgrade, mini and founders llamas: a few random items, rarer the better the llama.
// Founder's Coins (AccountResource:eventcurrency_founders): "Can be traded for special llamas ... Found by completing
// quests and in other llamas." The quests are the daily quests (their Rewards hold 20 each); no shipped loot table names
// the coins, so which llamas held them and how many is Core's (🟡): every llama but the founders event llamas the coins
// buy (the Founder's Llama and the Launch Event Llama, CardPack_Event_2017_Founders) holds `coins` of them on top of its
// items, more the better the llama (a store llama that turns silver or gold holds that llama's).
const foundersCoins = "AccountResource:eventcurrency_founders";
const mixedKinds = [["ranged", 25], ["melee", 15], ["trap", 15], ["worker", 25], ["manager", 5], ["hero", 10], ["defender", 5]];
const llamas = {
  cardpack_basic: { count: 2, rarity: [["c", 50], ["uc", 45], ["r", 5]], coins: 5 },
  cardpack_basic_silver: { count: 3, rarity: [["uc", 60], ["r", 35], ["vr", 5]], coins: 10 },
  cardpack_bronze: { count: 4, rarity: [["uc", 50], ["r", 35], ["vr", 12], ["sr", 3]], coins: 10 },
  cardpack_silver: { count: 5, rarity: [["uc", 20], ["r", 50], ["vr", 25], ["sr", 5]], coins: 15 },
  cardpack_gold: { count: 6, rarity: [["r", 40], ["vr", 45], ["sr", 15]], coins: 20 },
  cardpack_event_2017_founders: { count: 6, rarity: [["r", 55], ["vr", 35], ["sr", 10]], coins: 0 }
};

function llama({ count, rarity, coins }) {
  const contents = [];
  for (let attempt = 0; contents.length < count && attempt < count * 4; attempt++) contents.push(...one(weighted(mixedKinds), null, weighted(rarity)));
  if (coins > 0 && hasItem(foundersCoins)) contents.push({ templateId: foundersCoins, quantity: coins });
  return contents;
}

// Zone reward packs (ZCP_*): resources that grow with the mission's difficulty, given by the pack's tier or level.
const levels = { minimal: 1, verylow: 1, low: 2, medium: 3, high: 4, veryhigh: 5 };
const xpByLevel = [0, 100, 200, 400, 700, 1000, 1400];
const ingredientsByLevel = [0, 2, 4, 6, 9, 12, 15];

// A level word (zcp_reagent_c_t02_high: the t02 is the reagent's own tier) wins over a tier, then the outpost theater.
function zoneLevel(templateId, info) {
  const tokens = templateId.split(":")[1].toLowerCase().split("_");
  const level = tokens.find((token) => token in levels);
  if (level) return levels[level];
  const tier = tokens.find((token) => /^t\d\d$/.test(token));
  if (tier) return Math.min(Number(tier.slice(1)), 6) || 1;
  const theater = tokens.find((token) => /^theater\d$/.test(token));
  if (theater) return Number(theater.slice(-1)) + 1;
  return Math.max(1, Math.min(info.lootTier || 1, 6));
}

function zoneReward(group, templateId, info) {
  const level = zoneLevel(templateId, info);
  const resource = (id, quantity) => (hasItem(id) ? [{ templateId: id, quantity }] : []);
  const xp = { zcp_heroxp: "AccountResource:heroxp", zcp_survivorxp: "AccountResource:personnelxp", zcp_schematicxp: "AccountResource:schematicxp" };
  const family = Object.keys(xp).find((name) => group.startsWith(name));
  if (family) return resource(xp[family], xpByLevel[level]);

  let match = group.match(/^zcp_reagent_c_(t\d\d)/);
  if (match) return resource(`AccountResource:reagent_c_${match[1]}`, Math.max(1, Math.ceil(level / 2)));
  match = group.match(/^zcp_(ore|crystal)_([a-z]+)/);
  if (match) return resource(`Ingredient:ingredient_${match[1]}_${match[2]}`, ingredientsByLevel[level]);
  if (group.startsWith("zcp_improvised")) return resource("Ingredient:ingredient_rare_powercell", Math.max(1, Math.ceil(level / 2)));
  if (group.startsWith("zcp_voucher_basicpack") || group.startsWith("zcp_voucher_tutorialpack")) return resource("AccountResource:voucher_basicpack", 1);
  // "10 V-bucks", "50 V-bucks": the amount is in the pack's id (zcp_mtx_10, zcp_mtx_boost50).
  match = templateId.toLowerCase().match(/^cardpack:zcp_mtx_(?:boost)?(\d+)$/);
  if (match) return resource("Currency:mtxgiveaway", Number(match[1]));
  if (group === "zcp_rescued") return resource("AccountResource:peopleresource", rescuedPeople(info));
  if (group === "zcp_neighborhoodcurrency_noscale") return resource("Token:neighborhoodcurrency", 10);
  if (group === "zcp_snowballs_noscale") return resource("AccountResource:eventcurrency_snowballs", 10);
  match = group.match(/^zcp_tutorial_(hero|melee|ranged|trap)$/);
  if (match) return one(match[1], null, "uc");
  const expedition = expeditionReward(group, resource);
  if (expedition) return expedition;
  match = group.match(/^zcp_rareexpedition_(heroes|weapons|managers|traps)/);
  if (match) return one({ heroes: "hero", weapons: "ranged", managers: "manager", traps: "trap" }[match[1]], null, info.rarityCode);
  return [];
}

// "Rescued Survivor" (ZCP_Rescued[_Tnn], the survivor badges' BadgeCardPackReward, tier = the zone's loot level): People,
// "Survivors who have decided to join your Homebase", the cost of transforms and expeditions. Core's amount (🟡, the
// group's contents are server data): the pack's tier + 1, so 1 untiered, 2 at T01, 21 at T20.
const rescuedPeople = (info) => (info.lootTier || 0) + 1;

// Expedition rewards (ExpeditionRecipes results), by their descriptions: supply caches are XP, rescued survivors are
// survivors, crafting supplies are ingredients, resource caches and the lumberyard and quarry runs are building
// materials. They grow with the run's length and tier.
const runSize = { short: 1, medium: 2, long: 3 };
const craftingIngredients = ["Ingredient:ingredient_duct_tape", "Ingredient:ingredient_nuts_bolts", "Ingredient:ingredient_planks",
  "Ingredient:ingredient_herbs", "Ingredient:ingredient_blastpowder", "Ingredient:ingredient_batteries"];
const materials = { wood: ["wood"], stone: ["stone"], metal: ["metal"], woodstone: ["wood", "stone"], all: ["wood", "stone", "metal"] };

function expeditionReward(group, resource) {
  let match = group.match(/^zcp_(?:air_|sea_)?supplyrun_(short|medium|long)_t0(\d)$/);
  if (match) {
    const amount = 100 * runSize[match[1]] * Number(match[2]);
    return ["heroxp", "personnelxp", "schematicxp"].flatMap((xp) => resource(`AccountResource:${xp}`, amount));
  }
  match = group.match(/^zcp_(?:air_|sea_)?survivorscouting_(short|medium|long)_t0(\d)$/);
  if (match) {
    const rarity = ["uc", "uc", "r", "vr", "sr"][Math.min(Number(match[2]), 5) - 1];
    return Array.from({ length: runSize[match[1]] }, () => one("worker", null, rarity)).flat();
  }
  match = group.match(/^zcp_craftingrun_(short|medium|long)_t0(\d)$/);
  if (match) {
    const amount = 2 * runSize[match[1]] * Number(match[2]);
    const pool = [...craftingIngredients];
    const picks = [0, 1, 2].map(() => pool.splice(crypto.randomInt(pool.length), 1)[0]);
    return [...picks, `Ingredient:ingredient_mechanical_parts_t0${Math.min(Number(match[2]), 6)}`].flatMap((id) => resource(id, amount));
  }
  match = group.match(/^zcp_resourcerun_(all|wood|stone|metal|woodstone)_(short|medium)$/);
  if (match) return materials[match[1]].flatMap((name) => resource(`WorldItem:${name}itemdata`, 50 * runSize[match[2]]));
  if (group === "zcp_choppingwood") return resource("WorldItem:wooditemdata", 30);
  if (group === "zcp_miningore") return resource("WorldItem:stoneitemdata", 30);
  return null;
}

// The founders packs name a class; their weapon is the class's upgradeable founders schematic (from the descriptions:
// shotgun, sword, pistol, assault rifle).
const foundersWeapon = { constructor: ["shotgun"], ninja: ["sword"], outlander: ["pistol"], soldier: ["assault"] };
const foundersHero = { constructor: "constructor", ninja: "ninja", outlander: "outlander", soldier: "commando" };

function founders(group) {
  let match = group.match(/^cardpack_founders_(constructor|ninja|outlander|soldier)_weapon_(vr|sr)$/);
  if (match) return pickOne(namedSchematics(foundersWeapon[match[1]], match[2], { founders: true }));
  match = group.match(/^cardpack_founders_(constructor|ninja|outlander|soldier)_bundle$/);
  if (match) {
    return [...one("hero", foundersHero[match[1]], "sr"), ...one("hero", foundersHero[match[1]], "sr"),
      ...pickOne(namedSchematics(foundersWeapon[match[1]], "sr", { founders: true }))];
  }
  if (group === "cardpack_founders_starterweapon_bundle") return starterWeapons.flatMap((words) => pickOne(namedSchematics(words, "r")));
  match = group.match(/^cardpack_founders_defender_(assault|pistol|melee|sniper|shotgun)_(vr|sr)$/);
  if (match) return one("defender", match[1], match[2]);
  match = group.match(/^cardpack_founders_banners_t(\d\d)$/);
  if (match) return foundersBanners(Number(match[1]));
  match = group.match(/^cardpack_founders_(.+)_(r|vr|sr)$/);
  if (match && !match[1].startsWith("banners")) return pickOne(namedSchematics(match[1].split("_"), match[2], { founders: true }));
  return [];
}

// "Founders Banners: Standard" (T01) to "Ultimate" (T05): the Founder icons of that tier (FounderTier<N>Banner<M>).
function foundersBanners(tier) {
  return bannerIds().filter((templateId) => templateId.startsWith(`HomebaseBannerIcon:FounderTier${tier}Banner`))
    .map((templateId) => ({ templateId, quantity: 1 }));
}

const pickOne = (choices) => (choices.length ? [{ templateId: pick(choices), quantity: 1 }] : []);

// A named pack's schematic, found by the words of its group ("CardPack_Quest_TrapWallDarts_UC" -> wall, darts) or of
// its id ("cardpack_starter_sniper_boltaction_scope_r" -> sniper, boltaction, scope).
function named(group, templateId, rarity) {
  const strip = (words) => words.filter((word) => word && !["card", "pack", "cardpack", "starter", "quest", "custom", "trap", rarity].includes(word));
  const fromGroup = strip(group.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().split("_"));
  const fromId = strip(templateId.split(":")[1].toLowerCase().split("_"));
  for (const words of [fromGroup, fromId]) {
    const choices = namedSchematics(words, rarity);
    if (choices.length) return pickOne(choices);
  }
  return [];
}

const starterWeapons = [["assault", "auto"], ["shotgun", "standard"], ["sniper", "boltaction", "scope"], ["edged", "sword", "medium"], ["floor", "spikes"]];

// Everything a non-choice pack gives when opened, as {templateId, quantity}.
export function rollContents(templateId) {
  const info = getCardPack(templateId);
  if (!info) return [];
  const originalGroup = info.lootTierGroup;
  const group = originalGroup.toLowerCase();
  const rarity = group.split("_").pop();
  const withRarity = { ...info, rarityCode: rarities.includes(rarity) ? rarity : "r" };

  if (llamas[group]) return llama(llamas[group]);
  // By id: CardPack_Silver_Melee's group is CardPack_Gold_Melee in the data.
  const name = templateId.split(":")[1].toLowerCase();
  if (name.startsWith("cardpack_silver")) return llama(llamas.cardpack_silver);
  if (name.startsWith("cardpack_gold")) return llama(llamas.cardpack_gold);
  if (group.startsWith("cardpack_bronze") || group.startsWith("cardpack_event")) return llama(llamas.cardpack_bronze);
  if (group.startsWith("zcp_")) return zoneReward(group, templateId, withRarity);
  if (group.startsWith("cardpack_founders_")) return founders(group);

  let match = group.match(/^cardpack_generic_(defender)(assault|pistol|melee|sniper|shotgun)_(c|uc|r|vr|sr)$/);
  if (match) return one("defender", match[2], match[3]);
  match = group.match(/^cardpack_(?:generic_)?([a-z]+)(?:_([a-z]+))?_(c|uc|r|vr|sr)$/);
  if (match && isKnownKind(match[1])) return one(match[1], match[2], match[3]);
  if (/^cardpack_(starter|quest|custom)_/.test(group)) return named(originalGroup, templateId, withRarity.rarityCode);
  return one("schematic", null, withRarity.rarityCode);
}

// A llama opened in the store can turn silver or gold (FCardPackResultNotification.displayLevel 1 or 2, the pinata
// the client plays) and then holds what that llama holds. The upgraded llamas ship as their own definitions:
// CardPack_Bronze[_X] -> CardPack_Silver[_X] / CardPack_Gold[_X], CardPack_Basic -> CardPack_Basic_Silver. How often
// Epic upgraded one is server data that doesn't ship; these chances are Core's.
export const upgradeChances = { gold: 0.05, silver: 0.2 };

export function upgradedPack(templateId, roll = Math.random()) {
  const info = getCardPack(templateId);
  if (!info || info.choice) return info;
  const group = info.lootTierGroup.toLowerCase();
  let silver;
  let gold;
  if (group === "cardpack_basic") silver = getCardPack("CardPack:cardpack_basic_silver");
  else if (group.startsWith("cardpack_bronze")) {
    const family = group.slice("cardpack_bronze".length);
    silver = getCardPack(`CardPack:cardpack_silver${family}`);
    gold = getCardPack(`CardPack:cardpack_gold${family}`);
  }
  if (gold && roll < upgradeChances.gold) return gold;
  if (silver && roll < upgradeChances.gold + upgradeChances.silver) return silver;
  return info;
}

// A choice pack's two options, chosen when the pack is granted (UFortCardPackItem.Options, FMcpLootEntry shape).
// The kind comes from the group ("CardPack_Choice_Hero_R", "CardPack_Choice_Halloween_Heroes"); packs that name none
// (the generic Choice Pack) offer two mixed items.
export function rollOptions(templateId) {
  const info = getCardPack(templateId);
  if (!info) return [];
  const parts = info.lootTierGroup.toLowerCase().split("_");
  const rarity = rarities.includes(parts[parts.length - 1]) ? parts[parts.length - 1] : "r";
  const kind = parts.map((part) => part.replace(/es$|s$/, "")).find((part) => part !== "cardpack" && isKnownKind(part));
  const options = [];
  const taken = new Set();
  for (let attempt = 0; options.length < 2 && attempt < 20; attempt++) {
    const [choice] = kind ? pickOne(pool(kind, null, rarity)) : one(weighted(mixedKinds), null, rarity);
    if (!choice || taken.has(choice.templateId)) continue;
    taken.add(choice.templateId);
    options.push({ itemType: choice.templateId, itemGuid: "", itemProfile: "profile0", quantity: 1, attributes: {} });
  }
  return options;
}

export const isChoicePack = (templateId) => Boolean(getCardPack(templateId)?.choice);
