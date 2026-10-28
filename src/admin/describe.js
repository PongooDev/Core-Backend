import { inBuild } from "../builds/context.js";
import { certBuild } from "../builds/detect.js";
import { athenaCosmetics } from "../gamedata/athena.js";
import { bannerIds } from "../gamedata/banners.js";
import { getNode, nodeIds } from "../gamedata/homebase.js";
import { getCardPack, getItem, itemIds } from "../gamedata/items.js";
import { getQuest, questIds } from "../gamedata/quests.js";
import { dataBuilds } from "../gamedata/read.js";

// How the panel names, groups and colours items. Names are the game's DisplayName where it has one; rarity comes from
// the name (_c … _sr) first because this build's Rarity properties are placeholders for many items.
const rarityCodes = ["c", "uc", "r", "vr", "sr"];
const rarityOfProperty = { Handmade: "c", Ordinary: "uc", Sturdy: "r", Quality: "vr", Fine: "sr", Elegant: "sr", Masterwork: "sr", Epic: "sr", Badass: "sr", Legendary: "sr" };

export const categories = [
  ["heroes", "Heroes"], ["schematics", "Schematics"], ["survivors", "Survivors"], ["leads", "Lead survivors"],
  ["defenders", "Defenders"], ["llamas", "Llamas"], ["vouchers", "Vouchers"], ["resources", "Resources"],
  ["consumables", "Consumables"], ["transform", "Transform keys"], ["expeditions", "Expeditions"],
  ["stormshields", "Storm shields"], ["skilltree", "Skill tree"], ["banners", "Banners"], ["quests", "Quests"],
  ["world", "Backpack and storage"], ["other", "Other"]
];

function category(type, name) {
  switch (type) {
    case "hero": return "heroes";
    case "schematic": return "schematics";
    case "worker": return name.startsWith("manager") ? "leads" : "survivors";
    case "defender": return "defenders";
    case "cardpack": return "llamas";
    case "accountresource": return name.startsWith("voucher_") ? "vouchers" : "resources";
    case "currency": case "token": case "quota": return "resources";
    case "consumableaccountitem": case "buff": case "buffcredit": return "consumables";
    case "conversioncontrol": return "transform";
    case "expedition": return "expeditions";
    case "outpost": case "deployablebasecloudsave": return "stormshields";
    case "homebasenode": return "skilltree";
    case "homebasebannericon": case "homebasebannercolor": return "banners";
    case "quest": return "quests";
    case "worlditem": case "weapon": case "ingredient": case "trap": case "ammo": case "gadget": case "badge": case "food":
    case "buildingpiece": case "editool": case "backpackpickup": case "deco": case "missionitem": case "worldresource":
      return "world";
    default: return "other";
  }
}

const skipWords = new Set(["sid", "hid", "did", "wid", "cid", "aid", "ore", "crystal", "t00", "cardpack", "zcp"]);
const prettify = (name) => name.split("_")
  .filter((word) => word && !skipWords.has(word) && !rarityCodes.includes(word) && !/^t\d\d$/.test(word))
  .map((word) => word[0].toUpperCase() + word.slice(1)).join(" ") || name;

// The panel's requests name no build, so they read Cert's data (builds/context.js), which hasn't the items later builds
// added: 1.8's Skull Trooper Jonesy (Hero:hid_commando_gunheadshothw_vr_t01) showed as "Commando Gunheadshothw" (issue
// #76). An item is described from Cert's data when it has it, else from the newest build's that does, so items Cert
// knows keep their names and later ones get theirs.
const describedBuilds = [certBuild, ...dataBuilds.filter((build) => build !== certBuild).sort((a, b) => Number(b) - Number(a))];
const fromBuilds = (lookup) => {
  for (const build of describedBuilds) {
    const found = inBuild(build, lookup);
    if (found !== undefined) return found;
  }
  return undefined;
};
const itemOf = (templateId) => fromBuilds(() => getItem(templateId));
// Display names as the game shows them: some DisplayNames end in spaces ("Grave Digger  ").
const named = (name) => (typeof name === "string" && name.trim()) || undefined;
const gameName = (templateId) => fromBuilds(() => named(getItem(templateId)?.name) ?? named(getCardPack(templateId)?.displayName));
const cosmeticName = (templateId) => fromBuilds(() => named(Object.entries(athenaCosmetics())
  .find(([id]) => id.toLowerCase() === templateId.toLowerCase())?.[1].name));

// A schematic has no DisplayName of its own (1.8's only ones, the Jack-O-Launcher's, are its weapon's): the game shows
// the name of what it crafts, its Result. In 1.8's paks 2,131 of the 2,135 schematics craft the world item named like
// them (SID_X → WID_X or TID_X, Ammo_X → AmmoDataX); the others (SID_Floor_Track's gadget, an outpost and a Founders
// tier mismatch, which crafts a same-named weapon) keep a name made from theirs.
function craftedName(name) {
  if (name.startsWith("ammo_")) return gameName(`Ammo:ammodata${name.slice("ammo_".length)}`);
  const rest = name.replace(/^(sid|wid|tid)_/, "");
  return gameName(`Weapon:wid_${rest}`) ?? gameName(`Trap:tid_${rest}`);
}

