import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { currentBuild, inBuild } from "../../builds/context.js";
import { buildVersions } from "../../builds/detect.js";
import { log } from "../../log.js";
import { sessionMembers } from "../../matchmaking/sessions.js";
import { addSeasonXp, awardVictory, matchXp, recordMatchProgress } from "../../profiles/athena.js";
import { grant } from "../../profiles/progress.js";
import { openSession } from "../../profiles/session.js";
import { rewardModes } from "../../settings/store.js";
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
//   [{accountId, place, kills, secondsAlive}], countWins, matchId}, when a team is out of the match or has won: its
//   players' match, place, kills and time alive. 1.8 has neither winners nor recordwin (Core-Backend #81: no
//   "battleroyale/recordwin" in its exe), so CoreV2 sends countWins: true from a build without it and a place 1 there
//   is the win too; without countWins (1.7.2, or a CoreV2 from before) recordwin counts it, so a win isn't counted
//   twice. Each result's score (br_score, the lobby leaderboards' Score tab, Core-Backend #128) is the result's own
//   score when the server sends one, else what the match is worth in season XP (profiles/athena.js matchXp), as
//   CoreV2 reports none. A player with a Battle Royale profile (1.8's athena) also gets the match's season XP and its placement and
//   elimination challenge progress (profiles/athena.js), which reach their client as profile notifications, and for a
//   win (place 1) in solo, duo or squad The Umbrella and the Founder's Umbrella in the locker (Core-Backend #77, #84):
//   1.8's umbrella is a glider item.
//   With battleRoyaleVbucks on (Core-Backend #100, #124, the admin panel's Settings), each result in solo, duos,
//   squads or 1.10's 50v50 also pays V-Bucks, from that mode's battleRoyaleRewards: perKill a kill, perWin for a place 1
//   (a team's every player, as CoreV2 places them all), and the best of its placement tiers the place is within (top
//   25 = 100 and top 10 = 250 pay 250 for a 5th place, not 350), all three added up. Another limited-time playlist
//   pays nothing. A 50v50 result counts toward its event challenge (profiles/athena.js), not the victory umbrellas.
//   They go to profile0, the balance the game shows, as Currency:mtxgiveaway, the way the admin panel's and the llamas'
//   V-Bucks do. A result pays once per match: the report's matchId (CoreV2's, one id for the whole match) is kept in the player's profile0 with the V-Bucks it paid
//   (coreBattleRoyaleRewards, Core's, never sent to the client), so a report sent again pays nothing; a report without
//   one pays nothing either, as there is no telling it from a replay.
// The gameserver's own login records the players on a session it hosts, the DedicatedServer client (CoreV2) anyone's;
// other players are skipped, so a player's own token can't award itself wins. Both records answer 204 whatever they kept.

// How long a paid match is remembered. CoreV2 reports a player once a match, when their team is out or has won; a
// replay of a report weeks later isn't something a gameserver does.
const rewardedMatchMs = 30 * 24 * 60 * 60 * 1000;
const matchIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

// What a result earns in its playlist's mode (settings.battleRoyaleRewards): its kills, its win and its best placement
// tier; nothing in a playlist that isn't one of the modes.
export function matchVbucks(rewards, playlistId, { place, kills }) {
  const mode = Object.keys(rewardModes).find((name) => rewardModes[name] === Number(playlistId));
  const amounts = mode && rewards?.[mode];
  if (!amounts) return 0;
  const placement = Math.max(0, ...(amounts.placements ?? []).filter(({ top }) => place <= top).map(({ vbucks }) => vbucks));
  return kills * (amounts.perKill ?? 0) + (place === 1 ? amounts.perWin ?? 0 : 0) + placement;
}

