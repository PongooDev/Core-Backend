import crypto from "node:crypto";
import { ltms } from "../events/ltms.js";
import { shootingTestPlaylist, shootingTestTeams } from "../events/shootingtest.js";
import { log } from "../log.js";
import { acceptWebSocket } from "../stomp/websocket.js";
import { hasCustomServers, reservationsOf, serverTakes } from "./custom-servers.js";
import { regionAllowsAddress, regionName, regionOf, servedRegions } from "./regions.js";

// Battle Royale's matchmaking service (MMS, from 1.7.2), both sides (Core-Docs Athena-Matchmaking-1.7.2.md and
// Athena-Boot-1.7.2.md §1 C).
//
// Players (UFortMatchmakingV2, MatchmakingServiceClient): a ticket from
// /fortnite/api/game/v2/matchmakingservice/ticket/player/{id}?partyPlayerIds=&bucketId=<netcl>:0:<region>:<playlistId>,
// then a WebSocket with "Authorization: Epic-Signed <ticketType> <payload> <signature>" that gets StatusUpdate
// messages (payload.state Connecting, Waiting {totalPlayers, connectedPlayers}, Queued {ticketId, queuedPlayers,
// estimatedWaitSec, status}, SessionAssignment {matchId}) and then Play {matchId, sessionId}. When the service closes
// the socket with 1000, the client finds that session and travels straight to its game port.
//
// Gameservers (-EnableMMS, MatchmakingServiceDedicatedServer): once their session is created they take a ticket from
// /fortnite/api/game/v2/matchmakingservice/ticket/session/{sessionId}?bucketIds=<netcl>:0:<region>:*,...&minPlayers=
// &maxPlayers=, connect the same way and wait for Registered, then AssignMatch {matchId, bucketId, matchOptions,
// teams: [[[accountId]]] (team, party, players)}. They register the players on the session, answer AssignMatchResult
// {matchId, result: "ready"|"failed"}, and on the socket's close with 1000 start the match on the playlist the bucket
// names (AFortGameModeAthena::OnGivenMatchAssignment). Both sides ping with the text "ping".

const ticketTypes = { player: "mms-player", session: "mms-session" };
// How long a match on a registered server takes in more parties before it is assigned. Once assigned, the server's
// match holds only those players (OnGivenMatchAssignment sets MaxPlayerCount to the beacon's reservations: "Match is
// full" for anyone else), so friends who queue a few seconds apart still share a match. The admin panel's Matchmaking
// settings change it (matchmakingGatherSeconds, Core-Backend #122); the queue's ETA counts it down.
export const defaultGatherMs = 10_000;
// How long a party's other members (each with their own ticket) are sent after the first.
const partyMemberMs = 2 * 60 * 1000;
const playDelayMs = 1000;
// The server's warmup starts with its first player, the others join during it (WarmupRequiredPlayerCount, read by
// OnGivenMatchAssignment 0x3F3CD0).
const matchOptions = { "match.option.warmupRequiredPlayerCount": "1" };
// Each playlist's teams, from the server's own table (1.7.2 ConfigureForMatchAssignment 0x751960, 1.8
// GetMaxTeamInfoForPlaylist 0x79B690, 1.10 0x7EA1F0, the same for the playlists they share): MaxTeamCount teams of
// MaxTeamSize players, in squads of up to MaxSquadSize (21.40's UFortPlaylist names them). Solo 2 is 100 teams of 1,
// Duo 10 100 of 2, Squad 9 100 of 4, and 1.10's 50v50, 11, two teams of 50 in squads of 4. Playlists 0 (1×4), 1 (2×5) and
// 99 (1×1) aren't Battle Royale's; 1.10's 12 to 15 (100×4) have no playlist asset and nothing queues them
// there. From 1.11 the lobby queues the event playlists while the calendar offers them (events/ltms.js): 12 Sneaky
// Silencers, 13 High Explosives, 14 Speedy Storm, 16 Take To The Skies, 17 Lotsa Loot, 18 Sniper Shootout and 19 Blitz
// keep the server's 100 teams of 4 (2.4.2 0x7F3790 gives 12 to 19 that), and 15, Shooting Test #1, is the build's
// (playlistTeamsOf).
const playlistTeams = {
  0: { maxTeamCount: 1, maxTeamSize: 4, maxSquadSize: 4 },
  1: { maxTeamCount: 2, maxTeamSize: 5, maxSquadSize: 5 },
  2: { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 },
  9: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  10: { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 },
  11: { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 },
  12: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  13: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  14: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  16: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  17: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  18: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  19: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  99: { maxTeamCount: 1, maxTeamSize: 1, maxSquadSize: 1 }
};
// From 3.0 (CL-3901517) a playlist's teams are its playlist class's (events/ltms.js): MaxTeamCount, MaxTeamSize and
// MaxPartySize of Athena/Events/<mode>/Playlist_*. Where they differ from the table above: Take To The Skies (16) is
// duos, and 3.0's new playlists, 5x20 (22: 5 × 20 in parties of 4), High Jump (23), Use It & Lose It (25), Steady Storm
// (26), Solid Gold (27), Sky Supply (30) and Shotguns (31); and 3.1's (CL-3915963) Blitz children, Playlist_Blitz_Child_Solo
// (36: 100 × 1) and _Duo (37: 100 × 2), whose MaxTeamCount is Blitz's.
const playlistTeamsFrom30 = {
  36: { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 },
  37: { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 },
  16: { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 },
  22: { maxTeamCount: 5, maxTeamSize: 20, maxSquadSize: 4 },
  23: { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 },
  25: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  26: { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 },
  27: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 },
  30: { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 },
  31: { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 }
};
const playlistClassBuild = 3901517;
// Late joining (Core-Backend #122, the admin panel's Matchmaking settings). The servers' MMS client (1.9
// MatchmakingServiceDedicatedServer 0x3BF2730) knows only Registered, AssignMatch and UnassignMatch, takes an
// AssignMatch only while Registered, and leaves the service once its match is assigned (0x709370), so the protocol has
// no way to add parties to a match. CoreV2's gameserver opens its match itself: during the warmup it raises the game
// mode's MaxPlayerCount, gives each player who joins a team, and reports its players and the warmup's time left every
// second (POST matchmakingservice/warmup, services/matchmaking/warmup.js). While it does, a party queuing for the
// match's bucket is sent straight there. A party isn't sent once less than lateJoinMarginMs of the warmup is left: it
// has to load the map before the bus leaves ("Match has started" after that, PreLogin 0x4319F0). A match whose server
// stopped reporting for lateJoinStaleMs takes nobody; a party sent counts against the match's room until its players
// connect, or for lateArrivalMs.
const lateJoinMarginMs = 15_000;
const lateJoinStaleMs = 5_000;
const lateArrivalMs = 60_000;

