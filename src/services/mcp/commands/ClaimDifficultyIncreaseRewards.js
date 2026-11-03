import { claimDifficultyIncreaseRewards as claim } from "../../../profiles/difficultyincrease.js";

// ClaimDifficultyIncreaseRewards (UFortMcpContext::GrantPendingDifficultyIncreaseRewards), no parameters.
export function claimDifficultyIncreaseRewards({ session, notifications }) {
  claim(session, notifications);
}
