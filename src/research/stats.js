import { perBuild } from "../gamedata/read.js";

// 6.30's (CL-4573096) Research page: the homebase manager's ResearchSystemUpgradesTable curve table (research.json stats,
// each curve's value by level, index = level). PurchaseResearchStatUpgrade reads three curves of a stat
// (UFortMcpProfileCampaign::PurchaseResearchStatUpgrade_Mocked, 0x11CFE50): <statId>_cost (Research Points for a level),
// <statId>_personal and <statId>_team (what the level adds to Stat:<statId> and Stat:<statId>_team); the max level is
// the cost curve's last key. The _cumulative curves are what the UI shows as a level's total. Earlier builds have none.
const curves = perBuild((read) => new Map(Object.entries(read("research", {}).stats ?? {}).map(([name, values]) => [name.toLowerCase(), values])));

export const researchCurve = (name) => curves().get(String(name).toLowerCase());

export const researchStatCurves = (statId) => ({
  cost: researchCurve(`${statId}_cost`),
  personal: researchCurve(`${statId}_personal`),
  team: researchCurve(`${statId}_team`),
  personalTotal: researchCurve(`${statId}_personal_cumulative`),
  teamTotal: researchCurve(`${statId}_team_cumulative`)
});

// The Research page's points: UFortHomebaseManager's research points item (+0x3628, a soft pointer the purchase loads),
// "Research Points", the research collector's payout (research.json collectors).
export const researchPointsTemplate = "Token:collectionresource_nodegatetoken01";

// research_levels, profile0's stat the page reads its levels from (UFortMcpProfileCampaign 0x11C10A0): {statId: level};
// a stat it doesn't name is at 0. The client looks a stat up by name, so the key is matched without case.
export function researchLevels(profile) {
  const levels = profile.stats.attributes.research_levels;
  return levels && typeof levels === "object" && !Array.isArray(levels) ? levels : {};
}

export function researchLevelKey(levels, statId) {
  return Object.keys(levels).find((key) => key.toLowerCase() === String(statId).toLowerCase());
}

export function researchLevel(profile, statId) {
  const levels = researchLevels(profile);
  const key = researchLevelKey(levels, statId);
  return key === undefined ? 0 : Math.max(0, Math.trunc(Number(levels[key]) || 0));
}
