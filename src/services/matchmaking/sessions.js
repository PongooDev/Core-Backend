import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { requireLoopback } from "../../admin/local.js";
import { notFound } from "../../errors.js";
import { log } from "../../log.js";
import { sessionJson, sessionSummary } from "../../matchmaking/sessions.js";

// OnlineSubsystemMcp's session API, with the verbs the Cert build sends (FOnlineSessionMcp, Session-Plan §5): servers
// create (POST), update (PUT), heartbeat every 30 s, start, stop (POST), register and unregister players (POST /
// DELETE /players) and destroy (DELETE) their sessions; the client finds an empty server with matchMakingRequest
// (GAMEMODE_s FORTEMPTY), reads one session or a friend's (GET), joins and invites (POST) and fetches the
// connection's encryption key. Other verbs fall through to the unknown route log.
//
// A Core gameserver binds its game port 35 to 70 s before it registers its session (its first tick stalls for most of
// that, then it logs in, checks the hotfix and opens its beacon), and the launcher calls it ready at the bind, so a
// client that starts a mission while the servers are still starting finds no empty server. The tutorial's automatic matchmaking gives up after a few empty answers ("Matchmaking canceled", Retry then
// works: Core-Backend #11). So a search for an empty server that finds none waits for one to register or free up, up to
// emptyServerWaitMs, and is answered as soon as one does. The Cert client's HTTP requests time out after HttpTimeout
// (300 s by default, FHttpModule 0x185B670), well beyond that.
export const defaultEmptyServerWaitMs = 30_000;

// EMPTYONLY searches (the client's "Finding Empty Server") are the ones that send maxCurrentPlayers, as 0 (writer
// sub_380C0E0); a search for an existing session to join is answered at once.
const wantsEmptyServer = (search) => search?.maxCurrentPlayers === 0;

export function sessionRoutes({ tokens, sessions, network, emptyServerWaitMs = defaultEmptyServerWaitMs }) {
  const router = express.Router();
  const base = "/fortnite/api/matchmaking/session";
  const auth = requireAuth(tokens);
  const withSession = (handler) => (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return notFound(res, req.originalUrl);
    handler(session, req, res);
  };

  // The Cert server's create body has no serverAddress (only with -UseLocalIPs), so it is where the request came from.
  router.post(base, auth, (req, res) => {
    const session = sessions.create(req.body, req.socket.remoteAddress, req.session.accountId);
    log("Matchmaking", `Session ${session.id} created by ${session.ownerName || session.ownerId || "a server"} at ${session.serverAddress}:${session.serverPort}`);
    res.json(sessionJson(session, req, network));
  });

  router.post(`${base}/matchMakingRequest`, auth, (req, res) => {
    const answer = (found) => res.json(found.map((session) => sessionJson(session, req, network)));
    const found = sessions.search(req.body);
    if (found.length > 0 || !wantsEmptyServer(req.body) || !(emptyServerWaitMs > 0)) return answer(found);

    const started = Date.now();
    let waiting = true;
    const finish = (result) => {
      if (!waiting) return;
      waiting = false;
      clearTimeout(timer);
      stopWatching();
      if (!result) return; // The client gave up (cancelled matchmaking or closed the connection).
      const waited = ((Date.now() - started) / 1000).toFixed(1);
      log("Matchmaking", result.length > 0
        ? `Found an empty server after ${waited} s of waiting for one`
        : `No empty server came up within ${waited} s`);
      answer(result);
    };
    const stopWatching = sessions.watch(() => {
      const now = sessions.search(req.body);
      if (now.length > 0) finish(now);
    });
    const timer = setTimeout(() => finish(sessions.search(req.body)), emptyServerWaitMs);
    res.on("close", () => finish());
  });

  router.get(`${base}/findPlayer/:accountId`, auth, (req, res) => {
    res.json(sessions.findPlayer(req.params.accountId).map((session) => sessionJson(session, req, network)));
  });

  router.route(`${base}/:sessionId`)
    .get(auth, withSession((session, req, res) => res.json(sessionJson(session, req, network))))
    .put(auth, withSession((session, req, res) => res.json(sessionJson(sessions.update(session.id, req.body), req, network))))
    .delete(auth, withSession((session, req, res) => {
      sessions.remove(session.id);
      log("Matchmaking", `Session ${session.id} ended`);
      res.status(204).end();
    }));

  router.post(`${base}/:sessionId/heartbeat`, auth, withSession((session, req, res) => {
    sessions.heartbeat(session.id);
    res.status(204).end();
  }));

  for (const [action, started] of [["start", true], ["stop", false]]) {
    router.post(`${base}/:sessionId/${action}`, auth, withSession((session, req, res) => {
      sessions.setStarted(session.id, started);
      res.status(204).end();
    }));
  }

  // Both replies are parsed as a JSON object (RegisterPlayers sub_37F95E0, UnregisterPlayers sub_3807C30); RegisterPlayers
  // also needs publicPlayers and privatePlayers in it, or "Invalid response payload=" fails the task and the server
  // drops the player, and the server reads openPublicPlayers and openPrivatePlayers from it too ("Field
  // openPrivatePlayers was not found" otherwise). So both answer with the session's lists and open slots after the change.
  const playerLists = (session) => ({
    publicPlayers: [...session.publicPlayers], privatePlayers: [...session.privatePlayers],
    openPublicPlayers: session.openPublicPlayers, openPrivatePlayers: session.openPrivatePlayers
  });
  router.route(`${base}/:sessionId/players`)
    .post(auth, withSession((session, req, res) => res.json(playerLists(sessions.addPlayers(session.id, req.body)))))
    .delete(auth, withSession((session, req, res) => res.json(playerLists(sessions.removePlayers(session.id, req.body)))));

  for (const action of ["join", "invite"]) {
    router.post(`${base}/:sessionId/${action}`, auth, withSession((session, req, res) => res.status(204).end()));
  }

  // The client (for itself) and the server (for each joining player) fetch the same key.
  router.get("/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId", auth, withSession((session, req, res) => {
    res.json({ accountId: req.params.accountId, sessionId: session.id, key: sessions.key(session.id, req.params.accountId) });
  }));

  // Core's: the launcher reads which servers are busy (owner = the server slot's account, players, game mode).
  router.get("/core/api/sessions", requireLoopback, (req, res) => {
    res.json(sessions.list().map(sessionSummary));
  });

  return router;
}
