import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { assignmentBucket, bucketKey, bucketMatches, estimatedWaitSec, formTeams, isPartyOnlyBucket, parseBucket, playlistTeamsOf, serverRegion, showsMatchStart, withRegion } from "../src/matchmaking/service.js";
import { regionList, regionOf, servedRegions } from "../src/matchmaking/regions.js";
import { certUserAgent, dedicatedServerToken, del, get, openTunnel, post, send, startBackend, userLogin } from "./helpers.js";

// MatchmakingServiceClient's connection: a WebSocket with the ticket in its Authorization header, which the browser-style
// WebSocket can't send. Server frames are unmasked text; client frames are masked.
function matchmakingClient(port, authorization) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1", port, path: "/",
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"), Authorization: authorization }
    });
    request.on("error", reject);
    request.on("upgrade", (response, socket, head) => {
      const messages = [];
      const waiters = [];
      let buffer = Buffer.alloc(0);
      let closed = false;
      // The status of the service's close frame.
      let closeCode = null;
      // Its reason: the error code the client reports (#186).
      let closeReason = null;
      const deliver = (text) => (waiters.length ? waiters.shift()(text) : messages.push(text));
      const receive = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const opcode = buffer[0] & 0x0f;
          let length = buffer[1] & 0x7f;
          let offset = 2;
          if (length === 126) {
            length = buffer.readUInt16BE(2);
            offset = 4;
          }
          if (buffer.length < offset + length) return;
          const frame = buffer.subarray(offset, offset + length);
          buffer = buffer.subarray(offset + length);
          if (opcode === 0x1) deliver(frame.toString("utf8"));
          if (opcode === 0x8) {
            closed = true;
            closeCode = frame.length >= 2 ? frame.readUInt16BE(0) : null;
            closeReason = frame.subarray(2).toString("utf8");
          }
        }
      };
      // What the server sent with its handshake comes with the upgrade, not as data.
      receive(head);
      socket.on("data", receive);
      socket.on("close", () => {
        closed = true;
        while (waiters.length) waiters.shift()(null);
      });
      const send = (text) => {
        const payload = Buffer.from(text);
        const mask = crypto.randomBytes(4);
        const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
        socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
      };
      resolve({
        send,
        next: () => (messages.length ? Promise.resolve(messages.shift()) : closed ? Promise.resolve(null) : new Promise((done) => waiters.push(done))),
        closeCode: () => closeCode,
        closeReason: () => closeReason,
        close: () => socket.destroy()
      });
    });
    request.end();
  });
}

const authorizationOf = ({ ticketType, payload, signature }) => `Epic-Signed ${ticketType} ${payload} ${signature}`;

// The game client's MatchmakingServiceClient (1.9) as the state machine it is, to check the order of what the service
// sends it. Connecting is taken only in ConnectingToService (0x3BEB160); Waiting in ConnectingToService or QueueFull,
// to WaitingForParty, and in WaitingForParty (0x3BEC3E0); Queued for its own ticket in WaitingForParty or InQueue, to
// InQueue (0x3BEB5E0); SessionAssignment in InQueue, InReadyCheck or InSessionAssignment, to InSessionAssignment
// (0x3BEBEA0); Play only in InSessionAssignment (0x3BEB380). A close with 1000 in InSessionAssignment once Play named a
// session is Finished, and the client joins that session (0x3BEC600). Anything else is an error: out of turn, the
// client's MMS error 6, which the lobby shows as "Issue communicating with Matchmaking Service." (0x753C50).
// Resolves with {state, sessionId, error, seen: the message names and states}.
async function clientFlow(connection, ticketId) {
  let state = "ConnectingToService";
  let sessionId = null;
  const seen = [];
  const accepts = {
    Connecting: { ConnectingToService: "ConnectingToService" },
    Waiting: { ConnectingToService: "WaitingForParty", QueueFull: "WaitingForParty", WaitingForParty: "WaitingForParty" },
    Queued: { WaitingForParty: "InQueue", InQueue: "InQueue" },
    SessionAssignment: { InQueue: "InSessionAssignment", InReadyCheck: "InSessionAssignment", InSessionAssignment: "InSessionAssignment" },
    Play: { InSessionAssignment: "InSessionAssignment" }
  };
  for (;;) {
    const text = await connection.next();
    if (text === null) {
      if (connection.closeCode() === 1000 && state === "InSessionAssignment" && sessionId) return { state: "Finished", sessionId, error: null, seen };
      return { state, sessionId, error: `closed with ${connection.closeCode()} in ${state}`, seen };
    }
    if (text === "pong") continue;
    const { name, payload } = JSON.parse(text);
    const step = name === "StatusUpdate" ? payload.state : name;
    seen.push(step);
    const next = accepts[step]?.[state];
    if (!next) return { state, sessionId, error: `${step} in ${state}`, seen };
    if (step === "Queued" && payload.ticketId !== ticketId) return { state, sessionId, error: `Queued for ticket ${payload.ticketId}`, seen };
    if (step === "Play") sessionId = payload.sessionId;
    state = next;
  }
}

// A player's ticket and connection, with clientFlow following it from the start (party: the party's players).
async function gameClient(backend, player, { party = [player], bucket = "858118782:0:NA:10" } = {}) {
  const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=` +
    `${party.map(({ accountId }) => accountId).join(",")}&bucketId=${bucket}&player.platform=Windows`, player.token);
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  const { ticketId } = JSON.parse(Buffer.from(ticket.body.payload, "base64").toString("utf8"));
  return { connection, flow: clientFlow(connection, ticketId) };
}

// What UFortMatchmakingV2 does with a finished assignment (Athena-Matchmaking-1.7.2.md step 9): finds the session by its
// id, fetches the connection's key and joins it. Each must succeed, or the lobby shows an error.
async function joinAssigned(backend, player, sessionId) {
  const found = await get(backend.port, `/fortnite/api/matchmaking/session/${sessionId}`, player.token);
  assert.equal(found.status, 200);
  assert.equal(found.body.id, sessionId);
  const key = await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${player.accountId}/session/${sessionId}`, player.token);
  assert.equal(key.status, 200);
  assert.ok(key.body.key);
  assert.equal((await post(backend.port, `/fortnite/api/matchmaking/session/${sessionId}/join`, player.token, {})).status, 204);
  return found.body;
}

test("a bucket names the playlist and region; a server's pattern takes any playlist of its build and region", () => {
  assert.equal(parseBucket("858118782:0:NA:10").playlistId, 10);
  assert.equal(parseBucket("").playlistId, null);
  assert.ok(bucketMatches("858118782:0:NA:*", "858118782:0:NA:10"));
  assert.ok(!bucketMatches("858118782:0:NA:*:*:*", "858118782:0:NA:10"));
  assert.ok(!bucketMatches("858118782:0:EU:*", "858118782:0:NA:10"));
  // 1.8's servers register "<netcl>:0:<region>:**", the rest of the bucket matching anything (#74).
  assert.ok(bucketMatches("1944448041:0:NA:**", "1944448041:0:NA:2"));
  assert.ok(bucketMatches("1944448041:0:NA:**", "1944448041:0:NA:10:1:0"));
  assert.ok(!bucketMatches("1944448041:0:NA:**", "1944448041:0:NA"));
  assert.ok(!bucketMatches("1944448041:0:NA:**", "858118782:0:NA:2"));
});

