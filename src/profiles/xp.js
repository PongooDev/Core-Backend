import { currentBuild } from "../builds/context.js";
import { itemIds } from "../gamedata/items.js";
import { perBuild } from "../gamedata/read.js";
import { boostBalance, boostTemplate, levelRest, restBalance, restTemplate, spendBoost, spendRest, xpBonus } from "./boosts.js";
import { findItem } from "./items.js";
import { grant } from "./progress.js";

// Account levels (Balance/DataTables/XPAccountLevels): the total XP each level needs and the multiplier the UI shows
// XP through (1,000,000 XP between early levels shows as 250).
const levels = perBuild((read) => read("accountlevels", []));
export const maxLevel = () => (levels().length ? levels()[levels().length - 1].level : 1);
const levelData = (level) => levels().find((entry) => entry.level === level);

// 2.2 (CL-3841827): "The Commander XP curve has been inflated to make way for front-end crafting... Commander XP will
// appear larger than it did previously, but the amount of Commander XP you have earned toward your next level has been
// preserved, and the time it takes to level up remains unchanged", and "Increased players' current Daily Bonus XP and
// current Boost XP reserves to match the new Commander XP scale." 2.2's XPAccountLevels rows hold each level's own XP,
// 10,000,000 past level 1 (2.1's held the running total, 1,000,000 a level: 3,090,000,000 by level 310 would not fit
// the row's int32 Xp), and its RestXPCap, RestXPRechargeRate, BoostXPPerConsumable and Quota:RestXP are ten times 2.1's;
// its DefaultGameData's ScoreToXPLinearRate is 4.106437, 2.1's 0.410644. So from 2.2 a match's XP is ten times as much,
// and an account's XP into its level, rest XP and boost XP are ten times what they are on 2.1 and earlier.
// 2.3 (CL-3847564), 2.4 (CL-3858292), 2.4.2 (CL-3870737) and 2.5 (CL-3889387) keep 2.2's scale: their XPAccountLevels,
// rest XP rows and ScoreToXPLinearRate are 2.2's. So do 3.0 (CL-3901517), whose XPAccountLevels are 2.5's, and 3.1 (CL-3915963), whose are 3.0's.
const inflatedXpBuild = 3841827;
const inflatedXp = () => Number(currentBuild()) >= inflatedXpBuild;
export const commanderXpScale = () => (inflatedXp() ? 10 : 1);

// profile0's xp stat is the XP earned into the current level, not the total: the client's account info (sub_667B60,
// FFortPublicAccountInfo) shows LevelXp = display(level, xp) against LevelXpForLevel = display(level,
// TotalXp(level + 1) - TotalXp(level)), and the XP bar fills by their ratio. From 2.2 a row's XP is the level's own.
export const levelStartXp = (level) => (inflatedXp()
  ? levels().filter((entry) => entry.level <= level).reduce((sum, entry) => sum + entry.xp, 0)
  : levelData(level)?.xp ?? 0);
export const xpForLevel = (level) => (level < maxLevel()
  ? levelData(level + 1).xp - (inflatedXp() ? 0 : levelData(level).xp) : 0);

// Accounts are shared by every build, so profile0 keeps the scale its Commander XP is in (profile.coreXpScale, Core's,
// never sent; 1 for a profile that has none, made before 2.2), and a build of the other scale converts it once, as
// Epic's servers did when 2.2 came out: the XP into the level, the rest XP left (its cap and refill rate the level row's
// on that build) and the boost XP, each times the ratio. Only a request naming its build switches it (the admin panel's
// read the profile as it is).
export const profileXpScale = (profile) => profile.coreXpScale ?? 1;
const namesBuild = () => Number.isInteger(Number(currentBuild()));
export const xpScaleNeedsSwitch = (profile) => namesBuild() && profileXpScale(profile) !== commanderXpScale();

