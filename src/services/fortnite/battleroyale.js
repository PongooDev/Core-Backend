import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { log } from "../../log.js";
import { sessionMembers } from "../../matchmaking/sessions.js";
import { addSeasonXp, awardVictory, matchXp, recordMatchProgress } from "../../profiles/athena.js";
import { openSession } from "../../profiles/session.js";
import { isMainPlaylist } from "../../stats/store.js";
import { notifyProfiles } from "../mcp/profile.js";

// What a Battle Royale gameserver (1.7.2) tells the backend about its match's players, which Battle Royale's stats are
// made from (src/stats/store.js, the stats screen: services/fortnite/stats.js).
// - winners: POST {playlistId, accountIds} when the match is assigned, answered {playlistId, winners: [...]}
//   (OnQueryAthenaWinnersComplete 0x722560, serializer 0x732ED0: "Invalid response" without it). A winner is
//   {accountId, umbrellaType} (0x732DF0), which the game mode keeps per account (0x3F42F0, PostLogin 0x3F8760) and
//   turns into the player's glider, AFortPlayerControllerAthena::GliderType (EFortGliderType): "umbrella" Umbrella
//   (with AFortPlayerStateAthena::bHasWonAGame), "founder_umbrella" FounderUmbrella, "founder_glider" FounderGlider,
//   anything else or no entry the StockGlider. 1.7.2 has no glider items; this answer is the only thing that picks one.
//   Season 1's Victory Umbrella (Core #97): every player with a win in solo, duo or squad gets "umbrella", from the match
//   after it (the question is asked once, at assignment); the founder types go unused 🟡 (who Epic gave them wasn't
//   looked at, and every Core account is a founder).
// - recordwin: POST {playlistId, accountIds}, the winners at the end of the match (OnRecordWinnerComplete, 0x3F4950,
//   request 0x72E130): a win (br_placetop1) each.
// - recordresults: Core's (CoreV2's server; the 1.7.2 server reports nothing else), POST {playlistId, results:
//   [{accountId, place, kills, secondsAlive}], countWins}, when a team is out of the match or has won: its players'
//   match, place, kills and time alive. 1.8 has neither winners nor recordwin (Core-Backend #81: no
//   "battleroyale/recordwin" in its exe), so CoreV2 sends countWins: true from a build without it and a place 1 there
//   is the win too; without countWins (1.7.2, or a CoreV2 from before) recordwin counts it, so a win isn't counted
//   twice. A player with a Battle Royale profile (1.8's athena) also gets the match's season XP and its placement and
//   elimination challenge progress (profiles/athena.js), which reach their client as profile notifications, and for a
//   win (place 1) in solo, duo or squad The Umbrella and the Founder's Umbrella in the locker (Core-Backend #77, #84):
//   1.8's umbrella is a glider item.
// The gameserver's own login records the players on a session it hosts, the DedicatedServer client (CoreV2) anyone's;
// other players are skipped, so a player's own token can't award itself wins. Both records answer 204 whatever they kept.
export function battleRoyaleRoutes(context) {
  const { tokens, accounts, sessions, stats, profiles } = context;
  const router = express.Router();
  const auth = requireAuth(tokens);

  const playlistOf = (body) => Number(body?.playlistId ?? 0);
  function recordable(req, accountId) {
    if (typeof accountId !== "string" || !accounts.get(accountId)) return false;
    return isDedicatedServerToken(req.session)
      || sessions.hostedBy(req.session.accountId).some((session) => sessionMembers(session).includes(accountId));
  }

  router.post("/fortnite/api/game/v2/battleroyale/winners", auth, (req, res) => {
    const accountIds = Array.isArray(req.body?.accountIds) ? req.body.accountIds : [];
    const winners = accountIds.filter((accountId) => typeof accountId === "string" && accounts.get(accountId) && stats.hasWon(accountId))
      .map((accountId) => ({ accountId, umbrellaType: "umbrella" }));
    log("Battle Royale", `Umbrella for ${winners.map(({ accountId }) => accountId).join(", ") || "nobody"} of ${accountIds.length} players`);
    res.json({ playlistId: playlistOf(req.body), winners });
  });

  router.post("/fortnite/api/game/v2/battleroyale/recordwin", auth, (req, res) => {
    const playlistId = playlistOf(req.body);
    const accountIds = Array.isArray(req.body?.accountIds) ? req.body.accountIds : [];
    const winners = Number.isInteger(playlistId) && playlistId > 0 ? accountIds.filter((accountId) => recordable(req, accountId)) : [];
    // A 1.7.2 win also unlocks 1.8's umbrellas, the next time the player's athena profile loads (profiles/athena.js).
    for (const accountId of winners) stats.recordWin(accountId, playlistId);
    log("Battle Royale", `Win recorded in playlist ${playlistId} for ${winners.join(", ") || "nobody"}`
      + (winners.length < accountIds.length ? ` (${accountIds.length - winners.length} not on a session of this server)` : ""));
    res.status(204).end();
  });

  const count = (value, max) => (Number.isInteger(value) && value >= 0 ? Math.min(value, max) : null);
  router.post("/fortnite/api/game/v2/battleroyale/recordresults", auth, (req, res) => {
    const playlistId = playlistOf(req.body);
    const results = Array.isArray(req.body?.results) && Number.isInteger(playlistId) && playlistId > 0 ? req.body.results : [];
    const countWins = req.body?.countWins === true;
    for (const result of results) {
      const place = count(result?.place, 1000);
      const kills = count(result?.kills, 1000);
      const secondsAlive = count(result?.secondsAlive, 24 * 60 * 60);
      if (!place || kills === null || secondsAlive === null || !recordable(req, result.accountId)) {
        log("Battle Royale", `Result skipped: ${JSON.stringify(result)}`);
        continue;
      }
      const win = countWins && place === 1;
      stats.recordResult(result.accountId, playlistId, { place, kills, secondsAlive, win });
      log("Battle Royale", `${result.accountId} placed ${place} in playlist ${playlistId} with ${kills} kills, ${secondsAlive} s alive`
        + (win ? " (a win)" : ""));
      const session = openSession(profiles, result.accountId);
      if (!session.hasProfile("athena")) continue;
      recordMatchProgress(session, playlistId, { place, kills });
      addSeasonXp(session, matchXp(playlistId, { place, kills, secondsAlive }));
      if (place === 1 && isMainPlaylist(playlistId)) awardVictory(session);
      session.commit();
      notifyProfiles(context, session);
    }
    res.status(204).end();
  });

  return router;
}
