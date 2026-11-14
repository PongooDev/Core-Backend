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

// 6.30 (CL-4573096) names a node by its item's template id: the Upgrades screen's purchase (0x3185AB0) hands
// PurchaseOrUpgradeHomebaseNode its UFortUpgradeInfo's node definition's "Type:Name" id (UFortItemDefinition slot 0x238,
// the one the client also looks profile items up by), e.g. "HomebaseNode:SkillTree_Pickaxe".
// The bare row name earlier builds' PurchaseHomebaseNode sends is taken too.
export function getNodeByTemplateId(id) {
  return getNode(String(id).replace(/^homebasenode:/i, ""));
}

// A 6.30 node's levels, UFortHomebaseNodeItemDefinition LevelData (+0x370, FHomebaseNodeLevel: MinCommanderLevel, Cost,
// the effects it grants): the level a profile has is its HomebaseNode item's quantity. Earlier builds' skill tree rows
// have none ([]).
export const nodeLevels = (node) => node?.levels ?? [];

// The Upgrades page shows a node's DisplayType tab (UpgradesRoot's Gadget and Utility tabs); Hidden ones (the quests'
// QuestReward_*, CommanderLevel_RPCollection, StartNode_CommandCenter) come from quest and level-up rewards.
export const isUpgradesPageNode = (node) => nodeLevels(node).length > 0 && node.displayType !== "Hidden";

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
