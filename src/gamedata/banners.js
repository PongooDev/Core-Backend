import { readGameData } from "./read.js";

// The banner tables the homebase manager points at (BannerIcons, BannerColors): row name -> category.
const { icons = {}, colors = {} } = readGameData("banners", {});
const tables = { homebasebannericon: ["HomebaseBannerIcon", icons], homebasebannercolor: ["HomebaseBannerColor", colors] };

// A banner item's template id as the client builds it (type name, ":", row name), or undefined for no such row.
export function bannerTemplateId(templateId) {
  const [type, name = ""] = String(templateId).split(":");
  const [typeName, rows] = tables[type.toLowerCase()] ?? [];
  const row = rows && Object.keys(rows).find((key) => key.toLowerCase() === name.toLowerCase());
  return row ? `${typeName}:${row}` : undefined;
}

// Core's (no game data hands banners out): every account owns the Standard icons and every color, as new accounts did.
export const starterBanners = [
  ...Object.keys(icons).filter((row) => icons[row] === "Standard").map((row) => `HomebaseBannerIcon:${row}`),
  ...Object.keys(colors).map((row) => `HomebaseBannerColor:${row}`)
];

export function bannerIds() {
  return [...Object.keys(icons).map((row) => `HomebaseBannerIcon:${row}`), ...Object.keys(colors).map((row) => `HomebaseBannerColor:${row}`)];
}
