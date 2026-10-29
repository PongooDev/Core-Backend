import { inBuild } from "../builds/context.js";
import { certBuild, versionOf } from "../builds/detect.js";
import { athenaCosmetics } from "../gamedata/athena.js";
import { bannerIds } from "../gamedata/banners.js";
import { getNode, nodeIds } from "../gamedata/homebase.js";
import { getCardPack, getItem, itemIds } from "../gamedata/items.js";
import { getQuest, questIds } from "../gamedata/quests.js";
import { dataBuilds } from "../gamedata/read.js";
import { cosmeticRarity, cosmeticType, cosmeticTypeOrder } from "../store/itemshop.js";

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
// the name of what it crafts, its Result. In 1.8's paks all but 2 of the 2,135 schematics craft the item named like
// them (SID_X → WID_X or TID_X, Ammo_X → AmmoDataX, SID_AmmoDataRockets, Gadget_X); SID_OB_Assault_Auto_T03 (a common
// assault rifle) and SID_Floor_Track (a gadget) keep a name made from theirs.
function craftedName(name) {
  const rest = name.replace(/^(sid|wid|tid)_/, "");
  return [`Weapon:wid_${rest}`, `Trap:tid_${rest}`, `Ammo:ammodata${rest.replace(/^ammo_/, "")}`, `Ammo:${rest}`, `Gadget:${rest}`]
    .map(gameName).find(Boolean);
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

// Every template some data build's game data has that the panel can give: items, quests, skill tree nodes, banners,
// lower-cased id -> {templateId, build, builds}. Accounts are shared by every build, so the panel gives what any build
// knows (Core-Backend #109: 1.8's Fortnitemares heroes, Hazard the 13th and Marine Corps Ramirez, weren't in Give, which
// read Cert's data only). builds are the data builds that have it, oldest first; build is the one whose data a grant of
// it uses: Cert's when Cert has it, as before, else the newest build's that has it (the order describeItem reads them
// in). Made on first use.
let templates;
const byNumber = (a, b) => Number(a) - Number(b);
function templateIndex() {
  if (templates) return templates;
  templates = new Map();
  for (const build of [...dataBuilds].sort(byNumber)) {
    inBuild(build, () => [...itemIds(), ...questIds().filter((id) => getQuest(id)).map((id) => `Quest:${id}`),
      ...nodeIds().filter((id) => getNode(id)).map((id) => `HomebaseNode:${id.toLowerCase()}`), ...bannerIds()])
      .forEach((templateId) => {
        const key = templateId.toLowerCase();
        if (!templates.has(key)) templates.set(key, { templateId, builds: [] });
        templates.get(key).builds.push(build);
      });
  }
  for (const entry of templates.values()) entry.build = entry.builds.includes(certBuild) ? certBuild : entry.builds.at(-1);
  return templates;
}

// {templateId (as its build's data spells it), build, builds} for a template some build's data has, else undefined.
export const knownTemplate = (templateId) => templateIndex().get(String(templateId).toLowerCase());

// The builds that have a template, as the panel's chip says it: null when every build does, "1.8+" for 1.8 onwards,
// "1.1–1.7.2" for a range that stops before the newest, else the versions one by one.
function buildsLabel(builds) {
  const all = [...dataBuilds].sort(byNumber);
  if (builds.length === all.length) return null;
  const first = all.indexOf(builds[0]);
  const contiguous = builds.every((build, index) => all[first + index] === build);
  const name = (build) => versionOf(build) ?? build;
  if (!contiguous) return builds.map(name).join(", ");
  if (builds.at(-1) === all.at(-1)) return `${name(builds[0])}+`;
  return builds.length === 1 ? name(builds[0]) : `${name(builds[0])}–${name(builds.at(-1))}`;
}

// What the panel's Give section shows for a template: its description and the builds that have it.
export const catalogEntry = (templateId) => {
  const known = knownTemplate(templateId);
  return { ...describeItem(known?.templateId ?? templateId), builds: known ? buildsLabel(known.builds) : null };
};

let worldTypes;
// Whether a template type is the world inventory's (theater0): some build's data keeps items of it there, or the panel
// files it with them.
export function isWorldType(type) {
  worldTypes ??= new Set([...templateIndex().values()]
    .filter(({ templateId, build }) => inBuild(build, () => getItem(templateId))?.profile === "theater")
    .map(({ templateId }) => templateId.split(":")[0].toLowerCase()));
  const lower = String(type).toLowerCase();
  return worldTypes.has(lower) || category(lower, "") === "world";
}

let catalog;
// Everything the panel can give: every build's items (not the never-persisted ones, in the build a grant would use),
// quests, skill tree nodes and banners.
function allTemplates() {
  catalog ??= [...templateIndex().values()]
    .filter(({ templateId, build }) => !inBuild(build, () => getItem(templateId)?.neverPersisted))
    .map(({ templateId }) => catalogEntry(templateId));
  return catalog;
}

export function searchCatalog(query = "", categoryKey = "", limit = 60) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return allTemplates()
    .filter((entry) => !categoryKey || entry.category === categoryKey)
    .filter((entry) => words.every((word) => entry.templateId.toLowerCase().includes(word) || entry.name.toLowerCase().includes(word)))
    .slice(0, limit);
}

// Battle Royale's cosmetics as the panel's cosmetic picker shows them (Core-Backend #108): the name, type and rarity in
// the data of the build being served (run it inBuild), sorted in the locker's order of types, then by name.
export function describeCosmetics(templateIds) {
  const cosmetics = athenaCosmetics();
  return templateIds.map((templateId) => {
    const cosmetic = cosmetics[templateId];
    const { code, label } = cosmeticRarity(cosmetic?.rarity);
    return { templateId, name: named(cosmetic?.name) ?? prettify(templateId.split(":")[1]?.toLowerCase() ?? templateId),
      type: cosmeticType(cosmetic?.class, templateId), rarity: label, rarityCode: code };
  }).sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name) || a.templateId.localeCompare(b.templateId));
}
const typeRank = (type) => (cosmeticTypeOrder.includes(type) ? cosmeticTypeOrder.indexOf(type) : cosmeticTypeOrder.length);

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
