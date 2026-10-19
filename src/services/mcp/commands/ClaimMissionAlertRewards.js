import { claimMissionAlertRewards as claim } from "../../../profiles/alerts.js";

// ClaimMissionAlertRewards (UFortMcpContext::GrantPendingMissionAlertRewards), no parameters.
export function claimMissionAlertRewards({ session, notifications }) {
  claim(session, notifications);
}
