import { getNodeByTemplateId, isUpgradesPageNode, nodeLevels, nodeTemplateId } from "../../../gamedata/homebase.js";
import { McpError } from "../../../errors.js";
import { grant } from "../../../profiles/progress.js";
import { heldQuantity, takeQuantity } from "../../../profiles/homebase.js";

// 6.30's (CL-4573096) Upgrades page, UFortMcpProfileCampaign::PurchaseOrUpgradeHomebaseNode {nodeId} on campaign
// (profile0). It replaces PurchaseHomebaseNode (PurchaseHomebaseNode.js, 1.x to 6.22's skill trees, which 6.30 doesn't
// send). The client's own prediction of it, PurchaseOrUpgradeHomebaseNode_Mocked (0x11CF7C0), is Epic's rule:
// - nodeId names a UFortHomebaseNodeItemDefinition ("Cannot purchase or upgrade %s (Invalid Homebase Node)");
// - the level held is the node item's quantity (0 without one), and LevelData[that] is the next level ("... at level %d
//   (MaxLevel is %d)" past the last);
// - that level's MinCommanderLevel is at most the profile's level stat ("(MinCommanderLevel needed is %d and
//   CurrentCommanderLevel is %d)");
// - the profile holds each of its Cost ("(Need %d %s to pay cost)"), the Upgrade Points (Token:homebasepoints).
// It takes the costs and adds 1 to the node item, or adds one of quantity 1. There's no prerequisite or vault check in
// 6.30 (its nodes have none, and HomebaseNodePurchaseRestrictionReason is gone).
// 🟡 Core also refuses Hidden nodes (Upgrades page's tabs are Gadget and Utility): they cost nothing and come from
// quests and level-ups.
export function purchaseOrUpgradeHomebaseNode({ req, session }) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const nodeId = String(req.body?.nodeId ?? "");
  const node = getNodeByTemplateId(nodeId);
  const refuse = (message) => { throw new McpError("errors.com.epicgames.fortnite.homebase_node_purchase_failed", `Cannot purchase or upgrade ${nodeId} ${message}`); };
  const levels = nodeLevels(node);

  if (!levels.length) refuse("(Invalid Homebase Node)");
  if (!isUpgradesPageNode(node)) refuse("(not on the Upgrades page)");
  const templateId = nodeTemplateId(node.id);
  const level = heldQuantity(profile, templateId);
  if (level >= levels.length) refuse(`at level ${level} (MaxLevel is ${levels.length})`);
  const next = levels[level];
  const commanderLevel = profile.stats.attributes.level ?? 1;
  if (commanderLevel < (next.minCommanderLevel ?? 0)) {
    refuse(`at level ${level} (MinCommanderLevel needed is ${next.minCommanderLevel} and CurrentCommanderLevel is ${commanderLevel})`);
  }
  for (const cost of next.cost ?? []) {
    if (heldQuantity(profile, cost.templateId) < cost.quantity) refuse(`at level ${level} (Need ${cost.quantity} ${cost.templateId} to pay cost)`);
  }

  for (const cost of next.cost ?? []) takeQuantity(tracker, cost.templateId, cost.quantity);
  // grant raises a held leveled node a level (profiles/items.js), so quests waiting on it move as they do for a new one.
  grant(session, templateId, 1);
}
