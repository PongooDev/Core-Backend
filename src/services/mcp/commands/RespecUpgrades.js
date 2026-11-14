import { getNodeByTemplateId, isUpgradesPageNode, nodeLevels } from "../../../gamedata/homebase.js";
import { McpError } from "../../../errors.js";
import { grant } from "../../../profiles/progress.js";
import { heldQuantity, takeQuantity } from "../../../profiles/homebase.js";

// The Upgrades page's token, UUpgradesRoot_C UpgradesRespecToken (Items/Tokens/Upgrades_Respec, "Use these to reset your
// upgrades!"); the page offers a respec only while one is held (AreUpgradesRespecTokensAvailable).
export const upgradesRespecToken = "Token:upgrades_respec";

// 6.30's (CL-4573096) UFortMcpProfileCampaign::RespecUpgrades, no fields, on campaign (profile0), sent by
// UFortUpgradeScreenBase::UseUpgradesRespecToken (0x31A02F0). The client doesn't predict it; UpgradesRoot's dialog says
// what it does: "This will reset your upgrades and consume one of your upgrade refunds. All upgrade points collected will
// be returned if you take this action." So it takes one Upgrades Respec Token, removes every Upgrades page node and
// gives back what each level held cost (its LevelData Cost, level 1 to the item's quantity).
// 🟡 The Hidden nodes (quest and level-up rewards, never bought) stay.
export function respecUpgrades({ session }) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  if (heldQuantity(profile, upgradesRespecToken) < 1) {
    throw new McpError("errors.com.epicgames.fortnite.item_consumption_failed", `RespecUpgrades needs 1 ${upgradesRespecToken}`);
  }
  takeQuantity(tracker, upgradesRespecToken, 1);

  const refunds = new Map();
  for (const [itemId, item] of Object.entries(profile.items)) {
    if (!item.templateId.toLowerCase().startsWith("homebasenode:")) continue;
    const node = getNodeByTemplateId(item.templateId);
    if (!isUpgradesPageNode(node)) continue;
    for (const level of nodeLevels(node).slice(0, Math.max(0, item.quantity))) {
      for (const { templateId, quantity } of level.cost ?? []) refunds.set(templateId, (refunds.get(templateId) ?? 0) + quantity);
    }
    tracker.removeItem(itemId);
  }
  for (const [templateId, quantity] of refunds) grant(session, templateId, quantity);
}