// The match start countdown (Core-Backend #160): from 1.7.2 to 2.4.2 the matchmaking panel showed "Match starting in
// 1:48... / Players Connected: 87" while a match formed. Queued's status map ({ticketId, queuedPlayers,
// estimatedWaitSec, status: {key: string}}, 2.1 MatchmakingServiceClient 0x2CB5230) carries it: the
// FortAthenaMatchmakingWidget's queue handler (2.1 0x213E080; 1.10 reads the same keys at 0x21297FD) reads ticket.status.numNeeded,
// ticket.status.numQueued and ticket.status.matchStartDelay (_wtoi of each, -1 when left out). Without numQueued it shows
// the queue ("queuedPlayers" and the ETA); with numQueued but no matchStartDelay, Message.WaitingForPlayers ("Waiting
// for {numNeeded} more players...\nETA: {ETA}"); with both, Message.MatchStarting ("Match starting in {0}...\nPlayers
// Connected: {1}", {0} matchStartDelay as a timespan, {1} numQueued) and a one-shot timer of matchStartDelay seconds that
// puts it at 0:00 (0x213CFC0). It doesn't count down by itself: each Queued sets it again. Epic stopped sending it with
// 2.5 (CL-3889387; 2.4.2 is CL-3870737), whose clients (to 3.0 at least) still read the keys: it stays off for those.
export const firstMatchStartBuild = 3700114;
export const lastMatchStartBuild = 3870737;
export const showsMatchStart = (build) => Number(build) >= firstMatchStartBuild && Number(build) <= lastMatchStartBuild;

// Custom matchmaking keys (Core-Backend #186). With UFortMatchmakingV2's bCustomKeyEnabled (config; it shows the
// Battle Royale lobby's Custom Matchmaking Key action, AthenaLobby RefreshInput) a player's ticket request carries the
// key they typed as player.option.customKey, each party member's alike (2.4 StartFollowerMatchmaking 0x756340 adds it
// when the key isn't empty). Players with the same key share a match of their own, apart from everyone else's, and its
// AssignMatch tells the server so (match.option.customKey: 2.4's OnGivenMatchAssignment 0x4210A0 flags a match whose key
// isn't empty). Who may use a key is the backend's to say: a party with a player the admin panel allows
// (ticket.customKeyHost) opens one; anyone may then queue with that key while its match waits for a server, forms or
// (late joining on) is in its warmup. Any other key the service turns away by closing the connection with the error
// code as the close reason (MatchmakingServiceClient HandleWebSocketConnectionClosed 0x29CDC00 reports any close but
// Play's as an error with that text), which the lobby shows as "Custom matchmaking key is not supported" (0x20D93C0).
export const customKeyNotSupported = "match.custom_key_not_supported";
const customKeyRefusedCode = 4000;
// Which queue a bucket and key are: the bucket's (bucketKey), apart for each key.
export const queueOf = (bucketId, customKey = null) => bucketKey(bucketId) + (customKey ? `|key:${customKey}` : "");
// The game's early countdown (WarmupEarlyCountdownDuration, 15 s): with late joining off, a CoreV2 gameserver's warmup
// shortens to it once the match's assigned players are all in (CoreV2 ApplyWarmupLength), which for a match that has
// just formed is as soon as they load in.
const earlyCountdownSec = 15;
// How long a forming match's players take to reach its warmup once they are sent (Core-Backend #167): the reporter
// measured a steady 25 s from Play (the panel leaving "Waiting for server") to the gameserver's warmup timer starting,
// the client travelling and loading the map. A forming match's countdown adds it before the warmup, so that it reads
// what the island's timer does when they land; a running warmup's time left (late joining) is already real and doesn't.
// The admin panel's Match Start Buffer sets it (settings matchStartBufferSeconds).
export const defaultMatchStartBufferSec = 25;

export function parseBucket(bucketId) {
  const parts = String(bucketId ?? "").split(":");
  const playlistId = Number(parts[3]);
  return { netcl: parts[0], region: parts[2] ?? "", playlistId: Number.isInteger(playlistId) ? playlistId : null, parts };
}

// AssignMatch's bucketId as the server reads it (Core-Backend #153). 1.11's (CL-3807424) MMS server
// (HandleAssignMatchMessage, dump 0x2CBF4E0) splits it on ":" and reads it only with six fields or more:
// <GameId>:<AppId>:<BuildId>:<HotfixVersion>:<RegionId>:<PlaylistId>[:<GroupId>:<PoolId>:<SplitId>]. Given the players'
// own four ("<netcl>:0:<region>:<playlistId>"), it kept its PlaylistId of -1 ("HandleAssignMatchMessage invalid playlist
// id -1"), so every match started on the server's own playlist: a 50v50 queue played a solo match. 1.10 and earlier read
// the four fields as they are. GameId and AppId are only logged; the region the server keeps is field 4. Later builds
// (2.1, CL-3825894; 2.2, CL-3841827; 2.3, CL-3847564; 2.4, CL-3858292; 2.4.2, CL-3870737) take the six fields too, and
// so does 3.0 (CL-3901517): its dump keeps the ticket paths (ticket/player/`id?partyPlayerIds=&bucketId=,
// ticket/session/`id?bucketIds=), "Epic-Signed %s %s %s", the player.option and match.option keys, ticket.status.* and
// HandleAssignMatchMessage's six-field "GameId: %s AppId %s BuildId: %d HotfixVersion: %d RegionId: %s PlaylistId: %d".
// 3.1 (CL-3915963) keeps every one of them, ticket.status.numNeeded, numQueued and matchStartDelay and the Queued
// status's queuedPlayers and estimatedWaitSec, SessionAssignment's matchId and the Play message's sessionId and
// joinDelaySec included (its dump), so it is 3.0's format. 3.2 (CL-3935073) takes it as 3.1's (🟡: its client hasn't been
// dumped for this; its notes change no matchmaking).
export const sixFieldAssignBuild = 3807424;
const assignGameId = "Fortnite";
const assignAppId = "Fortnite";
export function assignmentBucket(bucketId, build) {
  return Number(build) >= sixFieldAssignBuild ? `${assignGameId}:${assignAppId}:${bucketId}` : bucketId;
}

// The bucket with another region in its region field.
export function withRegion(bucketId, region) {
  const { parts } = parseBucket(bucketId);
  if (parts.length > 2) parts[2] = region;
  return parts.join(":");
}

