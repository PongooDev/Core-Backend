import { getItem } from "../gamedata/items.js";
import { readGameData } from "../gamedata/read.js";

// An item's rating (power): its RatingLookup row of the BaseItemRating curves at its level.
const { ratings = {} } = readGameData("upgrades", {});

export function itemRating(item) {
  const row = getItem(item.templateId)?.rating;
  const curve = row && ratings[row];
  if (!curve) return 0;
  return curve[Math.min(item.attributes.level ?? 1, curve.length - 1)] ?? 0;
}
