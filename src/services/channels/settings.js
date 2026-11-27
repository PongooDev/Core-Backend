import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// Epic's channels service (channels-public-service-prod.ol.epicgames.com): the user settings the Party Hub app (Kairos)
// saved for each account. The game only reads them (9.20 CL-6822798, RVAs):
// - FOnlineChannelsServiceMcp's QueryAvatarInfo (0x583F20, for the lobby's FSocialQuery_AvatarInfo) POSTs
//   /api/v1/user/setting as application/x-www-form-urlencoded, up to 50 accounts a request:
//   accountId=<id>&accountId=<id>...&settingKey=avatar&settingKey=avatarBackground&settingKey=appInstalled.
// - Its completion (0x56E9E0) parses the body as {"avatarInfos": <body>}: an array of {accountId, key, value} with
//   string values. Any other status fails the query ("QueryAvatarInfo request failed").
// - The social panel (0x17F68C0) reads avatar as a character template id for the Kairos portrait
//   (cdn2.unrealengine.com/fit-in/.../Kairos/portraits/{templateId}.png), avatarBackground as a JSON array of colours
//   (#000000 and #FFFFFF without one) and appInstalled as "has the app".
// The service answered only the settings an account had saved, and only the Party Hub app saved them. No Core account
// has used it, so every account has none.
//
// SendNotifyActive (9.21 CL-6922310 RVA 0x587EB0, completion 0x588450) POSTs /api/v1/user/<accountId>/notifyActive
// (SendNotifyActiveUrl) with Content-Type application/json and no body; the "Playing" location it is given is only
// logged. UFortAthenaMatchmakingWidget::HandlePlayClicked (0x374FE80) calls it with an unbound delegate, so the
// completion only checks the status and logs the response. It told the Party Hub the player was in a match.
export function channelsRoutes({ tokens }) {
  const router = express.Router();

  router.post("/api/v1/user/setting", requireAuth(tokens), (req, res) => res.json([]));
  router.post("/api/v1/user/:accountId/notifyActive", requireAuth(tokens), (req, res) => res.status(204).end());

  return router;
}
