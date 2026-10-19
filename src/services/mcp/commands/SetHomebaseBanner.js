import { McpError } from "../../../errors.js";
import { bannerTemplateId } from "../../../gamedata/banners.js";
import { findItem } from "../../../profiles/items.js";

// The banner editor (UFortMcpProfileAccount::SetHomebaseBanner): row names from the BannerIcons and BannerColors tables,
// of banners the player owns (the editor only offers owned ones: HomebaseBannerIcon:<row>, HomebaseBannerColor:<row>).
export function setHomebaseBanner({ req, session }) {
  const { homebaseBannerIconId: iconId, homebaseBannerColorId: colorId } = req.body ?? {};
  if (typeof iconId !== "string" || typeof colorId !== "string" || !iconId || !colorId) return;
  const tracker = session.profile("profile0");
  for (const templateId of [`HomebaseBannerIcon:${iconId}`, `HomebaseBannerColor:${colorId}`]) {
    const banner = bannerTemplateId(templateId);
    if (!banner || !findItem(tracker.profile, banner)) {
      throw new McpError("errors.com.epicgames.fortnite.item_not_found", `${templateId} isn't one of your banners`);
    }
  }
  const homebase = tracker.profile.stats.attributes.homebase;
  if (homebase.bannerIconId !== iconId || homebase.bannerColorId !== colorId) {
    tracker.setStat("homebase", { ...homebase, bannerIconId: iconId, bannerColorId: colorId });
  }
}
