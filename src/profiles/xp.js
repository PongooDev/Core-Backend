import { readGameData } from "../gamedata/read.js";
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

// Adds score as XP to the account (profile0 stats level and xp, xp being the total) and grants each new level's
// rewards. Returns {xpEarned, levels: [each new level]}.
export function earnScore(session, score) {
  const tracker = session.profile("profile0");
  const stats = tracker.profile.stats.attributes;
  let level = stats.level ?? 1;
  let xp = stats.xp ?? 0;
  const multiplier = levelData(level)?.displayMultiplier ?? 1;
  const xpEarned = Math.max(0, Math.round(score / multiplier));
  if (!xpEarned) return { xpEarned: 0, levels: [] };

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
  if (gained.length) tracker.setStat("level", level);
  return { xpEarned, levels: gained };
}

