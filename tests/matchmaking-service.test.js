import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bucketKey, bucketMatches, estimatedWaitSec, formTeams, parseBucket, playlistTeamsOf, serverRegion, withRegion } from "../src/matchmaking/service.js";
import { regionOf } from "../src/matchmaking/regions.js";
import { dedicatedServerToken, del, get, post, startBackend, userLogin } from "./helpers.js";

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

    // The server asks who has won before when its match is assigned, and records the winners at its end.
    const winners = await post(backend.port, "/fortnite/api/game/v2/battleroyale/winners", server.token, { playlistId: 10, accountIds: [leader.accountId] });
    assert.deepEqual(winners.body, { playlistId: 10, winners: [] });
    assert.equal((await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", server.token, { playlistId: 10, accountIds: [leader.accountId] })).status, 204);

    const refused = await matchmakingClient(backend.port, authorizationOf({ ...ticket.body, signature: "AAAA" }));
    assert.equal(JSON.parse(await refused.next()).name, "Error");
    assert.equal(await refused.next(), null);
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
    // Today's behaviour: 10 s to gather, the game's warmup, no late joining, another region when theirs has no server.
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin, saved.regionFallback], [10, null, false, true]);
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
      { warmupSeconds: null, lateJoin: false, sessionId: null, open: false, maxPlayers: null, parties: [] });
    await settingsOf(backend, { warmupSeconds: 120 });
    assert.equal((await reportWarmup(backend, token, { phase: "Setup", accountIds: [] })).body.warmupSeconds, 120);
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
