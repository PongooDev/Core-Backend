import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { getBuild } from "../../builds/detect.js";
import { sendError } from "../../errors.js";
import { describeToken, partyChannel } from "../../vivox/tokens.js";

// The lobby's party voice tokens (UFortMcpUtils, /Script/FortniteGame.FortMcpUtils; 7.00 CL-4629139):
// - AFortPlayerControllerFrontEnd::RequestVoiceChatLogin (0x13E4AF0) -> UFortMcpUtils::RequestVoiceLogin (0x11A94E0):
//   GET {fortnite service}/fortnite/api/game/v2/voice/{accountId}/login (VoiceLoginUrl, +0xD0).
// - RequestVoiceChatJoin (0x13E45C0) -> RequestVoiceJoin (0x11A9180): GET .../voice/{accountId}/join/{partyId}
//   (VoiceJoinUrl, +0xE0).
// The answer's parser (0x1175FB0) takes {"token": "<Vivox access token>"}; errors are errors.com.epicgames.fortmcputils.
// VoiceChatLoginTokenReturned (0x13EE740) then connects FVivox if needed and logs in as ".<accountId>." with the token,
// then asks for the join token; the party's channel is confctl-g-Party-<partyId> (vivox/tokens.js partyChannel).
// Answered only for the builds the backend points at its Vivox emulator (5.10 and later, while the admin panel's Voice
// chat (Vivox) switch is on: vivox/service.js servesBuild); any other build gets what it got before, the unknown route.
const partyIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
// 8.20 and later (UE 4.23's VoiceChatManager, vivox/service.js vivoxVoiceChatBuild) POST for their own tokens:
// createLoginToken, and createJoinToken with {"channelType", "channelName"} (8.30 0xBC0B90). Their account is
// ".<namespace>.<accountId>." and a channel sip:confctl-<g|e>-<namespace>.<channelName>@<domain>, the namespace being
// the issuer the hotfix gives them. "echo" is Vivox's echo channel (e); party, group and direct are non-positional (g).
const channelNamePattern = /^[A-Za-z0-9_.-]{1,128}$/;
const channelTypes = new Set(["echo", "direct", "party", "group"]);

export function voiceRoutes({ tokens, vivox }) {
  const router = express.Router();
  const served = (req, res, next) => (vivox?.servesBuild(getBuild(req)) ? next() : next("route"));

  router.get("/fortnite/api/game/v2/voice/:accountId/login", served, requireAuth(tokens), requireOwnAccount, (req, res) => {
    const token = vivox.keys.mint({ action: "login", player: req.params.accountId });
    vivox.say(`lobby login token for ${req.params.accountId} (build ${getBuild(req)}): ${describeToken(token)}`);
    res.json({ token });
  });

  router.get("/fortnite/api/game/v2/voice/:accountId/join/:partyId", served, requireAuth(tokens), requireOwnAccount, (req, res) => {
    if (!partyIdPattern.test(req.params.partyId)) {
      return sendError(res, 400, "errors.com.epicgames.fortmcputils.invalid_party", `Invalid party id ${req.params.partyId}`);
    }
    const token = vivox.keys.mint({ action: "join", player: req.params.accountId, channel: partyChannel(req.params.partyId) });
    vivox.say(`lobby party join token for ${req.params.accountId}, party ${req.params.partyId} (build ${getBuild(req)}): ${describeToken(token)}`);
    res.json({ token });
  });

  router.post("/fortnite/api/game/v2/voice/:accountId/createLoginToken", served, requireAuth(tokens), requireOwnAccount, (req, res) => {
    const token = vivox.keys.mint({ action: "login", player: `${vivox.keys.issuer}.${req.params.accountId}` });
    vivox.say(`lobby login token for ${req.params.accountId} (build ${getBuild(req)}): ${describeToken(token)}`);
    res.json({ token });
  });

  router.post("/fortnite/api/game/v2/voice/:accountId/createJoinToken", served, requireAuth(tokens), requireOwnAccount, (req, res) => {
    const channelType = String(req.body?.channelType ?? "");
    const channelName = String(req.body?.channelName ?? "");
    if (!channelTypes.has(channelType) || !channelNamePattern.test(channelName)) {
      return sendError(res, 400, "errors.com.epicgames.fortnite.invalid_voice_channel", `Invalid voice channel ${channelType} ${channelName}`);
    }
    const channel = `confctl-${channelType === "echo" ? "e" : "g"}-${vivox.keys.issuer}.${channelName}`;
    const token = vivox.keys.mint({ action: "join", player: `${vivox.keys.issuer}.${req.params.accountId}`, channel });
    vivox.say(`lobby ${channelType} join token for ${req.params.accountId}, channel ${channelName} (build ${getBuild(req)}): ${describeToken(token)}`);
    res.json({ token });
  });

  return router;
}
