import crypto from "node:crypto";
import { log } from "../log.js";
import { acceptWebSocket } from "../stomp/websocket.js";

// Battle Royale's matchmaking service (MMS, from 1.7.2), both sides (Core-Docs Athena-Matchmaking-1.7.2.md and
// Athena-Boot-1.7.2.md §1 C).
//
// Players (UFortMatchmakingV2, MatchmakingServiceClient): a ticket from
// /fortnite/api/game/v2/matchmakingservice/ticket/player/{id}?partyPlayerIds=&bucketId=<netcl>:0:<region>:<playlistId>,
// then a WebSocket with "Authorization: Epic-Signed <ticketType> <payload> <signature>" that gets StatusUpdate
// messages (payload.state Connecting, Waiting {totalPlayers, connectedPlayers}, Queued {ticketId, queuedPlayers,
// estimatedWaitSec, status}, SessionAssignment {matchId}) and then Play {matchId, sessionId}. The client finds that
// session and travels straight to its game port.
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
// full" for anyone else), so friends who queue a few seconds apart still share a match.
export const defaultGatherMs = 10_000;
// How long a party's other members (each with their own ticket) are sent after the first.
const partyMemberMs = 2 * 60 * 1000;
const playDelayMs = 1000;
// The server's warmup starts with its first player, the others join during it (WarmupRequiredPlayerCount, read by
// OnGivenMatchAssignment 0x3F3CD0).
const matchOptions = { "match.option.warmupRequiredPlayerCount": "1" };

export function parseBucket(bucketId) {
  const parts = String(bucketId ?? "").split(":");
  const playlistId = Number(parts[3]);
  return { netcl: parts[0], region: parts[2] ?? "", playlistId: Number.isInteger(playlistId) ? playlistId : null, parts };
}

// A server's bucket pattern ("858118782:0:NA:*") against a player's bucket ("858118782:0:NA:10"): field by field, "*"
// matching anything, with the same number of fields.
export function bucketMatches(pattern, bucketId) {
  const want = String(pattern).split(":");
  const have = String(bucketId).split(":");
  return want.length === have.length && want.every((field, index) => field === "*" || field === have[index]);
}

const message = (name, payload) => JSON.stringify({ name, payload });
const status = (state, fields = {}) => message("StatusUpdate", { ...fields, state });
const newId = () => crypto.randomUUID().replaceAll("-", "");

