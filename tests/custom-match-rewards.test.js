import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { grantAthenaQuest } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #186: a custom matchmaking key's match gives no challenge progress, season XP or V-Bucks while the admin
// panel's "Custom matches give no challenge progress or rewards" is on (its default); a public match is unchanged.
const agent18 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489";

// The matchmaking service's WebSocket, with the ticket in its Authorization header (as tests/matchmaking-service.test.js).
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
          const frame = buffer.subarray(offset, offset + length);
          buffer = buffer.subarray(offset + length);
          if (opcode === 0x1) deliver(frame.toString("utf8"));
          if (opcode === 0x8) closed = true;
        }
      };
      receive(head);
      socket.on("data", receive);
      socket.on("close", () => {
        closed = true;
        while (waiters.length) waiters.shift()(null);
      });
      resolve({
        send: (text) => {
          const payload = Buffer.from(text);
          const mask = crypto.randomBytes(4);
          socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))]));
        },
        next: () => (messages.length ? Promise.resolve(messages.shift()) : closed ? Promise.resolve(null) : new Promise((done) => waiters.push(done))),
        close: () => socket.destroy()
      });
    });
    request.end();
  });
}
const authorizationOf = ({ ticketType, payload, signature }) => `Epic-Signed ${ticketType} ${payload} ${signature}`;
async function nextOf(connection, name) {
  let message;
  do message = JSON.parse(await connection.next()); while (message.name !== name);
  return message;
}

async function gameServer(backend, name) {
  const server = await userLogin(backend.port, name);
  const session = (await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
    ownerId: server.accountId, ownerName: name, serverName: name, serverAddress: "127.0.0.1", serverPort: 7777,
    maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "858118782", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
  })).body;
  const patterns = encodeURIComponent("858118782:0:NA:*,858118782:0:NA:*:*:*");
  const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${patterns}&minPlayers=1&maxPlayers=100`, server.token);
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  assert.equal(JSON.parse(await connection.next()).name, "Registered");
  return { ...server, session, connection };
}

async function queue(backend, player, customKey) {
  const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
    "&bucketId=858118782:0:NA:10&player.platform=Windows" + (customKey ? `&player.option.customKey=${customKey}` : ""), player.token);
  return matchmakingClient(backend.port, authorizationOf(ticket.body));
}

function command(port, { accountId, token }, name, body = {}, route = "client") {
  const text = JSON.stringify(body);
  return send({ host: "127.0.0.1", port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/${route}/${name}?profileId=athena&rvn=-1`,
    headers: { "User-Agent": agent18, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
}
const athenaOf = (body) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === "athena");
const athena = async (port, player) => athenaOf((await command(port, player, "QueryProfile")).body).profileChanges[0].profile;
const balance = async (backend, player) => Object.values((await post(backend.port,
  `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, player.token, {})).body.profileChanges[0].profile.items)
  .filter((item) => /^currency:mtx/i.test(item.templateId) && item.attributes.platform === "Epic").reduce((total, item) => total + item.quantity, 0);
const solo = { perKill: 10, perWin: 100, placements: [] };
const rewards = { solo, duos: solo, squads: solo, fiftyFifty: solo };

test("a custom key's match gives no challenge progress, XP or V-Bucks; a public match does, and the switch turns it off (#186)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 300 });
  const connections = [];
  try {
    // On by default, shown and saved on the Matchmaking tab.
    assert.equal((await get(backend.port, "/admin/api/matchmaking/overview")).body.customMatchNoRewards, true);
    await post(backend.port, "/admin/api/settings", undefined, { battleRoyaleVbucks: true, battleRoyaleRewards: rewards });

    const first = await gameServer(backend, "CoreServer1");
    const second = await gameServer(backend, "CoreServer2");
    connections.push(first.connection, second.connection);
    const custom = await userLogin(backend.port, "CustomPlayer");
    const normal = await userLogin(backend.port, "PublicPlayer");
    assert.equal((await post(backend.port, `/admin/api/accounts/${custom.accountId}/custom-matchmaking`, undefined, { allowed: true })).status, 200);
    const chests = {};
    for (const player of [custom, normal]) {
      await athena(backend.port, player);
      const session = openSession(createProfileStore(backend.dataDir), player.accountId);
      chests[player.accountId] = grantAthenaQuest(session.profile("athena"), "athenadailyquest_interacttreasurechest");
      session.commit();
    }
    const startBalance = { [custom.accountId]: await balance(backend, custom), [normal.accountId]: await balance(backend, normal) };

    const players = [await queue(backend, custom, "CoreKey1"), await queue(backend, normal, null)];
    connections.push(...players);
    for (const server of [first, second]) {
      const assign = await nextOf(server.connection, "AssignMatch");
      server.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    }
    // Each player joins the session they were sent to: its key fetch makes them its member.
    for (const [player, connection] of [[custom, players[0]], [normal, players[1]]]) {
      const { sessionId } = (await nextOf(connection, "Play")).payload;
      assert.equal((await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${player.accountId}/session/${sessionId}`, player.token)).status, 200);
    }

    // The gameserver's quest progress and its results, as CoreV2 sends them.
    const dedicated = await dedicatedServerToken(backend.port);
    const report = async (player, matchId) => (await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated,
      { playlistId: 2, matchId, countWins: true, results: [{ accountId: player.accountId, place: 1, kills: 5, secondsAlive: 1200 }] })).body.results[0];
    for (const player of [custom, normal]) {
      assert.equal((await command(backend.port, { accountId: player.accountId, token: dedicated }, "UpdateQuests",
        { advance: [{ statName: "daily_athena_loot_chest", count: 5 }] }, "dedicated_server")).status, 200);
    }
    // 1.8's EndBattleRoyaleGame carries quest progress too.
    assert.equal((await command(backend.port, { accountId: custom.accountId, token: dedicated }, "EndBattleRoyaleGame",
      { advance: [{ statName: "daily_athena_loot_chest", count: 5 }], matchType: "AthenaSolo", placement: 1 }, "dedicated_server")).status, 200);
    const customResult = await report(custom, "custom-1");
    const normalResult = await report(normal, "public-1");

    // The custom match: no quest progress, XP or V-Bucks, and an end-of-match answer with nothing gained.
    let profile = await athena(backend.port, custom);
    assert.equal(profile.items[chests[custom.accountId]].attributes.quest_state, "Active");
    assert.equal(profile.items[chests[custom.accountId]].attributes.completion_daily_athena_loot_chest ?? 0, 0);
    assert.deepEqual([profile.stats.attributes.level ?? 1, profile.stats.attributes.xp ?? 0], [1, 0]);
    assert.equal(await balance(backend, custom), startBalance[custom.accountId]);
    assert.deepEqual([customResult.accountId, customResult.totalSeasonXpGained, customResult.levelsGained, customResult.rewards], [custom.accountId, 0, 0, []]);

    // The public match, unchanged: the quest completes, the match gives XP and pays 5 kills and the win.
    profile = await athena(backend.port, normal);
    assert.equal(profile.items[chests[normal.accountId]].attributes.quest_state, "Completed");
    assert.ok(normalResult.totalSeasonXpGained > 0);
    assert.ok((profile.stats.attributes.level ?? 1) > 1);
    assert.equal(await balance(backend, normal), startBalance[normal.accountId] + 5 * 10 + 100);

    // Switched off, a custom match counts as a public one.
    const saved = await post(backend.port, "/admin/api/matchmaking/config", undefined, { customMatchNoRewards: false });
    assert.equal(saved.body.customMatchNoRewards, false);
    await command(backend.port, { accountId: custom.accountId, token: dedicated }, "UpdateQuests", { advance: [{ statName: "daily_athena_loot_chest", count: 5 }] }, "dedicated_server");
    const counted = await report(custom, "custom-2");
    profile = await athena(backend.port, custom);
    assert.equal(profile.items[chests[custom.accountId]].attributes.quest_state, "Completed");
    assert.ok(counted.totalSeasonXpGained > 0);
    assert.equal(await balance(backend, custom), startBalance[custom.accountId] + 5 * 10 + 100);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});