// Which queue a bucket is: the same bucket in any spelling of its region ("1:0:nae:10" and "1:0:NA:10"), or with
// anyRegion the same build and playlist in any region.
export function bucketKey(bucketId, { anyRegion = false } = {}) {
  const { parts } = parseBucket(bucketId);
  if (parts.length > 2) parts[2] = anyRegion ? "*" : regionOf(parts[2]) ?? "NONE";
  return parts.join(":");
}

// The region a server's patterns name, as the server spells it, or null when they take any region ("<netcl>:0:*:*").
export function serverRegion(patterns) {
  for (const pattern of patterns) {
    const field = String(pattern).split(":")[2];
    if (field !== undefined && field !== "*" && field !== "**") return field;
  }
  return null;
}

// The teams of a bucket's playlist ({maxTeamCount, maxTeamSize, maxSquadSize}), or null for one the server doesn't know.
// Shooting Test #1's (15, 2.4 to 2.5) are the build's (events/shootingtest.js: solo from 2.4.2, where the servers' table
// still has 100 teams of 4), the build being the parties' changelist (their tickets'); without one, 2.4.2's.
export const playlistTeamsOf = (bucketId, build = null) => {
  const { playlistId } = parseBucket(bucketId);
  if (playlistId === shootingTestPlaylist) return shootingTestTeams(build ?? 3870737);
  if (Number(build) >= playlistClassBuild && playlistTeamsFrom30[playlistId]) return playlistTeamsFrom30[playlistId];
  return playlistTeams[playlistId] ?? null;
};

// AssignMatch's teams ([team][party][accountId]) from a match's parties, [{players, fill}], or null when they don't fit
// the playlist's teams. The server makes one beacon reservation per party, on team i % its team count for AssignMatch's
// teams[i] (1.10 0x79CEE0, the team count the playlist's MaxTeamCount unless match.option.teamSplit says otherwise;
// ConfigureForMatchAssignment sets the Manual team assignment method, so GetTeamAssignment 0x391AD10 keeps it), and
// PickTeam 0x3F6500 gives a joining player their reservation's team ("PickTeam for [%s] used beacon value
// [HumanPvP_Team1]" for team 0). The players of teams[i] share SquadId i + 1 (1.10 AFortGameSessionDedicated 0x71AC80,
// the squad bar's). So AssignMatch's teams are squads:
// - A party that fills (player.option.fillTeam, the matchmaking panel's Squad Fill) shares a squad with other such
//   parties up to the playlist's MaxSquadSize, biggest first so the smaller ones fill the gaps; one that doesn't fill
//   plays alone (Core-Backend #78). A party bigger than a squad is split, or no team would have room for it.
// - Where a team is one squad (solo, duo, squad), each squad is a team of its own. Where a team holds several (50v50's
//   two teams of 50, in squads of 4), every party shares its team, whatever its Squad Fill: each party, biggest first,
//   goes to the team with the fewest players that has room for it (UPartyBeaconState's GetTeamAssignment, Smallest:
//   the lowest such team on a tie), so the teams are as even as the parties allow, and each team's parties make its
//   squads. The teams' squads then take turns in AssignMatch's teams, an empty team holding the place of a team that
//   has run out of squads (the server skips it, 0x79CEE0).
export function formTeams(parties, teams) {
  if (!teams) return parties.map((party) => [party.players]);
  const { maxTeamCount, maxTeamSize, maxSquadSize } = teams;
  const squadsOf = (group) => {
    const pieces = group.flatMap((party) => {
      const chunks = [];
      for (let index = 0; index < party.players.length; index += maxSquadSize) chunks.push(party.players.slice(index, index + maxSquadSize));
      return chunks.map((players) => ({ players, fill: party.fill }));
    });
    const squads = [];
    for (const piece of pieces.sort((a, b) => b.players.length - a.players.length)) {
      const squad = piece.fill && squads.find((entry) => entry.fill && entry.players + piece.players.length <= maxSquadSize);
      if (squad) {
        squad.parties.push(piece.players);
        squad.players += piece.players.length;
      } else {
        squads.push({ fill: piece.fill, parties: [piece.players], players: piece.players.length });
      }
    }
    return squads;
  };

  const sides = Array.from({ length: maxTeamCount }, () => ({ players: 0, members: [], squads: [] }));
  const roomFor = (size) => sides.filter((side) => side.players + size <= maxTeamSize)
    .reduce((smallest, side) => (!smallest || side.players < smallest.players ? side : smallest), null);
  if (maxTeamSize > maxSquadSize) {
    for (const party of [...parties].sort((a, b) => b.players.length - a.players.length)) {
      const side = roomFor(party.players.length);
      if (!side) return null;
      side.members.push(party);
      side.players += party.players.length;
    }
    for (const side of sides) side.squads = squadsOf(side.members).map((squad) => squad.parties);
  } else {
    for (const squad of squadsOf(parties)) {
      const side = roomFor(squad.players);
      if (!side) return null;
      side.squads.push(squad.parties);
      side.players += squad.players;
    }
  }
  const rounds = Math.max(0, ...sides.map((side) => side.squads.length));
  const result = [];
  for (let round = 0; round < rounds; round++) for (const side of sides) result.push(side.squads[round] ?? []);
  while (result.length && !result.at(-1).length) result.pop();
  return result;
}

// A server's bucket pattern ("858118782:0:NA:*") against a player's bucket ("858118782:0:NA:10"): field by field, "*"
// matching anything, with the same number of fields. A last field of "**" matches whatever fields are left: 1.8's
// servers register one pattern, "<netcl>:0:NA:**", where 1.7.2's registered "...:*" and "...:*:*:*" (Core-Backend #74:
// 1.8 players were never matched). The region field (the third) compares regions, so a server started with
// -McpRegion=nae takes NA's players (regions.js); with anyRegion it takes any region's.
export function bucketMatches(pattern, bucketId, { anyRegion = false } = {}) {
  const want = String(pattern).split(":");
  const have = String(bucketId).split(":");
  const rest = want.at(-1) === "**";
  const fields = rest ? want.slice(0, -1) : want;
  const same = (field, index) => field === "*" || (index === 2 ? anyRegion || regionOf(field) === regionOf(have[index]) : field === have[index]);
  return (rest ? have.length > fields.length : want.length === have.length) && fields.every(same);
}

