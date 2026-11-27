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
export function channelsRoutes({ tokens }) {
  const router = express.Router();

  router.post("/api/v1/user/setting", requireAuth(tokens), (req, res) => res.json([]));

  return router;
}
