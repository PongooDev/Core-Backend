import { readGameData } from "../gamedata/read.js";
import { boostBalance, levelRest, restBalance, spendBoost, spendRest, xpBonus } from "./boosts.js";
import { grantItem } from "./items.js";

// Account levels (Balance/DataTables/XPAccountLevels): the total XP each level needs and the multiplier the UI shows
// XP through (1,000,000 XP between early levels shows as 250).
const levels = readGameData("accountlevels", []);
export const maxLevel = levels.length ? levels[levels.length - 1].level : 1;
const levelData = (level) => levels.find((entry) => entry.level === level);

// profile0's xp stat is the XP earned into the current level, not the total: the client's account info (sub_667B60,
// FFortPublicAccountInfo) shows LevelXp = display(level, xp) against LevelXpForLevel = display(level,
// TotalXp(level + 1) - TotalXp(level)), and the XP bar fills by their ratio.
export const levelStartXp = (level) => levelData(level)?.xp ?? 0;
export const xpForLevel = (level) => (level < maxLevel ? levelData(level + 1).xp - levelData(level).xp : 0);

// Moves the account up through every level its xp fills, granting each new level's rewards, and keeps the rest of
// the xp in the level reached. A maxed account keeps none. Returns the levels gained.
export function settleLevel(session) {
  const tracker = session.profile("profile0");
  const stats = tracker.profile.stats.attributes;
  let level = stats.level ?? 1;
  let xp = Math.max(0, stats.xp ?? 0);
  const gained = [];
  while (level < maxLevel && xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
    gained.push(level);
    for (const { asset, quantity } of levelData(level).rewards) {
      const templateId = rewardTemplate(asset);
      if (templateId) grantItem(session, templateId, quantity, { packSource: "LevelUp" });
    }
  }
  if (level >= maxLevel) xp = 0;
  if (xp !== stats.xp) tracker.setStat("xp", xp);
  if (gained.length) tracker.setStat("level", level);
  return gained;
}

// Level-up rewards name assets ("HomebasePoints"); items are keyed "Type:name".
const items = readGameData("items", {});
const rewardTemplate = (asset) => Object.keys(items).find((id) => id.split(":")[1] === asset.toLowerCase());

// Match score to account XP: UFortGameData ScoreToXPLinearRate 0.612901 up to LinearEnd 18,300,000 score
// (Balance/DefaultGameData). Nothing in the client converts score to XP, so Epic's servers did; past LinearEnd Core keeps
// the linear rate (inferred).
export const scoreToXpRate = 0.612901;

export const noXpEarned = { baseXPEarned: 0, bonusXPEarned: 0, boostXPEarned: 0, boostXPMissed: 0, restXPEarned: 0, groupBoostXPEarned: 0 };

// Adds score as XP to the account (profile0 stats level and xp) and grants each new level's rewards. On top of the base XP (the parts FFortEarnScoreNotification reports, Core's rule with the client's rates):
// a critical match adds CriticalMatch_XpBonusPercent; rest XP adds up to Rest_XpBonusPercent of it from the RestXP
// quota; boost XP adds up to PersonalBoost_XpBonusPercent of it from Token:xpboost, and boostXPMissed is the part
// there was no boost for. Group boost isn't given. Returns those parts, xpEarned (their total) and levels gained.
export function earnScore(session, score, { criticalMatch = false, now = new Date() } = {}) {
  const tracker = session.profile("profile0");
  const stats = tracker.profile.stats.attributes;
  const base = Math.max(0, Math.round(score * scoreToXpRate));
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