// From 4.4 (CL-4117433) the client's bucket names its playlist, lowercased ("%u:%d:%s:%s"; 4.2's and earlier
// "%u:%d:%s:%d"): these are 4.4's, 4.5's and 5.0's own, from their clients' logs.
test("4.4 to 5.0's buckets name the playlist, which resolves to its id; the bucket the server gets is the client's", () => {
  const build45 = 4166199;
  const playground45 = "4148992:0:NAE:playlist_playground";
  assert.deepEqual([parseBucket(playground45, build45).playlistId, parseBucket(playground45).playlistName], [35, "playlist_playground"]);
  assert.equal(parseBucket("4148992:0:NAE:playlist_defaultduo", build45).playlistId, 10);
  assert.equal(parseBucket("4148992:0:NAE:playlist_defaultsolo", build45).playlistId, 2);
  assert.equal(parseBucket("4124989:0:NAE:playlist_defaultduo", 4132537).playlistId, 10);
  assert.equal(parseBucket("4198873:0:EU:playlist_playground", 4204761).playlistId, 35);
  assert.equal(parseBucket("4148992:0:NAE:Playlist_50v50", build45).playlistId, 50);
  // A name Core has no id for keeps its name and no id; a numeric bucket and a server's wildcards read as before.
  assert.deepEqual([parseBucket("4148992:0:NAE:playlist_unknown").playlistId, parseBucket("4148992:0:NAE:playlist_unknown").playlistName],
    [null, "playlist_unknown"]);
  assert.deepEqual([parseBucket("858118782:0:NA:35").playlistId, parseBucket("858118782:0:NA:35").playlistName], [35, null]);
  assert.equal(parseBucket("4148992:0:NAE:*").playlistName, null);
  // Playground plays alone (#299); Duos and Solo have their teams.
  assert.ok(isPartyOnlyBucket(playground45, build45));
  assert.ok(isPartyOnlyBucket("4198873:0:EU:playlist_playground", 4204761));
  assert.ok(!isPartyOnlyBucket("4148992:0:NAE:playlist_defaultduo", build45));
  assert.deepEqual(playlistTeamsOf("4148992:0:NAE:playlist_defaultduo", build45), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
  assert.deepEqual(playlistTeamsOf("4148992:0:NAE:playlist_defaultsolo", build45), { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 });
  // The servers read the bucket as the client sent it.
  assert.equal(assignmentBucket(withRegion(playground45, "NA"), build45), "Fortnite:Fortnite:4148992:0:NA:playlist_playground");
  assert.notEqual(bucketKey(playground45), bucketKey("4148992:0:NAE:playlist_defaultduo"));
});

test("parties that fill share teams up to the playlist's team size; the others play alone (#78)", () => {
  assert.deepEqual(["858118782:0:NA:2", "858118782:0:NA:10", "858118782:0:NA:9", "1944448041:0:NA:9:1:0", "858118782:0:NA:7", ""]
    .map((bucketId) => playlistTeamsOf(bucketId)?.maxTeamSize ?? null), [1, 2, 4, 4, null, null]);
  const party = (fill, ...players) => ({ players, fill });
  const teams = (size) => ({ maxTeamCount: 100, maxTeamSize: size, maxSquadSize: size });
  // Squads: biggest first, so a solo tops up the three and two duos pair up; No Fill parties stay alone, and so does a
  // solo left with no team that has room.
  assert.deepEqual(formTeams([party(true, "a"), party(true, "b", "c"), party(false, "d"), party(true, "e", "f", "g"), party(true, "h"),
    party(true, "i", "j"), party(false, "k", "l")], teams(4)),
  [[["e", "f", "g"], ["a"]], [["b", "c"], ["i", "j"]], [["k", "l"]], [["d"]], [["h"]]]);
  // Duos pair up two solos that fill; Solo is a team each; an unknown playlist keeps each party a team.
  assert.deepEqual(formTeams([party(true, "a"), party(false, "b"), party(true, "c")], teams(2)), [[["a"], ["c"]], [["b"]]]);
  assert.deepEqual(formTeams([party(true, "a"), party(true, "b")], teams(1)), [[["a"]], [["b"]]]);
  assert.deepEqual(formTeams([party(true, "a"), party(true, "b", "c")], null), [[["a"]], [["b", "c"]]]);
  // A party bigger than a team is split, or the server would have no team with room for its reservation.
  assert.deepEqual(formTeams([party(true, "a", "b", "c"), party(true, "d")], teams(2)), [[["a", "b"]], [["c"], ["d"]]]);
  assert.deepEqual(formTeams([party(false, "a", "b", "c"), party(true, "d")], teams(2)), [[["a", "b"]], [["c"]], [["d"]]]);
});

// CoreV2 #238: from 3.1 AssignMatch's teams[i] is the beacon's team i, its squads in match.option.squads.
test("from 3.1 AssignMatch's teams are the playlist's teams, their squads in match.option.squads", () => {
  const party = (fill, ...players) => ({ players, fill });
  const fiveByTwenty = playlistTeamsOf("3935073:0:NA:22", 3935073);
  assert.deepEqual(fiveByTwenty, { maxTeamCount: 5, maxTeamSize: 20, maxSquadSize: 4 });
  const parties = [party(true, "a", "b", "c"), party(true, "d"), party(false, "e"), party(true, "f", "g"), party(true, "h", "i", "j", "k"),
    party(true, "l"), party(true, "m", "n"), party(true, "o", "p", "q", "r"), party(false, "s")];
  // Before 3.1 the teams' squads take turns (the server puts teams[i] on team i % 5): seven squads in fifteen places, so
  // teams[5] and on would be teams of their own on 3.1's and 3.2's servers.
  const squads = formTeams(parties, fiveByTwenty);
  assert.equal(squads.length, 15);
  assert.equal(squads.squads, undefined);
  // From 3.1 one entry per team, squad by squad, and each team's squads as counts of its parties. The squads are made
  // first, as in squads (CoreV2 #242): a party that fills tops up a squad with room, biggest party first, one that
  // doesn't plays in its own; then the biggest squad first to the team with the fewest players.
  const teams = formTeams(parties, fiveByTwenty, { teamsAreSquads: false });
  assert.deepEqual([...teams], [
    [["h", "i", "j", "k"]],
    [["o", "p", "q", "r"]],
    [["a", "b", "c"], ["d"]],
    [["f", "g"], ["m", "n"]],
    [["e"], ["l"], ["s"]]
  ]);
  assert.equal(teams.squads, "1;1;2;2;1,1,1");
  assert.equal(teams.flat(2).length, parties.flatMap((entry) => entry.players).length);
  // Two solos on Fill share a squad, so a team (#242: they were put on two teams, each alone in a squad); empty teams
  // after the last are left out. Two that don't fill each have a squad, on teams of their own.
  const two = formTeams([party(true, "a"), party(true, "b")], fiveByTwenty, { teamsAreSquads: false });
  assert.deepEqual([...two], [[["a"], ["b"]]]);
  assert.equal(two.squads, "2");
  const alone = formTeams([party(false, "a"), party(false, "b")], fiveByTwenty, { teamsAreSquads: false });
  assert.deepEqual([...alone], [[["a"]], [["b"]]]);
  assert.equal(alone.squads, "1;1");
  // Teams of one squad (solo, duo, squad) need no option.
  const solo = formTeams([party(true, "a"), party(true, "b")], playlistTeamsOf("3935073:0:NA:2", 3935073), { teamsAreSquads: false });
  assert.deepEqual([...solo], [[["a"]], [["b"]]]);
  assert.equal(solo.squads, null);
});

test("the ETA is whole seconds, never a whole minute (the client shows N/A for those), and 0 when unknown", () => {
  assert.deepEqual([0, -5, NaN, 1, 9200, 60000, 59001, 120000].map(estimatedWaitSec), [0, 0, 0, 1, 10, 61, 60 + 1, 121]);
});

test("a party's tickets wait for a registered server, which gets the match and sends them all to its session", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200 });
  try {
    const leader = await userLogin(backend.port, "MmsLeader");
    const follower = await userLogin(backend.port, "MmsFollower");
    const latecomer = await userLogin(backend.port, "MmsLatecomer");
    const server = await userLogin(backend.port, "CoreServer1");
    const bucket = "858118782:0:NA:10";
    const ticketOf = (player, party) => get(backend.port,
      `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${party}&bucketId=${bucket}&player.platform=Windows`, player.token);
    const party = `${leader.accountId},${follower.accountId}`;

    const ticket = await ticketOf(leader, party);
    assert.equal(ticket.status, 200);
    assert.deepEqual([ticket.body.ticketType, ticket.body.serviceUrl], ["mms-player", `ws://127.0.0.1:${backend.port}`]);
    assert.equal((await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${follower.accountId}?bucketId=${bucket}`, leader.token)).status, 403);

    const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
    const states = [];
    for (let index = 0; index < 3; index++) states.push(JSON.parse(await client.next()));
    assert.deepEqual(states.map(({ name, payload }) => [name, payload.state]),
      [["StatusUpdate", "Connecting"], ["StatusUpdate", "Waiting"], ["StatusUpdate", "Queued"]]);
    assert.deepEqual([states[1].payload.totalPlayers, states[1].payload.connectedPlayers], [2, 2]);
    // The queue counts everyone queued for the bucket (#55): the party of two. With no server free there's no ETA ("N/A").
    assert.equal(states[2].payload.queuedPlayers, 2);
    assert.equal(states[2].payload.estimatedWaitSec, 0);
    // The party waits on Cert (the tests' User-Agent) with no server for it: the launcher may move one over (Core-Launcher #18).
    assert.deepEqual((await get(backend.port, "/core/api/demand")).body, [{ build: "3532353", mode: "battleRoyale", players: 1 }]);
    client.send("ping");
    assert.equal(await client.next(), "pong");
    const followerClient = await matchmakingClient(backend.port, authorizationOf((await ticketOf(follower, party)).body));

    // The gameserver: its session, then its own ticket and connection (-EnableMMS).
    const session = (await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "858118782", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
    })).body;
    const patterns = encodeURIComponent("858118782:0:NA:*,858118782:0:NA:*:*:*");
    const serverTicket = await get(backend.port,
      `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${patterns}&minPlayers=1&maxPlayers=100`, server.token);
    assert.equal(serverTicket.status, 200);
    assert.equal((await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=x`, leader.token)).status, 403);
    const gameserver = await matchmakingClient(backend.port, authorizationOf(serverTicket.body));
    assert.equal(JSON.parse(await gameserver.next()).name, "Registered");

    const assign = JSON.parse(await gameserver.next());
    assert.equal(assign.name, "AssignMatch");
    assert.equal(assign.payload.bucketId, bucket);
    assert.deepEqual(assign.payload.teams, [[[leader.accountId, follower.accountId]]]);
    assert.equal(assign.payload.matchOptions["match.option.warmupRequiredPlayerCount"], "1");
    gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    assert.equal(await gameserver.next(), null);

    for (const party of [client, followerClient]) {
      let message;
      do message = JSON.parse(await party.next()); while (message.name !== "Play");
      assert.deepEqual([message.payload.matchId, message.payload.sessionId], [assign.payload.matchId, session.id]);
      // The client joins once the service closes its socket.
      assert.equal(await party.next(), null);
    }
    assert.deepEqual((await get(backend.port, "/core/api/demand")).body, [], "nobody waits once their match has a server");

    // The assigned match holds only its players: a party that queues later waits for the next free server.
    const late = await matchmakingClient(backend.port, authorizationOf((await ticketOf(latecomer, latecomer.accountId)).body));
    for (let index = 0; index < 3; index++) await late.next();
    const nextSession = (await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7778,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "858118782", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
    })).body;
    const nextServer = await matchmakingClient(backend.port, authorizationOf((await get(backend.port,
      `/fortnite/api/game/v2/matchmakingservice/ticket/session/${nextSession.id}?bucketIds=${patterns}&minPlayers=1&maxPlayers=100`, server.token)).body));
    assert.equal(JSON.parse(await nextServer.next()).name, "Registered");
    const nextAssign = JSON.parse(await nextServer.next());
    assert.deepEqual(nextAssign.payload.teams, [[[latecomer.accountId]]]);
    nextServer.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: nextAssign.payload.matchId, result: "ready" } }));
    let message;
    const waits = [];
    do {
      message = JSON.parse(await late.next());
      if (message.payload.state === "Queued") waits.push(message.payload.estimatedWaitSec);
    } while (message.name !== "Play");
    assert.equal(message.payload.sessionId, nextSession.id);
    // Once its match forms, the ETA is the rest of the gather time (#56).
    assert.ok(waits.at(-1) > 0, `ETAs ${waits}`);
    late.close();

    // The server asks who has won before when its match is assigned (nobody: the leader, a founder as test accounts are,
    // glides on the Founder's Glider, Core-Backend #84), and records the winners at its end.
    const winners = await post(backend.port, "/fortnite/api/game/v2/battleroyale/winners", server.token, { playlistId: 10, accountIds: [leader.accountId] });
    assert.deepEqual(winners.body, { playlistId: 10, winners: [{ accountId: leader.accountId, umbrellaType: "founder_glider" }] });
    assert.equal((await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", server.token, { playlistId: 10, accountIds: [leader.accountId] })).status, 204);

    const refused = await matchmakingClient(backend.port, authorizationOf({ ...ticket.body, signature: "AAAA" }));
    assert.equal(JSON.parse(await refused.next()).name, "Error");
    assert.equal(await refused.next(), null);
  } finally {
    backend.close();
  }
});

test("behind an https reverse proxy a ticket's serviceUrl is wss:// on the proxy's host (Core #197)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "MmsProxied");
    const ticketOf = (headers) => send({ host: "127.0.0.1", port: backend.port,
      path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?bucketId=858118782:0:NA:2&player.platform=Windows`,
      headers: { "User-Agent": certUserAgent, Authorization: `bearer ${player.token}`, ...headers } });
    const proxied = await ticketOf({ "X-Forwarded-Proto": "https", "X-Forwarded-Host": "core.example.com" });
    assert.equal(proxied.status, 200);
    assert.equal(proxied.body.serviceUrl, "wss://core.example.com");
    assert.equal((await ticketOf({ Host: "core.example.com:5595" })).body.serviceUrl, "ws://core.example.com:5595");
  } finally {
    backend.close();
  }
});

test("a ticket the -httpproxy carried names the address the connection came in on, not the host the game asked for (Core-Backend #261)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "MmsHttpProxy");
    const path = `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?bucketId=4013257:0:OCE:2&player.platform=Windows`;
    const headers = (host) => ({ Host: host, "User-Agent": certUserAgent, Authorization: `bearer ${player.token}` });
    const direct = `ws://127.0.0.1:${backend.port}`;

    // https://api.echofn.org through the proxy's CONNECT tunnel: the WebSocket, outside the proxy, couldn't look it up.
    const tunnel = await openTunnel(backend.port, "api.echofn.org");
    const tunnelled = await send({ createConnection: () => tunnel, path, headers: headers("api.echofn.org") });
    assert.equal(tunnelled.status, 200);
    assert.equal(tunnelled.body.serviceUrl, direct);
    tunnel.destroy();

    // http:// in absolute form, as the proxy carries plain HTTP.
    const absolute = await send({ host: "127.0.0.1", port: backend.port, path: `http://api.echofn.org${path}`, headers: headers("api.echofn.org") });
    assert.equal(absolute.body.serviceUrl, direct);

    // A direct request keeps its Host (CoreRedirect's backend address), and an https reverse proxy its forwarded host.
    const ticketOf = (extra) => send({ host: "127.0.0.1", port: backend.port, path, headers: { ...headers("play.example.com:40123"), ...extra } });
    assert.equal((await ticketOf()).body.serviceUrl, "ws://play.example.com:40123");
    assert.equal((await ticketOf({ "X-Forwarded-Proto": "https", "X-Forwarded-Host": "core.example.com" })).body.serviceUrl, "wss://core.example.com");
  } finally {
    backend.close();
  }
});

