import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { notFound, sendError } from "../../errors.js";
import { log } from "../../log.js";

// Battle Royale's matchmaking tickets (src/matchmaking/service.js): a player's (MatchmakingServiceClient::ObtainTicket
// 0x3AB6C40) and a gameserver's session's (MatchmakingServiceDedicatedServer ObtainTicket 0x3ABD0B0, sent through the
// MCP service with the server's token). Their serviceUrl is this backend, whose WebSocket upgrades with an
// Epic-Signed ticket are the matchmaking service's.
export function ticketRoutes({ tokens, sessions, matchmaker }) {
  const router = express.Router();
  const base = "/fortnite/api/game/v2/matchmakingservice/ticket";
  const serviceUrl = (req) => `${req.socket.encrypted ? "wss" : "ws"}://${req.get("host")}`;
  const list = (value) => String(value ?? "").split(",").filter(Boolean);

  router.get(`${base}/player/:accountId`, requireAuth(tokens), (req, res) => {
    const { accountId } = req.params;
    if (req.session.accountId !== accountId) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", `Can't matchmake for ${accountId}`);
    }
    const partyPlayerIds = list(req.query.partyPlayerIds);
    // player.option.fillTeam: the party leader's client sends "false" for Squads with Squad Fill on No Fill
    // (FFortPartyRepState::bSquadFill) and "true" otherwise (1.7.2 0x2E68050, 1.8 0x2EACF10); the other members' tickets
    // leave it out.
    const fill = req.query["player.option.fillTeam"];
    const { ticket, response } = matchmaker.playerTicket({
      accountId,
      partyPlayerIds: partyPlayerIds.length ? partyPlayerIds : [accountId],
      bucketId: String(req.query.bucketId ?? ""),
      platform: String(req.query["player.platform"] ?? ""),
      fillTeam: fill === "true" ? true : fill === "false" ? false : null,
      serviceUrl: serviceUrl(req)
    });
    const fills = ticket.fillTeam === null ? "" : ticket.fillTeam ? ", fill" : ", no fill";
    log("Matchmaking", `Ticket for ${accountId}, party of ${ticket.partyPlayerIds.length}${fills}, bucket ${ticket.bucketId}`);
    res.json(response);
  });

  // ?bucketIds=<netcl>:0:<region>:*,<netcl>:0:<region>:*:*:*&minPlayers=1&maxPlayers=<the session's MaxPlayers>
  router.get(`${base}/session/:sessionId`, requireAuth(tokens), (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return notFound(res, req.originalUrl);
    // The server asks through the MCP service with its client credentials token (no account), or its own account's.
    if (req.session.accountId && session.hostAccountId && session.hostAccountId !== req.session.accountId) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", `Session ${session.id} isn't this server's`);
    }
    const maxPlayers = Number(req.query.maxPlayers);
    const { response } = matchmaker.sessionTicket({
      sessionId: session.id,
      accountId: req.session.accountId,
      bucketIds: list(req.query.bucketIds),
      maxPlayers: Number.isInteger(maxPlayers) && maxPlayers > 0 ? maxPlayers : session.maxPublicPlayers,
      serviceUrl: serviceUrl(req)
    });
    res.json(response);
  });

  return router;
}
