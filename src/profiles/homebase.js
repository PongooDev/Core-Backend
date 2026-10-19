import { nodeTemplateId } from "../gamedata/homebase.js";

export function heldQuantity(profile, templateId) {
  return Object.values(profile.items)
    .filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase())
    .reduce((total, item) => total + item.quantity, 0);
}

// The client's rule: a node is owned when profile0 holds HomebaseNode:<lowercase node id>.
export function ownsNode(profile, nodeId) {
  return heldQuantity(profile, nodeTemplateId(nodeId)) > 0;
}
