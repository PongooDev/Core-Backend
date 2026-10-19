// The banner editor (UFortMcpProfileAccount::SetHomebaseBanner): row names from the BannerIcons and BannerColors tables.
export function setHomebaseBanner({ req, session }) {
  const { homebaseBannerIconId: iconId, homebaseBannerColorId: colorId } = req.body ?? {};
  if (typeof iconId !== "string" || typeof colorId !== "string" || !iconId || !colorId) return;
  const tracker = session.profile("profile0");
  const homebase = tracker.profile.stats.attributes.homebase;
  if (homebase.bannerIconId !== iconId || homebase.bannerColorId !== colorId) {
    tracker.setStat("homebase", { ...homebase, bannerIconId: iconId, bannerColorId: colorId });
  }
}
