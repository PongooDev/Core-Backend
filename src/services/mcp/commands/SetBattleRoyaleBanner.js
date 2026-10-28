import { setBanner } from "../../../profiles/banner.js";

// The banner editor in the Battle Royale lobby (UFortMcpProfileAthena::SetBattleRoyaleBanner {homebaseBannerIconId,
// homebaseBannerColorId}; ESaveProfileForBanners::BattleRoyale). The lobby shows athena's banner_icon and banner_color;
// profile0's homebase banner follows, since the editor checks the choice against it (profiles/banner.js, #98).
export function setBattleRoyaleBanner({ req, session }) {
  setBanner(session, req.body?.homebaseBannerIconId, req.body?.homebaseBannerColorId);
}
