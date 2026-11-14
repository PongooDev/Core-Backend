import { nodeTemplateId } from "../gamedata/homebase.js";

export function heldQuantity(profile, templateId) {
  return Object.values(profile.items)
    .filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase())
    .reduce((total, item) => total + item.quantity, 0);
}

// Takes quantity of a template from the stacks that hold it, in order, removing the ones it empties. The caller checked
// heldQuantity first.
export function takeQuantity(tracker, templateId, quantity) {
  let left = quantity;
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (left <= 0) break;
    if (item.templateId.toLowerCase() !== templateId.toLowerCase()) continue;
    const taken = Math.min(left, item.quantity);
    left -= taken;
    if (item.quantity - taken > 0) tracker.setQuantity(itemId, item.quantity - taken);
    else tracker.removeItem(itemId);
  }
}

// The client's rule: a node is owned when profile0 holds HomebaseNode:<lowercase node id>.
export function ownsNode(profile, nodeId) {
  return heldQuantity(profile, nodeTemplateId(nodeId)) > 0;
}