test("AssignMatch's teams follow each party leader's Squad Fill choice (#78)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200 });
  const clients = [];
  try {
    const players = {};
    for (const name of ["Solo", "DuoLeader", "DuoMate", "Lone", "Filler", "PairLeader", "PairMate"]) players[name] = await userLogin(backend.port, `Fill${name}`);
    const server = await userLogin(backend.port, "CoreServer1");
    const bucket = "858118782:0:NA:9";
    const id = (name) => players[name].accountId;
    // The leader's client adds player.option.fillTeam (false only for Squads on No Fill); the other members' don't.
    const queue = async (name, party, fill) => {
      const option = fill === undefined ? "" : `&player.option.fillTeam=${fill}`;
      const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${id(name)}?partyPlayerIds=${party.map(id).join(",")}` +
        `&bucketId=${bucket}&player.platform=Windows${option}`, players[name].token);
      const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
      for (let index = 0; index < 3; index++) await client.next();
      clients.push(client);
    };
    await queue("Solo", ["Solo"], true);
    await queue("DuoLeader", ["DuoLeader", "DuoMate"], true);
    await queue("DuoMate", ["DuoLeader", "DuoMate"]);
    await queue("Lone", ["Lone"], false);
    await queue("Filler", ["Filler"], true);
    // A No Fill pair whose other member queues before its leader.
    await queue("PairMate", ["PairLeader", "PairMate"]);
    await queue("PairLeader", ["PairLeader", "PairMate"], false);

    const session = (await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "858118782", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
    })).body;
    const gameserver = await matchmakingClient(backend.port, authorizationOf((await get(backend.port,
      `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent("858118782:0:NA:*")}&minPlayers=1&maxPlayers=100`,
      server.token)).body));
    clients.push(gameserver);
    assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
    const assign = JSON.parse(await gameserver.next());
    assert.equal(assign.name, "AssignMatch");
    // The duo takes both solos that fill; the pair and the lone player stay on their own.
    assert.deepEqual(assign.payload.teams, [[[id("DuoLeader"), id("DuoMate")], [id("Solo")], [id("Filler")]],
      [[id("PairLeader"), id("PairMate")]], [[id("Lone")]]]);

    // CoreV2 #233: the warmup answer names the players whose party doesn't fill (a member's ticket without the option
    // follows its leader's), so "Fill players' teams with bots" leaves their teams alone.
    gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    assert.equal(await gameserver.next(), null);
    await settingsOf(backend, { bots: { fillPlayerTeams: true } });
    const token = await dedicatedServerToken(backend.port);
    const bots = (await reportWarmup(backend, token, { phase: "Warmup", accountIds: [id("Solo")], secondsLeft: 60 })).body.bots;
    assert.deepEqual([bots.count, bots.teams, [...bots.noFill].sort()], [0, true, [id("Lone"), id("PairLeader"), id("PairMate")].sort()]);
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});

// Core-Backend #135: 1.10's 50v50 (playlist 11) is two teams of 50: AssignMatch's teams[i] goes to team i % 2.
test("a 50v50 match's parties are shared out over its two teams, a No Fill party in a squad of its own", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200 });
  const clients = [];
  try {
    const players = {};
    for (const name of ["Trio1", "Trio2", "Trio3", "Solo", "Lone", "Filler"]) players[name] = await userLogin(backend.port, `Fifty${name}`);
    const server = await userLogin(backend.port, "CoreServer1");
    const bucket = "3790078:0:NA:11";
    const id = (name) => players[name].accountId;
    const queue = async (name, party, fill) => {
      const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${id(name)}?partyPlayerIds=${party.map(id).join(",")}` +
        `&bucketId=${bucket}&player.platform=Windows&player.option.fillTeam=${fill}`, players[name].token);
      const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
      for (let index = 0; index < 3; index++) await client.next();
      clients.push(client);
    };
    await queue("Trio1", ["Trio1", "Trio2", "Trio3"], true);
    await queue("Solo", ["Solo"], true);
    await queue("Lone", ["Lone"], false);
    await queue("Filler", ["Filler"], true);

    const session = (await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "3790078", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
    })).body;
    const gameserver = await matchmakingClient(backend.port, authorizationOf((await get(backend.port,
      `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent("3790078:0:NA:**")}&minPlayers=1&maxPlayers=100`,
      server.token)).body));
    clients.push(gameserver);
    assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
    const assign = JSON.parse(await gameserver.next());
    assert.equal(assign.name, "AssignMatch");
    // The trio on team 0; the solos on team 1, the two that fill in one squad and the one that doesn't in its own.
    assert.deepEqual(assign.payload.teams, [[[id("Trio1"), id("Trio2"), id("Trio3")]], [[id("Solo")], [id("Filler")]], [], [[id("Lone")]]]);
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});

// Core-Backend #153: 1.11's server reads AssignMatch's bucket only with six fields (GameId:AppId:BuildId:Hotfix:
// Region:Playlist); given the players' four it kept playlist -1 and played 50v50 queues as solo matches.
test("a 1.11 server's AssignMatch names 50v50's playlist in its six-field bucket; 1.10's keeps the players' four", async () => {
  assert.equal(assignmentBucket("3807424:0:NA:11", "3807424"), "Fortnite:Fortnite:3807424:0:NA:11");
  // 2.1 (CL-3825894) as 1.11.
  assert.equal(assignmentBucket("3825894:0:NA:11", "3825894"), "Fortnite:Fortnite:3825894:0:NA:11");
  assert.equal(assignmentBucket("3790078:0:NA:11", "3790078"), "3790078:0:NA:11");
  assert.equal(assignmentBucket("858118782:0:NA:2", null), "858118782:0:NA:2");
  const agentOf = (build) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${build}`;
  const as = (build, port, urlPath, token, method = "GET", body) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = { "User-Agent": agentOf(build), Authorization: `bearer ${token}` };
    if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
    return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
  };
  for (const build of ["3807424", "3790078"]) {
    const backend = await startBackend({ matchmakingGatherMs: 100 });
    const clients = [];
    try {
      const player = await userLogin(backend.port, `Fifty${build}`);
      const server = await userLogin(backend.port, `CoreServer${build}`);
      const bucket = `${build}:0:NA:11`;
      const ticket = await as(build, backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${bucket}&player.platform=Windows&player.option.fillTeam=true`, player.token);
      const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
      clients.push(client);
      const session = (await as(build, backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
        ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
        maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
      })).body;
      const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(build, backend.port,
        `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NA:**`)}&minPlayers=1&maxPlayers=100`,
        server.token)).body));
      clients.push(gameserver);
      assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
      const assign = JSON.parse(await gameserver.next());
      assert.equal(assign.name, "AssignMatch");
      assert.equal(assign.payload.bucketId, build === "3807424" ? `Fortnite:Fortnite:${bucket}` : bucket);
      // 1.11's HandleAssignMatchMessage: PlaylistId is field 5, RegionId field 4.
      const fields = assign.payload.bucketId.split(":");
      assert.equal(Number(fields[build === "3807424" ? 5 : 3]), 11);
      assert.equal(fields[build === "3807424" ? 4 : 2], "NA");
      assert.equal(assign.payload.teams.length, 1);
    } finally {
      for (const client of clients) client.close();
      backend.close();
    }
  }
});

test("regions compare in any spelling: a server's -McpRegion against the client's selected region (#121)", () => {
  assert.deepEqual(["NA", "nae", "NAW", " naC ", "OH", "EU", "gb", "OCE", "BR", "ASIA", "Test01", "TEST02", "ME", "xx", "NONE", "", undefined, "UND"].map(regionOf),
    ["NA", "NA", "NA", "NA", "NA", "EU", "EU", "OCE", "BR", "ASIA", "ASIA", "ASIA", "ME", "XX", null, null, null, null]);
  assert.ok(bucketMatches("3775276:0:nae:**", "3775276:0:NA:2"));
  assert.ok(bucketMatches("858118782:0:NA:*", "858118782:0:NAW:10"));
  assert.ok(!bucketMatches("858118782:0:NA:*", "858118782:0:EU:10"));
  assert.ok(bucketMatches("858118782:0:NA:*", "858118782:0:EU:10", { anyRegion: true }));
  // Any region, but still the same build and number of fields.
  assert.ok(!bucketMatches("858118782:0:NA:*", "1:0:EU:10", { anyRegion: true }));
  assert.ok(!bucketMatches("858118782:0:NA:*:*:*", "858118782:0:EU:10", { anyRegion: true }));
  assert.ok(bucketMatches("858118782:0:NONE:*", "858118782:0:NONE:10"));
  assert.equal(bucketKey("858118782:0:nae:10"), "858118782:0:NA:10");
  assert.equal(bucketKey("858118782:0:EU:10", { anyRegion: true }), "858118782:0:*:10");
  assert.equal(bucketKey("858118782:0::10"), "858118782:0:NONE:10");
  assert.equal(withRegion("858118782:0:EU:10", "NA"), "858118782:0:NA:10");
  assert.deepEqual([["1:0:NA:*", "1:0:NA:*:*:*"], ["1:0:*:**", "1:0:eu:*"], ["1:0:*:*"], []].map(serverRegion), ["NA", "eu", null, null]);
});

// A Battle Royale gameserver of build 858118782 in a region: its session, then its matchmaking connection, Registered.
async function regionServer(backend, name, region) {
  const server = await userLogin(backend.port, name);
  const session = (await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
    ownerId: server.accountId, ownerName: name, serverName: name, serverAddress: "127.0.0.1", serverPort: 7777,
    maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "858118782", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: region }
  })).body;
  const patterns = encodeURIComponent(`858118782:0:${region}:*,858118782:0:${region}:*:*:*`);
  const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${patterns}&minPlayers=1&maxPlayers=100`, server.token);
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  assert.equal(JSON.parse(await connection.next()).name, "Registered");
  return { ...server, session, connection };
}

// A solo player queued for Duos in a region, past Connecting and Waiting.
async function regionPlayer(backend, name, region) {
  const player = await userLogin(backend.port, name);
  const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
    `&bucketId=858118782:0:${region}:10&player.platform=Windows`, player.token);
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  for (let index = 0; index < 2; index++) await connection.next();
  return { ...player, connection };
}

// The next message of a name, skipping the StatusUpdates before it.
async function nextOf(connection, name) {
  let message;
  do message = JSON.parse(await connection.next()); while (message.name !== name);
  return message;
}

test("players are matched in their own region, and in another when theirs has no server at all (#121)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200 });
  const connections = [];
  try {
    const na = await regionServer(backend, "CoreServer1", "NA");
    const eu = await regionServer(backend, "CoreServer2", "EU");
    connections.push(na.connection, eu.connection);

    // Each region's player goes to that region's server, whichever way the region is spelled.
    const american = await regionPlayer(backend, "RegionNA", "nae");
    const european = await regionPlayer(backend, "RegionEU", "EU");
    connections.push(american.connection, european.connection);
    const naAssign = await nextOf(na.connection, "AssignMatch");
    const euAssign = await nextOf(eu.connection, "AssignMatch");
    assert.deepEqual(naAssign.payload.teams, [[[american.accountId]]]);
    assert.deepEqual(euAssign.payload.teams, [[[european.accountId]]]);
    // AssignMatch names the server's own region, which its game mode takes as its MatchmakingRegionId.
    assert.equal(naAssign.payload.bucketId, "858118782:0:NA:10");
    for (const [server, assign] of [[na, naAssign], [eu, euAssign]]) {
      server.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    }
    assert.equal((await nextOf(american.connection, "Play")).payload.sessionId, na.session.id);
    assert.equal((await nextOf(european.connection, "Play")).payload.sessionId, eu.session.id);

    // EU's server is in its match and comes back after it, so another European waits for it rather than taking NA's
    // free server.
    const nextNa = await regionServer(backend, "CoreServer3", "NA");
    connections.push(nextNa.connection);
    const waiter = await regionPlayer(backend, "RegionEUWaits", "EU");
    connections.push(waiter.connection);
    const queued = JSON.parse(await waiter.connection.next());
    assert.deepEqual([queued.payload.state, queued.payload.queuedPlayers, queued.payload.estimatedWaitSec], ["Queued", 1, 0]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Once EU has no server at all (its match's session ended), the European plays on NA's server, in an NA match.
    assert.equal((await del(backend.port, `/fortnite/api/matchmaking/session/${eu.session.id}`, eu.token)).status, 204);
    const fallback = await nextOf(nextNa.connection, "AssignMatch");
    assert.deepEqual(fallback.payload.teams, [[[waiter.accountId]]]);
    assert.equal(fallback.payload.bucketId, "858118782:0:NA:10");
    nextNa.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: fallback.payload.matchId, result: "ready" } }));
    // While it formed the European heard its queue's state and the time left.
    let message;
    const waits = [];
    do {
      message = JSON.parse(await waiter.connection.next());
      if (message.payload.state === "Queued") waits.push(message.payload.estimatedWaitSec);
    } while (message.payload.state !== "SessionAssignment");
    assert.ok(waits.length > 1 && waits.at(-1) > 0, `ETAs ${waits}`);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

