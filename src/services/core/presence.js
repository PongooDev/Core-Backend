import express from "express";
import { isLoopback, requestAddress } from "../../network.js";

// Core's (CoreV2 #467): what a player is doing, for the launcher's Discord Rich Presence. GET
// /core/api/presence?username=<login> answers { displayName, state }, the state being
//   "match"   while a gameserver has the account registered in its session (RegisterPlayers, until UnregisterPlayers or
//             the session ends);
//   "lobby"   while the account's game is logged in to XMPP, which it is from its front end on;
//   "offline" otherwise, and for a login no account has.
// With &after=<state> it answers once the state is another one (a session's players or the account's XMPP login
// changing), or after presenceWaitMs with the same, so the launcher keeps one request open while its game runs instead
// of asking every few seconds.
// It answers this PC, and the PC the account plays from (an address its XMPP connection comes from). Anyone else is
// told "offline" with no name: nobody learns another player's whereabouts, or which account an email signs in to.
export const defaultPresenceWaitMs = 55_000;
const states = new Set(["offline", "lobby", "match"]);

export function corePresenceRoutes({ accounts, sessions, xmpp, presenceWaitMs = defaultPresenceWaitMs }) {
  const router = express.Router();

  function presence(req) {
    const login = String(req.query.username ?? "").trim();
    const account = login ? accounts?.findByLogin?.(login) : null;
    if (!account) return { state: "offline" };
    const address = requestAddress(req);
    if (!isLoopback(address) && !(xmpp?.addressesOf?.(account.id) ?? []).includes(address)) return { state: "offline" };
    const inMatch = (sessions?.findPlayer?.(account.id) ?? []).length > 0;
    return { displayName: account.displayName, state: inMatch ? "match" : xmpp?.isOnline?.(account.id) ? "lobby" : "offline" };
  }

  router.get("/core/api/presence", (req, res) => {
    const after = states.has(req.query.after) ? req.query.after : null;
    const now = presence(req);
    if (after === null || now.state !== after || !(presenceWaitMs > 0)) return res.json(now);

    let waiting = true;
    const finish = (answer) => {
      if (!waiting) return;
      waiting = false;
      clearTimeout(timer);
      stopSessions();
      stopXmpp();
      if (answer) res.json(answer);
    };
    const check = () => {
      const current = presence(req);
      if (current.state !== after) finish(current);
    };
    const stopSessions = sessions?.watch?.(check) ?? (() => {});
    const stopXmpp = xmpp?.watchOnline?.(check) ?? (() => {});
    const timer = setTimeout(() => finish(presence(req)), presenceWaitMs);
    res.on("close", () => finish(null)); // the launcher stopped waiting (its game closed, or it is shutting down)
  });

  return router;
}
