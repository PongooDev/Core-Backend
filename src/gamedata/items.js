import { readGameData } from "./read.js";

const items = new Map(Object.entries(readGameData("items", {})).map(([templateId, item]) => [templateId.toLowerCase(), { templateId, ...item }]));
const characters = new Map(Object.entries(readGameData("characters", {})).map(([templateId, data]) => [templateId.toLowerCase(), data]));
const cardPacks = new Map(Object.entries(readGameData("cardpacks", {})).map(([templateId, data]) => [templateId.toLowerCase(), data]));

export function getItem(templateId) {
  return items.get(templateId.toLowerCase());
}

export function getCharacter(templateId) {
  return characters.get(templateId.toLowerCase());
}

export function getCardPack(templateId) {
  return cardPacks.get(templateId.toLowerCase());
}

export function itemIds() {
  return [...items.values()].map((item) => item.templateId);
}