test("a player from a region with no server shares a forming match with that server's region (#121)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 400 });
  const connections = [];
  try {
    const na = await regionServer(backend, "CoreServer1", "NA");
    connections.push(na.connection);
    const american = await regionPlayer(backend, "ShareNA", "NA");
    const brazilian = await regionPlayer(backend, "ShareBR", "BR");
    connections.push(american.connection, brazilian.connection);
    // The Brazilian counts in the American's queue (a party of one each).
    let message;
    do message = JSON.parse(await brazilian.connection.next()); while (message.payload.state !== "Queued");
    assert.equal(message.payload.queuedPlayers, 2);
    const assign = await nextOf(na.connection, "AssignMatch");
    assert.deepEqual(assign.payload.teams, [[[american.accountId], [brazilian.accountId]]]);
    assert.equal(assign.payload.bucketId, "858118782:0:NA:10");
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

test("with the region fallback off, a player only matches in the region they picked (#123)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200, regionFallback: false });
  const connections = [];
  try {
    const eu = await regionServer(backend, "CoreServer1", "EU");
    connections.push(eu.connection);
    // Brazil has no server: the Brazilian waits for one of Brazil's, with no ETA, rather than playing in Europe.
    const brazilian = await regionPlayer(backend, "StrictBR", "BR");
    connections.push(brazilian.connection);
    const queued = JSON.parse(await brazilian.connection.next());
    assert.deepEqual([queued.payload.state, queued.payload.queuedPlayers, queued.payload.estimatedWaitSec], ["Queued", 1, 0]);
    // Europe's server takes a European, and not the Brazilian with them.
    const european = await regionPlayer(backend, "StrictEU", "EU");
    connections.push(european.connection);
    const assign = await nextOf(eu.connection, "AssignMatch");
    assert.deepEqual(assign.payload.teams, [[[european.accountId]]]);
    eu.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    assert.equal((await nextOf(european.connection, "Play")).payload.sessionId, eu.session.id);

    // A Brazilian server takes them.
    const br = await regionServer(backend, "CoreServer2", "BR");
    connections.push(br.connection);
    const brAssign = await nextOf(br.connection, "AssignMatch");
    assert.deepEqual([brAssign.payload.teams, brAssign.payload.bucketId], [[[[brazilian.accountId]]], "858118782:0:BR:10"]);
    br.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: brAssign.payload.matchId, result: "ready" } }));
    assert.equal((await nextOf(brazilian.connection, "Play")).payload.sessionId, br.session.id);

    // Turned back on (the default), a region with no server falls back again, to any server free.
    await settingsOf(backend, { regionFallback: true });
    const next = await regionServer(backend, "CoreServer3", "EU");
    connections.push(next.connection);
    const asian = await regionPlayer(backend, "FallbackASIA", "ASIA");
    connections.push(asian.connection);
    assert.deepEqual((await nextOf(next.connection, "AssignMatch")).payload.teams, [[[asian.accountId]]]);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

// Core-Backend #142: the admin panel's server regions.
test("a server in one of the server regions takes all of their players; any other server only its own region's (#142)", () => {
  assert.deepEqual(regionList(["eu", "NAW", "EU", "xx", 5, "NONE"]), ["EU", "NA"]);
  // One region's code, as a string, is that region; anything else is no list at all.
  assert.deepEqual([regionList("gb"), regionList(""), regionList([]), regionList(5), regionList(null)], [["EU"], [], [], undefined, undefined]);
  assert.deepEqual([...servedRegions("eu", ["EU", "NA"])], ["EU", "NA"]);
  assert.deepEqual([...servedRegions("OCE", ["EU", "NA"])], ["OCE"]);
  assert.deepEqual([...servedRegions("NA", [])], ["NA"]);
  assert.deepEqual([...servedRegions("NONE", ["EU", "NA"])], [null]);
});

