import { perBuild } from "../gamedata/read.js";

// Loot pools for card packs, built from the requesting build's item data. Rarity and tier come from the names
// (_c/_uc/_r/_vr/_sr, _t01-_t06): this build's Rarity properties are placeholders (most schematics say Sturdy whatever
// their name says).
export const rarities = ["c", "uc", "r", "vr", "sr"];

function describe(templateId) {
  const [type, name] = templateId.split(":");
  const tokens = name.split("_");
  const rarity = [...tokens].reverse().find((token) => rarities.includes(token));
  const tier = Number(tokens.find((token) => /^t\d\d$/.test(token))?.slice(1) ?? 0);
  return { templateId, type: type.toLowerCase(), tokens, rarity, tier };
}

const tagged = (tags, prefix) => tags.find((tag) => tag.toLowerCase().startsWith(prefix))?.toLowerCase().slice(prefix.length).split(".")[0];

const data = perBuild((read) => {
  const items = read("items", {});
  const characters = new Map(Object.entries(read("characters", {})).map(([id, character]) => [id.toLowerCase(), character]));
  // Kinds a pack can ask for, each with the sub-kinds pack names use (hero_commando, manager_doctor, ranged_pistol...).
  const entries = [];
  for (const templateId of Object.keys(items)) {
    const item = describe(templateId);
    // Founders, test and tutorial items only come from their own packs, and the Halloween event's (the "Husk"
    // survivors, WorkerHalloween) from its event; tier 0 items are tutorial versions.
    if (item.tokens.some((token) => ["founders", "test", "tutorial"].includes(token) || token.includes("halloween")) || item.tier === 0 || !item.rarity) continue;
    const tags = characters.get(templateId.toLowerCase())?.tags ?? items[templateId].tags ?? [];

    if (item.type === "hero") entries.push({ ...item, kind: "hero", sub: tagged(tags, "homebase.class.is") });
    else if (item.type === "worker" && tagged(tags, "homebase.manager.is")) entries.push({ ...item, kind: "manager", sub: tagged(tags, "homebase.manager.is") });
    else if (item.type === "worker") entries.push({ ...item, kind: "worker" });
    else if (item.type === "defender") entries.push({ ...item, kind: "defender", sub: tagged(tags, "npc.charactertype.survivor.defender.") });
    else if (item.type === "schematic") {
      const ranged = tagged(tags, "weapon.ranged.");
      const melee = tagged(tags, "weapon.melee.");
      if (ranged) entries.push({ ...item, kind: "ranged", sub: ranged });
      else if (melee) entries.push({ ...item, kind: "melee", sub: item.tokens[2] });
      else if (tagged(tags, "trap.")) entries.push({ ...item, kind: "trap", sub: tagged(tags, "trap.") });
    }
  }
  const ids = Object.keys(items);
  return { ids, lowerIds: new Set(ids.map((id) => id.toLowerCase())), entries, kinds: new Set([...entries.map((entry) => entry.kind), ...Object.keys(kindAliases)]) };
});

// Pack names say "survivor" for workers, "weapon" for ranged (its description: "One random ranged weapon schematic"),
// "assault" for assault rifle defenders, and "commando" for soldiers.
const kindAliases = { survivor: ["worker"], weapon: ["ranged"], schematic: ["ranged", "melee", "trap"], all: ["hero", "worker", "manager", "defender", "ranged", "melee", "trap"] };
const subAliases = { defender: { assault: "assaultrifle" }, ranged: { launcher: "heavy", explosive: "heavy" } };

// The rarities to try for a wanted one: itself, then rarer, then more common.
const rarityOrder = (rarity) => [rarity, ...rarities.slice(rarities.indexOf(rarity) + 1), ...rarities.slice(0, rarities.indexOf(rarity)).reverse()];

// Every item of the wanted kind and sub-kind at a rarity (or the nearest rarity there is), at the lowest tier there is
// (a fresh account's level).
export function pool(kind, sub, rarity) {
  const kinds = kindAliases[kind] ?? [kind];
  const wantedSub = sub && (subAliases[kind]?.[sub] ?? sub);
  const ofKind = data().entries.filter((entry) => kinds.includes(entry.kind) && (!wantedSub || entry.sub === wantedSub));
  for (const wanted of rarityOrder(rarities.includes(rarity) ? rarity : "r")) {
    const matching = ofKind.filter((entry) => entry.rarity === wanted);
    if (!matching.length) continue;
    const lowest = Math.min(...matching.map((entry) => entry.tier));
    return matching.filter((entry) => entry.tier === lowest).map((entry) => entry.templateId);
  }
  return [];
}

export const isKnownKind = (kind) => data().kinds.has(kind);

// Items of any of these kinds whose name holds every word (melee + axe, ranged + launcher + pumpkin, hero + ninja), at
// a rarity (or the nearest there is) and its lowest tier.
export function poolMatching(kinds, words, rarity) {
  const matching = data().entries.filter((entry) => kinds.includes(entry.kind) && words.every((word) => entry.tokens.includes(word)));
  for (const wanted of rarityOrder(rarities.includes(rarity) ? rarity : "r")) {
    const atRarity = matching.filter((entry) => entry.rarity === wanted);
    if (!atRarity.length) continue;
    const lowest = Math.min(...atRarity.map((entry) => entry.tier));
    return atRarity.filter((entry) => entry.tier === lowest).map((entry) => entry.templateId);
  }
  return [];
}

// Named packs (starter, quest, custom): the schematics whose name holds every word of the pack's name.
export function namedSchematics(words, rarity, { founders = false } = {}) {
  const matches = data().ids.map(describe).filter((item) => item.type === "schematic" && item.tier > 0 &&
    founders === item.tokens.includes("founders") && words.every((word) => item.tokens.includes(word)));
  for (const wanted of rarityOrder(rarity)) {
    const atRarity = matches.filter((item) => item.rarity === wanted);
    if (atRarity.length) {
      const lowest = Math.min(...atRarity.map((item) => item.tier));
      return atRarity.filter((item) => item.tier === lowest).map((item) => item.templateId);
    }
  }
  return [];
}

export const hasItem = (templateId) => data().lowerIds.has(templateId.toLowerCase());
