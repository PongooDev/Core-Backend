import { getItem } from "../gamedata/items.js";
import { upgradeData } from "../gamedata/upgrades.js";

// An item's rating (power): its RatingLookup row of the BaseItemRating curves at its level.
export function itemRating(item) {
  const row = getItem(item.templateId)?.rating;
  const curve = row && upgradeData().ratings[row];
  if (!curve) return 0;
  return curve[Math.min(item.attributes.level ?? 1, curve.length - 1)] ?? 0;
}
