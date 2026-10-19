import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { notFound } from "../../errors.js";
import { log } from "../../log.js";
import { sessionJson } from "../../matchmaking/sessions.js";

// OnlineSubsystemMcp's session API. Gameservers create, update, heartbeat and end their sessions; the client finds
// one with matchMakingRequest (the Cert client asks for an empty dedicated server: GAMEMODE_s FORTEMPTY) and then
// fetches the connection's encryption key.
export function sessionRoutes({ tokens, sessions }) {
  const router = express.Router();
  const base = "/fortnite/api/matchmaking/session";
  const auth = requireAuth(tokens);
  const withSession = (handler) => (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return notFound(res, req.originalUrl);
    handler(session, req, res);
  };

  router.post(base, auth, (req, res) => {
    const session = sessions.create(req.body);
    log("Matchmaking", `Session ${session.id} created by ${session.ownerName || session.ownerId || "a server"} at ${session.serverAddress}:${session.serverPort}`);
    res.json(sessionJson(session));
  });

  router.post(`${base}/matchMakingRequest`, auth, (req, res) => {
    res.json(sessions.search(req.body).map(sessionJson));
  });

  router.get(`${base}/findPlayer/:accountId`, auth, (req, res) => {
    res.json(sessions.findPlayer(req.params.accountId).map(sessionJson));
  });

  router.get(`${base}/:sessionId`, auth, withSession((session, req, res) => res.json(sessionJson(session))));

  router.route(`${base}/:sessionId`)
    .put(auth, withSession((session, req, res) => res.json(sessionJson(sessions.update(session.id, req.body)))))
    .post(auth, withSession((session, req, res) => res.json(sessionJson(sessions.update(session.id, req.body)))))
    .delete(auth, withSession((session, req, res) => {
      sessions.remove(session.id);
      log("Matchmaking", `Session ${session.id} ended`);
      res.status(204).end();
    }));

  router.all(`${base}/:sessionId/heartbeat`, auth, withSession((session, req, res) => {
    sessions.heartbeat(session.id);
    res.status(204).end();
  }));

  for (const [action, started] of [["start", true], ["stop", false]]) {
    router.all(`${base}/:sessionId/${action}`, auth, withSession((session, req, res) => {
      sessions.setStarted(session.id, started);
      res.status(204).end();
    }));
  }

  router.all(`${base}/:sessionId/players`, auth, withSession((session, req, res) => {
    sessions.update(session.id, req.body);
    res.status(204).end();
  }));

  for (const action of ["join", "invite"]) {
    router.all(`${base}/:sessionId/${action}`, auth, withSession((session, req, res) => res.status(204).end()));
  }

  // The client (for itself) and the server (for each joining player) fetch the same key.
  router.get("/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId", auth, withSession((session, req, res) => {
    res.json({ accountId: req.params.accountId, sessionId: session.id, key: sessions.key(session.id, req.params.accountId) });
  }));

  return router;
}