// Core-Backend #352: a custom key's match gets none of the panel's bots ("No bots in custom matchmaking matches",
// bots.noCustomMatchBots, on by default); a public match keeps them.
test("the warmup answer has no bots in a custom key's match, bots in a public one, and the switch off restores them (#352)", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 300 });
  const connections = [];
  try {
    assert.equal((await get(backend.port, "/admin/api/matchmaking/overview")).body.bots.noCustomMatchBots, true);
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { bots: { forcePlayerAIs: true, count: 30, fillPlayerTeams: true, fillLobby: { solo: true, duo: true, squad: true } } });
    const first = await gameServer(backend, "CoreServer1");
    const second = await gameServer(backend, "CoreServer2");
    connections.push(first.connection, second.connection);
    const custom = await userLogin(backend.port, "CustomPlayer");
    const normal = await userLogin(backend.port, "PublicPlayer");
    assert.equal((await post(backend.port, `/admin/api/accounts/${custom.accountId}/custom-matchmaking`, undefined, { allowed: true })).status, 200);
    const players = [await queue(backend, custom, "CoreKey1"), await queue(backend, normal, null)];
    connections.push(...players);
    for (const server of [first, second]) {
      const assign = await nextOf(server.connection, "AssignMatch");
      server.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    }
    for (const [player, connection] of [[custom, players[0]], [normal, players[1]]]) {
      const { sessionId } = (await nextOf(connection, "Play")).payload;
      assert.equal((await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${player.accountId}/session/${sessionId}`, player.token)).status, 200);
    }
    const dedicated = await dedicatedServerToken(backend.port);
    const ask = async (player) => (await post(backend.port, "/fortnite/api/game/v2/matchmakingservice/warmup", dedicated,
      { phase: "Setup", accountIds: [player.accountId], playlistId: 2 })).body;

    // The custom match: no bots at all. The public one: the panel's.
    let answer = await ask(custom);
    assert.deepEqual([answer.bots, answer.botsMode], [null, { id: "duo", enabled: false }]);
    answer = await ask(normal);
    assert.deepEqual([answer.bots.count, answer.bots.teams, answer.botsMode.enabled], [100, true, true]);

    // Switched off, the custom match has them again.
    const saved = await post(backend.port, "/admin/api/matchmaking/config", undefined, { bots: { noCustomMatchBots: false } });
    assert.equal(saved.body.bots.noCustomMatchBots, false);
    answer = await ask(custom);
    assert.deepEqual([answer.bots.count, answer.botsMode.enabled], [100, true]);
  } finally {
    for (const connection of connections) connection.close();
    backend.close();
  }
});
