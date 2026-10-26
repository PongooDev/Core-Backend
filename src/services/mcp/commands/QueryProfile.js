import { clearClaimedToday } from "./ClaimLoginReward.js";

export function queryProfile({ profileId, tracker }) {
  if (profileId === "profile0") clearClaimedToday(tracker);
}
