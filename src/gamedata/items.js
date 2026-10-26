import { perBuild } from "./read.js";

const data = perBuild((read) => ({
  items: new Map(Object.entries(read("items", {})).map(([templateId, item]) => [templateId.toLowerCase(), { templateId, ...item }])),
  characters: new Map(Object.entries(read("characters", {})).map(([templateId, character]) => [templateId.toLowerCase(), character])),
  cardPacks: new Map(Object.entries(read("cardpacks", {})).map(([templateId, pack]) => [templateId.toLowerCase(), { templateId, ...pack }])),
  cloudSaveProfile: Object.values(read("items", {})).find((item) => item.class === "FortOutpostItemDefinition")?.profile ?? "profile"
}));

export function getItem(templateId) {
  return data().items.get(templateId.toLowerCase());
}

export function getCharacter(templateId) {
  return data().characters.get(templateId.toLowerCase());
}

// The profile type the build keeps storm shields and deployable bases (cloud save items) in: "profile" up to 1.2,
// "metadata" from 1.7.2 (tools/extractor, ItemClasses.ProfileType).
export function cloudSaveProfile() {
  return data().cloudSaveProfile;
}

export function getCardPack(templateId) {
  return data().cardPacks.get(templateId.toLowerCase());
}

export function itemIds() {
  return [...data().items.values()].map((item) => item.templateId);
}