// The V-Bucks a result pays (settings, battleRoyaleVbucks), granted into the session's profile0: 0 when off, when it
// earns nothing, without a match id, or when this match already paid the player.
function payMatchVbucks(session, settings, matchId, playlistId, result, now = new Date()) {
  if (settings.battleRoyaleVbucks !== true) return 0;
  const amount = matchVbucks(settings.battleRoyaleRewards, playlistId, result);
  if (amount <= 0) return 0;
  if (!matchId) {
    log("Battle Royale", `No V-Bucks for ${session.accountId}: the result has no matchId, so a replay of it couldn't be told apart`);
    return 0;
  }
  const account = session.profile("profile0").profile;
  const paid = Object.fromEntries(Object.entries(account.coreBattleRoyaleRewards ?? {})
    .filter(([, { at }]) => now.getTime() - Date.parse(at) < rewardedMatchMs));
  if (Object.hasOwn(paid, matchId)) {
    log("Battle Royale", `No V-Bucks for ${session.accountId}: match ${matchId} already paid them ${paid[matchId].vbucks}`);
    return 0;
  }
  grant(session, "Currency:mtxgiveaway", amount);
  // Saved with the V-Bucks, in the same profile write.
  account.coreBattleRoyaleRewards = { ...paid, [matchId]: { vbucks: amount, at: now.toISOString() } };
  return amount;
}

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
  // The build of the match a player's result comes from: the one their session's gameserver named when it made the
  // session (its own client's requests name it, matchmaking/sessions.js), the latest such session's. CoreV2's report names
  // none (User-Agent "Core V2"), so its results are read with that build's game data, the quests the player holds there
  // among them (1.10's 50v50 challenge, events/fiftyfifty.js, is in 1.10's data only); a report that names its build, or
  // a player on no session, keeps the request's.
  const matchBuild = (accountId) => (Object.hasOwn(buildVersions, currentBuild()) ? undefined : sessions.list()
    .filter((session) => buildVersions[session.hostBuild] && sessionMembers(session).includes(accountId))
    .sort((a, b) => Date.parse(b.lastUpdated) - Date.parse(a.lastUpdated))[0]?.hostBuild);
  router.post("/fortnite/api/game/v2/battleroyale/recordresults", auth, (req, res) => {
    const playlistId = playlistOf(req.body);
    const results = Array.isArray(req.body?.results) && Number.isInteger(playlistId) && playlistId > 0 ? req.body.results : [];
    const countWins = req.body?.countWins === true;
    const matchId = typeof req.body?.matchId === "string" && matchIdPattern.test(req.body.matchId) ? req.body.matchId : null;
    const rewards = context.settings?.get?.() ?? {};
    for (const result of results) {
      const place = count(result?.place, 1000);
      const kills = count(result?.kills, 1000);
      const secondsAlive = count(result?.secondsAlive, 24 * 60 * 60);
      if (!place || kills === null || secondsAlive === null || !recordable(req, result.accountId)) {
        log("Battle Royale", `Result skipped: ${JSON.stringify(result)}`);
        continue;
      }
      const win = countWins && place === 1;
      const score = count(result.score, 1000000) ?? matchXp(playlistId, { place, kills, secondsAlive });
      stats.recordResult(result.accountId, playlistId, { place, kills, secondsAlive, score, win });
      log("Battle Royale", `${result.accountId} placed ${place} in playlist ${playlistId} with ${kills} kills, ${secondsAlive} s alive,`
        + ` score ${score}` + (win ? " (a win)" : ""));
      const session = openSession(profiles, result.accountId);
      const vbucks = payMatchVbucks(session, rewards, matchId, playlistId, { place, kills });
      if (vbucks) log("Battle Royale", `${result.accountId} earned ${vbucks} V-Bucks in match ${matchId}`);
      const progress = () => {
        recordMatchProgress(session, playlistId, { place, kills });
        addSeasonXp(session, matchXp(playlistId, { place, kills, secondsAlive }));
        if (place === 1 && isMainPlaylist(playlistId)) awardVictory(session);
      };
      if (session.hasProfile("athena")) {
        const build = matchBuild(result.accountId);
        if (build) inBuild(build, progress);
        else progress();
      }
      session.commit();
      notifyProfiles(context, session);
    }
    res.status(204).end();
  });

  return router;
}
