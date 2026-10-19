import { readGameData } from "../gamedata/read.js";
import { boostBalance, levelRest, restBalance, spendBoost, spendRest, xpBonus } from "./boosts.js";
import { grantItem } from "./items.js";

// Account levels (Balance/DataTables/XPAccountLevels): the total XP each level needs and the multiplier the UI shows
// XP through (1,000,000 XP between early levels shows as 250). Match score is turned into XP at the current level's
// multiplier, so the XP the player sees rises by the score they earned (Core's rule: Epic did this on its servers).
const levels = readGameData("accountlevels", []);
const maxLevel = levels.length ? levels[levels.length - 1].level : 1;
const levelData = (level) => levels.find((entry) => entry.level === level);

// Level-up rewards name assets ("HomebasePoints"); items are keyed "Type:name".
const items = readGameData("items", {});
const rewardTemplate = (asset) => Object.keys(items).find((id) => id.split(":")[1] === asset.toLowerCase());

const none = { baseXPEarned: 0, bonusXPEarned: 0, boostXPEarned: 0, boostXPMissed: 0, restXPEarned: 0, groupBoostXPEarned: 0 };

// Adds score as XP to the account (profile0 stats level and xp, xp being the total) and grants each new level's
// rewards. On top of the base XP (the parts FFortEarnScoreNotification reports, Core's rule with the client's rates):
// a critical match adds CriticalMatch_XpBonusPercent; rest XP adds up to Rest_XpBonusPercent of it from the RestXP
// quota; boost XP adds up to PersonalBoost_XpBonusPercent of it from Token:xpboost, and boostXPMissed is the part
// there was no boost for. Group boost isn't given. Returns those parts, xpEarned (their total) and levels gained.
export function earnScore(session, score, { criticalMatch = false, now = new Date() } = {}) {
  const tracker = session.profile("profile0");
  const stats = tracker.profile.stats.attributes;
  let level = stats.level ?? 1;
  let xp = stats.xp ?? 0;
  const multiplier = levelData(level)?.displayMultiplier ?? 1;
  const base = Math.max(0, Math.round(score / multiplier));
  if (!base) return { ...none, xpEarned: 0, levels: [] };

  const bonus = criticalMatch ? Math.round(base * xpBonus.criticalMatch) : 0;
  const rest = Math.min(restBalance(session, now), Math.round(base * xpBonus.rest));
  const boostWanted = Math.round(base * xpBonus.personalBoost);
  const boost = Math.min(boostBalance(session), boostWanted);
  spendRest(session, rest, now);
  spendBoost(session, boost);
  const xpEarned = base + bonus + rest + boost;

  xp += xpEarned;
  const gained = [];
  while (level < maxLevel && xp >= (levelData(level + 1)?.xp ?? Infinity)) {
    level += 1;
    gained.push(level);
    for (const { asset, quantity } of levelData(level).rewards) {
      const templateId = rewardTemplate(asset);
      if (templateId) grantItem(session, templateId, quantity, { packSource: "LevelUp" });
    }
  }
  if (level === maxLevel) xp = Math.min(xp, levelData(maxLevel).xp);
  tracker.setStat("xp", xp);
  if (gained.length) {
    tracker.setStat("level", level);
    levelRest(session, level, now);
  }
  return {
    baseXPEarned: base, bonusXPEarned: bonus, boostXPEarned: boost, boostXPMissed: boostWanted - boost,
    restXPEarned: rest, groupBoostXPEarned: 0, xpEarned, levels: gained
  };
}
