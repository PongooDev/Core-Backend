import express from "express";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { requireAuth } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";
import { stormDestructionPercent } from "../../events/stormdestruction.js";
import { botModeOf, botsInMode, matchBots } from "../../matchmaking/botmodes.js";

// Core's: a CoreV2 Battle Royale gameserver's warmup (Core-Backend #122, the admin panel's Matchmaking settings).
//   POST /fortnite/api/game/v2/matchmakingservice/warmup
//   {phase: "Setup"|"Warmup"|"Aircraft"|..., accountIds: [the players connected], secondsLeft: <the warmup's>,
//    playlistId, playlistName}
//   -> {warmupSeconds, lateJoin, sessionId, open, maxPlayers, parties: [[accountId]], noFill: [accountId], bots,
//       botsMode: {id, enabled}, stormDestructionPercent}
// The server asks from its world's start, every 30 seconds until its warmup begins, then every second until the bus
// leaves, and once more after. warmupSeconds (null: the game's own) is how long its warmup lasts: the game mode's
// WarmupCountdownDuration, which the game has from its config and no match option sets (1.9's OnGivenMatchAssignment
// 0x42D2B0 reads only match.option.warmupRequiredPlayerCount). With lateJoin on and the phase Warmup, the matchmaking
// service sends parties queuing for the match's bucket to it (open), up to maxPlayers, and parties lists the ones it
// sent, for the server to give each party one team. noFill is the match's players whose party doesn't fill (the party
// leader's player.option.fillTeam false): in a team of several squads (Teams of 20, CoreV2 #242) the server puts a late
// player who fills in a squad of players with room, and one who doesn't in a squad of their own. The match is found by
// its players (matchmaking/service.js). A Playground match (Core-Backend #299) is its party's alone: never open, lateJoin
// false, maxPlayers its party's size; its bots still follow the panel ("Fill players' teams with bots" fills the party's
// team unless the party plays without fill).
// bots (CoreV2 #233) is the player bots to add, {count, level, health, shield, quests, fights, teams, noFill}, when the
// admin panel's Force player AIs is on and its count is above 0, or its "Fill players' teams with bots" is on, else null.
// count is the bots on teams of their own (0 with Force player AIs off): the match's mode's own count when the panel
// sets one (Core-Backend #352, bots.modeCounts), else the shared one, the requested one as is: the gameserver applies
// the cap itself (bots = min(count, match capacity - connected players - bots on players' teams), re-checked before the
// bus leaves). teams: whether bots fill the empty places on players' teams in duos and squads; noFill: the match's
// players whose party doesn't fill (the party leader's player.option.fillTeam false), whose teams get none.
// A match of a tournament playlist (Core-Backend #282) plays with its running event's own bots when it has them: on with
// the event's count, or off (tournaments/store.js effectiveBots); the Matchmaking tab's otherwise, and for a report the
// service can't place in a match yet (no players connected: the gameserver brings no bots in before one is).
// The Matchmaking tab's bots play only in the game modes it has them on in (Core-Backend #352, matchmaking/botmodes.js):
// in one that is off, bots is null. The match's mode is its playlist's: the matchmaking service's for a match it placed,
// else the one the gameserver reports (playlistId, the game mode's CurrentPlaylistId, or from 5.30 playlistName, its
// CurrentPlaylistName; a gameserver from before #352 sends neither), so a server is told before its first player is
// placed. botsMode is that mode ({id: the panel's mode id, enabled: whether its bots play there}), or null when the
// playlist isn't known yet; a gameserver from before #352 ignores it.
// stormDestructionPercent (PongooDev/CoreV2#395, events/stormdestruction.js) is the events config's share of matches
// (0 to 100) that get 5.40's Storm Destruction: the gameserver rolls each match against it once, while the build's
// Athena.bMegaStormEnabled (the hotfix's switch) is on, and turns the switch off for a match that doesn't get it.
// Only the DedicatedServer client (CoreV2's requests) or a gameserver account hosting a session may ask.
const maxAccountIds = 200;

export function warmupRoutes({ tokens, sessions, settings, matchmaker, tournaments }) {
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
    const event = match?.playlistId !== null && match?.playlistId !== undefined ? tournaments?.botsFor?.(match.playlistId) ?? null : null;
    const reported = Number(req.body?.playlistId);
    const mode = botModeOf(match?.playlistId ?? (Number.isInteger(reported) && reported > 0 ? reported
      : typeof req.body?.playlistName === "string" && req.body.playlistName.length <= 128 ? req.body.playlistName : null));
    const bots = matchBots(current.bots, event, mode);
    const forced = bots?.forcePlayerAIs === true && bots.count > 0;
    const teams = bots?.fillPlayerTeams === true;
    res.json({
      warmupSeconds: current.warmupSeconds ?? null,
      // A Playground match (Core-Backend #299) is its party's alone: no late joining, so the gameserver's countdown
      // shortens once the party is in, as with late joining off.
      lateJoin: lateJoin && match?.partyOnly !== true,
      sessionId: match?.sessionId ?? null,
      open: match?.open ?? false,
      maxPlayers: match?.maxPlayers ?? null,
      parties: match?.parties ?? [],
      noFill: match?.noFill ?? [],
      bots: forced || teams
        ? { count: forced ? bots.count : 0, level: bots.level, health: bots.startingHealth, shield: bots.startingShield, quests: bots.eliminationsCountForQuests,
          fights: bots.botFightChance ?? 30, teams, noFill: match?.noFill ?? [] }
        : null,
      botsMode: mode === null ? null : { id: mode, enabled: event ? true : botsInMode(current.bots, mode) },
      stormDestructionPercent: stormDestructionPercent(current.events)
    });
  });

  return router;
}
