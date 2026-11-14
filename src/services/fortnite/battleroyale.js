import { payPlayerOnSession } from "../../tournaments/payouts.js";
import { isShowdownPlaylist, tournamentsCompleteMessage } from "../../tournaments/showdown.js";
import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { currentBuild, inBuild } from "../../builds/context.js";
import { buildVersions } from "../../builds/detect.js";
import { log } from "../../log.js";
import { teamsOfPlaylist } from "../../matchmaking/service.js";
import { customKeyOf, rewardlessMatch, sessionMembers } from "../../matchmaking/sessions.js";
import { athenaSeason, seasonLevels } from "../../gamedata/athena.js";
import { addSeasonXp, awardVictory, matchXp, matchXpAwards, recordMatchProgress, umbrellaTypeOf } from "../../profiles/athena.js";
import { boostedMatchXp, inProfileSeason, namesAthenaBuild, profileSeason, seasonNumber, takeUpSeason } from "../../profiles/seasons.js";
import { grant } from "../../profiles/progress.js";
import { openSession } from "../../profiles/session.js";
import { rewardModes } from "../../settings/store.js";
import { isMainPlaylist } from "../../stats/store.js";
import { notifyProfiles } from "../mcp/profile.js";
import { currentBattlePassConfig } from "../../battlepass/season1.js";

// What a Battle Royale gameserver (1.7.2) tells the backend about its match's players, which Battle Royale's stats are
// made from (src/stats/store.js, the stats screen: services/fortnite/stats.js).
// - winners: POST {playlistId, accountIds} when the match is assigned, answered {playlistId, winners: [...]}
//   (OnQueryAthenaWinnersComplete 0x722560, serializer 0x732ED0: "Invalid response" without it). A winner is
//   {accountId, umbrellaType} (0x732DF0), which the game mode keeps per account (0x3F42F0, PostLogin 0x3F8760) and
//   turns into the player's glider, AFortPlayerControllerAthena::GliderType (EFortGliderType): "umbrella" Umbrella
//   (with AFortPlayerStateAthena::bHasWonAGame), "founder_umbrella" FounderUmbrella, "founder_glider" FounderGlider,
//   anything else or no entry the StockGlider. 1.7.2 has no glider items; this answer is the only thing that picks one.
//   Season 1's Victory Umbrella (Core #97): every player with a win in solo, duo or squad gets "umbrella", from the match
//   after it (the question is asked once, at assignment). An account that owns Save the World (a founder,
//   profiles/founders.js) gets "founder_umbrella" for a win instead and "founder_glider" without one (Core-Backend #84,
//   profiles/athena.js umbrellaTypeOf); anyone else without a win isn't listed.
// - recordwin: POST {playlistId, accountIds}, the winners at the end of the match (OnRecordWinnerComplete, 0x3F4950,
//   request 0x72E130): a win (br_placetop1) each.
// - recordresults: Core's (CoreV2's server; the 1.7.2 server reports nothing else), POST {playlistId, results:
//   [{accountId, place, kills, botKills, secondsAlive}], countWins, matchId}, when a team is out of the match or has won: its
//   players' match, place, kills and time alive. 1.8 has neither winners nor recordwin (Core-Backend #81: no
//   "battleroyale/recordwin" in its exe), so CoreV2 sends countWins: true from a build without it and a place 1 there
//   is the win too; without countWins (1.7.2, or a CoreV2 from before) recordwin counts it, so a win isn't counted
//   twice. Each result's score (br_score, the lobby leaderboards' Score tab, Core-Backend #128) is the result's own
//   score when the server sends one, else what the match is worth in season XP (profiles/athena.js matchXp), as
//   CoreV2 reports none. A player with a Battle Royale profile (1.8's athena) also gets the match's season XP and its placement and
//   elimination challenge progress (profiles/athena.js), which reach their client as profile notifications, and for a
//   win (place 1) in solo, duo or squad the victory umbrellas it lacks in the locker (Core-Backend #77, #84, #157): The
//   Umbrella in any season, the match's season's own umbrella (Season 2's Snowflake), and a founder's Founder's Umbrella.
//   1.8's umbrella is a glider item. It is answered {results: [{accountId, levelsGained, bookLevelsGained,
//   totalSeasonXpGained, totalBookXpGained, prePenaltySeasonXpGained, xpMultipliers, rewards}]}, what each player with an athena profile was given
//   (rewardResult), which CoreV2 shows on their end-of-match screen (CoreV2 #192).
//   With battleRoyaleVbucks on (Core-Backend #100, #124, the admin panel's Settings), each result in solo, duos,
//   squads or 1.10's 50v50 also pays V-Bucks, from that mode's battleRoyaleRewards: perKill a kill, perWin for a place 1
//   (a team's every player, as CoreV2 places them all), and the best of its placement tiers the place is within (top
//   25 = 100 and top 10 = 250 pay 250 for a 5th place, not 350), all three added up. A limited-time playlist pays as
//   the mode of its teams does (CoreV2 #294: LTMs paid nothing): one of 1 is solo's, 2 duos', more squads', 2 teams of
//   50 50v50's; one with a single team (Playground) or no Battle Royale teams pays nothing. A 50v50 result counts
//   toward its event challenge (profiles/athena.js), not the victory umbrellas.
//   They go to profile0, the balance the game shows, as Currency:mtxgiveaway, the way the admin panel's and the llamas'
//   V-Bucks do. A result pays once per match: the report's matchId (CoreV2's, one id for the whole match) is kept in the player's profile0 with the V-Bucks it paid
//   (coreBattleRoyaleRewards, Core's, never sent to the client), so a report sent again pays nothing; a report without
//   one pays nothing either, as there is no telling it from a replay.
// The gameserver's own login records the players on a session it hosts, the DedicatedServer client (CoreV2) anyone's;
// other players are skipped, so a player's own token can't award itself wins. recordwin answers 204 whatever it kept.

