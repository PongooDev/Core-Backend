import { getNode, nodeTemplateId, pageNodes } from "../../../gamedata/homebase.js";
import { McpError } from "../../../errors.js";
import { grant } from "../../../profiles/progress.js";
import { heldQuantity, ownsNode as owns } from "../../../profiles/homebase.js";
import { questIdOf } from "../../../profiles/quests.js";

// Same checks the client runs before sending (AreNodePrereqsMet, AreNodeQuestReqsMet, AreNodeCostsMet).
function prerequisitesMet(profile, node) {
  if (!node.prerequisites?.length) return true;
  return node.prerequisites.some((group) => group.every((entry) => {
    if (entry.node) return owns(profile, entry.node);
    const onPage = pageNodes(entry.page).filter((id) => {
      const costs = getNode(id)?.cost ?? [];
      if (entry.nodeType === "All") return true;
      if (entry.nodeType === "SkillPoint") return costs.some((c) => c.templateId.toLowerCase() === "token:homebasepoints");
      if (entry.nodeType === "ResearchPoint") return costs.some((c) => c.templateId.toLowerCase() === "token:collectionresource_nodegatetoken01");
      return false;
    });
    return onPage.filter((id) => owns(profile, id)).length >= entry.min;
  }));
}

function questsClaimed(profile, node) {
  return (node.quests ?? []).every((questId) => Object.values(profile.items)
    .some((item) => questIdOf(item) === questId && item.attributes.quest_state === "Claimed"));
}

export function purchaseHomebaseNode({ req, session }) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const node = getNode(req.body?.nodeId ?? "");
  const refuse = (message) => { throw new McpError("errors.com.epicgames.fortnite.homebase_node_purchase_failed", message); };

  if (!node) refuse(`No skill tree node ${req.body?.nodeId}`);
  if (owns(profile, node.id)) refuse(`${node.id} is already owned`);
  if (!prerequisitesMet(profile, node)) refuse(`${node.id} needs other nodes first`);
  if (!questsClaimed(profile, node)) refuse(`${node.id} needs quests ${node.quests.join(", ")}`);
  for (const cost of node.cost ?? []) {
    if (heldQuantity(profile, cost.templateId) < cost.quantity) refuse(`${node.id} costs ${cost.quantity} ${cost.templateId}`);
  }

  for (const cost of node.cost ?? []) {
    let left = cost.quantity;
    for (const [itemId, item] of Object.entries(profile.items)) {
      if (left === 0 || item.templateId.toLowerCase() !== cost.templateId.toLowerCase()) continue;
      const taken = Math.min(left, item.quantity);
      left -= taken;
      if (item.quantity - taken > 0) tracker.setQuantity(itemId, item.quantity - taken);
      else tracker.removeItem(itemId);
    }
  }
  grant(session, nodeTemplateId(node.id), 1);
}