// Queued's estimatedWaitSec, from the time left until a forming match is assigned. The client shows "N/A" for an ETA
// whose seconds part is 0 (0x2E40A10 checks ticks / 10^7 % 60 > 0), so 0 stays "N/A" (no free server: nothing to
// estimate) and a whole minute is sent a second over (#56).
export function estimatedWaitSec(remainingMs) {
  if (!(remainingMs > 0)) return 0;
  const seconds = Math.ceil(remainingMs / 1000);
  return seconds % 60 === 0 ? seconds + 1 : seconds;
}

const message = (name, payload) => JSON.stringify({ name, payload });
const status = (state, fields = {}) => message("StatusUpdate", { ...fields, state });
const newId = () => crypto.randomUUID().replaceAll("-", "");

// gatherMs: a number, or a function asked each time a match forms (the admin panel's setting). lateJoin: whether
// matches in their warmup take more parties, asked each time. regionFallback: whether a party whose region has no
// server plays in another region (Core-Backend #121) or waits for one of its own (#123), asked each time. serverRegions:
// the admin panel's server regions (#142, regions.js servedRegions), asked each time. matchStartCountdown: whether 1.7.2
// to 2.4.2's players see the match start countdown (#160), warmupSeconds the panel's warmup length (null: the
// game's), and matchStartBuffer the seconds from Play to the warmup starting that it adds (#167), all asked each time.
// regionHostingIps, customServers and customFallback (#227): each region's hosting IPs (regions.js regionAllowsAddress),
// the custom matchmaking servers (custom-servers.js) and whether a custom match with servers of its own may play on a
// public one, all asked each time. A server's IP is the one its session was registered from (sessions.js sourceAddress).
export function createMatchmaker({ sessions, gatherMs = defaultGatherMs, lateJoin = () => false, regionFallback = () => true, serverRegions = () => [], serverLimits = () => ({}), matchmakingModes = () => ({}),
  matchStartCountdown = () => false, warmupSeconds = () => null, matchStartBuffer = () => defaultMatchStartBufferSec,
  regionHostingIps = () => ({}), customServers = () => [], customFallback = () => false, quiet = false }) {
  const say = quiet ? () => {} : (text) => log("Matchmaking", text);
  const gatherOf = () => {
    const value = typeof gatherMs === "function" ? gatherMs() : gatherMs;
    return Number.isFinite(value) && value >= 0 ? value : defaultGatherMs;
  };
  const secret = crypto.randomBytes(32);
  const sign = (payload) => crypto.createHmac("sha256", secret).update(payload).digest("base64");

  // Registered gameservers waiting for a match: {sessionId, accountId, patterns, maxPlayers, ws, forming}.
  const servers = new Set();
  // Parties waiting for a server: {ticket, ws, size}.
  const waiting = [];
  // Assigned matches by session id: {matchId, bucketId, assigned, parties, players, noFill, maxPlayers}. noFill: the
  // players whose party doesn't fill (Squad Fill on No Fill), late parties' too, whose teams get no bots (CoreV2 #233).
  const matches = new Map();
  // Matches in their warmup that take late parties, by session id: {matchId, bucketId, maxPlayers, players (the
  // accounts connected, as the server reported them), heard, until, parties: [{key, players, size, sent}]}.
  const lateJoins = new Map();
  // Every server whose region counts as having a server, by session id: the registered ones and those hosting a match
  // (they register again once it ends), until their session goes.
  const hosts = new Map();
  const modeByPlaylist = { 2: "solo", 10: "duo", 9: "squad", ...Object.fromEntries(ltms.map(({ playlistId, id }) => [playlistId, id])) };
  // The game's own warmup length by the build (the bucket's netcl) of the servers that reported one: the most time left
  // a warmup report gave while the panel left the length to the game (#160).
  const gameWarmups = new Map();

  // How long after a match's players are sent its bus leaves, as a CoreV2 gameserver runs the warmup (#160): with late
  // joining off the early countdown, as the match's players are all in once they load; on, the whole warmup, the panel's
  // length or the game's as its servers reported it. null when that isn't known yet.
  function warmupAfterSend(bucketId) {
    const panel = warmupSeconds();
    const length = Number.isInteger(panel) && panel > 0 ? panel : gameWarmups.get(parseBucket(bucketId).netcl) ?? null;
    if (!lateJoin()) return Math.min(earlyCountdownSec, length ?? earlyCountdownSec);
    return length;
  }
  // The seconds from Play to the warmup's timer starting (#167): the panel's, or 25.
  function bufferAfterSend() {
    const value = matchStartBuffer();
    return Number.isInteger(value) && value >= 0 ? value : defaultMatchStartBufferSec;
  }

  // Queued's status for a member (#160): the match start countdown and the players connected, for a client that shows
  // them (1.7.2 to 2.4.2) with the panel's setting on, else none.
  function matchStartStatus(member, players, delaySec) {
    if (!matchStartCountdown() || !showsMatchStart(member.ticket.build) || !Number.isFinite(delaySec)) return {};
    return { "ticket.status.numQueued": String(players), "ticket.status.matchStartDelay": String(Math.max(0, Math.ceil(delaySec))) };
  }

  function activeServersCount(region, mode) {
    let count = 0;
    const canRegion = regionOf(region);
    for (const match of matches.values()) {
      const bucket = parseBucket(match.bucketId);
      if (regionOf(bucket.region) === canRegion && modeByPlaylist[bucket.playlistId] === mode) {
        count++;
      }
    }
    for (const server of servers) {
      if (server.forming) {
        const bucket = parseBucket(server.forming.bucketId);
        if (regionOf(bucket.region || server.region) === canRegion && modeByPlaylist[bucket.playlistId] === mode) {
          count++;
        }
      }
    }
    return count;
  }

  function allowsServerAssignment(region, playlistId) {
    const limits = typeof serverLimits === "function" ? serverLimits() : serverLimits;
    if (!limits) return true;
    const mode = modeByPlaylist[playlistId];
    if (!mode) return true;
    const canRegion = regionOf(region) || "NA";
    const regionLim = limits[canRegion];
    if (!regionLim) return true;
    const limit = Number(regionLim[mode]);
    if (!Number.isInteger(limit) || limit <= 0) return true;
    return activeServersCount(canRegion, mode) < limit;
  }
  const sockets = new Set();

  // A party's bucket as a server sees it: in the server's own region when the server takes the bucket's region
  // (Core-Backend #142: with EU and NA the server regions, an EU server takes NA's players into its EU matches).
  function inServerRegion(server, bucketId) {
    if (server.regionField === null) return bucketId;
    const takes = servedRegions(server.region, serverRegions()).has(regionOf(parseBucket(bucketId).region));
    return takes ? withRegion(bucketId, server.regionField) : bucketId;
  }
  const takesBucket = (server, bucketId, options) => server.patterns.some((pattern) => bucketMatches(pattern, inServerRegion(server, bucketId), options));

  // Custom matchmaking servers (#227): whether a server is one, and whether a party's custom match has servers of its own.
  const reserved = (server) => reservationsOf(server.address, customServers()).length > 0;
  const hasOwnServers = (party) => hasCustomServers(party.customKey, party.ticket.partyPlayerIds, customServers());
  // Whether a server may host a party's match in the bucket: it takes the bucket, its IP is one of the match's region's
  // hosting IPs, and it is a public server for a public match, or for a custom match one kept for it (a public one only
  // when no custom server is kept for the match, or the fallback lets it).
  function canHost(server, party, bucketId, options) {
    if (!takesBucket(server, bucketId, options)) return false;
    const matchBucket = server.regionField ? withRegion(bucketId, server.regionField) : bucketId;
    if (!regionAllowsAddress(parseBucket(matchBucket).region, server.address, regionHostingIps())) return false;
    if (!serverTakes(server.address, { customKey: party.customKey, players: party.ticket.partyPlayerIds }, customServers())) return false;
    return !party.customKey || reserved(server) || !hasOwnServers(party) || customFallback();
  }

  // Whether a server registered for the bucket's build and region, that may host the party's match, exists at all. When
  // none does, nobody would ever take the bucket's players: they play in another region instead (Core-Backend #121).
  function hasServerFor(bucketId, party) {
    for (const [sessionId, host] of hosts) {
      if (!sessions.get(sessionId)) hosts.delete(sessionId);
      else if (canHost(host, party, bucketId)) return true;
    }
    return false;
  }

  const sizeOf = (ticket) => Math.max(1, ticket.partyPlayerIds.length);
  // Whether a party fills its team with others. Only the party leader's ticket says (the others' have no
  // player.option.fillTeam); without it the party fills, as the client asks for every playlist but Squads with No Fill.
  const fills = (party) => [party, ...party.members].map((member) => member.ticket.fillTeam).find((fill) => typeof fill === "boolean") ?? true;
  // AssignMatch's teams for a match's parties, or null when the playlist's teams have no room for them all.
  const teamsFor = (parties, bucketId) => formTeams(parties.map((party) => ({ players: party.ticket.partyPlayerIds, fill: fills(party) })),
    playlistTeamsOf(bucketId, parties.find((party) => party.ticket.build)?.ticket.build ?? null));

  function issueTicket(kind, fields) {
    const ticket = { ...fields, kind, ticketId: newId(), issued: Date.now() };
    const payload = Buffer.from(JSON.stringify(ticket)).toString("base64");
    return { ticket, response: { serviceUrl: fields.serviceUrl, ticketType: ticketTypes[kind], payload, signature: sign(payload) } };
  }

  // "Epic-Signed <ticketType> <payload> <signature>": a ticket this backend issued, or null.
  function readTicket(authorization) {
    const [scheme, type, payload, signature] = String(authorization ?? "").split(" ");
    if (scheme !== "Epic-Signed" || !payload || !signature) return null;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    try {
      const ticket = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
      return ticketTypes[ticket.kind] === type ? ticket : null;
    } catch {
      return null;
    }
  }

  // The client keeps the session id from Play and joins it when the service closes the socket with 1000
  // (MatchmakingServiceClient HandleWebSocketConnectionClosed 0x3AB6530: InSessionAssignment with a session id → Finished).
  // It takes SessionAssignment only once it is queued: in InQueue, InReadyCheck or InSessionAssignment (1.9
  // HandleSessionAssignmentStatusUpdate 0x3BEBEA0). After Waiting alone it is WaitingForParty, and a SessionAssignment
  // there is "Invalid state", MMS client error 6, which UFortMatchmakingV2 shows as "Issue communicating with
  // Matchmaking Service." (0x753C50 maps it to MMSCommunicationIssue, 19). So a party sent on the spot, without having
  // queued (late joining, or following its party's earlier member), hears Queued first (Core-Backend #122). start
  // ({players, delaySec}): the match in its warmup the party is sent to, whose countdown its Queued shows (#160).
  function play(party, sessionId, matchId, start = null) {
    for (const member of [party, ...party.members]) {
      member.done = true;
      const shown = start ? matchStartStatus(member, start.players, start.delaySec) : {};
      if (!member.queued || Object.keys(shown).length) {
        member.queued = true;
        member.ws.send(status("Queued", { ticketId: member.ticket.ticketId, queuedPlayers: party.size, estimatedWaitSec: estimatedWaitSec(playDelayMs), status: shown }));
      }
      member.ws.send(status("SessionAssignment", { matchId }));
      setTimeout(() => {
        member.ws.send(message("Play", { matchId, sessionId, joinDelaySec: 1 }));
        member.ws.close(1000);
      }, playDelayMs).unref?.();
    }
  }

  // The match a party's earlier member was sent to.
  function partyMatch(party) {
    const now = Date.now();
    for (const [sessionId, match] of matches) {
      if (!sessions.get(sessionId) || now - match.assigned > partyMemberMs) {
        matches.delete(sessionId);
        continue;
      }
      if (match.parties.has(party.key)) return [sessionId, match];
    }
    return null;
  }

  function place(party) {
    if (party.done || party.ws.closed) return true;

    // A member of a party that was already sent somewhere goes after it.
    const sent = partyMatch(party);
    if (sent) {
      const [sessionId, match] = sent;
      say(`${party.ticket.accountId} follows their party to match ${match.matchId} (session ${sessionId})`);
      play(party, sessionId, match.matchId);
      return true;
    }

    // A party whose region has no server takes a match in any region, the bucket's build and playlist still matching,
    // unless the fallback is off: then it waits for a server of its region, and only its region's matches take it.
    const bucketId = party.ticket.bucketId;
    const noServer = !hasServerFor(bucketId, party);
    const anyRegion = noServer && regionFallback();
    if (noServer !== Boolean(party.noServer) || anyRegion !== Boolean(party.anyRegion)) {
      party.noServer = noServer;
      party.anyRegion = anyRegion;
      if (noServer) say(`No server is registered for ${regionName(regionOf(parseBucket(bucketId).region))} (bucket ${bucketId}): ` +
        `${party.ticket.accountId} ${anyRegion ? "queues for a server in any region" : "waits for one (the region fallback is off)"}`);
    }
    const key = bucketKey(bucketId, { anyRegion });

    // A match still in its warmup takes the party, unless the party's other members are already in a forming match.
    const late = ![...servers].some((server) => server.forming?.parties.some((entry) => entry.key === party.key)) && lateJoinFor(party, key, anyRegion);
    if (late) {
      joinLate(party, ...late);
      return true;
    }

    for (const server of servers) {
      const forming = server.forming;
      // The party's other members' tickets join the party already in the match.
      const same = forming?.parties.find((entry) => entry.key === party.key);
      if (same) {
        same.members.push(party);
        return true;
      }
      if (forming && forming.customKey === party.customKey && bucketKey(forming.bucketId, { anyRegion }) === bucketKey(inServerRegion(server, bucketId), { anyRegion })
        && forming.players + party.size <= server.maxPlayers
        && teamsFor([...forming.parties, party], forming.bucketId)) {
        forming.parties.push(party);
        forming.players += party.size;
        if (anyRegion) say(`${party.ticket.accountId} joins match ${forming.matchId} in ${regionName(server.region)} (bucket ${forming.bucketId})`);
        if (forming.players >= server.maxPlayers) assign(server);
        return true;
      }
    }
    // A custom match takes a server kept for custom matches first (#227).
    const free = party.customKey ? [...servers].sort((a, b) => reserved(b) - reserved(a)) : servers;
    for (const server of free) {
      if (server.forming || party.size > server.maxPlayers) continue;
      if (!canHost(server, party, bucketId, { anyRegion })) continue;
      // The match is the server's region's: AssignMatch's bucketId names it as the server does (the server takes its
      // MatchmakingRegionId from it, 1.7.2 0x6D78E0), and its region's players join it.
      const matchBucket = server.regionField ? withRegion(bucketId, server.regionField) : bucketId;
      const bucket = parseBucket(matchBucket);
      if (!allowsServerAssignment(server.regionField || bucket.region, bucket.playlistId)) continue;
      server.forming = { matchId: newId(), bucketId: matchBucket, customKey: party.customKey, parties: [party], players: party.size, started: Date.now(), gatherMs: gatherOf() };
      server.forming.timer = setTimeout(() => assign(server), server.forming.gatherMs);
      server.forming.timer.unref?.();
      say(`Match ${server.forming.matchId} forms on session ${server.sessionId} for bucket ${matchBucket}` +
        (party.customKey ? `, custom key ${party.customKey}` : "") + (matchBucket === bucketId ? "" : ` (${party.ticket.accountId} queued for ${bucketId})`));
      return true;
    }
    return false;
  }

  // Which queue a party is in: the match it is in until that match is assigned, else its own bucket's, with the
  // bucket's region in any spelling.
  function queueKey(party) {
    for (const server of servers) {
      const forming = server.forming;
      if (forming && !forming.sent && forming.parties.includes(party)) return queueOf(forming.bucketId, forming.customKey);
    }
    return queueOf(party.ticket.bucketId, party.customKey);
  }

  // The parties still in a queue: waiting for a server, or in a match that hasn't been assigned yet.
  function queuedParties(key) {
    const forming = [...servers].flatMap((server) => (server.forming && !server.forming.sent ? server.forming.parties : []));
    return [...waiting, ...forming].filter((party) => !party.ws.closed && queueKey(party) === key);
  }

  // The match a party is in while it forms, or null.
  const formingOf = (party) => [...servers].map((server) => server.forming).find((forming) => forming && !forming.sent && forming.parties.includes(party)) ?? null;
  // How long until a party is sent to its match: the rest of its forming match's gather time, or 0 while it waits for a
  // free server.
  function remainingMs(party) {
    const forming = formingOf(party);
    return forming ? forming.started + forming.gatherMs + playDelayMs - Date.now() : 0;
  }

  // Queued {queuedPlayers, estimatedWaitSec}: everyone in the queue (queueKey), sent again to each of them whenever it
  // changes, and every second while a match forms so the ETA counts down. A party playing in another region hears the
  // queue of the match it joined. A party in a forming match also hears its countdown (#160): the match's players, and
  // how long until its bus leaves, the time until they are sent, their trip to the island (#167) and the warmup after it.
  function announceQueue(key) {
    const parties = queuedParties(key);
    // A party's members each queue with their own ticket: the party counts once.
    const queuedPlayers = [...new Map(parties.map((party) => [party.key, party.size])).values()].reduce((sum, size) => sum + size, 0);
    for (const party of parties) {
      const remaining = remainingMs(party);
      const wait = estimatedWaitSec(remaining);
      const forming = formingOf(party);
      const start = forming ? { players: forming.players, delaySec: Math.ceil(Math.max(0, remaining) / 1000) + bufferAfterSend() + (warmupAfterSend(forming.bucketId) ?? 0) } : null;
      for (const member of [party, ...party.members]) {
        if (member.done || member.ws.closed) continue;
        member.queued = true;
        const shown = start ? matchStartStatus(member, start.players, start.delaySec) : {};
        member.ws.send(status("Queued", { ticketId: member.ticket.ticketId, queuedPlayers, estimatedWaitSec: wait, status: shown }));
      }
    }
  }

  const countdown = setInterval(() => {
    // A region whose last server went away (its session ended) sends its waiting parties elsewhere.
    if (waiting.length) placeWaiting();
    const forming = new Set([...servers].filter((server) => server.forming && !server.forming.sent).map((server) => queueOf(server.forming.bucketId, server.forming.customKey)));
    for (const key of forming) announceQueue(key);
  }, 1000);
  countdown.unref?.();

  // Parties placed in a forming match hear their ETA straight away.
  function placeWaiting() {
    const placed = new Set();
    for (let index = 0; index < waiting.length;) {
      if (place(waiting[index])) placed.add(queueKey(waiting.splice(index, 1)[0]));
      else index++;
    }
    for (const key of placed) announceQueue(key);
  }

  function assign(server) {
    const forming = server.forming;
    if (!forming || forming.sent) return;
    clearTimeout(forming.timer);
    forming.parties = forming.parties.filter((party) => !party.ws.closed);
    if (!forming.parties.length) {
      server.forming = null;
      return;
    }
    forming.sent = true;
    // The parties fitted the playlist's teams as they joined; should a member's Squad Fill choice, heard later, make them
    // not fit, each party is a team of its own.
    const teams = teamsFor(forming.parties, forming.bucketId) ?? forming.parties.map((party) => [party.ticket.partyPlayerIds]);
    say(`Assigning match ${forming.matchId} (${forming.players} players in ${teams.length} teams, bucket ${forming.bucketId}) to session ${server.sessionId}`);
    // In the format of the server's build, the one its session ticket was asked from (a netcl isn't always a changelist).
    const options = forming.customKey ? { ...matchOptions, "match.option.customKey": forming.customKey } : matchOptions;
    server.ws.send(message("AssignMatch", { matchId: forming.matchId, bucketId: assignmentBucket(forming.bucketId, server.build), matchOptions: options, teams }));
  }

  function onAssignResult(server, payload) {
    const forming = server.forming;
    if (!forming || payload?.matchId !== forming.matchId) return;
    if (payload.result === "working") return;
    if (payload.result !== "ready") {
      say(`Session ${server.sessionId} refused match ${forming.matchId} (${payload.result}); its parties queue again`);
      servers.delete(server);
      hosts.delete(server.sessionId);
      server.ws.close(1000);
      waiting.unshift(...forming.parties);
      placeWaiting();
      for (const key of new Set(forming.parties.map(queueKey))) announceQueue(key);
      return;
    }
    servers.delete(server);
    // The server starts the match on the socket's normal close (status 1000).
    server.ws.close(1000);
    matches.set(server.sessionId, { matchId: forming.matchId, bucketId: forming.bucketId, customKey: forming.customKey ?? null, assigned: Date.now(),
      parties: new Set(forming.parties.map((party) => party.key)), players: new Set(forming.parties.flatMap((party) => party.ticket.partyPlayerIds)),
      noFill: new Set(forming.parties.filter((party) => !fills(party)).flatMap((party) => party.ticket.partyPlayerIds)), maxPlayers: server.maxPlayers });
    for (const party of forming.parties) play(party, server.sessionId, forming.matchId);
    placeWaiting();
  }

  // The players sent to a match in its warmup who haven't connected yet (for lateArrivalMs).
  const pendingOf = (open, now) => open.parties.filter((entry) => now - entry.sent < lateArrivalMs).flatMap((entry) => entry.players).filter((id) => !open.players.has(id)).length;

  // The match in its warmup a party goes to: the one its party's earlier member was sent to, else (late joining on) one
  // for the party's queue with room and enough of its warmup left. [sessionId, open] or null.
  function lateJoinFor(party, key, anyRegion) {
    const now = Date.now();
    for (const [sessionId, open] of lateJoins) {
      if (!sessions.get(sessionId) || now - open.heard > lateJoinStaleMs) lateJoins.delete(sessionId);
      else if (open.parties.some((entry) => entry.key === party.key)) return [sessionId, open];
    }
    if (!lateJoin()) return null;
    for (const [sessionId, open] of lateJoins) {
      const pending = pendingOf(open, now);
      // The match's server (a host until its session goes) takes its server regions' parties (Core-Backend #142).
      const host = hosts.get(sessionId);
      const wanted = host ? bucketKey(inServerRegion(host, party.ticket.bucketId), { anyRegion }) : key;
      if (open.until - now >= lateJoinMarginMs && (open.customKey ?? null) === party.customKey && bucketKey(open.bucketId, { anyRegion }) === wanted
        && open.players.size + pending + party.size <= open.maxPlayers) {
        return [sessionId, open];
      }
    }
    return null;
  }

  function joinLate(party, sessionId, open) {
    if (open.parties.some((entry) => entry.key === party.key)) {
      say(`${party.ticket.accountId} follows their party to match ${open.matchId} in its warmup (session ${sessionId})`);
    } else {
      open.parties.push({ key: party.key, players: [...party.ticket.partyPlayerIds], size: party.size, sent: Date.now() });
      say(`${party.ticket.accountId} (party of ${party.size}) joins match ${open.matchId} in its warmup, ${Math.round((open.until - Date.now()) / 1000)} s left (session ${sessionId})`);
    }
    matches.get(sessionId)?.parties.add(party.key);
    if (!fills(party)) {
      for (const id of party.ticket.partyPlayerIds) matches.get(sessionId)?.noFill?.add(id);
    }
    // Its countdown is the warmup's time left, as the server reported it: what the island's timer shows as it loads in
    // (#160). Its players connected are the match's and those on their way, this party among them.
    const now = Date.now();
    play(party, sessionId, open.matchId, { players: open.players.size + pendingOf(open, now), delaySec: (open.until - now) / 1000 });
  }

  // The session of the match whose players these are: one taking late parties, else one this service assigned.
  function matchSessionOf(accountIds) {
    const ids = new Set(accountIds);
    for (const [sessionId, open] of lateJoins) {
      if ([...open.players, ...open.parties.flatMap((entry) => entry.players)].some((id) => ids.has(id))) return sessionId;
    }
    for (const [sessionId, match] of matches) {
      if ([...match.players].some((id) => ids.has(id))) return sessionId;
    }
    return null;
  }

  // A Core gameserver's report during its match's warmup: the accounts connected to it, whether it takes late parties
  // and how long its warmup has left. {sessionId, open, maxPlayers, parties: [[accountId]]} (the late parties sent there,
  // for the server to keep each party on one team, and noFill: the match's players whose party doesn't fill, CoreV2 #233),
  // or null for a match this service doesn't know.
  function warmup({ accountIds, open, secondsLeft }) {
    const sessionId = matchSessionOf(accountIds);
    if (!sessionId || !sessions.get(sessionId)) return null;
    const match = matches.get(sessionId);
    let entry = lateJoins.get(sessionId);
    const noFill = [...(match?.noFill ?? [])];
    // The game's warmup length, for the countdowns of the next matches on servers of this build (#160).
    const reportedBucket = match?.bucketId ?? entry?.bucketId;
    if (reportedBucket && warmupSeconds() === null && secondsLeft > 0) {
      const netcl = parseBucket(reportedBucket).netcl;
      gameWarmups.set(netcl, Math.max(gameWarmups.get(netcl) ?? 0, Math.ceil(secondsLeft)));
    }
    if (!open || !lateJoin() || !(secondsLeft > 0)) {
      if (lateJoins.delete(sessionId)) say(`Match ${entry.matchId} (session ${sessionId}) takes no more parties`);
      return { sessionId, open: false, maxPlayers: entry?.maxPlayers ?? match?.maxPlayers ?? null, parties: entry?.parties.map((party) => party.players) ?? [], noFill };
    }
    if (!entry) {
      if (!match) return { sessionId, open: false, maxPlayers: null, parties: [], noFill };
      const session = sessions.get(sessionId);
      entry = { matchId: match.matchId, bucketId: match.bucketId, customKey: match.customKey ?? null, maxPlayers: match.maxPlayers || session.maxPublicPlayers + session.maxPrivatePlayers,
        parties: [] };
      lateJoins.set(sessionId, entry);
      say(`Match ${entry.matchId} (session ${sessionId}, bucket ${entry.bucketId}) takes late parties during its warmup, up to ${entry.maxPlayers} players`);
    }
    const now = Date.now();
    entry.players = new Set(accountIds);
    entry.heard = now;
    entry.until = now + secondsLeft * 1000;
    placeWaiting();
    return { sessionId, open: true, maxPlayers: entry.maxPlayers, parties: entry.parties.map((party) => party.players), noFill };
  }

  // Whether a custom key is open (#186): a party allowed to use keys queues with it, waiting for a server or in its forming
  // match, or its match takes late parties during its warmup.
  function keyOpen(customKey) {
    const forming = [...servers].flatMap((server) => (server.forming && !server.forming.sent ? server.forming.parties : []));
    if ([...waiting, ...forming].some((party) => !party.ws.closed && party.customKey === customKey && party.ticket.customKeyHost)) return true;
    const now = Date.now();
    return lateJoin() && [...lateJoins].some(([sessionId, open]) => open.customKey === customKey && sessions.get(sessionId)
      && now - open.heard <= lateJoinStaleMs && open.until - now >= lateJoinMarginMs);
  }

  function acceptPlayer(ws, ticket) {
    if (ticket.customKey && !ticket.customKeyHost && !keyOpen(ticket.customKey)) {
      say(`${ticket.accountId} queued with custom key ${ticket.customKey}, which no allowed player has opened: refused (${customKeyNotSupported})`);
      return ws.close(customKeyRefusedCode, customKeyNotSupported);
    }
    // A party's members may have picked different regions: the party is the same in any of them.
    const party = { ticket, ws, size: sizeOf(ticket), members: [],
      key: `${bucketKey(ticket.bucketId, { anyRegion: true })}|${[...ticket.partyPlayerIds].sort().join(",")}|${ticket.customKey ?? ""}`,
      customKey: ticket.customKey || null };
    ws.on("close", () => {
      const queue = queueKey(party);
      ws.closed = true;
      const index = waiting.indexOf(party);
      if (index >= 0) waiting.splice(index, 1);
      for (const server of servers) {
        const forming = server.forming;
        if (!forming || forming.sent || !forming.parties.includes(party)) continue;
        forming.parties = forming.parties.filter((entry) => entry !== party);
        forming.players -= party.size;
        if (!forming.parties.length) {
          clearTimeout(forming.timer);
          server.forming = null;
        }
      }
      if (!party.done) {
        say(`${ticket.accountId} left the queue for bucket ${ticket.bucketId}`);
        announceQueue(queue);
      }
    });
    ws.send(status("Connecting"));
    ws.send(status("Waiting", { totalPlayers: party.size, connectedPlayers: party.size }));
    say(`${ticket.accountId} (party of ${party.size}) queued for bucket ${ticket.bucketId}${party.customKey ? ` with custom key ${party.customKey}` : ""}`);
    if (!place(party)) waiting.push(party);
    if (!party.done) announceQueue(queueKey(party));
  }

  function acceptServer(ws, ticket) {
    const regionField = serverRegion(ticket.bucketIds);
    const server = { sessionId: ticket.sessionId, accountId: ticket.accountId, patterns: ticket.bucketIds, maxPlayers: ticket.maxPlayers, ws,
      build: Number(ticket.build) || null, forming: null, regionField, region: regionField === null ? "any region" : regionOf(regionField),
      // The IP its session was registered from (#227).
      address: sessions.get(ticket.sessionId)?.sourceAddress ?? "" };
    // Its region's hosting IPs (#227), checked again here as the admin panel may have changed them since its ticket.
    if (regionField !== null && !regionAllowsAddress(regionField, server.address, regionHostingIps())) {
      say(`Refused session ${server.sessionId} for ${server.region}: ${server.address || "its IP"} isn't one of ${server.region}'s hosting IPs (admin panel, Matchmaking, Server Regions)`);
      ws.send(message("Error", { errorCode: "errors.com.epicgames.common.missing_permission" }));
      return ws.close(1008);
    }
    servers.add(server);
    hosts.set(server.sessionId, server);
    ws.on("message", (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }
      if (parsed?.name === "AssignMatchResult") onAssignResult(server, parsed.payload);
    });
    ws.on("close", () => {
      ws.closed = true;
      if (!servers.delete(server)) return;
      hosts.delete(server.sessionId);
      say(`Session ${server.sessionId} left the matchmaking service`);
      if (server.forming && !server.forming.sent) {
        clearTimeout(server.forming.timer);
        waiting.unshift(...server.forming.parties);
      }
      server.forming = null;
      placeWaiting();
    });
    ws.send(message("Registered", {}));
    say(`Session ${server.sessionId} registered for ${server.patterns.join(", ")} (${regionName(server.region)}, ${server.maxPlayers} players)` +
      (reserved(server) ? `, a custom matchmaking server (${server.address})` : ""));
    placeWaiting();
  }

  function handleUpgrade(req, socket, head) {
    const ticket = readTicket(req.headers.authorization);
    const ws = acceptWebSocket(req, socket, head);
    if (!ws) return;
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    if (!ticket) {
      say("Refused a matchmaking connection with an unknown ticket");
      ws.send(message("Error", { errorCode: "errors.com.epicgames.common.authentication.authentication_failed" }));
      return ws.close(1008);
    }
    ws.on("message", (data) => {
      if (data.toString("utf8") === "ping") ws.send("pong");
    });
    if (ticket.kind === "session") acceptServer(ws, ticket);
    else acceptPlayer(ws, ticket);
  }

  return {
    playerTicket: (fields) => issueTicket("player", fields),
    sessionTicket: (fields) => issueTicket("session", fields),
    readTicket,
    isMatchmakingUpgrade: (req) => String(req.headers.authorization ?? "").startsWith("Epic-Signed "),
    handleUpgrade,
    warmup,
    closeAll() {
      clearInterval(countdown);
      for (const ws of sockets) ws.close(1001);
    },
    // Core's: what the launcher and the admin panel can show.
    state: () => ({ servers: [...servers].map(({ sessionId, maxPlayers, forming, region }) => ({ sessionId, region, maxPlayers, forming: forming?.matchId ?? null })),
      waiting: waiting.length, matches: [...matches].map(([sessionId, { matchId, bucketId, customKey }]) => ({ sessionId, matchId, bucketId, customKey })),
      lateJoin: [...lateJoins].map(([sessionId, { matchId, players, maxPlayers, until }]) => ({ sessionId, matchId, players: players.size, maxPlayers,
        secondsLeft: Math.max(0, Math.round((until - Date.now()) / 1000)) })) })
  };
}
