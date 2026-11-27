import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// Epic's content-controls service (parental controls, content-controls-prod.ol.epicgames.net). 9.20+ download the
// signed-in user from UFortContentControlsManager's init when bEnableContentControls is set:
// FOnlineContentControlsServiceMcp::DownloadUser sends GET /content-controls/{accountId} and reads
// FContentControlsDownloadUserResult, {"data": FContentControlsUser}, where FContentControlsUser is principalId (FString),
// ageGate (int32), contentControlsEnabled and pinGatedPurchasingEnabled (bool). Core's accounts never set controls up,
// so each one answers with both off.
export function contentControlsRoutes({ tokens }) {
  const router = express.Router();

  router.get("/content-controls/:accountId", requireAuth(tokens), (req, res) => {
    res.json({
      data: {
        principalId: req.params.accountId,
        ageGate: 0,
        contentControlsEnabled: false,
        pinGatedPurchasingEnabled: false,
      },
    });
  });

  return router;
}