// One description per template: an account view describes every item, and a big profile holds thousands of copies.
const described = new Map();
export function describeItem(templateId) {
  const key = String(templateId);
  if (!described.has(key)) described.set(key, describe(key));
  return described.get(key);
}

// Items the game keeps one per unit (MaxStackSize 1 account items: heroes, schematics, survivors, defenders, llamas,
// expeditions...): a grant of n makes n profile items. Skill tree nodes, banners and quests are owned once whatever
// the quantity, so they aren't.
export function isSingleItem(templateId) {
  const type = String(templateId).split(":")[0].toLowerCase();
  if (type === "quest" || type === "homebasenode" || type === "homebasebannericon" || type === "homebasebannercolor") return false;
  const info = itemOf(templateId);
  return info?.profile === "profile" && info.maxStackSize === 1;
}

function describe(templateId) {
  const [rawType, rawName = ""] = String(templateId).split(":");
  const type = rawType.toLowerCase();
  const name = rawName.toLowerCase();
  const info = itemOf(templateId);
  const tokens = name.split("_");
  const rarity = [...tokens].reverse().find((token) => rarityCodes.includes(token)) ?? rarityOfProperty[info?.rarity] ?? "c";
  const tier = Number(tokens.find((token) => /^t\d\d$/.test(token))?.slice(1) ?? 0);
  const displayName = gameName(templateId) ?? (type === "schematic" ? craftedName(name) : undefined)
    ?? (type.startsWith("athena") ? cosmeticName(templateId) : undefined)
    ?? (type === "quest" ? `Quest: ${prettify(name)}`
      : type === "homebasebannericon" ? `Banner icon ${rawName}`
      : type === "homebasebannercolor" ? `Banner colour ${rawName}`
      : type === "homebasenode" ? `Skill tree node ${rawName}`
      : prettify(name));
  return { templateId, name: displayName, category: category(type, name), rarity, tier, maxLevel: info?.maxLevel ?? null, single: isSingleItem(templateId) };
}

let catalog;
// Everything the panel can give: items (not the never-persisted ones), quests, skill tree nodes, banners.
function allTemplates() {
  catalog ??= [...itemIds().filter((templateId) => !getItem(templateId)?.neverPersisted), ...questIds().filter((id) => getQuest(id)).map((id) => `Quest:${id}`),
    ...nodeIds().filter((id) => getNode(id)).map((id) => `HomebaseNode:${id.toLowerCase()}`), ...bannerIds()]
    .map(describeItem);
  return catalog;
}

export function searchCatalog(query = "", categoryKey = "", limit = 60) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return allTemplates()
    .filter((entry) => !categoryKey || entry.category === categoryKey)
    .filter((entry) => words.every((word) => entry.templateId.toLowerCase().includes(word) || entry.name.toLowerCase().includes(word)))
    .slice(0, limit);
}

// The balances the panel edits directly. V-Bucks are spread over four currencies; setting them leaves one Giveaway
// stack, which the store spends like the others.
export const currencies = [
  { key: "vbucks", label: "V-Bucks", templates: ["Currency:mtxcomplimentary", "Currency:mtxgiveaway", "Currency:mtxpurchasebonus", "Currency:mtxpurchased"], setAs: "Currency:mtxgiveaway" },
  { key: "skillPoints", label: "Skill points", templates: ["Token:homebasepoints"] },
  { key: "researchPoints", label: "Research points", templates: ["Token:collectionresource_nodegatetoken01"] },
  { key: "heroXp", label: "Hero XP", templates: ["AccountResource:heroxp"] },
  { key: "survivorXp", label: "Survivor XP", templates: ["AccountResource:personnelxp"] },
  { key: "schematicXp", label: "Schematic XP", templates: ["AccountResource:schematicxp"] },
  { key: "boostXp", label: "Boost XP", templates: ["Token:xpboost"] },
  { key: "miniLlamaVouchers", label: "Mini Reward Llama vouchers", templates: ["AccountResource:voucher_basicpack"] },
  { key: "upgradeLlamaVouchers", label: "Upgrade Llama vouchers", templates: ["AccountResource:voucher_cardpack_bronze"] },
  { key: "peopleReagents", label: "Training manuals", templates: ["AccountResource:reagent_people"] }
];

export const stormShields = ["Outpost:outpostcore_pve_01", "Outpost:outpostcore_pve_02", "Outpost:outpostcore_pve_03", "Outpost:outpostcore_pve_04"];
