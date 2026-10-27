import { defaultSchedule, tokenSchedules } from "../../../gamedata/dailyrewards.js";
import { findItem, lootEntry } from "../../../profiles/items.js";
import { grant } from "../../../profiles/progress.js";

const utcMidnight = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const isSchedules = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// The panel adds a "today's reward" card only for the schedules the stored stat calls unclaimed today: it reads the
// stat before it claims, and sub_2D29590 copies each additionalSchedules entry's claimedToday as it is. Cleared only
// by the claim, yesterday's flag hid the founder's card on every day after the first (#42), so a new day clears it on
// the profile the client loads (QueryProfile) too.
export function clearClaimedToday(tracker, now = new Date()) {
  const stat = tracker.profile.stats.attributes.daily_rewards;
  if (!stat || Date.parse(stat.lastClaimDate) >= utcMidnight(now) || !isSchedules(stat.additionalSchedules)) return;
  const schedules = Object.entries(stat.additionalSchedules);
  if (!schedules.some(([, schedule]) => schedule?.claimedToday)) return;
  const cleared = schedules.map(([name, schedule]) => [name, { ...schedule, claimedToday: false }]);
  tracker.setStat("daily_rewards", { ...stat, additionalSchedules: Object.fromEntries(cleared) });
}

// The client asks whenever its copy of daily_rewards says a claim is due, so the stat is always sent back to settle it.
// It fills the panel's reward cards from the notification's items, in order: the default schedule, then token schedules.
export function claimLoginReward({ session, notifications }) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const now = new Date();
  const stat = { nextDefaultReward: 0, totalDaysLoggedIn: 0, ...structuredClone(profile.stats.attributes.daily_rewards) };
  if (!isSchedules(stat.additionalSchedules)) stat.additionalSchedules = {};
  const items = [];
  const claim = (schedule, index) => {
    const reward = schedule.rewards[index % schedule.rewards.length];
    items.push(...grant(session, reward.templateId, reward.quantity, { packSource: "Schedule" }).map(lootEntry));
  };

  if (!(Date.parse(stat.lastClaimDate) >= utcMidnight(now))) {
    for (const schedule of Object.values(stat.additionalSchedules)) schedule.claimedToday = false;
    const schedule = defaultSchedule();
    if (schedule) claim(schedule, stat.nextDefaultReward);
    stat.nextDefaultReward += 1;
    stat.totalDaysLoggedIn += 1;
    stat.lastClaimDate = now.toISOString();
  }

  // Each claim uses one token; at zero it's removed, or the client would keep asking for that schedule.
  for (const schedule of tokenSchedules()) {
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
