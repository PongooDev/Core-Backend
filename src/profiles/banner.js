import { McpError } from "../errors.js";
import { bannerTemplateId } from "../gamedata/banners.js";
import { findItem } from "./items.js";

// The player's banner: row names from the BannerIcons and BannerColors tables, of banners the player owns in profile0
// (the editor only offers owned ones: HomebaseBannerIcon:<row>, HomebaseBannerColor:<row>). profile0 keeps it in
// stats.homebase {bannerIconId, bannerColorId}, athena in banner_icon and banner_color.
//
// From 1.8 the client has one banner editor (UFortPlayerProfileBannerEditor) for both. Its ESaveProfileForBanners says
// which command it sends (CommitChosenIconAndColor, 0x3015C00: SetHomebaseBanner or SetBattleRoyaleBanner), and the
// Battle Royale one opens on athena's banner (RefreshBannerEditor, 0x305A300). But before sending either it compares
// the choice with profile0's homebase banner (sub_707CF0) and sends nothing when they match. So with athena's banner
// kept apart, the banner profile0 held could never be put back on in Battle Royale (Core-Backend #98): picking red,
// orange, then red again left orange. Both profiles keep the one banner, set by either command.
export function setBanner(session, iconId, colorId) {
  if (typeof iconId !== "string" || typeof colorId !== "string" || !iconId || !colorId) return;
  const account = session.profile("profile0");
  for (const templateId of [`HomebaseBannerIcon:${iconId}`, `HomebaseBannerColor:${colorId}`]) {
    const banner = bannerTemplateId(templateId);
    if (!banner || !findItem(account.profile, banner)) {
      throw new McpError("errors.com.epicgames.fortnite.item_not_found", `${templateId} isn't one of your banners`);
    }
  }

  const homebase = account.profile.stats.attributes.homebase;
  if (homebase && (homebase.bannerIconId !== iconId || homebase.bannerColorId !== colorId)) {
    account.setStat("homebase", { ...homebase, bannerIconId: iconId, bannerColorId: colorId });
  }

  // An account that has never had athena (a build before Battle Royale) isn't given one.
  if (!session.hasProfile("athena")) return;
  const athena = session.profile("athena");
  const { attributes } = athena.profile.stats;
  if (attributes.banner_icon !== iconId) athena.setStat("banner_icon", iconId);
  if (attributes.banner_color !== colorId) athena.setStat("banner_color", colorId);
}
