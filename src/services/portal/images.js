// Item pictures for the portal's My account page (Core-Backend #249). Core has no images of its own: Battle Royale
// cosmetics' icons come from the public fortnite-api.com CDN, by cosmetic id, and only while the admin's "Show item
// images" switch (settings showItemImages, on by default) is on. With it off no URL is built, so no request is made.

export const itemImageHost = "https://fortnite-api.com";
const imageSizes = new Set(["smallicon", "icon"]);

// The cosmetic id of a templateId ("AthenaCharacter:CID_029_Athena_Commando_F_Halloween" -> "cid_029_athena_commando_f_halloween"),
// or null when it is not a plain id, so nothing else is ever put into a URL.
export function cosmeticImageId(templateId) {
  const parts = String(templateId ?? "").split(":");
  if (parts.length !== 2) return null;
  const id = parts[1].toLowerCase();
  return /^[a-z0-9_]+$/.test(id) ? id : null;
}

// The icon's URL, or null for an id without a valid form, an unknown size or the switch being off.
export function cosmeticImageUrl(templateId, { enabled = true, size = "smallicon" } = {}) {
  const id = cosmeticImageId(templateId);
  if (!enabled || !id || !imageSizes.has(size)) return null;
  return `${itemImageHost}/images/cosmetics/br/${id}/${size}.png`;
}

export const showItemImages = (settings) => settings?.get?.().showItemImages !== false;

// The Content-Security-Policy of the portal page: images from itself (and data: for its icon), and from the image host only while the switch is on.
export const portalContentSecurityPolicy = (enabled) => `img-src 'self' data:${enabled ? ` ${itemImageHost}` : ""}`;
