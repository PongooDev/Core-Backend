import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { log } from "../../log.js";
import { sessionMembers } from "../../matchmaking/sessions.js";

// What a Battle Royale gameserver (1.7.2) tells the backend about its match's players, which Battle Royale's stats are
// made from (src/stats/store.js, the stats screen: services/fortnite/stats.js).
// - winners: POST {playlistId, accountIds} when the match is assigned, answered {playlistId, winners: [...]}
//   (OnQueryAthenaWinnersComplete 0x722560, serializer 0x732ED0: "Invalid response" without it). A winner is
//   {accountId, umbrellaType} (0x732DF0), which the game mode keeps per account (0x3F42F0); nobody gets one yet 🟡
//   (which umbrella types there are wasn't looked at).
// - recordwin: POST {playlistId, accountIds}, the winners at the end of the match (OnRecordWinnerComplete, 0x3F4950,
//   request 0x72E130): a win (br_placetop1) each.
// - recordresults: Core's (CoreV2's server; the 1.7.2 server reports nothing else), POST {playlistId, results:
//   [{accountId, place, kills, secondsAlive}]} when a team is out of the match or has won: its players' match, place,
//   kills and time alive.
// The gameserver's own login records the players on a session it hosts, the DedicatedServer client (CoreV2) anyone's;
// other players are skipped, so a player's own token can't award itself wins. Both records answer 204 whatever they kept.
export function battleRoyaleRoutes({ tokens, accounts, sessions, stats }) {
  const router = express.Router();
  const auth = requireAuth(tokens);

  const playlistOf = (body) => Number(body?.playlistId ?? 0);
  function recordable(req, accountId) {
    if (typeof accountId !== "string" || !accounts.get(accountId)) return false;
    return isDedicatedServerToken(req.session)
      || sessions.hostedBy(req.session.accountId).some((session) => sessionMembers(session).includes(accountId));
  }

  router.post("/fortnite/api/game/v2/battleroyale/winners", auth, (req, res) => {
    res.json({ playlistId: playlistOf(req.body), winners: [] });
  });

  router.post("/fortnite/api/game/v2/battleroyale/recordwin", auth, (req, res) => {
    const playlistId = playlistOf(req.body);
    const accountIds = Array.isArray(req.body?.accountIds) ? req.body.accountIds : [];
    const winners = Number.isInteger(playlistId) && playlistId > 0 ? accountIds.filter((accountId) => recordable(req, accountId)) : [];
    for (const accountId of winners) stats.recordWin(accountId, playlistId);
    log("Battle Royale", `Win recorded in playlist ${playlistId} for ${winners.join(", ") || "nobody"}`
      + (winners.length < accountIds.length ? ` (${accountIds.length - winners.length} not on a session of this server)` : ""));
    res.status(204).end();
  });

  const count = (value, max) => (Number.isInteger(value) && value >= 0 ? Math.min(value, max) : null);
  router.post("/fortnite/api/game/v2/battleroyale/recordresults", auth, (req, res) => {
    const playlistId = playlistOf(req.body);
    const results = Array.isArray(req.body?.results) && Number.isInteger(playlistId) && playlistId > 0 ? req.body.results : [];
    for (const result of results) {
      const place = count(result?.place, 1000);
      const kills = count(result?.kills, 1000);
      const secondsAlive = count(result?.secondsAlive, 24 * 60 * 60);
      if (!place || kills === null || secondsAlive === null || !recordable(req, result.accountId)) {
        log("Battle Royale", `Result skipped: ${JSON.stringify(result)}`);
        continue;
      }
      stats.recordResult(result.accountId, playlistId, { place, kills, secondsAlive });
      log("Battle Royale", `${result.accountId} placed ${place} in playlist ${playlistId} with ${kills} kills, ${secondsAlive} s alive`);
    }
    res.status(204).end();
  });

  return router;
}
