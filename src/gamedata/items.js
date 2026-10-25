import { perBuild } from "./read.js";

const data = perBuild((read) => ({
  items: new Map(Object.entries(read("items", {})).map(([templateId, item]) => [templateId.toLowerCase(), { templateId, ...item }])),
  characters: new Map(Object.entries(read("characters", {})).map(([templateId, character]) => [templateId.toLowerCase(), character])),
  cardPacks: new Map(Object.entries(read("cardpacks", {})).map(([templateId, pack]) => [templateId.toLowerCase(), { templateId, ...pack }]))
}));

export function getItem(templateId) {
  return data().items.get(templateId.toLowerCase());
}

export function getCharacter(templateId) {
  return data().characters.get(templateId.toLowerCase());
}

export function getCardPack(templateId) {
  return data().cardPacks.get(templateId.toLowerCase());
}

export function itemIds() {
  return [...data().items.values()].map((item) => item.templateId);
}