test("with EU and NA the server regions, EU's server takes NA's players into its EU matches, within EU's server quotas (#142)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 300, regionFallback: false, serverRegions: ["EU", "NA"] });
  const connections = [];
  try {
    const eu = await regionServer(backend, "CoreServer1", "EU");
    connections.push(eu.connection);
    // NA has a server now (EU's): the American and the European share its match, which plays in EU.
    const american = await regionPlayer(backend, "MultiNA", "nae");
    const european = await regionPlayer(backend, "MultiEU", "EU");
    connections.push(american.connection, european.connection);
    const assign = await nextOf(eu.connection, "AssignMatch");
    assert.deepEqual(assign.payload.teams, [[[american.accountId], [european.accountId]]]);
    assert.equal(assign.payload.bucketId, "858118782:0:EU:10");
    eu.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    assert.equal((await nextOf(american.connection, "Play")).payload.sessionId, eu.session.id);
    assert.equal((await nextOf(european.connection, "Play")).payload.sessionId, eu.session.id);

    // EU's Duos quota of 1 is full with that match: another EU server waits, and so does the next American.
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { serverLimits: { EU: { duo: 1 } } });
    const next = await regionServer(backend, "CoreServer2", "EU");
    connections.push(next.connection);
    const waiter = await regionPlayer(backend, "MultiNAWaits", "NA");
    // OCE isn't a server region and the fallback is off: the Australian waits for an OCE server.
    const australian = await regionPlayer(backend, "MultiOCE", "OCE");
    connections.push(waiter.connection, australian.connection);
    for (const player of [waiter, australian]) {
      const queued = JSON.parse(await player.connection.next());
      assert.deepEqual([queued.payload.state, queued.payload.estimatedWaitSec], ["Queued", 0]);
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Room for a second EU match: the American gets it, still in EU, and the Australian keeps waiting.
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { serverLimits: { EU: { duo: 2 } } });
    const second = await nextOf(next.connection, "AssignMatch");
    assert.deepEqual([second.payload.teams, second.payload.bucketId], [[[[waiter.accountId]]], "858118782:0:EU:10"]);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

test("the server regions are a setting, kept over a restart, and a single region's code still reads as that region (#142)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-regions-"));
  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ serverRegion: "eu" }));
  let backend = await startBackend({ dataDir });
  try {
    let saved = (await settingsOf(backend)).body;
    assert.deepEqual([saved.serverRegions, saved.serverRegion], [["EU"], undefined]);
    saved = (await settingsOf(backend, { serverRegions: ["NAW", "eu", "nowhere"] })).body;
    assert.deepEqual(saved.serverRegions, ["NA", "EU"]);
    // Not a list or a region: ignored.
    saved = (await settingsOf(backend, { serverRegions: 5 })).body;
    assert.deepEqual(saved.serverRegions, ["NA", "EU"]);
    // The matchmaking tab shows and sets them, and its defaults clear them.
    assert.deepEqual((await get(backend.port, "/admin/api/matchmaking/overview")).body.serverRegions, ["NA", "EU"]);
    assert.deepEqual((await post(backend.port, "/admin/api/matchmaking/config", undefined, { serverRegions: ["OCE", "BR"] })).body.serverRegions, ["OCE", "BR"]);
    backend.close();
    backend = await startBackend({ dataDir });
    assert.deepEqual((await settingsOf(backend)).body.serverRegions, ["OCE", "BR"]);
    // The status route, which needs no login, names them for the launcher's servers (Core-Launcher #8), and no other setting.
    const status = (await get(backend.port, "/core/api/status")).body;
    assert.deepEqual(Object.keys(status).sort(), ["name", "serverRegions", "version"]);
    assert.deepEqual(status.serverRegions, ["OCE", "BR"]);
    assert.deepEqual((await post(backend.port, "/admin/api/matchmaking/actions/reset-defaults", undefined, {})).body.serverRegions, []);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// Core-Backend #122: the admin panel's matchmaking waits, and late joining during a CoreV2 gameserver's warmup
// (services/matchmaking/warmup.js).
const settingsOf = (backend, body) => (body === undefined ? get(backend.port, "/admin/api/settings") : post(backend.port, "/admin/api/settings", undefined, body));
const reportWarmup = (backend, token, body) => post(backend.port, "/fortnite/api/game/v2/matchmakingservice/warmup", token, body);

// A party queued for Duos in NA, past Connecting and Waiting: one member's ticket (party: the party's players).
async function queueParty(backend, player, party = [player]) {
  const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=` +
    `${party.map(({ accountId }) => accountId).join(",")}&bucketId=858118782:0:NA:10&player.platform=Windows`, player.token);
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  for (let index = 0; index < 2; index++) await connection.next();
  return connection;
}

test("the gather time, warmup, late joining and region fallback are settings, kept over a restart and set from config.json (#122, #123)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-mmwait-"));
  let backend = await startBackend({ dataDir });
  try {
    let saved = (await settingsOf(backend)).body;
    // Today's behaviour: 10 s to gather, a 120 s warmup (CoreV2 #256), no late joining, another region when theirs has
    // no server.
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin, saved.regionFallback], [10, 120, false, true]);
    saved = (await settingsOf(backend, { matchmakingGatherSeconds: "25", warmupSeconds: 90, lateJoin: true, regionFallback: false })).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin, saved.regionFallback], [25, 90, true, false]);
    // Out of range, not a whole number or not a switch: ignored.
    saved = (await settingsOf(backend, { matchmakingGatherSeconds: 301, warmupSeconds: 5, lateJoin: "yes", regionFallback: "yes" })).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin, saved.regionFallback], [25, 90, true, false]);
    saved = (await settingsOf(backend, { matchmakingGatherSeconds: 1.5, warmupSeconds: 1801 })).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds], [25, 90]);
    backend.close();
    backend = await startBackend({ dataDir });
    saved = (await settingsOf(backend)).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin, saved.regionFallback], [25, 90, true, false]);
    // A blank warmup is the game's again.
    saved = (await settingsOf(backend, { warmupSeconds: "" })).body;
    assert.equal(saved.warmupSeconds, null);
  } finally {
    backend.close();
  }

  backend = await startBackend({ matchmakingGatherSeconds: 0, warmupSeconds: 45, lateJoin: true, regionFallback: false });
  try {
    const saved = (await settingsOf(backend)).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin, saved.regionFallback], [0, 45, true, false]);
  } finally {
    backend.close();
  }
});

test("the warmup is 120 s by default, and a saved settings file keeps its own length, the game's too (CoreV2 #256)", async () => {
  // Saved before the default changed: the game's (null) and a length of its own are kept; a file without one, or with
  // one out of range, gets the default.
  for (const [saved, expected] of [[{ warmupSeconds: null }, null], [{ warmupSeconds: 45 }, 45], [{}, 120], [{ warmupSeconds: 5 }, 120]]) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-warmup-default-"));
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ matchmakingGatherSeconds: 10, ...saved }));
    const backend = await startBackend({ dataDir });
    try {
      assert.equal((await settingsOf(backend)).body.warmupSeconds, expected, JSON.stringify(saved));
    } finally {
      backend.close();
    }
  }
  // A new install has the default; a blank length is the game's.
  const backend = await startBackend({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-warmup-default-")) });
  try {
    assert.equal((await settingsOf(backend)).body.warmupSeconds, 120);
    await settingsOf(backend, { warmupSeconds: null });
    assert.equal((await settingsOf(backend)).body.warmupSeconds, null);
  } finally {
    backend.close();
  }
});

test("a match forms for the panel's gather time, which is the queue's ETA (#122)", async () => {
  const backend = await startBackend();
  const connections = [];
  try {
    await settingsOf(backend, { matchmakingGatherSeconds: 3 });
    const na = await regionServer(backend, "CoreServer1", "NA");
    connections.push(na.connection);
    const player = await userLogin(backend.port, "GatherPlayer");
    const started = Date.now();
    const connection = await queueParty(backend, player);
    connections.push(connection);
    // 3 s to gather, and 1 s more before Play.
    assert.equal(JSON.parse(await connection.next()).payload.estimatedWaitSec, 4);
    await nextOf(na.connection, "AssignMatch");
    const took = Date.now() - started;
    assert.ok(took >= 2800 && took < 4500, `assigned after ${took} ms`);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

test("only a gameserver reports its warmup, and hears the warmup time (#122)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "WarmupPlayer");
    assert.equal((await reportWarmup(backend, player.token, { phase: "Setup", accountIds: [] })).status, 403);
    assert.equal((await reportWarmup(backend, undefined, { phase: "Setup" })).status, 401);
    const token = await dedicatedServerToken(backend.port);
    assert.deepEqual((await reportWarmup(backend, token, { phase: "Setup", accountIds: [] })).body,
      { warmupSeconds: 120, lateJoin: false, sessionId: null, open: false, maxPlayers: null, parties: [], noFill: [], bots: null, stormDestructionPercent: 10 });
    await settingsOf(backend, { warmupSeconds: 300 });
    assert.equal((await reportWarmup(backend, token, { phase: "Setup", accountIds: [] })).body.warmupSeconds, 300);
    await settingsOf(backend, { warmupSeconds: "" });
    assert.equal((await reportWarmup(backend, token, { phase: "Setup", accountIds: [] })).body.warmupSeconds, null);
  } finally {
    backend.close();
  }
});

test("with late joining on, a match in its warmup takes the parties that queue after it (#122)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200 });
  const connections = [];
  try {
    const token = await dedicatedServerToken(backend.port);
    const na = await regionServer(backend, "CoreServer1", "NA");
    connections.push(na.connection);
    const first = await userLogin(backend.port, "LateFirst");
    connections.push(await queueParty(backend, first));
    const assign = await nextOf(na.connection, "AssignMatch");
    na.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    assert.equal(await na.connection.next(), null);

    // Off (the default), the server's report opens nothing, and a party that queues waits for a free server.
    let answer = (await reportWarmup(backend, token, { phase: "Warmup", accountIds: [first.accountId], secondsLeft: 60 })).body;
    assert.deepEqual([answer.sessionId, answer.open, answer.lateJoin], [na.session.id, false, false]);
    const waiter = await userLogin(backend.port, "LateWaiter");
    const waiting = await queueParty(backend, waiter);
    connections.push(waiting);
    assert.equal(JSON.parse(await waiting.next()).payload.state, "Queued");

    // On, the match opens, and the waiting party is sent to it straight away.
    await settingsOf(backend, { lateJoin: true });
    answer = (await reportWarmup(backend, token, { phase: "Warmup", accountIds: [first.accountId], secondsLeft: 60 })).body;
    assert.deepEqual([answer.sessionId, answer.open, answer.maxPlayers], [na.session.id, true, 100]);
    const play = await nextOf(waiting, "Play");
    assert.deepEqual([play.payload.sessionId, play.payload.matchId], [na.session.id, assign.payload.matchId]);

    // A party's members, each with their own ticket, go together, the second even once late joining is off; the report
    // names the parties sent, for the server's teams.
    const leader = await userLogin(backend.port, "LateLeader");
    const mate = await userLogin(backend.port, "LateMate");
    const leaderConnection = await queueParty(backend, leader, [leader, mate]);
    connections.push(leaderConnection);
    assert.equal((await nextOf(leaderConnection, "Play")).payload.sessionId, na.session.id);
    await settingsOf(backend, { lateJoin: false });
    const mateConnection = await queueParty(backend, mate, [leader, mate]);
    connections.push(mateConnection);
    assert.equal((await nextOf(mateConnection, "Play")).payload.sessionId, na.session.id);
    await settingsOf(backend, { lateJoin: true });
    answer = (await reportWarmup(backend, token, { phase: "Warmup", accountIds: [first.accountId, waiter.accountId], secondsLeft: 50 })).body;
    assert.deepEqual(answer.parties, [[waiter.accountId], [leader.accountId, mate.accountId]]);

    // Too little of the warmup left to load in: a party waits for a new match.
    await reportWarmup(backend, token, { phase: "Warmup", accountIds: [first.accountId, waiter.accountId, leader.accountId], secondsLeft: 10 });
    const tooLate = await userLogin(backend.port, "LateTooLate");
    const tooLateConnection = await queueParty(backend, tooLate);
    connections.push(tooLateConnection);
    assert.equal(JSON.parse(await tooLateConnection.next()).payload.state, "Queued");
    // Once the bus has left the match takes nobody, even with time reported.
    answer = (await reportWarmup(backend, token, { phase: "Aircraft", accountIds: [first.accountId], secondsLeft: 0 })).body;
    assert.deepEqual([answer.sessionId, answer.open], [na.session.id, false]);
    // The next free server takes the party that waited.
    const next = await regionServer(backend, "CoreServer2", "NA");
    connections.push(next.connection);
    assert.deepEqual((await nextOf(next.connection, "AssignMatch")).payload.teams, [[[tooLate.accountId]]]);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

test("a party sent to a match in its warmup is queued first, which its client needs to take the assignment, then finds and joins the session (#122)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200, lateJoin: true });
  const connections = [];
  try {
    const token = await dedicatedServerToken(backend.port);
    const na = await regionServer(backend, "CoreServer1", "NA");
    connections.push(na.connection);
    // The first player is assigned the normal way: queued, then the match forms and the server takes it.
    const first = await userLogin(backend.port, "WarmupFirst");
    const firstClient = await gameClient(backend, first);
    connections.push(firstClient.connection);
    const assign = await nextOf(na.connection, "AssignMatch");
    na.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    const firstFlow = await firstClient.flow;
    assert.deepEqual([firstFlow.state, firstFlow.sessionId, firstFlow.error], ["Finished", na.session.id, null]);
    await joinAssigned(backend, first, na.session.id);

    // The server registers its player and starts its session, and is on its warmup island ("waiting for players 1:26").
    await post(backend.port, `/fortnite/api/matchmaking/session/${na.session.id}/players`, na.token, { publicPlayers: [first.accountId], privatePlayers: [] });
    assert.equal((await post(backend.port, `/fortnite/api/matchmaking/session/${na.session.id}/start`, na.token, {})).status, 204);
    const answer = (await reportWarmup(backend, token, { phase: "Warmup", accountIds: [first.accountId], secondsLeft: 86 })).body;
    assert.deepEqual([answer.sessionId, answer.open], [na.session.id, true]);

    // A player who queues now is sent straight to it. Without Queued first, SessionAssignment found their client in
    // WaitingForParty: "Error communicating with the matchmaking service".
    const second = await userLogin(backend.port, "WarmupSecond");
    const secondClient = await gameClient(backend, second);
    connections.push(secondClient.connection);
    const secondFlow = await secondClient.flow;
    assert.deepEqual(secondFlow.seen, ["Connecting", "Waiting", "Queued", "SessionAssignment", "Play"]);
    assert.deepEqual([secondFlow.state, secondFlow.sessionId, secondFlow.error], ["Finished", na.session.id, null]);
    const session = await joinAssigned(backend, second, na.session.id);
    assert.equal(session.started, true);

    // A party's members, each with their own ticket: the second follows the first without queueing either.
    const leader = await userLogin(backend.port, "WarmupLeader");
    const mate = await userLogin(backend.port, "WarmupMate");
    const leaderClient = await gameClient(backend, leader, { party: [leader, mate] });
    connections.push(leaderClient.connection);
    assert.equal((await leaderClient.flow).error, null);
    const mateClient = await gameClient(backend, mate, { party: [leader, mate] });
    connections.push(mateClient.connection);
    const mateFlow = await mateClient.flow;
    assert.deepEqual([mateFlow.state, mateFlow.sessionId, mateFlow.error], ["Finished", na.session.id, null]);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

// A player on a build (its User-Agent's changelist) queued for Duos in NA, past Connecting and Waiting.
async function queueOnBuild(backend, player, changelist) {
  const ticket = await send({ host: "127.0.0.1", port: backend.port,
    path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}&bucketId=858118782:0:NA:10&player.platform=Windows`,
    headers: { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-CL-${changelist}`, Authorization: `bearer ${player.token}` } });
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  for (let index = 0; index < 2; index++) await connection.next();
  return connection;
}

// Queued's match start countdown (#160): [Players Connected, seconds until the match starts].
const startOf = (message) => ["ticket.status.numQueued", "ticket.status.matchStartDelay"].map((key) => message.payload.status[key]);

test("the match start countdown is 1.7.2's to 2.4.2's: 2.5 (CL-3889387) dropped it (#160)", () => {
  for (const build of [3700114, 3790078, 3825894, 3870737, "3870737"]) assert.ok(showsMatchStart(build), build);
  for (const build of [3532353, 3541083, 3889387, 4000000, null, undefined, "unknown"]) assert.ok(!showsMatchStart(build), build);
});

test("1.7.2 to 2.4.2's players in a forming match hear its players and the countdown to its bus; 2.5's, and all with the setting off, the queue (#160)", async () => {
  const backend = await startBackend();
  const connections = [];
  try {
    await settingsOf(backend, { matchmakingGatherSeconds: 5 });
    assert.equal((await settingsOf(backend)).body.matchStartCountdown, true);
    const na = await regionServer(backend, "CoreServer1", "NA");
    connections.push(na.connection);
    const old = await userLogin(backend.port, "StartOld");
    const newer = await userLogin(backend.port, "StartNewer");
    const oldConnection = await queueOnBuild(backend, old, 3700114);
    connections.push(oldConnection);
    // 5 s to gather and 1 s to Play, 25 s to reach the island (#167), then the early countdown (15 s) once the match's
    // players are in (late joining off).
    let queued = JSON.parse(await oldConnection.next());
    assert.equal(queued.payload.state, "Queued");
    assert.deepEqual(startOf(queued), ["1", "46"]);
    assert.equal(queued.payload.estimatedWaitSec, 6);

    // A 2.5 player joins the match: theirs is the queue as before; the 1.7.2 player's players connected count them.
    const newerConnection = await queueOnBuild(backend, newer, 3889387);
    connections.push(newerConnection);
    const newerQueued = JSON.parse(await newerConnection.next());
    assert.equal(newerQueued.payload.state, "Queued");
    assert.deepEqual(newerQueued.payload.status, {});
    do queued = JSON.parse(await oldConnection.next()); while (startOf(queued)[0] !== "2");
    assert.ok(Number(startOf(queued)[1]) <= 46, startOf(queued)[1]);

    // The panel's buffer (#167): 0 leaves the gather time and the early countdown alone.
    await settingsOf(backend, { matchStartBufferSeconds: 0 });
    assert.equal((await settingsOf(backend)).body.matchStartBufferSeconds, 0);
    do queued = JSON.parse(await oldConnection.next()); while (Number(startOf(queued)[1]) > 21);
    assert.ok(Number(startOf(queued)[1]) >= 15, startOf(queued)[1]);

    // Off, 1.7.2's queue is as before.
    await settingsOf(backend, { matchStartCountdown: false });
    assert.equal((await settingsOf(backend)).body.matchStartCountdown, false);
    do queued = JSON.parse(await oldConnection.next()); while (queued.payload.state === "Queued" && Object.keys(queued.payload.status).length);
    assert.equal(queued.payload.state, "Queued");
    assert.deepEqual(queued.payload.status, {});
    await nextOf(na.connection, "AssignMatch");
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

test("with player bots on, the countdown runs to the warmup's end, which the gameserver keeps in full for them (CoreV2 #256)", async () => {
  const backend = await startBackend();
  const connections = [];
  try {
    await settingsOf(backend, { matchmakingGatherSeconds: 5, bots: { forcePlayerAIs: true, count: 50 } });
    const na = await regionServer(backend, "CoreServer1", "NA");
    connections.push(na.connection);
    const player = await userLogin(backend.port, "StartBots");
    const connection = await queueOnBuild(backend, player, 3700114);
    connections.push(connection);
    // 5 s to gather, 1 s to Play, 25 s to reach the island (#167) and the default 120 s warmup, not the early countdown.
    assert.deepEqual(startOf(JSON.parse(await connection.next())), ["1", "151"]);
    // Bots off again: the early countdown (late joining off).
    await settingsOf(backend, { bots: { forcePlayerAIs: false } });
    let queued;
    do queued = JSON.parse(await connection.next()); while (Number(startOf(queued)[1]) > 46);
    assert.ok(Number(startOf(queued)[1]) >= 40, startOf(queued)[1]);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

test("with late joining on, the countdown runs to the warmup's end: the panel's length, the game's as reported, or a running warmup's time left (#160)", async () => {
  const backend = await startBackend({ lateJoin: true });
  const connections = [];
  try {
    await settingsOf(backend, { matchmakingGatherSeconds: 3, warmupSeconds: 60 });
    const token = await dedicatedServerToken(backend.port);
    const na = await regionServer(backend, "CoreServer1", "NA");
    connections.push(na.connection);
    const first = await userLogin(backend.port, "StartFirst");
    const firstConnection = await queueOnBuild(backend, first, 3825894);
    connections.push(firstConnection);
    // 3 s to gather, 1 s to Play, 25 s to reach the island (#167) and the panel's 60 s warmup.
    assert.deepEqual(startOf(JSON.parse(await firstConnection.next())), ["1", "89"]);
    // The game's length (no panel length) isn't known until a server reports its warmup: the gather time and the buffer.
    await settingsOf(backend, { warmupSeconds: null });
    let queued;
    do queued = JSON.parse(await firstConnection.next()); while (Number(startOf(queued)[1]) > 29);
    const assign = await nextOf(na.connection, "AssignMatch");
    na.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    assert.equal((await nextOf(firstConnection, "Play")).payload.sessionId, na.session.id);

    // On its island (the game's 90 s warmup, 40 s left): a party that queues now hears the warmup's time left and the
    // match's players, itself among them, before it is sent: the time left is the island's own, with no buffer (#167).
    await reportWarmup(backend, token, { phase: "Warmup", accountIds: [first.accountId], secondsLeft: 90 });
    await reportWarmup(backend, token, { phase: "Warmup", accountIds: [first.accountId], secondsLeft: 40 });
    const second = await userLogin(backend.port, "StartSecond");
    const secondConnection = await queueOnBuild(backend, second, 3870737);
    connections.push(secondConnection);
    queued = JSON.parse(await secondConnection.next());
    assert.equal(queued.payload.state, "Queued");
    assert.equal(startOf(queued)[0], "2");
    assert.ok(["39", "40"].includes(startOf(queued)[1]), startOf(queued)[1]);
    assert.equal(JSON.parse(await secondConnection.next()).payload.state, "SessionAssignment");
    assert.equal((await nextOf(secondConnection, "Play")).payload.sessionId, na.session.id);

    // The next match, on the game's length its build's servers reported: 90 s after the gather time and the buffer.
    await reportWarmup(backend, token, { phase: "Aircraft", accountIds: [first.accountId], secondsLeft: 0 });
    const next = await regionServer(backend, "CoreServer2", "NA");
    connections.push(next.connection);
    const third = await userLogin(backend.port, "StartThird");
    const thirdConnection = await queueOnBuild(backend, third, 3790078);
    connections.push(thirdConnection);
    assert.deepEqual(startOf(JSON.parse(await thirdConnection.next())), ["1", "119"]);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

// Core-Backend #186: the lobby's custom matchmaking key (player.option.customKey), from 2.4.
async function queueWithKey(backend, player, customKey, party = [player]) {
  const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=` +
    `${party.map(({ accountId }) => accountId).join(",")}&bucketId=858118782:0:NA:10&player.platform=Windows` +
    (customKey ? `&player.option.customKey=${encodeURIComponent(customKey)}` : ""), player.token);
  if (ticket.status !== 200) return { ticket };
  return { ticket, connection: await matchmakingClient(backend.port, authorizationOf(ticket.body)) };
}
const allowCustomKeys = (backend, player, allowed = true) => post(backend.port, `/admin/api/accounts/${player.accountId}/custom-matchmaking`, undefined, { allowed });

test("a custom key outside 4 to 16 characters is refused at the ticket, as Epic's service did (#186)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ShortKey");
    for (const key of ["abc", "x".repeat(17)]) {
      const { ticket } = await queueWithKey(backend, player, key);
      assert.equal(ticket.status, 400);
      assert.equal(ticket.body.errorCode, "errors.com.epicgames.fortnite.invalid_custom_match_key");
    }
  } finally {
    backend.close();
  }
});