export function switchXpScale(session) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  if (!xpScaleNeedsSwitch(profile)) return;
  const ratio = commanderXpScale() / profileXpScale(profile);
  const scaled = (value) => Math.round((value ?? 0) * ratio);
  const { level = 1, xp = 0 } = profile.stats.attributes;
  if (xp) tracker.setStat("xp", scaled(xp));
  const restId = findItem(profile, restTemplate);
  if (restId) {
    levelRest(session, level);
    const rest = profile.items[restId].attributes;
    tracker.setItemAttribute(restId, "current_value", Math.min(scaled(rest.current_value), rest.max_quota ?? Infinity));
  }
  const boostId = findItem(profile, boostTemplate);
  if (boostId) tracker.setQuantity(boostId, Math.max(1, scaled(profile.items[boostId].quantity)));
  profile.coreXpScale = commanderXpScale();
}

// Moves the account up through every level its xp fills, granting each new level's rewards, and keeps the rest of
// the xp in the level reached. A maxed account keeps none. Returns the levels gained.
export function settleLevel(session) {
  const tracker = session.profile("profile0");
  const stats = tracker.profile.stats.attributes;
  let level = stats.level ?? 1;
  let xp = Math.max(0, stats.xp ?? 0);
  const gained = [];
  while (level < maxLevel() && xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
    gained.push(level);
    for (const { asset, quantity } of levelData(level).rewards) {
      const templateId = rewardTemplate(asset);
      if (templateId) grant(session, templateId, quantity, { packSource: "LevelUp" });
    }
  }
  if (level >= maxLevel()) xp = 0;
  if (xp !== stats.xp) tracker.setStat("xp", xp);
  if (gained.length) tracker.setStat("level", level);
  return gained;
}

// Level-up rewards name assets ("HomebasePoints"); items are keyed "Type:name".
const rewardTemplate = (asset) => itemIds().find((id) => id.split(":")[1] === asset.toLowerCase());

// Match score to account XP: UFortGameData ScoreToXPLinearRate 0.612901 up to LinearEnd 18,300,000 score
// (Balance/DefaultGameData). Nothing in the client converts score to XP, so Epic's servers did; past LinearEnd Core keeps
// the linear rate (inferred). From 2.2 it is ten times that, as the XP curve is (commanderXpScale).
export const scoreToXpRate = 0.612901;

export const noXpEarned = { baseXPEarned: 0, bonusXPEarned: 0, boostXPEarned: 0, boostXPMissed: 0, restXPEarned: 0, groupBoostXPEarned: 0 };

// Adds score as XP to the account (profile0 stats level and xp) and grants each new level's rewards. On top of the base XP (the parts FFortEarnScoreNotification reports, Core's rule with the client's rates):
// a critical match adds CriticalMatch_XpBonusPercent; rest XP adds up to Rest_XpBonusPercent of it from the RestXP
// quota; boost XP adds up to PersonalBoost_XpBonusPercent of it from Token:xpboost, and boostXPMissed is the part
// there was no boost for. Group boost isn't given. Returns those parts, xpEarned (their total) and levels gained.
export function earnScore(session, score, { criticalMatch = false, now = new Date() } = {}) {
  const tracker = session.profile("profile0");
  const stats = tracker.profile.stats.attributes;
  const base = Math.max(0, Math.round(score * scoreToXpRate * commanderXpScale()));
  if (!base) return { ...noXpEarned, xpEarned: 0, levels: [] };

  const bonus = criticalMatch ? Math.round(base * xpBonus.criticalMatch) : 0;
  const rest = Math.min(restBalance(session, now), Math.round(base * xpBonus.rest));
  const boostWanted = Math.round(base * xpBonus.personalBoost);
  const boost = Math.min(boostBalance(session), boostWanted);
  spendRest(session, rest, now);
  spendBoost(session, boost);
  const xpEarned = base + bonus + rest + boost;

  tracker.setStat("xp", (stats.xp ?? 0) + xpEarned);
  const gained = settleLevel(session);
  if (gained.length) levelRest(session, gained[gained.length - 1], now);
  return {
    baseXPEarned: base, bonusXPEarned: bonus, boostXPEarned: boost, boostXPMissed: boostWanted - boost,
    restXPEarned: rest, groupBoostXPEarned: 0, xpEarned, levels: gained
  };
}
