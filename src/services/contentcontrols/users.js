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

  // 9.30+ (CL-7095426): once DownloadUser succeeds, UFortContentControlsManager (0x1753670) downloads the user's rules for
  // namespace "fn" (0x1744300): FOnlineContentControlsServiceMcp::DownloadRules (0x3DEDC0) sends GET
  // /content-controls/{accountId}/rules/namespaces/{namespace} (DownloadRulesUrl, "/'UserId/rules/namespaces/'Namespace")
  // and reads {"data": {"result", "namespaceSetting", "userSetting"}} (0x42B2A0), each a rule set (0x42B160):
  // allowedToAcquire, allowedToMakePurchases, canSeeMatureLanguage, canAcceptFriendRequest, canRecieveInGameItems (Epic's
  // spelling), canSeeThirdPartyNames, canDisplayMyUserName, canSeeOtherPlayersNames, canUseVoiceChat,
  // canVoiceChatWithUnknowns (bool), playtimeReportingFrequency (FString, "none" by default) and purchaseReportingEnabled
  // (bool). The manager keeps "result" (0x17535A0). 🟡 An account with no controls set up is allowed everything and
  // reports nothing (Epic's answer for such an account isn't recorded; the client's own defaults are false and "none").
  router.get("/content-controls/:accountId/rules/namespaces/:namespace", requireAuth(tokens), (req, res) => {
    const rules = {
      allowedToAcquire: true,
      allowedToMakePurchases: true,
      canSeeMatureLanguage: true,
      canAcceptFriendRequest: true,
      canRecieveInGameItems: true,
      canSeeThirdPartyNames: true,
      canDisplayMyUserName: true,
      canSeeOtherPlayersNames: true,
      canUseVoiceChat: true,
      canVoiceChatWithUnknowns: true,
      playtimeReportingFrequency: "none",
      purchaseReportingEnabled: false,
    };
    res.json({ data: { result: rules, namespaceSetting: rules, userSetting: rules } });
  });

  return router;
}