// How long a paid match is remembered. CoreV2 reports a player once a match, when their team is out or has won; a
// replay of a report weeks later isn't something a gameserver does.
const rewardedMatchMs = 30 * 24 * 60 * 60 * 1000;
const matchIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

// The kills a result's challenges count: the player bots among them (CoreV2 #233's botKills) are left out when the admin
// panel's "bot eliminations count for quests" is off (settings.bots.eliminationsCountForQuests); stats, XP and V-Bucks
// keep every kill.
export function questKillsOf(settings, kills, botKills) {
  if (settings?.bots?.eliminationsCountForQuests !== false) return kills;
  const bots = Number.isInteger(botKills) && botKills > 0 ? Math.min(botKills, kills) : 0;
  return kills - bots;
}

// The reward mode a playlist pays as: solo, duos, squads and 50v50 their own; a limited-time playlist its teams' mode
// (matchmaking/service.js teamsOfPlaylist, the build's teams), none for one of a single team or none known.
export function rewardModeOf(playlistId, build = currentBuild()) {
  const id = Number(playlistId);
  const own = Object.keys(rewardModes).find((name) => rewardModes[name] === id);
  if (own) return own;
  const teams = Number.isInteger(id) ? teamsOfPlaylist(id, build ?? null) : null;
  if (!teams || teams.maxTeamCount < 2) return null;
  if (teams.maxTeamCount === 2 && teams.maxTeamSize === 50) return "fiftyFifty";
  return teams.maxTeamSize === 1 ? "solo" : teams.maxTeamSize === 2 ? "duos" : "squads";
}

