import { McpError } from "../../../errors.js";
import { grant } from "../../../profiles/progress.js";
import { heldQuantity, takeQuantity } from "../../../profiles/homebase.js";
import { researchRespecToken } from "../../../profiles/respec.js";
import { researchLevel, researchLevels, researchPointsTemplate, researchStatCurves } from "../../../research/stats.js";

// Takes up to quantity from a stat's items (the account levels' FORT shares the stack with research's).
function lowerStat(tracker, templateId, quantity) {
  if (quantity > 0) takeQuantity(tracker, templateId, Math.min(quantity, heldQuantity(tracker.profile, templateId)));
}

// 6.30's (CL-4573096) UFortMcpProfileCampaign::RespecResearch, no fields, on campaign (profile0), sent by
// UFortResearchMenuBase::UseResearchRespecToken (0x311F460). The client doesn't predict it; ResearchScreen's dialog says
// what it does: "This will reset your research and consume one of your research refunds. All research points collected
// will be returned if you take this action." So it takes one Research Respec Token, and for each stat research_levels
// names gives back the Research Points its levels cost (_cost, level 1 to its level) and takes back what they added to
// Stat:<statId> and Stat:<statId>_team (the _personal_cumulative and _team_cumulative at its level, what
// PurchaseResearchStatUpgrade added level by level); research_levels is then empty (every stat at 0).
// 🟡 Points given back aren't held to the collector's wallet cap (ResearchPointMaxBonus caps claims, not refunds).
export function respecResearch({ session }) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  if (heldQuantity(profile, researchRespecToken) < 1) {
    throw new McpError("errors.com.epicgames.fortnite.item_consumption_failed", `RespecResearch needs 1 ${researchRespecToken}`);
  }
  takeQuantity(tracker, researchRespecToken, 1);

  let refund = 0;
  for (const statId of Object.keys(researchLevels(profile))) {
    const level = researchLevel(profile, statId);
    const { cost, personalTotal, teamTotal } = researchStatCurves(statId);
    if (!level || !cost) continue;
    const top = Math.min(level, cost.length - 1);
    for (let at = 1; at <= top; at++) refund += cost[at] ?? 0;
    lowerStat(tracker, `Stat:${statId}`, personalTotal?.[top] ?? 0);
    lowerStat(tracker, `Stat:${statId}_team`, teamTotal?.[top] ?? 0);
  }
  tracker.setStat("research_levels", {});
  if (refund > 0) grant(session, researchPointsTemplate, refund);
}
