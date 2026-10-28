import { setBattleRoyaleBanner as setBanner } from "../../../profiles/athena.js";

// The banner editor in the Battle Royale lobby (UFortMcpProfileAthena::SetBattleRoyaleBanner {homebaseBannerIconId,
// homebaseBannerColorId}), profiles/athena.js.
export function setBattleRoyaleBanner({ req, session }) {
  setBanner(session, req.body?.homebaseBannerIconId, req.body?.homebaseBannerColorId);
}