test("players with the same custom key share a match of their own; a key no allowed player opened is not supported (#186)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 600 });
  const connections = [];
  try {
    const first = await regionServer(backend, "CoreServer1", "NA");
    const second = await regionServer(backend, "CoreServer2", "NA");
    connections.push(first.connection, second.connection);
    const host = await userLogin(backend.port, "KeyHost");
    const guest = await userLogin(backend.port, "KeyGuest");
    const stranger = await userLogin(backend.port, "KeyStranger");
    const publicPlayer = await userLogin(backend.port, "PublicPlayer");

    // Without the permission nobody opens a key: the service closes the connection with the client's error code.
    const early = await queueWithKey(backend, guest, "CoreKey1");
    connections.push(early.connection);
    assert.equal(await early.connection.next(), null);
    assert.deepEqual([early.connection.closeCode(), early.connection.closeReason()], [4000, "match.custom_key_not_supported"]);

    // The admin panel's permission, shown on the player and in the Matchmaking tab.
    const granted = await allowCustomKeys(backend, host);
    assert.equal(granted.body.customMatchmaking, true);
    assert.deepEqual((await get(backend.port, "/admin/api/matchmaking/overview")).body.customMatchmaking.map(({ displayName }) => displayName), ["KeyHost"]);

    const opened = await queueWithKey(backend, host, "CoreKey1");
    const joined = await queueWithKey(backend, guest, "CoreKey1");
    const refused = await queueWithKey(backend, stranger, "OtherKey");
    const unkeyed = await queueWithKey(backend, publicPlayer, null);
    connections.push(opened.connection, joined.connection, refused.connection, unkeyed.connection);
    assert.equal(await refused.connection.next(), null);
    assert.equal(refused.connection.closeReason(), "match.custom_key_not_supported");

    // The keyed match and the public one form on different servers, each with only its own players.
    const assigns = [await nextOf(first.connection, "AssignMatch"), await nextOf(second.connection, "AssignMatch")];
    const keyed = assigns.find((assign) => assign.payload.matchOptions["match.option.customKey"]);
    const open = assigns.find((assign) => !assign.payload.matchOptions["match.option.customKey"]);
    assert.ok(keyed && open);
    assert.equal(keyed.payload.matchOptions["match.option.customKey"], "CoreKey1");
    assert.deepEqual(keyed.payload.teams.flat(2).sort(), [host.accountId, guest.accountId].sort());
    assert.deepEqual(open.payload.teams.flat(2), [publicPlayer.accountId]);

    // Revoked, the player's key is no longer opened.
    assert.equal((await allowCustomKeys(backend, host, false)).body.customMatchmaking, false);
    const after = await queueWithKey(backend, host, "CoreKey2");
    connections.push(after.connection);
    assert.equal(await after.connection.next(), null);
    assert.equal(after.connection.closeReason(), "match.custom_key_not_supported");
  } finally {
    for (const connection of connections) connection?.close();
    backend.close();
  }
});

test("the warmup answer carries the player bots to add when Force player AIs or Fill players' teams is on (CoreV2 #233)", async () => {
  const backend = await startBackend();
  try {
    const token = await dedicatedServerToken(backend.port);
    const ask = async () => (await reportWarmup(backend, token, { phase: "Setup", accountIds: [] })).body.bots;
    assert.equal(await ask(), null);
    await settingsOf(backend, { bots: { forcePlayerAIs: true, count: 30, level: 7, startingHealth: 80, startingShield: 20, eliminationsCountForQuests: false, botFightChance: 55 } });
    assert.deepEqual(await ask(), { count: 30, level: 7, health: 80, shield: 20, quests: false, fights: 55, teams: false, noFill: [] });
    // Fill players' teams works without Force player AIs: no bots on teams of their own then.
    await settingsOf(backend, { bots: { fillPlayerTeams: true } });
    assert.deepEqual(await ask(), { count: 30, level: 7, health: 80, shield: 20, quests: false, fights: 55, teams: true, noFill: [] });
    await settingsOf(backend, { bots: { forcePlayerAIs: false } });
    assert.deepEqual(await ask(), { count: 0, level: 7, health: 80, shield: 20, quests: false, fights: 55, teams: true, noFill: [] });
    await settingsOf(backend, { bots: { forcePlayerAIs: true, fillPlayerTeams: false } });
    // On with no bots asked for, and off with a count, send none.
    await settingsOf(backend, { bots: { count: 0 } });
    assert.equal(await ask(), null);
    await settingsOf(backend, { bots: { count: 30, forcePlayerAIs: false } });
    assert.equal(await ask(), null);
  } finally {
    backend.close();
  }
});

// Core-Backend #227: each region's hosting IPs and the custom matchmaking servers. The backend's reverse proxy mode
// stands in for gameservers on other IPs: each request names its server's IP in X-Forwarded-For.
const mmConfig = (backend, body) => post(backend.port, "/admin/api/matchmaking/config", undefined, body);
const behindProxy = (backend, on) => post(backend.port, "/admin/api/network", undefined, { behindProxy: on });
function proxied(backend, method, path, token, ip, body) {
  const headers = { "User-Agent": certUserAgent, Authorization: `bearer ${token}` };
  if (ip) headers["X-Forwarded-For"] = ip;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return send({ host: "127.0.0.1", port: backend.port, method, path, headers }, body === undefined ? undefined : JSON.stringify(body));
}
const sessionBody = (server, name, region) => ({ ownerId: server.accountId, ownerName: name, serverName: name, serverAddress: "127.0.0.1", serverPort: 7777,
  maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "858118782", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: region } });
// A Battle Royale server at ip (none: this PC) in a region, registered with the matchmaking service.
async function serverAt(backend, name, region, ip) {
  const server = await userLogin(backend.port, name);
  const created = await proxied(backend, "POST", "/fortnite/api/matchmaking/session", server.token, ip, sessionBody(server, name, region));
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const patterns = encodeURIComponent(`858118782:0:${region}:*,858118782:0:${region}:*:*:*`);
  const ticket = await proxied(backend, "GET", `/fortnite/api/game/v2/matchmakingservice/ticket/session/${created.body.id}?bucketIds=${patterns}&minPlayers=1&maxPlayers=100`, server.token, ip);
  assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  assert.equal(JSON.parse(await connection.next()).name, "Registered");
  return { ...server, session: created.body, connection };
}

