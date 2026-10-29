import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bucketKey, bucketMatches, estimatedWaitSec, formTeams, parseBucket, serverRegion, teamSizeOf, withRegion } from "../src/matchmaking/service.js";
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
          const payload = buffer.subarray(offset, offset + length).toString("utf8");
          buffer = buffer.subarray(offset + length);
          if (opcode === 0x1) deliver(payload);
          if (opcode === 0x8) closed = true;
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
        close: () => socket.destroy()
      });
    });
    request.end();
  });
}

const authorizationOf = ({ ticketType, payload, signature }) => `Epic-Signed ${ticketType} ${payload} ${signature}`;

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
  assert.deepEqual(["858118782:0:NA:2", "858118782:0:NA:10", "858118782:0:NA:9", "1944448041:0:NA:9:1:0", "858118782:0:NA:7", ""].map(teamSizeOf),
    [1, 2, 4, 4, null, null]);
  const party = (fill, ...players) => ({ players, fill });
  // Squads: biggest first, so a solo tops up the three and two duos pair up; No Fill parties stay alone, and so does a
  // solo left with no team that has room.
  assert.deepEqual(formTeams([party(true, "a"), party(true, "b", "c"), party(false, "d"), party(true, "e", "f", "g"), party(true, "h"),
    party(true, "i", "j"), party(false, "k", "l")], 4),
  [[["e", "f", "g"], ["a"]], [["b", "c"], ["i", "j"]], [["k", "l"]], [["d"]], [["h"]]]);
  // Duos pair up two solos that fill; Solo is a team each; an unknown playlist keeps each party a team.
  assert.deepEqual(formTeams([party(true, "a"), party(false, "b"), party(true, "c")], 2), [[["a"], ["c"]], [["b"]]]);
  assert.deepEqual(formTeams([party(true, "a"), party(true, "b")], 1), [[["a"]], [["b"]]]);
  assert.deepEqual(formTeams([party(true, "a"), party(true, "b", "c")], null), [[["a"]], [["b", "c"]]]);
  // A party bigger than a team is split, or the server would have no team with room for its reservation.
  assert.deepEqual(formTeams([party(true, "a", "b", "c"), party(true, "d")], 2), [[["a", "b"]], [["c"], ["d"]]]);
  assert.deepEqual(formTeams([party(false, "a", "b", "c"), party(true, "d")], 2), [[["a", "b"]], [["c"]], [["d"]]]);
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

test("the gather time, warmup and late joining are settings, kept over a restart and set from config.json (#122)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-mmwait-"));
  let backend = await startBackend({ dataDir });
  try {
    let saved = (await settingsOf(backend)).body;
    // Today's behaviour: 10 s to gather, the game's warmup, no late joining.
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin], [10, null, false]);
    saved = (await settingsOf(backend, { matchmakingGatherSeconds: "25", warmupSeconds: 90, lateJoin: true })).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin], [25, 90, true]);
    // Out of range or not a whole number: ignored.
    saved = (await settingsOf(backend, { matchmakingGatherSeconds: 301, warmupSeconds: 5, lateJoin: "yes" })).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin], [25, 90, true]);
    saved = (await settingsOf(backend, { matchmakingGatherSeconds: 1.5, warmupSeconds: 1801 })).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds], [25, 90]);
    backend.close();
    backend = await startBackend({ dataDir });
    saved = (await settingsOf(backend)).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin], [25, 90, true]);
    // A blank warmup is the game's again.
    saved = (await settingsOf(backend, { warmupSeconds: "" })).body;
    assert.equal(saved.warmupSeconds, null);
  } finally {
    backend.close();
  }

  backend = await startBackend({ matchmakingGatherSeconds: 0, warmupSeconds: 45, lateJoin: true });
  try {
    const saved = (await settingsOf(backend)).body;
    assert.deepEqual([saved.matchmakingGatherSeconds, saved.warmupSeconds, saved.lateJoin], [0, 45, true]);
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
