import { currentBuild } from "../builds/context.js";
import { grant } from "./progress.js";

// 6.30's (CL-4573096) respec tokens: the Upgrades page's UpgradesRespecToken (Items/Tokens/Upgrades_Respec, "Use these to
// reset your upgrades!") and the Research page's ResearchRespecToken (Items/Tokens/Research_Respec). RespecUpgrades and
// RespecResearch each use one (services/mcp/commands/RespecUpgrades.js, RespecResearch.js).
export const upgradesRespecToken = "Token:upgrades_respec";
export const researchRespecToken = "Token:research_respec";

// 🟡 Core's choice: nothing in 6.30's data grants either token (no account level, quest, card pack or store offer names
// them), and the respec dialogs can't be used without one (AreUpgradesRespecTokensAvailable /
// AreResearchRespecTokensAvailable). So the campaign profile's first load on 6.30 or later gives one of each, once per
// account: coreMigrations notes it (respecTokens, Core's, never sent), so it never repeats, whatever the account spends
// or the build it plays next. Earlier builds give none and don't note it.
const firstBuild = 4573096;
const migration = "respecTokens";

export const respecTokensNeedSetUp = (profile) => Number(currentBuild()) >= firstBuild && !(profile.coreMigrations ?? []).includes(migration);

export function setUpRespecTokens(session) {
  const { profile } = session.profile("profile0");
  if (!respecTokensNeedSetUp(profile)) return;
  grant(session, upgradesRespecToken, 1);
  grant(session, researchRespecToken, 1);
  profile.coreMigrations = [...(profile.coreMigrations ?? []), migration];
}
