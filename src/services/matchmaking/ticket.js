import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { allowsBuild, buildName, buildNotAllowed } from "../../builds/allowed.js";
import { currentBuild } from "../../builds/context.js";
import { notFound, sendError } from "../../errors.js";
import { ltmModes, ltmOfPlaylist, ltmOn } from "../../events/ltms.js";
import { log } from "../../log.js";
import { regionAllowsAddress, regionOf } from "../../matchmaking/regions.js";
import { customMatchOptionsOf, customMatchOptionsText, parseBucket, serverRegion } from "../../matchmaking/service.js";
import { managesSession } from "../../matchmaking/sessions.js";
import { defaultHostingIps, httpsProxied, requestAddress, viaHttpProxy } from "../../network.js";
import { showdownTicket, tournamentIdOf } from "../../tournaments/showdown.js";
import { notRegionHost } from "./sessions.js";

// Battle Royale's matchmaking tickets (src/matchmaking/service.js): a player's (MatchmakingServiceClient::ObtainTicket
// 0x3AB6C40) and a gameserver's session's (MatchmakingServiceDedicatedServer ObtainTicket 0x3ABD0B0, sent through the
// MCP service with the server's token). Their serviceUrl is this backend, whose WebSocket upgrades with an
// Epic-Signed ticket are the matchmaking service's. Behind a TLS-terminating reverse proxy (X-Forwarded-Proto: https,
// Core #197) it is wss:// on the host the client used, which the proxy hands back to this backend's WebSocket. A request
// the game's -httpproxy carried names the host the game asked for (api.echofn.org in Core-Backend #261), which the
// WebSocket, outside the proxy, looks up itself ("Lws(Error): getaddrinfo failed", FailedToConnectToMMS): it is ws:// on
// the address and port the connection came in on (network.js directHost).
const customKeyLength = { min: 4, max: 16 };

