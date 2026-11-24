import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import vm from "node:vm";
import { parseBucket } from "../src/matchmaking/service.js";
import { battleRoyaleMode, bucketPlaylist, saveTheWorldPlaylist, serverHosts, serverModeLabel, serverModeOf, serverModeOptions, serverModeRuleProblem,
  serverModeRules, serverModesOf } from "../src/matchmaking/server-modes.js";
import { createSessionStore } from "../src/matchmaking/sessions.js";
import { createSettingsStore } from "../src/settings/store.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #227: the server game modes. A server a rule names (its IP or range, and optionally its game port) hosts
// only the rule's modes; a server no rule names hosts any mode, as before. Core-Launcher #20's Creative-only servers are
// such a rule.

// MatchmakingServiceClient's connection, as in matchmaking-service.test.js: a WebSocket with the ticket in its
// Authorization header. Server frames are unmasked text; client frames are masked.
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

// The next message of a name, skipping the StatusUpdates before it.
async function nextOf(connection, name) {
  let message;
  do message = JSON.parse(await connection.next()); while (message.name !== name);
  return message;
}
// The next message of a name within ms, or null.
const nextWithin = (connection, name, ms) => Promise.race([nextOf(connection, name), new Promise((done) => setTimeout(() => done(null), ms))]);
const ready = (server, assign) => server.connection.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));

