import { setBanner } from "../../../profiles/banner.js";

// The banner editor (UFortMcpProfileAccount::SetHomebaseBanner {homebaseBannerIconId, homebaseBannerColorId}):
// profile0's homebase banner, and athena's with it for an account that has one (profiles/banner.js, #98).
export function setHomebaseBanner({ req, session }) {
  const { homebaseBannerIconId: iconId, homebaseBannerColorId: colorId } = req.body ?? {};
  setBanner(session, iconId, colorId);
}
