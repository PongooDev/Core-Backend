import crypto from "node:crypto";
import { log } from "../log.js";
import { acceptWebSocket } from "../stomp/websocket.js";
import { regionName, regionOf } from "./regions.js";

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
// Each playlist's team size, from the server's own table (1.7.2 ConfigureForMatchAssignment 0x751960, 1.8
// GetMaxTeamInfoForPlaylist 0x79B690, the same): Solo 2 is 100 teams of 1, Duo 10 100 of 2, Squad 9 100 of 4. Playlists
// 0 (1×4), 1 (2×5) and 99 (1×1) aren't Battle Royale's.
const teamSizes = { 0: 4, 1: 5, 2: 1, 9: 4, 10: 2, 99: 1 };
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

export function parseBucket(bucketId) {
  const parts = String(bucketId ?? "").split(":");
  const playlistId = Number(parts[3]);
  return { netcl: parts[0], region: parts[2] ?? "", playlistId: Number.isInteger(playlistId) ? playlistId : null, parts };
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

// The team size of a bucket's playlist, or null for one the server doesn't know.
export const teamSizeOf = (bucketId) => teamSizes[parseBucket(bucketId).playlistId] ?? null;

// AssignMatch's teams ([team][party][accountId]) from a match's parties, [{players, fill}]: a party that fills
// (player.option.fillTeam, the matchmaking panel's Squad Fill) shares a team with other such parties, biggest first so
// the smaller ones fill the gaps; one that doesn't fill plays alone (Core-Backend #78). The server makes one beacon
// reservation per party on its team's index (ConfigureForMatchAssignment sets the Manual team assignment method, so
// GetTeamAssignment 0x391AD10 keeps it), and PickTeam 0x3F6500 gives a joining player their reservation's team ("PickTeam
// for [%s] used beacon value [HumanPvP_Team1]" for team 0). A party bigger than a team is split into teams: no team
// would have room for its reservation and the server would refuse the match.
export function formTeams(parties, teamSize) {
  if (!teamSize) return parties.map((party) => [party.players]);
  const pieces = parties.flatMap((party) => {
    const chunks = [];
    for (let index = 0; index < party.players.length; index += teamSize) chunks.push(party.players.slice(index, index + teamSize));
    return chunks.map((players) => ({ players, fill: party.fill }));
  });
  const teams = [];
  for (const piece of pieces.sort((a, b) => b.players.length - a.players.length)) {
    const team = piece.fill && teams.find((entry) => entry.fill && entry.players + piece.players.length <= teamSize);
    if (team) {
      team.parties.push(piece.players);
      team.players += piece.players.length;
    } else {
      teams.push({ fill: piece.fill, parties: [piece.players], players: piece.players.length });
    }
  }
  return teams.map((team) => team.parties);
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
// matches in their warmup take more parties, asked each time.
export function createMatchmaker({ sessions, gatherMs = defaultGatherMs, lateJoin = () => false, quiet = false }) {
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
  // Assigned matches by session id: {matchId, bucketId, assigned, parties, players, maxPlayers}.
  const matches = new Map();
  // Matches in their warmup that take late parties, by session id: {matchId, bucketId, maxPlayers, players (the
  // accounts connected, as the server reported them), heard, until, parties: [{key, players, size, sent}]}.
  const lateJoins = new Map();
  // Every server whose region counts as having a server, by session id: the registered ones and those hosting a match
  // (they register again once it ends), until their session goes.
  const hosts = new Map();
  const sockets = new Set();

  // Whether a server registered for the bucket's build and region exists at all. When none does, nobody would ever
  // take the bucket's players: they play in another region instead (Core-Backend #121).
  function hasServerFor(bucketId) {
    for (const [sessionId, host] of hosts) {
      if (!sessions.get(sessionId)) hosts.delete(sessionId);
      else if (host.patterns.some((pattern) => bucketMatches(pattern, bucketId))) return true;
    }
    return false;
  }

  const sizeOf = (ticket) => Math.max(1, ticket.partyPlayerIds.length);
  // Whether a party fills its team with others. Only the party leader's ticket says (the others' have no
  // player.option.fillTeam); without it the party fills, as the client asks for every playlist but Squads with No Fill.
  const fills = (party) => [party, ...party.members].map((member) => member.ticket.fillTeam).find((fill) => typeof fill === "boolean") ?? true;

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
  // queued (late joining, or following its party's earlier member), hears Queued first (Core-Backend #122).
  function play(party, sessionId, matchId) {
    for (const member of [party, ...party.members]) {
      member.done = true;
      if (!member.queued) {
        member.queued = true;
        member.ws.send(status("Queued", { ticketId: member.ticket.ticketId, queuedPlayers: party.size, estimatedWaitSec: estimatedWaitSec(playDelayMs), status: {} }));
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

    // A party whose region has no server takes a match in any region, the bucket's build and playlist still matching.
    const bucketId = party.ticket.bucketId;
    const anyRegion = !hasServerFor(bucketId);
    if (anyRegion !== Boolean(party.anyRegion)) {
      party.anyRegion = anyRegion;
      if (anyRegion) say(`No server is registered for ${regionName(regionOf(parseBucket(bucketId).region))} (bucket ${bucketId}): ` +
        `${party.ticket.accountId} queues for a server in any region`);
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
      if (forming && bucketKey(forming.bucketId, { anyRegion }) === key && forming.players + party.size <= server.maxPlayers) {
        forming.parties.push(party);
        forming.players += party.size;
        if (anyRegion) say(`${party.ticket.accountId} joins match ${forming.matchId} in ${regionName(server.region)} (bucket ${forming.bucketId})`);
        if (forming.players >= server.maxPlayers) assign(server);
        return true;
      }
    }
    for (const server of servers) {
      if (server.forming || party.size > server.maxPlayers) continue;
      if (!server.patterns.some((pattern) => bucketMatches(pattern, bucketId, { anyRegion }))) continue;
      // The match is the server's region's: AssignMatch's bucketId names it as the server does (the server takes its
      // MatchmakingRegionId from it, 1.7.2 0x6D78E0), and its region's players join it.
      const matchBucket = server.regionField ? withRegion(bucketId, server.regionField) : bucketId;
      server.forming = { matchId: newId(), bucketId: matchBucket, parties: [party], players: party.size, started: Date.now(), gatherMs: gatherOf() };
      server.forming.timer = setTimeout(() => assign(server), server.forming.gatherMs);
      server.forming.timer.unref?.();
      say(`Match ${server.forming.matchId} forms on session ${server.sessionId} for bucket ${matchBucket}` +
        (matchBucket === bucketId ? "" : ` (${party.ticket.accountId} queued for ${bucketId})`));
      return true;
    }
    return false;
  }

  // Which queue a party is in: the match it is in until that match is assigned, else its own bucket's, with the
  // bucket's region in any spelling.
  function queueKey(party) {
    for (const server of servers) {
      const forming = server.forming;
      if (forming && !forming.sent && forming.parties.includes(party)) return bucketKey(forming.bucketId);
    }
    return bucketKey(party.ticket.bucketId);
  }

  // The parties still in a queue: waiting for a server, or in a match that hasn't been assigned yet.
  function queuedParties(key) {
    const forming = [...servers].flatMap((server) => (server.forming && !server.forming.sent ? server.forming.parties : []));
    return [...waiting, ...forming].filter((party) => !party.ws.closed && queueKey(party) === key);
  }

  // How long until a party is sent to its match: the rest of its forming match's gather time, or 0 while it waits for a
  // free server.
  function remainingMs(party) {
    for (const server of servers) {
      const forming = server.forming;
      if (forming && !forming.sent && forming.parties.includes(party)) return forming.started + forming.gatherMs + playDelayMs - Date.now();
    }
    return 0;
  }

  // Queued {queuedPlayers, estimatedWaitSec}: everyone in the queue (queueKey), sent again to each of them whenever it
  // changes, and every second while a match forms so the ETA counts down. A party playing in another region hears the
  // queue of the match it joined.
  function announceQueue(key) {
    const parties = queuedParties(key);
    // A party's members each queue with their own ticket: the party counts once.
    const queuedPlayers = [...new Map(parties.map((party) => [party.key, party.size])).values()].reduce((sum, size) => sum + size, 0);
    for (const party of parties) {
      const wait = estimatedWaitSec(remainingMs(party));
      for (const member of [party, ...party.members]) {
        if (member.done || member.ws.closed) continue;
        member.queued = true;
        member.ws.send(status("Queued", { ticketId: member.ticket.ticketId, queuedPlayers, estimatedWaitSec: wait, status: {} }));
      }
    }
  }

  const countdown = setInterval(() => {
    // A region whose last server went away (its session ended) sends its waiting parties elsewhere.
    if (waiting.length) placeWaiting();
    const forming = new Set([...servers].filter((server) => server.forming && !server.forming.sent).map((server) => bucketKey(server.forming.bucketId)));
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
    const teams = formTeams(forming.parties.map((party) => ({ players: party.ticket.partyPlayerIds, fill: fills(party) })), teamSizeOf(forming.bucketId));
    say(`Assigning match ${forming.matchId} (${forming.players} players in ${teams.length} teams, bucket ${forming.bucketId}) to session ${server.sessionId}`);
    server.ws.send(message("AssignMatch", { matchId: forming.matchId, bucketId: forming.bucketId, matchOptions, teams }));
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
    matches.set(server.sessionId, { matchId: forming.matchId, bucketId: forming.bucketId, assigned: Date.now(),
      parties: new Set(forming.parties.map((party) => party.key)), players: new Set(forming.parties.flatMap((party) => party.ticket.partyPlayerIds)),
      maxPlayers: server.maxPlayers });
    for (const party of forming.parties) play(party, server.sessionId, forming.matchId);
    placeWaiting();
  }

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
      const pending = open.parties.filter((entry) => now - entry.sent < lateArrivalMs).flatMap((entry) => entry.players).filter((id) => !open.players.has(id)).length;
      if (open.until - now >= lateJoinMarginMs && bucketKey(open.bucketId, { anyRegion }) === key && open.players.size + pending + party.size <= open.maxPlayers) {
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
    play(party, sessionId, open.matchId);
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
  // for the server to keep each party on one team), or null for a match this service doesn't know.
  function warmup({ accountIds, open, secondsLeft }) {
    const sessionId = matchSessionOf(accountIds);
    if (!sessionId || !sessions.get(sessionId)) return null;
    const match = matches.get(sessionId);
    let entry = lateJoins.get(sessionId);
    if (!open || !lateJoin() || !(secondsLeft > 0)) {
      if (lateJoins.delete(sessionId)) say(`Match ${entry.matchId} (session ${sessionId}) takes no more parties`);
      return { sessionId, open: false, maxPlayers: entry?.maxPlayers ?? match?.maxPlayers ?? null, parties: entry?.parties.map((party) => party.players) ?? [] };
    }
    if (!entry) {
      if (!match) return { sessionId, open: false, maxPlayers: null, parties: [] };
      const session = sessions.get(sessionId);
      entry = { matchId: match.matchId, bucketId: match.bucketId, maxPlayers: match.maxPlayers || session.maxPublicPlayers + session.maxPrivatePlayers, parties: [] };
      lateJoins.set(sessionId, entry);
      say(`Match ${entry.matchId} (session ${sessionId}, bucket ${entry.bucketId}) takes late parties during its warmup, up to ${entry.maxPlayers} players`);
    }
    const now = Date.now();
    entry.players = new Set(accountIds);
    entry.heard = now;
    entry.until = now + secondsLeft * 1000;
    placeWaiting();
    return { sessionId, open: true, maxPlayers: entry.maxPlayers, parties: entry.parties.map((party) => party.players) };
  }

  function acceptPlayer(ws, ticket) {
    // A party's members may have picked different regions: the party is the same in any of them.
    const party = { ticket, ws, size: sizeOf(ticket), members: [],
      key: `${bucketKey(ticket.bucketId, { anyRegion: true })}|${[...ticket.partyPlayerIds].sort().join(",")}` };
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
    say(`${ticket.accountId} (party of ${party.size}) queued for bucket ${ticket.bucketId}`);
    if (!place(party)) waiting.push(party);
    if (!party.done) announceQueue(queueKey(party));
  }

  function acceptServer(ws, ticket) {
    const regionField = serverRegion(ticket.bucketIds);
    const server = { sessionId: ticket.sessionId, accountId: ticket.accountId, patterns: ticket.bucketIds, maxPlayers: ticket.maxPlayers, ws,
      forming: null, regionField, region: regionField === null ? "any region" : regionOf(regionField) };
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
    say(`Session ${server.sessionId} registered for ${server.patterns.join(", ")} (${regionName(server.region)}, ${server.maxPlayers} players)`);
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
      waiting: waiting.length, matches: [...matches].map(([sessionId, { matchId, bucketId }]) => ({ sessionId, matchId, bucketId })),
      lateJoin: [...lateJoins].map(([sessionId, { matchId, players, maxPlayers, until }]) => ({ sessionId, matchId, players: players.size, maxPlayers,
        secondsLeft: Math.max(0, Math.round((until - Date.now()) / 1000)) })) })
  };
}
