import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { bucketMatches, estimatedWaitSec, parseBucket } from "../src/matchmaking/service.js";
import { get, post, startBackend, userLogin } from "./helpers.js";

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