test("a region's hosting IPs: a server from another IP is refused for it, through the proxy only in proxy mode (#227)", async () => {
  const backend = await startBackend();
  try {
    // Anything but IP addresses and CIDR ranges, or an unknown region, is refused.
    assert.equal((await mmConfig(backend, { regionHostingIps: { EU: ["eu.example.com"] } })).status, 400);
    assert.equal((await mmConfig(backend, { regionHostingIps: { MARS: ["203.0.113.0/24"] } })).status, 400);
    assert.equal((await mmConfig(backend, { regionHostingIps: { EU: "203.0.113.0/24" } })).status, 400);
    const saved = await mmConfig(backend, { regionHostingIps: { EU: ["203.0.113.0/24"] } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.regionHostingIps, { EU: ["203.0.113.0/24"] });

    // This PC (127.0.0.1) isn't one of EU's: its EU server is refused, its NA one (no IPs listed) isn't.
    const local = await userLogin(backend.port, "CoreServer1");
    const refused = await proxied(backend, "POST", "/fortnite/api/matchmaking/session", local.token, null, sessionBody(local, "CoreServer1", "gb"));
    assert.equal(refused.status, 403);
    assert.match(refused.body.errorMessage, /can't host for EU/);
    // The header is the client's to write while the backend isn't behind a proxy: it changes nothing.
    assert.equal((await proxied(backend, "POST", "/fortnite/api/matchmaking/session", local.token, "203.0.113.5", sessionBody(local, "CoreServer1", "EU"))).status, 403);
    const na = await proxied(backend, "POST", "/fortnite/api/matchmaking/session", local.token, null, sessionBody(local, "CoreServer1", "NA"));
    assert.equal(na.status, 200);
    // Moved to EU, it is refused too.
    const moved = await proxied(backend, "PUT", `/fortnite/api/matchmaking/session/${na.body.id}`, local.token, null, { attributes: { REGION_s: "EU" } });
    assert.equal(moved.status, 403);

    // Behind a proxy, the IP the proxy names: a Trusted Hosting IP in EU's range hosts for EU, one outside it doesn't.
    assert.equal((await behindProxy(backend, true)).body.behindProxy, true);
    await settingsOf(backend, { allowedHostingIps: ["127.0.0.1", "::1", "203.0.113.5", "198.51.100.9"] });
    const eu = await serverAt(backend, "CoreServer2", "EU", "203.0.113.5");
    eu.connection.close();
    const outsider = await userLogin(backend.port, "CoreServer3");
    assert.equal((await proxied(backend, "POST", "/fortnite/api/matchmaking/session", outsider.token, "198.51.100.9", sessionBody(outsider, "CoreServer3", "EU"))).status, 403);

    // A region's IPs listed after its server registered: its matchmaking ticket is refused.
    await mmConfig(backend, { regionHostingIps: { EU: ["203.0.113.0/24"], NA: ["192.0.2.0/24"] } });
    const patterns = encodeURIComponent("858118782:0:NA:*");
    const ticket = await proxied(backend, "GET", `/fortnite/api/game/v2/matchmakingservice/ticket/session/${na.body.id}?bucketIds=${patterns}&minPlayers=1&maxPlayers=100`, local.token, null);
    assert.equal(ticket.status, 403);
    // Emptied, a region takes any IP again.
    await mmConfig(backend, { regionHostingIps: {} });
    assert.equal((await proxied(backend, "POST", "/fortnite/api/matchmaking/session", outsider.token, "198.51.100.9", sessionBody(outsider, "CoreServer3", "EU"))).status, 200);
  } finally {
    backend.close();
  }
});

test("custom matchmaking servers take only custom matches, their own first, public servers only with the fallback (#227)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 300 });
  const connections = [];
  try {
    await behindProxy(backend, true);
    await settingsOf(backend, { allowedHostingIps: ["127.0.0.1", "::1", "203.0.113.5", "198.51.100.9"] });
    const host = await userLogin(backend.port, "KeptHost");
    await allowCustomKeys(backend, host);
    assert.match((await mmConfig(backend, { customMatchServers: [{ address: "203.0.113.5", keys: ["abc"] }] })).body.errorMessage, /between 4 and 16/);
    assert.match((await mmConfig(backend, { customMatchServers: [{ address: "203.0.113.5", accounts: ["NoSuchPlayer"] }] })).body.errorMessage, /No player named/);
    const saved = await mmConfig(backend, { customMatchServers: [{ address: "203.0.113.5", keys: ["CoreKey1"], accounts: ["KeptHost"] }] });
    assert.deepEqual(saved.body.customMatchServers, [{ address: "203.0.113.5", keys: ["CoreKey1"], accounts: [{ id: host.accountId, displayName: "KeptHost" }] }]);
    assert.equal(saved.body.customMatchFallback, false);

    // The public server registers first, so it comes first in the service's list.
    const open = await serverAt(backend, "CoreServer1", "NA", "198.51.100.9");
    const kept = await serverAt(backend, "CoreServer2", "NA", "203.0.113.5");
    connections.push(open.connection, kept.connection);

    // The custom match goes to its own server, and the public one never does.
    const publicPlayer = await userLogin(backend.port, "OpenPlayer");
    const unkeyed = await queueWithKey(backend, publicPlayer, null);
    connections.push(unkeyed.connection);
    assert.deepEqual((await nextOf(open.connection, "AssignMatch")).payload.teams.flat(2), [publicPlayer.accountId]);
    const keyed = await queueWithKey(backend, host, "CoreKey1");
    connections.push(keyed.connection);
    const assign = await nextOf(kept.connection, "AssignMatch");
    assert.equal(assign.payload.matchOptions["match.option.customKey"], "CoreKey1");
    kept.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    assert.equal((await nextOf(keyed.connection, "Play")).payload.sessionId, kept.session.id);

    // Its server busy, a match of its key waits for it (no fallback), while one of a key with no server of its own takes a
    // public server. The host's other key: the entry takes its matches too (the host is listed), so a second public
    // server is needed to see it.
    const spare = await serverAt(backend, "CoreServer3", "NA", "198.51.100.9");
    connections.push(spare.connection);
    await mmConfig(backend, { customMatchServers: [{ address: "203.0.113.5", keys: ["CoreKey1"] }] });
    // Another host: the first's own ticket would follow its party to its earlier match.
    const second = await userLogin(backend.port, "KeptHost2");
    await allowCustomKeys(backend, second);
    const waiting = await queueWithKey(backend, second, "CoreKey1");
    connections.push(waiting.connection);
    const other = await queueWithKey(backend, host, "OtherKey");
    connections.push(other.connection);
    const otherAssign = await nextOf(spare.connection, "AssignMatch");
    assert.equal(otherAssign.payload.matchOptions["match.option.customKey"], "OtherKey");
    spare.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: otherAssign.payload.matchId, result: "ready" } }));
    assert.equal((await nextOf(other.connection, "Play")).payload.sessionId, spare.session.id);

    // CoreKey1's match is still waiting; with the fallback on it takes a public server.
    const free = await serverAt(backend, "CoreServer4", "NA", "198.51.100.9");
    connections.push(free.connection);
    const pending = nextOf(free.connection, "AssignMatch");
    const quiet = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve(null), 1500))]);
    assert.equal(quiet, null);
    assert.equal((await mmConfig(backend, { customMatchFallback: true })).body.customMatchFallback, true);
    const fallback = await pending;
    assert.equal(fallback.payload.matchOptions["match.option.customKey"], "CoreKey1");
    assert.deepEqual(fallback.payload.teams.flat(2), [second.accountId]);
  } finally {
    for (const connection of connections) connection?.close();
    backend.close();
  }
});

// Core-Backend #282: a tournament event's dedicated servers and its own bots. While Solo Showdown's event runs, its
// matches play only on its servers, which take no other playlist's; the warmup answer gives its matches the event's bots.
const userAgent42 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.2-CL-4072250";
async function queueOn42(backend, player, playlistId) {
  const ticket = await send({ host: "127.0.0.1", port: backend.port, method: "GET",
    path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}&bucketId=858118782:0:NA:${playlistId}&player.platform=Windows`,
    headers: { "User-Agent": userAgent42, Authorization: `bearer ${player.token}` } });
  assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
  return matchmakingClient(backend.port, authorizationOf(ticket.body));
}

test("a tournament event's servers host only its playlist's matches, and its matches play with its own bots (#282)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200 });
  const connections = [];
  try {
    await behindProxy(backend, true);
    await settingsOf(backend, { allowedHostingIps: ["127.0.0.1", "::1", "203.0.113.5", "198.51.100.9"] });
    await mmConfig(backend, { modes: { soloShowdown: true } });
    // Anything but IPs or ranges, or a bot count past 100, is refused.
    assert.equal((await post(backend.port, "/admin/api/tournaments", undefined, { servers: ["tourney.example.com"] })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/tournaments", undefined, { bots: { enabled: true, count: 101 } })).status, 400);
    const created = await post(backend.port, "/admin/api/tournaments", undefined, { name: "Showdown", servers: ["203.0.113.5"], bots: { enabled: true, count: 7 } });
    assert.equal(created.status, 201);
    assert.deepEqual([created.body.event.servers, created.body.event.bots], [["203.0.113.5"], { enabled: true, count: 7 }]);
    const eventId = created.body.event.id;

    // A public server, the event's two, then another public one.
    const publicA = await serverAt(backend, "CoreServer1", "NA", "198.51.100.9");
    const kept = await serverAt(backend, "CoreServer2", "NA", "203.0.113.5");
    const kept2 = await serverAt(backend, "CoreServer3", "NA", "203.0.113.5");
    const publicB = await serverAt(backend, "CoreServer4", "NA", "198.51.100.9");
    connections.push(publicA.connection, kept.connection, kept2.connection, publicB.connection);
    const ready = (server, assign) => server.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));

    // The Solo Showdown match skips the public server before the event's.
    const showdown = await userLogin(backend.port, "ShowdownPlayer");
    connections.push(await queueOn42(backend, showdown, 51));
    const showdownAssign = await nextOf(kept.connection, "AssignMatch");
    assert.deepEqual(showdownAssign.payload.teams.flat(2), [showdown.accountId]);
    ready(kept, showdownAssign);
    // Solos: the first public server, then the second, past the event's free one.
    const solo1 = await userLogin(backend.port, "SoloOne");
    connections.push(await queueOn42(backend, solo1, 2));
    const solo1Assign = await nextOf(publicA.connection, "AssignMatch");
    ready(publicA, solo1Assign);
    const solo2 = await userLogin(backend.port, "SoloTwo");
    connections.push(await queueOn42(backend, solo2, 2));
    assert.deepEqual((await nextOf(publicB.connection, "AssignMatch")).payload.teams.flat(2), [solo2.accountId]);

    // The event's bots for its match, the Matchmaking tab's (off) for the solo.
    const token = await dedicatedServerToken(backend.port);
    const botsOf = async (player) => (await reportWarmup(backend, token, { phase: "Warmup", accountIds: [player.accountId], secondsLeft: 60 })).body.bots;
    assert.equal((await botsOf(showdown)).count, 7);
    assert.equal(await botsOf(solo1), null);
    // The Matchmaking tab's on and the event's off: the other way round, the tab's level still the solo's.
    await settingsOf(backend, { bots: { forcePlayerAIs: true, count: 30, level: 3 } });
    const off = await post(backend.port, `/admin/api/tournaments/${eventId}/settings`, undefined, { bots: { enabled: false } });
    assert.deepEqual([off.body.event.servers, off.body.event.bots], [["203.0.113.5"], { enabled: false, count: 0 }]);
    assert.equal(await botsOf(showdown), null);
    assert.deepEqual([(await botsOf(solo1)).count, (await botsOf(solo1)).level], [30, 3]);
    // On with its own count, the tab's level; back to the tab's, its count.
    await post(backend.port, `/admin/api/tournaments/${eventId}/settings`, undefined, { bots: { enabled: true, count: 12 } });
    assert.deepEqual([(await botsOf(showdown)).count, (await botsOf(showdown)).level], [12, 3]);
    await post(backend.port, `/admin/api/tournaments/${eventId}/settings`, undefined, { bots: null });
    assert.equal((await botsOf(showdown)).count, 30);
    assert.equal((await post(backend.port, `/admin/api/tournaments/${eventId}/settings`, undefined, { servers: ["nope"] })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/tournaments/nope/settings", undefined, { bots: null })).status, 404);
  } finally {
    for (const connection of connections) connection?.close();
    backend.close();
  }
});

test("an ended event's servers take any match again, and its playlist plays on the normal pool (#282)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200 });
  const connections = [];
  try {
    await behindProxy(backend, true);
    await settingsOf(backend, { allowedHostingIps: ["127.0.0.1", "::1", "203.0.113.5", "198.51.100.9"] });
    const created = await post(backend.port, "/admin/api/tournaments", undefined, { servers: ["203.0.113.0/24"] });
    await post(backend.port, `/admin/api/tournaments/${created.body.event.id}/end`, undefined, {});
    const kept = await serverAt(backend, "CoreServer1", "NA", "203.0.113.5");
    connections.push(kept.connection);
    const solo = await userLogin(backend.port, "SoloAfter");
    connections.push(await queueOn42(backend, solo, 2));
    assert.deepEqual((await nextOf(kept.connection, "AssignMatch")).payload.teams.flat(2), [solo.accountId]);
  } finally {
    for (const connection of connections) connection?.close();
    backend.close();
  }
});

// Core-Backend #299: Playground (Playlist_Playground, 35) is its party's alone, as Update v4.50 ran it: a session of its
// own, assigned at once and sized to the party, which no other party joins, forming or in its warmup.
const userAgent45 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.5-CL-4166199";
async function queueOn45(backend, player, party = [player], { playlistId = 35, fill = null, playlist = playlistId } = {}) {
  const ticket = await send({ host: "127.0.0.1", port: backend.port, method: "GET",
    path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${party.map(({ accountId }) => accountId).join(",")}` +
      `&bucketId=858118782:0:NA:${playlist}&player.platform=Windows${fill === null ? "" : `&player.option.fillTeam=${fill}`}`,
    headers: { "User-Agent": userAgent45, Authorization: `bearer ${player.token}` } });
  assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  for (let index = 0; index < 2; index++) await connection.next();
  return connection;
}

