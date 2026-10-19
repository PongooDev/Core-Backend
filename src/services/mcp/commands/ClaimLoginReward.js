import { defaultSchedule, tokenSchedules } from "../../../gamedata/dailyrewards.js";
import { findItem, lootEntry } from "../../../profiles/items.js";
import { grant } from "../../../profiles/progress.js";

const utcMidnight = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

// The client asks whenever its copy of daily_rewards says a claim is due, so the stat is always sent back to settle it.
// It fills the panel's reward cards from the notification's items, in order: the default schedule, then token schedules.
export function claimLoginReward({ session, notifications }) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const now = new Date();
  const stat = { nextDefaultReward: 0, totalDaysLoggedIn: 0, ...structuredClone(profile.stats.attributes.daily_rewards) };
  if (typeof stat.additionalSchedules !== "object" || Array.isArray(stat.additionalSchedules) || !stat.additionalSchedules) {
    stat.additionalSchedules = {};
  }
  const items = [];
  const claim = (schedule, index) => {
    const reward = schedule.rewards[index % schedule.rewards.length];
    items.push(...grant(session, reward.templateId, reward.quantity).map(lootEntry));
  };

  if (!(Date.parse(stat.lastClaimDate) >= utcMidnight(now))) {
    for (const schedule of Object.values(stat.additionalSchedules)) schedule.claimedToday = false;
    if (defaultSchedule) claim(defaultSchedule, stat.nextDefaultReward);
    stat.nextDefaultReward += 1;
    stat.totalDaysLoggedIn += 1;
    stat.lastClaimDate = now.toISOString();
  }

  // Each claim uses one token; at zero it's removed, or the client would keep asking for that schedule.
  for (const schedule of tokenSchedules) {
    const tokenId = findItem(profile, schedule.token);
    if (!tokenId || profile.items[tokenId].quantity <= 0) continue;
    const key = Object.keys(stat.additionalSchedules).find((name) => name.toLowerCase() === schedule.name.toLowerCase()) ?? schedule.name;
    const claimed = stat.additionalSchedules[key] ?? { rewardsClaimed: 0, claimedToday: false };
    if (claimed.claimedToday) continue;

    claim(schedule, claimed.rewardsClaimed);
    stat.additionalSchedules[key] = { rewardsClaimed: claimed.rewardsClaimed + 1, claimedToday: true };
    const left = profile.items[tokenId].quantity - 1;
    if (left > 0) tracker.setQuantity(tokenId, left);
    else tracker.removeItem(tokenId);
  }

  tracker.setStat("daily_rewards", stat);
  notifications.push({ type: "daily_rewards", primary: true, daysLoggedIn: stat.totalDaysLoggedIn, items });
}
