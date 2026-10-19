import { caseInsensitive, readGameData } from "./read.js";

const { nodes = {}, pages = {} } = readGameData("homebasenodes", {});
const nodesById = caseInsensitive(nodes);
const pagesById = new Map(Object.entries(pages).map(([id, list]) => [id.toLowerCase(), list]));
const squadsById = caseInsensitive(readGameData("squads", {}));
const objectiveStats = readGameData("objectivestats", {});

// Every squad slot is unlocked by exactly one skill tree node.
const slotNodes = new Map();
for (const node of nodesById.values()) {
  for (const { squadId, slot } of node.squadSlots ?? []) slotNodes.set(`${squadId.toLowerCase()}#${slot}`, node.id);
}

export const nodeTemplateId = (nodeId) => `HomebaseNode:${nodeId.toLowerCase()}`;

export function getNode(nodeId) {
  return nodesById.get(String(nodeId).toLowerCase());
}

export function pageNodes(pageId) {
  return pagesById.get(String(pageId).toLowerCase()) ?? [];
}

export function getSquad(squadId) {
  return squadsById.get(String(squadId).toLowerCase());
}

export function slotUnlockNode(squadId, slot) {
  return slotNodes.get(`${squadId.toLowerCase()}#${slot}`);
}

export function getObjectiveStat(name) {
  return objectiveStats[name.toLowerCase()];
}

export function nodeIds() {
  return [...nodesById.values()].map((node) => node.id);
}