// A Battle Royale gameserver on this PC (127.0.0.1) at a game port, as Core Launcher runs several: its session, then its
// matchmaking connection, Registered.
async function portServer(backend, name, port) {
  const server = await userLogin(backend.port, name);
  const session = (await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
    ownerId: server.accountId, ownerName: name, serverName: name, serverAddress: "127.0.0.1", serverPort: port,
    maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "858118782", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
  })).body;
  const patterns = encodeURIComponent("858118782:0:NA:*,858118782:0:NA:*:*:*");
  const ticket = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${patterns}&minPlayers=1&maxPlayers=100`, server.token);
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  assert.equal(JSON.parse(await connection.next()).name, "Registered");
  return { ...server, session, connection };
}

// A party queued for a playlist (its bucket's playlist field: an id up to 4.2, a lowercased name from 4.4), on the build
// the User-Agent names (the Cert build's when none), past Connecting and Waiting.
async function queue(backend, player, playlist, { party = [player], userAgent = null } = {}) {
  const path = `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${party.map(({ accountId }) => accountId).join(",")}` +
    `&bucketId=858118782:0:NA:${playlist}&player.platform=Windows`;
  const ticket = userAgent ? await send({ host: "127.0.0.1", port: backend.port, method: "GET", path, headers: { "User-Agent": userAgent, Authorization: `bearer ${player.token}` } })
    : await get(backend.port, path, player.token);
  assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
  const connection = await matchmakingClient(backend.port, authorizationOf(ticket.body));
  for (let index = 0; index < 2; index++) await connection.next();
  return connection;
}
const mmConfig = (backend, body) => post(backend.port, "/admin/api/matchmaking/config", undefined, body);

test("a rule's modes: the game modes in any spelling, LTMs by their playlist, any playlist by name or id", () => {
  assert.deepEqual(["Solo", "Duos", "squads", "STW", "battleRoyale", "Playground", "creative", " 204 ", 35].map(serverModeOf),
    ["solo", "duo", "squad", "saveTheWorld", battleRoyaleMode, "playground", "creative", "204", "35"]);
  // A limited-time mode by its id is its playlist (every build's), or itself before playlist assets (1.10's 50v50).
  assert.deepEqual(["fiftyFiftyV2", "fiftyFiftySeason7", "playgroundV2", "fiftyFifty", "playlist_barrier", "Playlist_DefaultSolo", "Playlist_Unknown"].map(serverModeOf),
    ["Playlist_50v50", "Playlist_50v50", "playground", "fiftyFifty", "Playlist_Barrier", "solo", "Playlist_Unknown"]);
  assert.deepEqual(["", "nope", null, {}, "Playlist_a b"].map(serverModeOf), [null, null, null, null, null]);

  // Rules: an IP, IP:port, [IPv6]:port or a range with its own port; invalid ones are dropped when saved.
  assert.deepEqual(serverModeRules([
    { address: "127.0.0.1:7778", modes: ["Creative", "creative"] },
    { address: "203.0.113.0/24", port: "7777", modes: ["solo", "nope"] },
    { address: "[::1]:7779", modes: ["br"] },
    { address: "198.51.100.4", port: 70000, modes: ["solo"] },
    { address: "x", modes: ["solo"] },
    { address: "198.51.100.5", modes: [] }
  ]), [
    { address: "127.0.0.1", port: 7778, modes: ["creative"] },
    { address: "203.0.113.0/24", port: 7777, modes: ["solo"] },
    { address: "127.0.0.1", port: 7779, modes: [battleRoyaleMode] }
  ]);
  assert.equal(serverModeRules("127.0.0.1"), undefined);
  assert.match(serverModeRuleProblem({ address: "x", modes: ["solo"] }), /Not an IP address/);
  assert.match(serverModeRuleProblem({ address: "1.2.3.4", port: 0, modes: ["solo"] }), /Not a port/);
  assert.match(serverModeRuleProblem({ address: "1.2.3.4", modes: [] }), /at least one game mode/);
  assert.match(serverModeRuleProblem({ address: "1.2.3.4", modes: ["solo", "nope"] }), /nope/);
  assert.equal(serverModeRuleProblem({ address: "1.2.3.4:7777", modes: ["Solo", "Playlist_Barrier", 204] }), null);

  // The panel's choices: the game modes first, then each limited-time playlist once.
  const options = serverModeOptions();
  assert.deepEqual(options.slice(0, 7).map(({ value }) => value), [battleRoyaleMode, "solo", "duo", "squad", "playground", "creative", "saveTheWorld"]);
  const values = options.map(({ value }) => value);
  assert.equal(new Set(values).size, values.length);
  assert.ok(values.includes("Playlist_50v50") && values.includes("fiftyFifty") && !values.includes("Playlist_Playground"));
  assert.equal(new Set(options.map(({ label }) => label)).size, options.length, "every choice has a name of its own");
  assert.deepEqual(["creative", "Playlist_Barrier", "204", "Playlist_Unknown"].map(serverModeLabel), ["Creative", "Food Fight", "Playlist 204", "Playlist_Unknown"]);

  // The settings keep the valid rules.
  const settings = createSettingsStore(null);
  assert.deepEqual(settings.get().serverGameModes, []);
  assert.deepEqual(settings.update({ serverGameModes: [{ address: "127.0.0.1", port: 7778, modes: ["creative"] }, { address: "x", modes: ["solo"] }] }).serverGameModes,
    [{ address: "127.0.0.1", port: 7778, modes: ["creative"] }]);
  assert.deepEqual(settings.update({ serverGameModes: "x" }).serverGameModes, [{ address: "127.0.0.1", port: 7778, modes: ["creative"] }]);
});

test("a bucket's playlist is the same mode on every build: by its id up to 4.2, by its name from 4.4", () => {
  const playlistOf = (bucket, build) => bucketPlaylist(parseBucket(bucket, build), build);
  const rules = (modes) => [{ address: "127.0.0.1", port: null, modes }];
  const hosts = (modes, bucket, build) => serverHosts("127.0.0.1", 7777, playlistOf(bucket, build), rules(modes));
  // Solo: 1.8's id, 4.2's id, 7.00's name.
  for (const [bucket, build] of [["1:0:NA:2", 3724489], ["1:0:NA:2", 4072250], ["1:0:NA:playlist_defaultsolo", 4629139]]) {
    assert.equal(hosts(["solo"], bucket, build), true, bucket);
    assert.equal(hosts(["duo"], bucket, build), false, bucket);
    assert.equal(hosts([battleRoyaleMode], bucket, build), true, bucket);
  }
  // Playground: 4.2's id 35 and 7.00's name; 7.00's Creative shares the id but not the name.
  assert.equal(hosts(["playground"], "1:0:NA:35", 4072250), true);
  assert.equal(hosts(["playground"], "1:0:NA:playlist_playground", 4629139), true);
  assert.equal(hosts(["playground"], "1:0:NA:playlist_playgroundv2", 4629139), false);
  assert.equal(hosts(["creative"], "1:0:NA:playlist_playgroundv2", 4629139), true);
  assert.equal(hosts(["creative"], "1:0:NA:playlist_playground", 4629139), false);
  assert.equal(hosts([battleRoyaleMode], "1:0:NA:playlist_playgroundv2", 4629139), false, "Battle Royale is every mode but Creative");
  assert.equal(hosts([battleRoyaleMode], "1:0:NA:playlist_playground", 4629139), true);
  assert.equal(hosts(["35"], "1:0:NA:playlist_playgroundv2", 4629139), true, "an id takes every playlist with it");
  // A limited-time mode's playlist on every build that has it: 3.5.1's 50v50 by id, 7.00's by name; 1.10's 50v50 is its own.
  assert.equal(hosts(["Playlist_50v50"], "1:0:NA:50", 4000805), true);
  assert.equal(hosts(["Playlist_50v50"], "1:0:NA:playlist_50v50", 4629139), true);
  assert.equal(hosts(["Playlist_50v50"], "1:0:NA:11", 3790078), false);
  assert.equal(hosts(["fiftyFifty"], "1:0:NA:11", 3790078), true);
  // 23 was High Jump on 3.0 and High Explosives v2 (Solo) from 3.5.1: each build's own.
  assert.equal(hosts(["highJump"], "1:0:NA:23", 3901517), true);
  assert.equal(hosts(["highJump"], "1:0:NA:23", 4000805), false);
  assert.equal(hosts(["Playlist_HighExplosives_Solo"], "1:0:NA:23", 4000805), true);
  // A playlist Core has no entry for, by its name or its id.
  assert.equal(hosts(["Playlist_Somewhere"], "1:0:NA:playlist_somewhere", 4629139), true);
  assert.equal(hosts(["204"], "1:0:NA:playlist_barrier", 4573096), true);
  // Save the World only takes its own; Battle Royale's modes never take it.
  assert.equal(serverHosts("127.0.0.1", 7777, saveTheWorldPlaylist, rules(["saveTheWorld"])), true);
  assert.equal(serverHosts("127.0.0.1", 7777, saveTheWorldPlaylist, rules([battleRoyaleMode, "35"])), false);
  assert.equal(hosts(["saveTheWorld"], "1:0:NA:2", 4072250), false);

  // Which rules name a server: its IP or range, and its port when the rule names one; several rules' modes add up.
  const list = serverModeRules([{ address: "127.0.0.1", port: 7778, modes: ["creative"] }, { address: "203.0.113.0/24", modes: ["solo"] },
    { address: "203.0.113.9", modes: ["duo"] }]);
  assert.deepEqual(serverModesOf("127.0.0.1", 7778, list), ["creative"]);
  assert.equal(serverModesOf("127.0.0.1", 7777, list), null, "another port of the same PC is unpinned");
  assert.deepEqual(serverModesOf("::ffff:203.0.113.9", 7777, list), ["solo", "duo"]);
  assert.equal(serverModesOf("198.51.100.1", 7777, list), null);
  assert.equal(serverHosts("198.51.100.1", 7777, playlistOf("1:0:NA:playlist_playgroundv2", 4629139), list), true, "an unpinned server hosts anything");
});

test("a pinned server only gets its modes; an unpinned one gets every mode; a mode no free server hosts waits", async () => {
  const backend = await startBackend({ matchmakingGatherMs: 200 });
  const connections = [];
  try {
    // Anything but an IP or range, a port, and known modes or playlists, is refused.
    assert.match((await mmConfig(backend, { serverGameModes: [{ address: "solo.example.com", modes: ["solo"] }] })).body.errorMessage, /Not an IP address/);
    assert.match((await mmConfig(backend, { serverGameModes: [{ address: "127.0.0.1", port: 99999, modes: ["solo"] }] })).body.errorMessage, /Not a port/);
    assert.match((await mmConfig(backend, { serverGameModes: [{ address: "127.0.0.1", modes: ["Solos2"] }] })).body.errorMessage, /Solos2/);
    assert.equal((await mmConfig(backend, { serverGameModes: "127.0.0.1" })).status, 400);
    // The launcher's servers on this PC share 127.0.0.1: the one on port 7778 hosts Solo only.
    const saved = await mmConfig(backend, { serverGameModes: [{ address: "127.0.0.1", port: "7778", modes: ["Solo"] }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.serverGameModes, [{ address: "127.0.0.1", port: 7778, modes: ["solo"] }]);
    assert.ok(saved.body.serverGameModeOptions.some(({ value, label }) => value === "creative" && label === "Creative"));

    // The pinned server registers first, so it comes first in the service's list.
    const pinned = await portServer(backend, "CoreServer1", 7778);
    const open = await portServer(backend, "CoreServer2", 7777);
    connections.push(pinned.connection, open.connection);
    const sessions = (await get(backend.port, "/admin/api/sessions")).body;
    assert.deepEqual(sessions.find(({ id }) => id === pinned.session.id).hostedModes, ["Solo"]);
    assert.equal(sessions.find(({ id }) => id === open.session.id).hostedModes, null);

    // Duos skip the free pinned server.
    const duo1 = await userLogin(backend.port, "DuoOne");
    connections.push(await queue(backend, duo1, 10));
    const duoAssign = await nextOf(open.connection, "AssignMatch");
    assert.deepEqual(duoAssign.payload.teams.flat(2), [duo1.accountId]);
    ready(open, duoAssign);

    // With the unpinned server busy, the next Duos party waits: the pinned one is free but never takes it.
    const duo2 = await userLogin(backend.port, "DuoTwo");
    const duo2Connection = await queue(backend, duo2, 10);
    connections.push(duo2Connection);
    assert.equal(JSON.parse(await duo2Connection.next()).payload.state, "Queued");
    const pinnedNext = nextOf(pinned.connection, "AssignMatch");
    assert.equal(await Promise.race([pinnedNext, new Promise((done) => setTimeout(() => done(null), 1000))]), null);

    // A solo party takes the pinned server.
    const solo1 = await userLogin(backend.port, "SoloOne");
    connections.push(await queue(backend, solo1, 2));
    const soloAssign = await pinnedNext;
    assert.deepEqual(soloAssign.payload.teams.flat(2), [solo1.accountId]);
    ready(pinned, soloAssign);

    // An unpinned server takes the waiting Duos party, and then a solo one too.
    const open2 = await portServer(backend, "CoreServer3", 7777);
    connections.push(open2.connection);
    const lateDuo = await nextOf(open2.connection, "AssignMatch");
    assert.deepEqual(lateDuo.payload.teams.flat(2), [duo2.accountId]);
    ready(open2, lateDuo);
    const solo2 = await userLogin(backend.port, "SoloTwo");
    connections.push(await queue(backend, solo2, 2));
    const open3 = await portServer(backend, "CoreServer4", 7777);
    connections.push(open3.connection);
    assert.deepEqual((await nextOf(open3.connection, "AssignMatch")).payload.teams.flat(2), [solo2.accountId]);

    // The panel's script still compiles, with the section in it.
    const html = (await get(backend.port, "/admin")).body;
    const script = html.slice(html.indexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
    assert.doesNotThrow(() => new vm.Script(script, { filename: "panel.html" }));
    assert.match(html, /Server Game Modes/);
  } finally {
    for (const connection of connections) connection?.close();
    backend.close();
  }
});

// Core-Launcher #20: a Creative-only server beside Battle Royale-only servers, on one backend and one PC.
test("Creative-only and Battle Royale-only servers on one backend each take only their own parties (7.00)", async () => {
  const today = new Date();
  // Season 7's replay past Creative's early access (13 December 2018), so any player queues it.
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 19 * 86_400_000).toISOString().slice(0, 10);
  const backend = await startBackend({ matchmakingGatherMs: 200, events: { seasonStarts: { 7: start } } });
  const connections = [];
  const agent700 = "Fortnite/++Fortnite+Release-7.00-CL-4629139 Windows/10.0.19045.1.256.64bit";
  try {
    const saved = await mmConfig(backend, { serverGameModes: [{ address: "127.0.0.1:7778", modes: ["creative"] }, { address: "127.0.0.1", port: 7777, modes: ["battleRoyale"] }] });
    assert.deepEqual(saved.body.serverGameModes, [{ address: "127.0.0.1", port: 7778, modes: ["creative"] }, { address: "127.0.0.1", port: 7777, modes: ["battleRoyale"] }]);
    // The Battle Royale server registers first.
    const royale = await portServer(backend, "CoreServer1", 7777);
    const creative = await portServer(backend, "CoreServer2", 7778);
    connections.push(royale.connection, creative.connection);

    // A Creative party skips the free Battle Royale server for the Creative one.
    const leader = await userLogin(backend.port, "CrLeader");
    const mate = await userLogin(backend.port, "CrMate");
    connections.push(await queue(backend, leader, "playlist_playgroundv2", { party: [leader, mate], userAgent: agent700 }));
    const creativeAssign = await nextOf(creative.connection, "AssignMatch");
    assert.deepEqual(creativeAssign.payload.teams.flat(2), [leader.accountId, mate.accountId]);
    ready(creative, creativeAssign);

    // Solo plays on the Battle Royale server.
    const solo = await userLogin(backend.port, "BrSolo");
    connections.push(await queue(backend, solo, "playlist_defaultsolo", { userAgent: agent700 }));
    const soloAssign = await nextOf(royale.connection, "AssignMatch");
    assert.deepEqual(soloAssign.payload.teams.flat(2), [solo.accountId]);
    ready(royale, soloAssign);

    // Another Creative party waits: a free Battle Royale server never takes it, a free Creative one does. Playground is
    // Battle Royale's, so the Battle Royale server takes it meanwhile.
    const builder = await userLogin(backend.port, "CrBuilder");
    const builderConnection = await queue(backend, builder, "playlist_playgroundv2", { userAgent: agent700 });
    connections.push(builderConnection);
    const royale2 = await portServer(backend, "CoreServer3", 7777);
    connections.push(royale2.connection);
    const royale2Next = nextOf(royale2.connection, "AssignMatch");
    assert.equal(await Promise.race([royale2Next, new Promise((done) => setTimeout(() => done(null), 1000))]), null);
    const playground = await userLogin(backend.port, "PgPlayer");
    connections.push(await queue(backend, playground, "playlist_playground", { userAgent: agent700 }));
    assert.deepEqual((await royale2Next).payload.teams.flat(2), [playground.accountId]);
    const creative2 = await portServer(backend, "CoreServer4", 7778);
    connections.push(creative2.connection);
    const builderAssign = await nextOf(creative2.connection, "AssignMatch");
    assert.deepEqual(builderAssign.payload.teams.flat(2), [builder.accountId]);
    ready(creative2, builderAssign);
    assert.equal((await nextOf(builderConnection, "Play")).payload.sessionId, creative2.session.id);
  } finally {
    for (const connection of connections) connection?.close();
    backend.close();
  }
});

// Save the World's missions find their server with the session search, which leaves out a server whose game modes leave
// Save the World out. Battle Royale's sessions are the matchmaking service's, and the search leaves them as they were.
test("Save the World's search finds only the servers whose game modes take it, and every unpinned one", () => {
  let rules = [{ address: "127.0.0.1", port: 7777, modes: ["creative"] }];
  const store = createSessionStore({ serverModes: () => rules });
  const server = (port, gameMode = "FORTEMPTY") => ({ ownerId: "server", ownerName: "Core", serverName: "Core", serverAddress: "127.0.0.1", serverPort: port,
    maxPublicPlayers: 4, maxPrivatePlayers: 0, buildUniqueId: "595160781", isDedicated: true,
    attributes: { REGION_s: "NA", MATCHMAKINGPOOL_s: "Any", GAMEMODE_s: gameMode, BEACONPORT_i: 15009 } });
  const search = (gameMode = "FORTEMPTY") => store.search({ criteria: [{ type: "EQUAL", key: "REGION_s", value: "NA" }, { type: "EQUAL", key: "GAMEMODE_s", value: gameMode }],
    requireDedicated: true, buildUniqueId: "595160781", maxResults: 30 }).map(({ id }) => id).sort();
  const pinned = store.create(server(7777), "127.0.0.1", "CoreServer1");
  const open = store.create(server(7779), "127.0.0.1", "CoreServer2");
  const royale = store.create(server(7777, "FORTATHENA"), "127.0.0.1", "CoreServer3");
  assert.deepEqual(search(), [open.id]);
  rules = [{ address: "127.0.0.1", port: 7777, modes: ["creative", "saveTheWorld"] }];
  assert.deepEqual(search(), [open.id, pinned.id].sort());
  // A Battle Royale session is found as before, whatever its server's modes.
  rules = [{ address: "127.0.0.1", port: 7777, modes: ["solo"] }];
  assert.deepEqual(search("FORTATHENA"), [royale.id]);
  // With the only server of a region kept from Save the World, the region counts as having none (the region fallback).
  store.remove(open.id);
  store.remove(royale.id);
  assert.deepEqual(search(), []);
  assert.deepEqual(store.regionFallback({ criteria: [{ type: "EQUAL", key: "REGION_s", value: "NA" }], buildUniqueId: "595160781" }), { region: "NA" });
});

test("the admin panel's Matchmaking page has the Server Game Modes section", () => {
  const html = fs.readFileSync(new URL("../src/admin/panel.html", import.meta.url), "utf8");
  assert.match(html, /function serverGameModesSection\(form, options\)/);
  assert.match(html, /sectionSessions, sectionServerModes, /);
  assert.match(html, /\["Hosts", \(s\) =>/);
});

// Core-Backend #432: the Add Game Mode to Queue window's season tabs and the bots' season filter stopped at Season 7.
test("the admin panel's mode lists take their seasons from the season table, Season 8 included", () => {
  const html = fs.readFileSync(new URL("../src/admin/panel.html", import.meta.url), "utf8");
  assert.match(html, /\{ id: "8", label: "Season 8/);
  assert.match(html, /\[\["all", "All Seasons"\], \.\.\.SEASONS\.map\(/);
  assert.match(html, /\[\["all", "All seasons"\], \.\.\.SEASONS\.map\(/);
  assert.doesNotMatch(html, /\["7", "Season 7"\]\]\.map/);
});