test("Playground is a match of the party's own: assigned at once, no other party joins it, its warmup closed and sized to the party (#299)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 5000 });
  const connections = [];
  try {
    await settingsOf(backend, { lateJoin: true, bots: { forcePlayerAIs: false, fillPlayerTeams: true } });
    const token = await dedicatedServerToken(backend.port);
    const first = await regionServer(backend, "PlaygroundServer1", "NA");
    connections.push(first.connection);
    const leader = await userLogin(backend.port, "PgLeader");
    const mate = await userLogin(backend.port, "PgMate");
    const started = Date.now();
    // On Fill: from 4.4 a party without player.option.fillTeam plays without fill (#377).
    const leaderConnection = await queueOn45(backend, leader, [leader, mate], { fill: true });
    connections.push(leaderConnection);
    // No gather wait: nobody else would join.
    const assign = await nextOf(first.connection, "AssignMatch");
    assert.ok(Date.now() - started < 3000);
    assert.deepEqual(assign.payload.teams.flat(2), [leader.accountId, mate.accountId]);

    // Another Playground party doesn't join the match while it forms: it waits for a server of its own.
    const solo = await userLogin(backend.port, "PgSolo");
    const soloConnection = await queueOn45(backend, solo);
    connections.push(soloConnection);
    assert.equal(JSON.parse(await soloConnection.next()).payload.state, "Queued");
    const second = await regionServer(backend, "PlaygroundServer2", "NA");
    connections.push(second.connection);
    assert.deepEqual((await nextOf(second.connection, "AssignMatch")).payload.teams.flat(2), [solo.accountId]);

    // The party's other member follows it.
    const mateConnection = await queueOn45(backend, mate, [leader, mate]);
    connections.push(mateConnection);
    first.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    assert.equal((await nextOf(leaderConnection, "Play")).payload.sessionId, first.session.id);
    assert.equal((await nextOf(mateConnection, "Play")).payload.sessionId, first.session.id);

    // In its warmup, with late joining on, the match stays closed, its room the party's, its bots the panel's.
    const answer = (await reportWarmup(backend, token, { phase: "Warmup", accountIds: [leader.accountId], secondsLeft: 60 })).body;
    assert.deepEqual([answer.sessionId, answer.open, answer.lateJoin, answer.maxPlayers, answer.parties], [first.session.id, false, false, 2, []]);
    assert.equal(answer.bots.teams, true);
    assert.deepEqual(answer.bots.noFill, []);
    const late = await userLogin(backend.port, "PgLate");
    const lateConnection = await queueOn45(backend, late);
    connections.push(lateConnection);
    assert.equal(JSON.parse(await lateConnection.next()).payload.state, "Queued");
    await reportWarmup(backend, token, { phase: "Warmup", accountIds: [leader.accountId, mate.accountId], secondsLeft: 50 });
    // Nothing sends it there: within a second it hears no SessionAssignment.
    const heard = await Promise.race([lateConnection.next(), new Promise((done) => setTimeout(() => done("none"), 1000))]);
    assert.ok(heard === "none" || JSON.parse(heard).payload?.state === "Queued", heard);

    // A party playing without fill gets no bot teammates there either.
    const third = await regionServer(backend, "PlaygroundServer3", "NA");
    connections.push(third.connection);
    const lateAssign = await nextOf(third.connection, "AssignMatch");
    assert.deepEqual(lateAssign.payload.teams.flat(2), [late.accountId]);
    const noFill = await userLogin(backend.port, "PgNoFill");
    const noFillConnection = await queueOn45(backend, noFill, [noFill], { fill: false });
    connections.push(noFillConnection);
    const fourth = await regionServer(backend, "PlaygroundServer4", "NA");
    connections.push(fourth.connection);
    const noFillAssign = await nextOf(fourth.connection, "AssignMatch");
    fourth.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: noFillAssign.payload.matchId, result: "ready" } }));
    await nextOf(noFillConnection, "Play");
    const noFillAnswer = (await reportWarmup(backend, token, { phase: "Warmup", accountIds: [noFill.accountId], secondsLeft: 60 })).body;
    assert.deepEqual([noFillAnswer.open, noFillAnswer.maxPlayers, noFillAnswer.noFill, noFillAnswer.bots.noFill], [false, 1, [noFill.accountId], [noFill.accountId]]);

    // Duos still gather and open in their warmup as before.
    assert.equal((await reportWarmup(backend, token, { phase: "Warmup", accountIds: [], secondsLeft: 60 })).body.lateJoin, true);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

// CoreV2 #377: from 4.4 the leader's client sends player.option.fillTeam only as "true" (Fill) and leaves it out for
// No Fill, so a 4.4+ party whose tickets don't carry it plays without fill: no bots on its team.
test("a 4.4+ party whose tickets leave out player.option.fillTeam plays without fill; one that sends true fills (#377)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 300 });
  const connections = [];
  try {
    await settingsOf(backend, { bots: { forcePlayerAIs: false, fillPlayerTeams: true } });
    const token = await dedicatedServerToken(backend.port);
    const leader = await userLogin(backend.port, "NoFillLeader");
    const mate = await userLogin(backend.port, "NoFillMate");
    const filler = await userLogin(backend.port, "FillLeader");
    connections.push(await queueOn45(backend, leader, [leader, mate], { playlistId: 9 }));
    connections.push(await queueOn45(backend, mate, [leader, mate], { playlistId: 9 }));
    connections.push(await queueOn45(backend, filler, [filler], { playlistId: 9, fill: true }));
    const server = await regionServer(backend, "NoFillServer", "NA");
    connections.push(server.connection);
    const assign = await nextOf(server.connection, "AssignMatch");
    // The No Fill pair keeps its squad to itself; the solo that fills is in one of its own.
    assert.deepEqual(assign.payload.teams.map((team) => team.flat().sort()).sort(),
      [[leader.accountId, mate.accountId].sort(), [filler.accountId]].sort());
    server.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    const answer = (await reportWarmup(backend, token, { phase: "Warmup", accountIds: [leader.accountId], secondsLeft: 60 })).body;
    assert.deepEqual([...answer.bots.noFill].sort(), [leader.accountId, mate.accountId].sort());
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

test("a Playground ticket that names its playlist, as 4.5's client sends it, is the party's alone (#299)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 5000 });
  const connections = [];
  try {
    const first = await regionServer(backend, "NamedPgServer1", "NA");
    connections.push(first.connection);
    const leader = await userLogin(backend.port, "NamedPgLeader");
    const started = Date.now();
    connections.push(await queueOn45(backend, leader, [leader], { playlist: "playlist_playground" }));
    const assign = await nextOf(first.connection, "AssignMatch");
    assert.ok(Date.now() - started < 3000);
    assert.equal(assign.payload.bucketId, "858118782:0:NA:playlist_playground");
    const other = await userLogin(backend.port, "NamedPgOther");
    const otherConnection = await queueOn45(backend, other, [other], { playlist: "playlist_playground" });
    connections.push(otherConnection);
    assert.equal(JSON.parse(await otherConnection.next()).payload.state, "Queued");
    const second = await regionServer(backend, "NamedPgServer2", "NA");
    connections.push(second.connection);
    assert.deepEqual((await nextOf(second.connection, "AssignMatch")).payload.teams.flat(2), [other.accountId]);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

// Core-Backend #301: 5.0 (UE 4.21, CL-4204761 and CL-4214610) matchmakes as 4.5 does. Its client's ticket bucket is still
// "%u:%d:%s:%s" (<netcl>:<hotfix>:<QoS region>:<playlist>, UFortMatchmakingV2::StartMatchmaking 0xFF0170 in CL-4204761),
// its server's patterns "%u:%d:%s:**" and "%u:%d:%s:%s:**" (0xFC7980), and the MMS messages and Play's matchId, sessionId
// and joinDelaySec (0x6D4130) are 4.5's: a 5.0 player is matched to a 5.0 server of the same netcl, on either changelist.
test("a 5.0 player is matched to a registered 5.0 server on either changelist (#301)", async () => {
  for (const build of ["4204761", "4214610"]) {
    const agent = `game=Fortnite, engine=UE4, build=++Fortnite+Release-5.0-CL-${build}`;
    const as = (port, urlPath, token, method = "GET", body) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const headers = { "User-Agent": agent, Authorization: `bearer ${token}` };
      if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
    };
    const backend = await startBackend({ matchmakingGatherMs: 100 });
    const clients = [];
    try {
      const server = await userLogin(backend.port, `Server${build}`);
      const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
        ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
        maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
      })).body;
      const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
        `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
        server.token)).body));
      clients.push(gameserver);
      assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
      const player = await userLogin(backend.port, `Solo${build}`);
      const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${build}:0:nae:2&player.platform=Windows&player.option.fillTeam=true`, player.token);
      assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
      const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
      clients.push(client);
      const assign = await nextOf(gameserver, "AssignMatch");
      assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${build}:0:NAE:2`);
      assert.deepEqual(assign.payload.teams, [[[player.accountId]]]);
      gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
      const play = await nextOf(client, "Play");
      assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
    } finally {
      for (const client of clients) client.close();
      backend.close();
    }
  }
});

// Core-Backend #314: 5.10's to 5.30's shipped lobbies offer Playground (FrontEndPlaylistData), so it matchmakes by default:
// a 5.30 party's playlist_playground ticket is taken with the admin panel untouched, and the party gets a 5.30 server of its
// own, whose AssignMatch keeps the playlist's name for OnGivenMatchAssignment.
test("5.30's Playground matchmakes by default: the ticket is taken and the party gets a server of its own (#314)", async () => {
  const build = "4305896";
  const agent = `Fortnite/++Fortnite+Release-5.30-CL-${build} Windows/10.0.19045.1.256.64bit`;
  const as = (port, urlPath, token, method = "GET", body) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = { "User-Agent": agent, Authorization: `bearer ${token}` };
    if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
    return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
  };
  const backend = await startBackend({ matchmakingGatherMs: 5000 });
  const clients = [];
  try {
    const server = await userLogin(backend.port, "Server530");
    const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
      ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
    })).body;
    const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
      `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
      server.token)).body));
    clients.push(gameserver);
    assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
    const leader = await userLogin(backend.port, "Pg530Leader");
    const mate = await userLogin(backend.port, "Pg530Mate");
    const party = `${leader.accountId},${mate.accountId}`;
    const started = Date.now();
    const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${leader.accountId}?partyPlayerIds=${party}` +
      `&bucketId=${build}:0:NAE:playlist_playground&player.platform=Windows&player.option.fillTeam=false`, leader.token);
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
    clients.push(client);
    const assign = await nextOf(gameserver, "AssignMatch");
    assert.ok(Date.now() - started < 3000, "assigned at once: nobody else joins a Playground match");
    assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${build}:0:NAE:playlist_playground`);
    assert.deepEqual(assign.payload.teams.flat(2), [leader.accountId, mate.accountId]);
    gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    const play = await nextOf(client, "Play");
    assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});
