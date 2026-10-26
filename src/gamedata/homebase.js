import { caseInsensitive, perBuild } from "./read.js";

const data = perBuild((read) => {
  const { nodes = {}, pages = {} } = read("homebasenodes", {});
  const nodesById = caseInsensitive(nodes);
  // Every squad slot is unlocked by exactly one skill tree node.
  const slotNodes = new Map();
  for (const node of nodesById.values()) {
    for (const { squadId, slot } of node.squadSlots ?? []) slotNodes.set(`${squadId.toLowerCase()}#${slot}`, node.id);
  }
  return {
    nodesById,
    pagesById: new Map(Object.entries(pages).map(([id, list]) => [id.toLowerCase(), list])),
    squadsById: caseInsensitive(read("squads", {})),
    objectiveStats: read("objectivestats", {}),
    slotNodes
  };
});

export const nodeTemplateId = (nodeId) => `HomebaseNode:${nodeId.toLowerCase()}`;

export function getNode(nodeId) {
  return data().nodesById.get(String(nodeId).toLowerCase());
}

export function pageNodes(pageId) {
  return data().pagesById.get(String(pageId).toLowerCase()) ?? [];
}

export function getSquad(squadId) {
  return data().squadsById.get(String(squadId).toLowerCase());
}

export function slotUnlockNode(squadId, slot) {
  return data().slotNodes.get(`${squadId.toLowerCase()}#${slot}`);
}

export function getObjectiveStat(name) {
  return data().objectiveStats[name.toLowerCase()];
}

export function nodeIds() {
  return [...data().nodesById.values()].map((node) => node.id);
}