// What a result earns in its playlist's mode (settings.battleRoyaleRewards): its kills, its win and its best placement
// tier; nothing in a playlist that pays as none of the modes.
export function matchVbucks(rewards, playlistId, { place, kills }, build = currentBuild()) {
  const mode = rewardModeOf(playlistId, build);
  const amounts = mode && rewards?.[mode];
  if (!amounts) return 0;
  const placement = Math.max(0, ...(amounts.placements ?? []).filter(({ top }) => place <= top).map(({ vbucks }) => vbucks));
  return kills * (amounts.perKill ?? 0) + (place === 1 ? amounts.perWin ?? 0 : 0) + placement;
}

// The V-Bucks a result pays (settings, battleRoyaleVbucks), granted into the session's profile0: 0 when off, when it
// earns nothing, without a match id, or when this match already paid the player.
function payMatchVbucks(session, settings, matchId, playlistId, result, build, now = new Date()) {
  if (settings.battleRoyaleVbucks !== true) return 0;
  const amount = matchVbucks(settings.battleRoyaleRewards, playlistId, result, build ?? currentBuild());
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

// A player's season progress, as totals: the season XP and Battle Stars over the levels and tiers reached.
const xpTotalOf = (levels, level, xp) => (levels?.find((entry) => entry.level === level)?.xpTotal ?? 0) + (xp ?? 0);
function progressOf(session) {
  const { attributes } = session.profile("athena").profile.stats;
  const level = attributes.level ?? 1;
  const tier = attributes.book_level ?? 1;
  return { level, tier, xp: xpTotalOf(seasonLevels(), level, attributes.xp), stars: xpTotalOf(athenaSeason()?.bookLevels, tier, attributes.book_xp) };
}

// What the match gave the player, in the form of the rewards Epic's MCP answered EndBattleRoyaleGame with
// (FAthenaRewardResult, 1.11 on): the levels and tiers gained, the season XP and Battle Stars, the Battle Pass's match XP
// boost (an FAthenaMatchXpMultiplierGroup of EAthenaMatchXpMultiplierSource 1, "Battle Pass Bonus", its percent) and the
// XP by what earned it (FAthenaAwardGroup: rewardSource, score and seasonXp). CoreV2's server sends it to the player's
// end-of-match screen (ClientSendEndBattleRoyaleMatchForPlayer), whose XP bar plays the groups, then the boost, from the
// level the client's athena profile had (UAthenaPlayerMatchReport::InitialLevelInfo), and writes the totals.
// From 3.2 the result also holds PrePenaltySeasonXpGained, the season XP before the anti-addiction penalty, and the
// screen's boosts share it, not TotalSeasonXpGained: GetXpRewards (4.1 0xA95DB0) writes a positive boost's line as
// its percent's part of PrePenaltySeasonXpGained less the groups' Scores, the penalty's as its part of
// PrePenaltySeasonXpGained less TotalSeasonXpGained. Without it the Battle Pass Bonus read "+-1,190", minus the Total
// Score (CoreV2 #286). No penalty is taken here, so it is the season XP gained.
const selfMultiplierSource = 1;
function rewardResult(session, accountId, before, awards, seasonXp) {
  const after = progressOf(session);
  const boost = athenaSeason() ? session.profile("athena").profile.stats.attributes.season_match_boost ?? 0 : 0;
  return {
    accountId,
    levelsGained: Math.max(0, after.level - before.level),
    bookLevelsGained: Math.max(0, after.tier - before.tier),
    totalSeasonXpGained: seasonXp,
    totalBookXpGained: Math.max(0, after.stars - before.stars),
    prePenaltySeasonXpGained: seasonXp,
    xpMultipliers: boost > 0 ? [{ source: selfMultiplierSource, amount: boost }] : [],
    rewards: awards.map(({ rewardSource, xp }) => ({ rewardSource, score: xp, seasonXp: xp, bookXp: 0 }))
  };
}

// rewardResult's form for a match that gave nothing (a custom match, #186).
const nothingGained = (accountId) => ({ accountId, levelsGained: 0, bookLevelsGained: 0, totalSeasonXpGained: 0, totalBookXpGained: 0,
  prePenaltySeasonXpGained: 0, xpMultipliers: [], rewards: [] });

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
    const winners = accountIds.filter((accountId) => typeof accountId === "string" && accounts.get(accountId))
      .map((accountId) => ({ accountId, umbrellaType: umbrellaTypeOf(accountId, stats.hasWon(accountId), profiles.settings) }))
      .filter(({ umbrellaType }) => umbrellaType);
    log("Battle Royale", `Gliders for ${winners.map(({ accountId, umbrellaType }) => `${accountId} (${umbrellaType})`).join(", ") || "nobody"} of ${accountIds.length} players`);
    res.json({ playlistId: playlistOf(req.body), winners });
  });

  router.post("/fortnite/api/game/v2/battleroyale/recordwin", auth, (req, res) => {
    const playlistId = playlistOf(req.body);
    const accountIds = Array.isArray(req.body?.accountIds) ? req.body.accountIds : [];
    const winners = Number.isInteger(playlistId) && playlistId > 0 ? accountIds.filter((accountId) => recordable(req, accountId)) : [];
    // A 1.7.2 win also unlocks 1.8's umbrellas, the next time the player's athena profile loads (profiles/athena.js).
    for (const accountId of winners) stats.recordWin(accountId, playlistId, new Date(), seasonNumber());
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
  // The season of the match a player's result comes from, for its leaderboards (Core-Backend #151): its build's (1.11's
  // Season 2, 1.8 to 1.10's Season 1), else the request's when it names a Battle Royale build, else the season the
  // player's profile is in, as the result's progress is read (profiles/seasons.js).
  const matchSeason = (session, build) => {
    if (build) return inBuild(build, seasonNumber);
    if (namesAthenaBuild() || !session.hasProfile("athena")) return seasonNumber();
    return profileSeason(session.profile("athena").profile);
  };
  // The player's friends in their squad, for 2.2's "Play matches with a friend" (profiles/athena.js): the report names no
  // teams, but a team's players share its place (CoreV2 gives those who left before it was out the team's), so in a
  // playlist of teams, the others of the report with the player's place are their squad (🟡).
  const soloPlaylist = 2;
  const squadFriendsOf = (playlistId, results, accountId, place) => {
    if (playlistId === soloPlaylist || !context.friends) return 0;
    const friends = new Set(context.friends.accepted(accountId));
    return results.filter((other) => other?.accountId !== accountId && other?.place === place && friends.has(other.accountId)).length;
  };
  router.post("/fortnite/api/game/v2/battleroyale/recordresults", auth, (req, res) => {
    const playlistId = playlistOf(req.body);
    const results = Array.isArray(req.body?.results) && Number.isInteger(playlistId) && playlistId > 0 ? req.body.results : [];
    const countWins = req.body?.countWins === true;
    const matchId = typeof req.body?.matchId === "string" && matchIdPattern.test(req.body.matchId) ? req.body.matchId : null;
    const rewards = context.settings?.get?.() ?? {};
    const answered = [];
    for (const result of results) {
      const place = count(result?.place, 1000);
      const kills = count(result?.kills, 1000);
      const secondsAlive = count(result?.secondsAlive, 24 * 60 * 60);
      const questKills = kills === null ? null : questKillsOf(rewards, kills, result?.botKills);
      if (!place || kills === null || secondsAlive === null || !recordable(req, result.accountId)) {
        log("Battle Royale", `Result skipped: ${JSON.stringify(result)}`);
        continue;
      }
      const win = countWins && place === 1;
      const bpMultiplier = currentBattlePassConfig()?.xpMultiplier ?? 1.0;
      const earnedXp = Math.floor(matchXp(playlistId, { place, kills, secondsAlive }) * bpMultiplier);
      const score = count(result.score, 1000000) ?? earnedXp;
      const session = openSession(profiles, result.accountId);
      const build = matchBuild(result.accountId);
      const season = matchSeason(session, build);
      stats.recordResult(result.accountId, playlistId, { place, kills, secondsAlive, score, win, season });
      log("Battle Royale", `${result.accountId} placed ${place} in playlist ${playlistId} with ${kills} kills, ${secondsAlive} s alive,`
        + ` score ${score}` + (win ? " (a win)" : "") + ` in Season ${season}`);
      // A tournament event's points (Core-Backend #263, tournaments/store.js): Solo Showdown's placement (and, by the
      // event's rules, elimination) points. 6.10's in-game tournaments (tournaments/showdown.js) score a team: the report
      // names no teams, but a team's players share its place (as squadFriendsOf above reads it), so on a Showdown playlist
      // the players of the report with this place are the team, its eliminations theirs together, and each is told with
      // the XMPP message their client asks its window's history on (com.epicgames.tournaments.complete; 🟡 Epic's came
      // from the player's own client after the server's ClientNotifyTournamentStatsFinal: that a service message is
      // taken the same way isn't seen in a running client).
      const showdown = isShowdownPlaylist(playlistId);
      const team = showdown ? results.filter((other) => other?.place === result.place && typeof other?.accountId === "string" && accounts.get(other.accountId)) : [];
      const teamKills = showdown ? team.reduce((total, other) => total + (count(other.kills, 1000) ?? 0), 0) : kills;
      for (const { eventId, points } of context.tournaments?.recordResult(result.accountId, playlistId,
        { place, kills: teamKills, matchId, team: team.map((other) => other.accountId),
          build: build ?? (Object.hasOwn(buildVersions, currentBuild()) ? currentBuild() : null) }) ?? []) {
        log("Battle Royale", `${result.accountId} scored ${points} points in tournament event ${eventId}`);
        if (showdown) context.xmpp?.notify(result.accountId, tournamentsCompleteMessage, {});
        // The event's points prizes the player now reaches (#361, tournaments/payouts.js), once each, saved with the match.
        const event = context.tournaments.get(eventId);
        if (event) payPlayerOnSession(context.tournaments, event, session);
      }
      // A custom matchmaking key's match (Core-Backend #186) gives no V-Bucks, season XP or challenge progress while the
      // admin panel's "Custom matches give no challenge progress or rewards" is on (its default), as Epic's custom matches
      // gave none; its stats above still count. The player's end-of-match screen is answered with nothing gained.
      if (rewardlessMatch(sessions, rewards, result.accountId)) {
        log("Battle Royale", `${result.accountId}'s match was a custom match (key ${customKeyOf(sessions, result.accountId)}): no V-Bucks, XP or challenge progress`);
        if (session.hasProfile("athena")) answered.push(nothingGained(result.accountId));
        session.commit();
        continue;
      }
      const vbucks = payMatchVbucks(session, rewards, matchId, playlistId, { place, kills }, build);
      if (vbucks) log("Battle Royale", `${result.accountId} earned ${vbucks} V-Bucks in match ${matchId}`);
      const progress = () => {
        // The match's XP and challenges count in its build's season, whichever lobby opened the profile last.
        takeUpSeason(session);
        const before = progressOf(session);
        recordMatchProgress(session, playlistId, { place, kills: questKills, squadFriends: squadFriendsOf(playlistId, results, result.accountId, place) });
        // 1.11's Battle Pass adds its match XP boost (profiles/seasons.js).
        const seasonXp = boostedMatchXp(session, earnedXp);
        addSeasonXp(session, seasonXp);
        if (place === 1 && isMainPlaylist(playlistId)) awardVictory(session);
        answered.push(rewardResult(session, result.accountId, before, matchXpAwards(playlistId, { place, kills, secondsAlive }), seasonXp));
      };
      if (session.hasProfile("athena")) {
        if (build) inBuild(build, progress);
        // A report naming no build is read in the season the player's profile is in (profiles/seasons.js).
        else inProfileSeason(session.profile("athena").profile, progress);
      }
      session.commit();
      notifyProfiles(context, session);
    }
    res.json({ results: answered });
  });

  return router;
}
