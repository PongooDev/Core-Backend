import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// 1.2 (CL-3541083) added UFortTwitchAccount, which on login GETs /api/game/v2/twitch/{accountId} (route sub_1400A5400).
// The reply is read by sub_14067D750: it must be a JSON object, deserialized into an FJsonSerializable whose fields
// broadcasterInfo {accessToken, channelId, updateThrottle}, broadcasterViewers, broadcasterGrants,
// broadcasterWindows {endTime, cooldownTime} and updateThrottle are all optional. Twitch broadcaster links aren't
// kept (TwitchUpdateBroadcasterRegistration is a no-op), so every account answers with no Twitch info: an empty
// object (inferred; Epic's reply for an unlinked account wasn't captured). Not gated to the account's own token, as
// gameservers are never refused.
export function twitchRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/game/v2/twitch/:accountId", requireAuth(tokens), (req, res) => {
    res.json({});
  });

  return router;
}