export function ticketRoutes({ tokens, accounts, sessions, matchmaker, settings, network, tournaments }) {
  const router = express.Router();
  const base = "/fortnite/api/game/v2/matchmakingservice/ticket";
  const serviceUrl = (req) => {
    const proxied = httpsProxied(req);
    if (proxied) return `wss://${proxied.host}`;
    if (viaHttpProxy(req) && network) return `ws://${network.directHost(req)}`;
    return `${req.socket.encrypted ? "wss" : "ws"}://${req.get("host")}`;
  };
  const list = (value) => String(value ?? "").split(",").filter(Boolean);

  router.get(`${base}/player/:accountId`, requireAuth(tokens), (req, res) => {
    const { accountId } = req.params;
    if (req.session.accountId !== accountId) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", `Can't matchmake for ${accountId}`);
    }
    // The admin panel's allowed builds (Core-Backend #164), behind the version check and the login: a player still in
    // the game when their build stopped being allowed can't queue. A gameserver's session ticket (below) is exempt.
    const allowedBuilds = settings?.get?.().allowedBuilds ?? null;
    if (!allowsBuild(allowedBuilds, currentBuild())) {
      log("Matchmaking", `Refused ${accountId}'s ticket on Fortnite ${buildName(currentBuild())}: not an allowed build (admin panel, Settings)`);
      return buildNotAllowed(res, allowedBuilds, currentBuild());
    }
    const bucketId = String(req.query.bucketId ?? "");
    const { playlistId } = parseBucket(bucketId);
    const ltm = ltmOfPlaylist(playlistId);
    const mode = { 2: "solo", 10: "duo", 9: "squad" }[playlistId] ?? ltm?.id;
    const settingsValue = settings?.get?.();
    const modes = ltmModes(currentBuild(), settingsValue);
    // The event queues' LTMs (Shooting Test #1, Sniper Shootout, ...) queue only while the build's lobby offers them
    // (events/ltms.js): off unless turned on, by hand or by their original dates. 50v50 stays on unless turned off.
    const partyPlayerIds = list(req.query.partyPlayerIds);
    // 6.10's in-game tournaments (tournaments/showdown.js): a Showdown playlist is no lobby mode, so its ticket is taken
    // while a tournament event of it runs, for a full party. The client names the event with player.option.tournamentId
    // and player.option.windowId (UFortMatchmakingV2::StartMatchmaking, CL-4480234 0x10DDA70) when its Events tab has it
    // live; a refusal carries the code Epic's service gave, which the lobby has a text for ("Sorry, this tournament is
    // not currently active.", "You need to be in a full party for this tournament."). The match is an ordinary one of
    // the playlist: the event's points come from its results (services/fortnite/battleroyale.js).
    let tournamentEvent = null;
    if (ltm?.tournament) {
      const { event, error } = showdownTicket({ playlistId, tournamentId: String(req.query["player.option.tournamentId"] ?? ""),
        windowId: String(req.query["player.option.windowId"] ?? ""), partySize: partyPlayerIds.length || 1, build: currentBuild() }, new Date(), tournaments);
      if (error) {
        log("Matchmaking", `Refused ${accountId}'s ticket for bucket ${bucketId}: ${error.message} (${error.code}; admin panel, Tournaments)`);
        return sendError(res, 400, error.code, error.message);
      }
      tournamentEvent = event;
    }
    const off = tournamentEvent ? false : ltm && !ltm.defaultOn ? !ltmOn(ltm.id, currentBuild(), settingsValue) : modes && modes[mode] === false;
    if (mode && off) {
      // The client shows this refusal (ObtainTicket's unexpected status, FailedToObtainTicket) as "Weird. We couldn't
      // connect to the match." (EMatchmakingErrorV2::FailedToContactGameServices, 5.30), so the console names it
      // (Core-Backend #313).
      log("Matchmaking", `Refused ${accountId}'s ticket for bucket ${bucketId}: ${ltm?.name ?? mode} is off ` +
        "(admin panel, Matchmaking, Battle Royale game modes; or outside its original dates while Original dates is on)");
      return sendError(res, 400, "errors.com.epicgames.fortnite.matchmaking_disabled", `Matchmaking for ${mode} is currently disabled`);
    }
    // player.option.fillTeam: the party leader's client sends "false" for Squads with Squad Fill on No Fill
    // (FFortPartyRepState::bSquadFill) and "true" otherwise (1.7.2 0x2E68050, 1.8 0x2EACF10); the other members' tickets
    // leave it out. From 4.4 it sends only "true", for Fill, and nothing for No Fill (matchmaking/service.js
    // fillTeamTrueOnlyBuild, CoreV2 #377).
    const fill = req.query["player.option.fillTeam"];
    // player.option.customKey: the lobby's custom matchmaking key (Core-Backend #186, matchmaking/service.js), sent only
    // when it isn't empty. Epic's ticket service refused a key outside 4 to 16 characters with invalid_custom_match_key,
    // which the lobby shows as "Custom matchmaking key must be between 4 and 16 characters long." (2.4 0x20DFD40).
    const customKey = String(req.query["player.option.customKey"] ?? "");
    if (customKey && (customKey.length < customKeyLength.min || customKey.length > customKeyLength.max)) {
      return sendError(res, 400, "errors.com.epicgames.fortnite.invalid_custom_match_key",
        `Custom matchmaking key must be between ${customKeyLength.min} and ${customKeyLength.max} characters long.`);
    }
    const party = partyPlayerIds.length ? partyPlayerIds : [accountId];
    const { ticket, response } = matchmaker.playerTicket({
      accountId,
      partyPlayerIds: party,
      bucketId: String(req.query.bucketId ?? ""),
      platform: String(req.query["player.platform"] ?? ""),
      fillTeam: fill === "true" ? true : fill === "false" ? false : null,
      customKey: customKey || null,
      // Whether the party may open a key: one of its players has the admin panel's Custom Matchmaking permission.
      customKeyHost: Boolean(customKey) && party.some((id) => accounts?.get(id)?.customMatchmaking === true),
      // player.option.custom_match_option.*: the party leader's Playground custom options (6.01, matchmaking/service.js),
      // which its match's server gets with AssignMatch.
      customMatchOptions: customMatchOptionsOf(req.query),
      // The client's build (its User-Agent's changelist): 1.7.2 to 2.4.2's show the match start countdown (#160).
      build: Number(currentBuild()) || null,
      serviceUrl: serviceUrl(req)
    });
    const fills = ticket.fillTeam === null ? "" : ticket.fillTeam ? ", fill" : ", no fill";
    const keyed = ticket.customKey ? `, custom key ${ticket.customKey}${ticket.customKeyHost ? "" : " (not allowed to open it)"}` : "";
    const optioned = ticket.customMatchOptions ? `, custom options ${customMatchOptionsText(ticket.customMatchOptions)}` : "";
    const evented = tournamentEvent ? `, tournament event ${tournamentEvent.name} (${tournamentIdOf(tournamentEvent)})` : "";
    log("Matchmaking", `Ticket for ${accountId}, party of ${ticket.partyPlayerIds.length}${fills}, bucket ${ticket.bucketId}${keyed}${optioned}${evented}`);
    res.json(response);
  });

  // ?bucketIds=<netcl>:0:<region>:*,<netcl>:0:<region>:*:*:*&minPlayers=1&maxPlayers=<the session's MaxPlayers>
  router.get(`${base}/session/:sessionId`, requireAuth(tokens), (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return notFound(res, req.originalUrl);
    // Only the PC hosting it: this one, or the Trusted Hosting IP that registered it (Core-Backend #125).
    if (!managesSession(session, req, settings?.get?.().allowedHostingIps ?? defaultHostingIps)) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", `Session ${session.id} isn't hosted from this IP address`);
    }
    // The server asks through the MCP service with its client credentials token (no account), or its own account's.
    if (req.session.accountId && session.hostAccountId && session.hostAccountId !== req.session.accountId) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", `Session ${session.id} isn't this server's`);
    }
    // Its region's hosting IPs (Core-Backend #227): a server registers for its region (-McpRegion) from one of them only.
    const bucketIds = list(req.query.bucketIds);
    const region = serverRegion(bucketIds);
    const address = session.sourceAddress ?? requestAddress(req);
    if (region !== null && !regionAllowsAddress(region, address, settings?.get?.().regionHostingIps ?? {})) {
      return notRegionHost(res, address, regionOf(region), `register session ${session.id} for matchmaking`);
    }
    const maxPlayers = Number(req.query.maxPlayers);
    const { response } = matchmaker.sessionTicket({
      sessionId: session.id,
      accountId: req.session.accountId,
      bucketIds,
      maxPlayers: Number.isInteger(maxPlayers) && maxPlayers > 0 ? maxPlayers : session.maxPublicPlayers,
      // The server's build (its User-Agent's changelist), which decides AssignMatch's bucket format.
      build: currentBuild() ?? null,
      serviceUrl: serviceUrl(req)
    });
    res.json(response);
  });

  return router;
}
