import { bannerIds } from "../gamedata/banners.js";
import { getNode, nodeIds } from "../gamedata/homebase.js";
import { getCardPack, getItem, itemIds } from "../gamedata/items.js";
import { getQuest, questIds } from "../gamedata/quests.js";

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

export function describeItem(templateId) {
  const [rawType, rawName = ""] = String(templateId).split(":");
  const type = rawType.toLowerCase();
  const name = rawName.toLowerCase();
  const info = getItem(templateId);
  const tokens = name.split("_");
  const rarity = [...tokens].reverse().find((token) => rarityCodes.includes(token)) ?? rarityOfProperty[info?.rarity] ?? "c";
  const tier = Number(tokens.find((token) => /^t\d\d$/.test(token))?.slice(1) ?? 0);
  const displayName = info?.name ?? getCardPack(templateId)?.displayName
    ?? (type === "quest" ? `Quest: ${prettify(name)}`
      : type === "homebasebannericon" ? `Banner icon ${rawName}`
      : type === "homebasebannercolor" ? `Banner colour ${rawName}`
      : type === "homebasenode" ? `Skill tree node ${rawName}`
      : prettify(name));
  return { templateId, name: displayName, category: category(type, name), rarity, tier, maxLevel: info?.maxLevel ?? null };
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
