import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { currentBuild } from "../../builds/context.js";
import { sendError } from "../../errors.js";
import { log } from "../../log.js";
import { sessionMembers } from "../../matchmaking/sessions.js";
import { eventWindowHistory, hasShowdown, tournamentAndHistory, tournamentsCompleteMessage } from "../../tournaments/showdown.js";

// 6.10's in-game tournaments (tournaments/showdown.js has what the client does with each): FortMcpUtils' three event URLs,
// which 6.10's shipped DefaultGame.ini adds (CL-4480234; 6.02's has none of them).
// - GetEventTournamentAndHistoryUrl, GET .../events/tournamentandhistory/<accountId>/<regionId>/<platformName>: the Events
//   tab's tournaments and the player's histories in them. Core has no regions or platforms of its own for an event, so
//   both are taken as they come and every player gets every event. A build without the tab that asks all the same gets
//   the empty lists.
// - GetEventWindowHistoryUrl, GET .../events/eventwindowhistory/<accountId>/<eventWindowId>: the player's histories in
//   one event window, a JSON array, asked after a match. A window the build isn't offered is Epic's
//   invalid_event_window_id.
// - ReportTournamentStatsUrl, POST .../events/reporttournamentstats: a game server's report of a team's match in an
//   event (FMcpTournamentStats). The client's exe has no code left that sends it and CoreV2's game server reports its
//   matches through battleroyale/recordresults, which scores them by their playlist; this takes Epic's own report all the
//   same, from a game server, for a server that sends it: each of the team's players gets the match in that event, with
//   the team's placement and eliminations (a match already counted, by its id, isn't counted again).
export function eventRoutes(context) {
  const { tokens, accounts, sessions } = context;
  const router = express.Router();
  const auth = requireAuth(tokens);
  const base = "/fortnite/api/game/v2/events";
  const own = (req, res) => {
    if (req.session.accountId === req.params.accountId || isDedicatedServerToken(req.session)) return true;
    sendError(res, 403, "errors.com.epicgames.common.missing_permission", `Can't read ${req.params.accountId}'s events`);
    return false;
  };

  router.get(`${base}/tournamentandhistory/:accountId/:regionId/:platformName`, auth, (req, res) => {
    if (!own(req, res)) return;
    res.json(tournamentAndHistory(req.params.accountId, currentBuild(), new Date(), context.tournaments));
  });

  router.get(`${base}/eventwindowhistory/:accountId/:eventWindowId`, auth, (req, res) => {
    if (!own(req, res)) return;
    const histories = eventWindowHistory(req.params.accountId, req.params.eventWindowId, currentBuild(), new Date(), context.tournaments);
    if (histories === null) {
      return sendError(res, 404, "errors.com.epicgames.fortnite.invalid_event_window_id", `No event window ${req.params.eventWindowId}`);
    }
    res.json(histories);
  });

  const text = (value) => (typeof value === "string" && value.length <= 128 ? value : "");
  const field = (body, name) => body?.[name] ?? body?.[name[0].toUpperCase() + name.slice(1)];
  const count = (value, max) => (Number.isInteger(value) && value >= 0 && value <= max ? value : null);
  router.post(`${base}/reporttournamentstats`, auth, (req, res) => {
    const tournamentId = text(field(req.body, "tournamentId"));
    const matchId = text(field(req.body, "matchId")) || null;
    const team = (Array.isArray(field(req.body, "teamAccountIds")) ? field(req.body, "teamAccountIds") : []).filter((id) => typeof id === "string" && accounts.get(id));
    const place = count(field(req.body, "finalTeamPlacement"), 1000);
    const kills = count(field(req.body, "numTeamEliminations"), 1000);
    const event = tournamentId ? context.tournaments?.get(tournamentId) : null;
    if (!event) return sendError(res, 404, "errors.com.epicgames.fortnite.invalid_tournament_id", "Tournament does not exist.");
    // Only a game server: its client-credentials token, or the host of a session these players are on.
    const hosted = isDedicatedServerToken(req.session) || sessions.hostedBy(req.session.accountId)
      .some((session) => team.some((accountId) => sessionMembers(session).includes(accountId)));
    if (!hosted) return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Only a game server reports tournament stats");
    if (!place || kills === null || !team.length) {
      return sendError(res, 400, "errors.com.epicgames.validation.validation_failed", "A report names its team, final placement and eliminations");
    }
    for (const accountId of team) {
      for (const { eventId, points } of context.tournaments.recordResult(accountId, event.playlistId, { place, kills, matchId, team, only: event.id })) {
        log("Battle Royale", `${accountId} scored ${points} points in tournament event ${eventId} (the game server's tournament report)`);
        if (hasShowdown(currentBuild())) context.xmpp?.notify(accountId, tournamentsCompleteMessage, {});
      }
    }
    res.status(204).end();
  });

  return router;
}
