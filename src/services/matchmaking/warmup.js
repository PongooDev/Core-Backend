import express from "express";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { requireAuth } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";

// Core's: a CoreV2 Battle Royale gameserver's warmup (Core-Backend #122, the admin panel's Matchmaking settings).
//   POST /fortnite/api/game/v2/matchmakingservice/warmup
//   {phase: "Setup"|"Warmup"|"Aircraft"|..., accountIds: [the players connected], secondsLeft: <the warmup's>}
//   -> {warmupSeconds, lateJoin, sessionId, open, maxPlayers, parties: [[accountId]]}
// The server asks from its world's start, every 30 seconds until its warmup begins, then every second until the bus
// leaves, and once more after. warmupSeconds (null: the game's own) is how long its warmup lasts: the game mode's
// WarmupCountdownDuration, which the game has from its config and no match option sets (1.9's OnGivenMatchAssignment
// 0x42D2B0 reads only match.option.warmupRequiredPlayerCount). With lateJoin on and the phase Warmup, the matchmaking
// service sends parties queuing for the match's bucket to it (open), up to maxPlayers, and parties lists the ones it
// sent, for the server to give each party one team. The match is found by its players (matchmaking/service.js).
// Only the DedicatedServer client (CoreV2's requests) or a gameserver account hosting a session may ask.
const maxAccountIds = 200;

export function warmupRoutes({ tokens, sessions, settings, matchmaker }) {
  const router = express.Router();

  router.post("/fortnite/api/game/v2/matchmakingservice/warmup", requireAuth(tokens), (req, res) => {
    if (!isDedicatedServerToken(req.session) && !sessions.hostedBy(req.session.accountId).length) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Only a gameserver reports its warmup");
    }
    const current = settings.get();
    const accountIds = [...new Set((Array.isArray(req.body?.accountIds) ? req.body.accountIds : [])
      .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64))].slice(0, maxAccountIds);
    const secondsLeft = Number(req.body?.secondsLeft);
    const lateJoin = current.lateJoin === true;
    const open = lateJoin && req.body?.phase === "Warmup" && Number.isFinite(secondsLeft) && secondsLeft > 0;
    const match = accountIds.length ? matchmaker.warmup({ accountIds, open, secondsLeft }) : null;
    res.json({
      warmupSeconds: current.warmupSeconds ?? null,
      lateJoin,
      sessionId: match?.sessionId ?? null,
      open: match?.open ?? false,
      maxPlayers: match?.maxPlayers ?? null,
      parties: match?.parties ?? []
    });
  });

  return router;
}
