import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { currentBuild } from "../../builds/context.js";
import { sendError } from "../../errors.js";
import { eventsAccountHistory, eventsDownload, eventsLeaderboard, eventsPlayerOf, eventsWindowHistory, isEventsServiceBuild } from "../../tournaments/eventsservice.js";

// Epic's events service (OnlineSubsystemMcp.OnlineEventsServiceMcp: ServiceName "events", BasePath /api/v1,
// events-public-service-live.ol.epicgames.com), which 7.30's (CL-4834550) and 7.40's (CL-5046157) Events tab asks in place
// of FortMcpUtils' event URLs (tournaments/eventsservice.js has the routes, what the client reads and what Core serves):
// - GET /api/v1/events/<gameId>/download/<accountId>?region=&platform=&teamAccountIds= (DownloadUrl): the player, the
//   tournaments their Events tab lists, a template of each one's rules and their scores.
// - GET /api/v1/events/<gameId>/<eventId>/<eventWindowId>/history (RefreshEventHistoryUrl, which 7.40 doesn't ask): the
//   player's scores in the window.
// - GET /api/v1/leaderboards/<gameId>/<eventId>/<eventWindowId>/<accountId>?page=&rank=&teamAccountIds=
//   (RequestLeaderboardUrl): a page of the window's leaderboard.
// - GET /api/v1/players/<gameId>/<accountId> (RefreshPlayerUrl, 7.40 on): the player, with 8.20 on its Arena tokens and Hype
//   (Core-Backend #420, tournaments/arena.js).
// - GET /api/v1/events/<gameId>/data/<accountId> (DataUrl, 8.20 on): as the download.
// - GET /api/v1/events/<gameId>/<eventId>/history/<accountId> and .../<eventId>/<eventWindowId>/history/<accountId> (8.20
//   on, Core-Backend #427): the player's scores in the event or the window, as an array; the details screen's.
// Only for 7.30 and later (eventsServiceBuild): 7.20's and older builds' requests fall through to the unanswered routes as
// before (they ask FortMcpUtils, services/fortnite/events.js). A window the player's list doesn't have is a 404 (🟡 the
// error code is Core's: Epic's isn't known).
export function eventsServiceRoutes(context) {
  const { tokens } = context;
  const router = express.Router();
  const auth = requireAuth(tokens);
  const forBuild = (req, res, next) => (isEventsServiceBuild(currentBuild()) ? next() : next("router"));
  const own = (req, res, next) => {
    if (req.session.accountId === req.params.accountId || isDedicatedServerToken(req.session)) return next();
    sendError(res, 403, "errors.com.epicgames.common.missing_permission", `Can't read ${req.params.accountId}'s events`);
  };
  const noWindow = (req, res) => sendError(res, 404, "errors.com.epicgames.events.event_window_not_found",
    `No event window ${req.params.eventWindowId} of event ${req.params.eventId}`);
  const text = (value) => (typeof value === "string" ? value : "");

  router.get("/api/v1/events/:gameId/download/:accountId", forBuild, auth, own, (req, res) => {
    res.json(eventsDownload(req.params.accountId, currentBuild(), { region: text(req.query.region), platform: text(req.query.platform) },
      new Date(), context.tournaments, req.params.gameId));
  });

  // DataUrl, GET /api/v1/events/<gameId>/data/<accountId> (8.20's to 8.40's table, CL-5625478 and CL-5793395's
  // FOnlineEventsServiceMcp constructor, 0x463250 on 8.30): 🟡 no caller of it was traced, so it is answered as the download.
  // 8.50 (CL-6058028) asks it with ?region=&showPastEvents=, so its region is the download's.
  router.get("/api/v1/events/:gameId/data/:accountId", forBuild, auth, own, (req, res) => {
    res.json(eventsDownload(req.params.accountId, currentBuild(), { region: text(req.query.region) }, new Date(), context.tournaments, req.params.gameId));
  });

  router.get("/api/v1/events/:gameId/:eventId/:eventWindowId/history", forBuild, auth, (req, res) => {
    const scores = eventsWindowHistory(req.session.accountId, req.params.eventId, req.params.eventWindowId, currentBuild(), new Date(),
      context.tournaments, req.params.gameId);
    if (scores === null) return noWindow(req, res);
    res.json(scores);
  });

  // 8.20's and later account history (Core-Backend #427): the player's scores in the event, or in one of its windows.
  const accountHistory = (req, res) => {
    const scores = eventsAccountHistory(req.params.accountId, req.params.eventId, req.params.eventWindowId ?? null, currentBuild(), new Date(),
      context.tournaments, req.params.gameId);
    if (scores === null) return sendError(res, 404, "errors.com.epicgames.events.event_not_found", `No event ${req.params.eventId}`);
    res.json(scores);
  };
  router.get("/api/v1/events/:gameId/:eventId/history/:accountId", forBuild, auth, own, accountHistory);
  router.get("/api/v1/events/:gameId/:eventId/:eventWindowId/history/:accountId", forBuild, auth, own, accountHistory);

  router.get("/api/v1/leaderboards/:gameId/:eventId/:eventWindowId/:accountId", forBuild, auth, own, (req, res) => {
    const leaderboard = eventsLeaderboard(req.params.accountId, req.params.eventId, req.params.eventWindowId, currentBuild(),
      { page: text(req.query.page), rank: text(req.query.rank) }, new Date(), context.tournaments, req.params.gameId);
    if (leaderboard === null) return noWindow(req, res);
    res.json(leaderboard);
  });

  router.get("/api/v1/players/:gameId/:accountId", forBuild, auth, own, (req, res) => {
    res.json(eventsPlayerOf(req.params.accountId, req.params.gameId, currentBuild()));
  });

  return router;
}
