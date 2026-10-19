import crypto from "node:crypto";
import { getCharacter, getItem } from "../gamedata/items.js";
import { readGameData } from "../gamedata/read.js";

// A survivor's looks and traits (UFortWorker: gender, personality, set_bonus, portrait; the client's own export of
// one, sub_5D3830, also writes managerSynergy for leads). What the definition fixes (UFortWorkerType Gender,
// FixedPortrait, FixedPersonalityTag, FixedSetBonusTag, ManagerSynergyTag) is kept; the rest is rolled the way the
// game data describes it (MyFortData HomebaseData): a weighted personality, a gender, one of that personality's
// portraits for the gender, and for regular survivors a weighted set bonus. Leads have no set bonus.
// Without these the client shows a silhouette and empty PERSONALITY / SET BONUS (2026-10-19 bug report).
const { personalities = [], setBonuses = [] } = readGameData("workers", {});
const genderNumber = { Male: 1, Female: 2 };

function weighted(entries) {
  const total = entries.reduce((sum, entry) => sum + (entry.weight ?? 1), 0);
  let roll = crypto.randomInt(1_000_000) / 1_000_000 * total;
  for (const entry of entries) {
    roll -= entry.weight ?? 1;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

export const isSurvivor = (templateId) => getItem(templateId)?.class === "FortWorkerType";

export function rollWorkerAttributes(templateId) {
  const character = getCharacter(templateId) ?? {};
  const personality = personalities.find((entry) => entry.tag === character.personality) ?? weighted(personalities);
  const genderName = character.gender ?? weighted(personality?.genders ?? [{ gender: "Male" }]).gender;
  const portraits = personality?.genders.find((entry) => entry.gender === genderName)?.portraits ?? [];
  const attributes = {
    gender: genderNumber[genderName] ?? 1,
    personality: personality?.tag ?? "",
    portrait: character.portrait ?? (portraits.length ? weighted(portraits).portrait : "")
  };
  if (character.manager) attributes.managerSynergy = character.managerSynergy ?? "";
  else attributes.set_bonus = character.setBonus ?? (setBonuses.length ? weighted(setBonuses).tag : "");
  return attributes;
}

// Survivors made before these were rolled get them (the attributes the item lacks, so nothing set is changed).
export function fillWorkerAttributes(item) {
  if (!isSurvivor(item.templateId)) return false;
  const missing = Object.entries(rollWorkerAttributes(item.templateId)).filter(([name]) => !item.attributes[name]);
  for (const [name, value] of missing) item.attributes[name] = value;
  return missing.length > 0;
}
