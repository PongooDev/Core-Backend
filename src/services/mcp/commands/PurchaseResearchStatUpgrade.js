import { getItem } from "../../../gamedata/items.js";
import { McpError } from "../../../errors.js";
import { grant } from "../../../profiles/progress.js";
import { heldQuantity, takeQuantity } from "../../../profiles/homebase.js";
import { researchLevel, researchLevelKey, researchLevels, researchPointsTemplate, researchStatCurves } from "../../../research/stats.js";

const isStat = (templateId) => getItem(templateId)?.class === "FortStatItemDefinition";

// 6.30's (CL-4573096) Research page, UFortMcpProfileCampaign::PurchaseResearchStatUpgrade {statId} on campaign
// (profile0), sent by UFortResearchMenuBase::RequestPurchaseResearchLevel (0x3111770) with a tile's StatIdName
// ("fortitude", "offense", "resistance", "technology"). The client's own prediction of it,
// PurchaseResearchStatUpgrade_Mocked (0x11CFE50), is Epic's rule:
// - Stat:<statId> and Stat:<statId>_team are FortStatItemDefinitions ("Cannot purchase research stat %s (Invalid Stat)");
// - the stat's _cost, _personal and _team curves exist (research/stats.js);
// - the next level, research_levels[statId] + 1, is at most the cost curve's last key ("(Max stat level reached)");
// - the Research Points held pay that level's cost ("(Need %d %s to pay cost)").
// It takes the cost, adds the level's _personal to the Stat:<statId> item and its _team to Stat:<statId>_team (adding
// the item if there's none), and writes research_levels with the stat at the new level, the others as they were.
// 🟡 A level whose _team adds 0 adds no Stat:<statId>_team item where there's none (most levels add 0).
export function purchaseResearchStatUpgrade({ req, session }) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const statId = String(req.body?.statId ?? "");
  const refuse = (message) => { throw new McpError("errors.com.epicgames.fortnite.research_stat_upgrade_failed", `Cannot purchase research stat ${statId} ${message}`); };
  const personalStat = `Stat:${statId}`;
  const teamStat = `Stat:${statId}_team`;

  if (!statId || !isStat(personalStat) || !isStat(teamStat)) refuse("(Invalid Stat)");
  const { cost, personal, team } = researchStatCurves(statId);
  if (!cost || !personal || !team) refuse("(ResearchSystemUpgradesTable doesn't have necessary cost, personal stat or team stat curves)");
  const level = researchLevel(profile, statId) + 1;
  if (level > cost.length - 1) refuse("(Max stat level reached)");
  const price = cost[level] ?? 0;
  if (heldQuantity(profile, researchPointsTemplate) < price) refuse(`(Need ${price} ${researchPointsTemplate} to pay cost)`);

  if (price > 0) takeQuantity(tracker, researchPointsTemplate, price);
  if ((personal[level] ?? 0) > 0) grant(session, personalStat, personal[level]);
  if ((team[level] ?? 0) > 0) grant(session, teamStat, team[level]);
  const levels = researchLevels(profile);
  const key = researchLevelKey(levels, statId) ?? statId;
  tracker.setStat("research_levels", { ...levels, [key]: level });
}