export function createMatchmaker({ sessions, gatherMs = defaultGatherMs, quiet = false }) {
  const say = quiet ? () => {} : (text) => log("Matchmaking", text);
  const secret = crypto.randomBytes(32);
  const sign = (payload) => crypto.createHmac("sha256", secret).update(payload).digest("base64");

  // Registered gameservers waiting for a match: {sessionId, accountId, patterns, maxPlayers, ws, forming}.
  const servers = new Set();
  // Parties waiting for a server: {ticket, ws, size}.
  const waiting = [];
  // Assigned matches by session id: {matchId, bucketId, assigned, parties}.
  const matches = new Map();
  const sockets = new Set();

  const sizeOf = (ticket) => Math.max(1, ticket.partyPlayerIds.length);

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

  function play(party, sessionId, matchId) {
    for (const member of [party, ...party.members]) {
      member.done = true;
      member.ws.send(status("SessionAssignment", { matchId }));
      setTimeout(() => member.ws.send(message("Play", { matchId, sessionId, joinDelaySec: 1 })), playDelayMs).unref?.();
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

    for (const server of servers) {
      const forming = server.forming;
      // The party's other members' tickets join the party already in the match.
      const same = forming?.parties.find((entry) => entry.key === party.key);
      if (same) {
        same.members.push(party);
        return true;
      }
      if (forming && forming.bucketId === party.ticket.bucketId && forming.players + party.size <= server.maxPlayers) {
        forming.parties.push(party);
        forming.players += party.size;
        if (forming.players >= server.maxPlayers) assign(server);
        return true;
      }
    }
    for (const server of servers) {
      if (server.forming || party.size > server.maxPlayers) continue;
      if (!server.patterns.some((pattern) => bucketMatches(pattern, party.ticket.bucketId))) continue;
      server.forming = { matchId: newId(), bucketId: party.ticket.bucketId, parties: [party], players: party.size };
      server.forming.timer = setTimeout(() => assign(server), gatherMs);
      server.forming.timer.unref?.();
      say(`Match ${server.forming.matchId} forms on session ${server.sessionId} for bucket ${party.ticket.bucketId}`);
      return true;
    }
    return false;
  }

  function placeWaiting() {
    for (let index = 0; index < waiting.length;) {
      if (place(waiting[index])) waiting.splice(index, 1);
      else index++;
    }
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
    const teams = forming.parties.map((party) => [party.ticket.partyPlayerIds]);
    say(`Assigning match ${forming.matchId} (${forming.players} players, bucket ${forming.bucketId}) to session ${server.sessionId}`);
    server.ws.send(message("AssignMatch", { matchId: forming.matchId, bucketId: forming.bucketId, matchOptions, teams }));
  }

  function onAssignResult(server, payload) {
    const forming = server.forming;
    if (!forming || payload?.matchId !== forming.matchId) return;
    if (payload.result === "working") return;
    if (payload.result !== "ready") {
      say(`Session ${server.sessionId} refused match ${forming.matchId} (${payload.result}); its parties queue again`);
      servers.delete(server);
      server.ws.close(1000);
      waiting.unshift(...forming.parties);
      placeWaiting();
      return;
    }
    servers.delete(server);
    // The server starts the match on the socket's normal close (status 1000).
    server.ws.close(1000);
    matches.set(server.sessionId, { matchId: forming.matchId, bucketId: forming.bucketId, assigned: Date.now(),
      parties: new Set(forming.parties.map((party) => party.key)) });
    for (const party of forming.parties) play(party, server.sessionId, forming.matchId);
    placeWaiting();
  }

  function acceptPlayer(ws, ticket) {
    const party = { ticket, ws, size: sizeOf(ticket), members: [], key: `${ticket.bucketId}|${[...ticket.partyPlayerIds].sort().join(",")}` };
    ws.on("close", () => {
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
      if (!party.done) say(`${ticket.accountId} left the queue for bucket ${ticket.bucketId}`);
    });
    ws.send(status("Connecting"));
    ws.send(status("Waiting", { totalPlayers: party.size, connectedPlayers: party.size }));
    ws.send(status("Queued", { ticketId: ticket.ticketId, queuedPlayers: waiting.length, estimatedWaitSec: 0, status: {} }));
    say(`${ticket.accountId} (party of ${party.size}) queued for bucket ${ticket.bucketId}`);
    if (!place(party)) waiting.push(party);
  }

  function acceptServer(ws, ticket) {
    const server = { sessionId: ticket.sessionId, accountId: ticket.accountId, patterns: ticket.bucketIds, maxPlayers: ticket.maxPlayers, ws, forming: null };
    servers.add(server);
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
      say(`Session ${server.sessionId} left the matchmaking service`);
      if (server.forming && !server.forming.sent) {
        clearTimeout(server.forming.timer);
        waiting.unshift(...server.forming.parties);
      }
      server.forming = null;
      placeWaiting();
    });
    ws.send(message("Registered", {}));
    say(`Session ${server.sessionId} registered for ${server.patterns.join(", ")} (${server.maxPlayers} players)`);
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
    closeAll() {
      for (const ws of sockets) ws.close(1001);
    },
    // Core's: what the launcher and the admin panel can show.
    state: () => ({ servers: [...servers].map(({ sessionId, maxPlayers, forming }) => ({ sessionId, maxPlayers, forming: forming?.matchId ?? null })),
      waiting: waiting.length, matches: [...matches].map(([sessionId, { matchId, bucketId }]) => ({ sessionId, matchId, bucketId })) })
  };
}
