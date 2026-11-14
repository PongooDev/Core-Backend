import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { botModeCandidates, botModeFor, botModeIds, botModeOf, botsForMode, botsInMode, matchBots, sanitizeBotFillLobby, sanitizeBotModeCounts, sanitizeBotModes } from "../src/matchmaking/botmodes.js";
import { createSettingsStore } from "../src/settings/store.js";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #352: the game modes the player bots play in, the Matchmaking tab's Player bots card's "Game modes with
// bots" (settings bots.modes), every mode on by default.

test("a playlist's mode: the default modes by id or name, an LTM by the build's playlist (#352)", () => {
  assert.deepEqual([botModeOf(2), botModeOf(10), botModeOf("9")], ["solo", "duo", "squad"]);
  // 5.30's game mode and 4.4's buckets name the playlist.
  assert.equal(botModeOf("Playlist_DefaultSquad", 4352937), "squad");
  assert.equal(botModeOf("playlist_playground", 4148992), "playground");
  // An LTM's by the build: 1.10's 50v50 is playlist 11, 6.00's is Playlist_50v50.
  assert.equal(botModeOf(11, 3790078), "fiftyFifty");
  assert.equal(botModeOf("Playlist_50v50", 4402180), "fiftyFiftySeason6");
  // None for a playlist Core doesn't know, or none at all.
  assert.deepEqual([botModeOf(999999), botModeOf("Playlist_Nope"), botModeOf(0), botModeOf(null), botModeOf("")], [null, null, null, null, null]);
});

test("the bots by mode: on unless the mode's switch is off, an unknown mode keeping them (#352)", () => {
  const bots = { forcePlayerAIs: true, count: 30, fillPlayerTeams: true, modes: { solo: true, duo: false } };
  assert.deepEqual([botsInMode(bots, "solo"), botsInMode(bots, "duo"), botsInMode(bots, "squad"), botsInMode(bots, null)], [true, false, true, true]);
  // A settings value from before the switches has every mode on.
  assert.equal(botsInMode({ forcePlayerAIs: true, count: 30 }, "duo"), true);
  assert.equal(botsForMode(bots, "solo"), bots);
  assert.deepEqual(botsForMode(bots, "duo"), { ...bots, forcePlayerAIs: false, fillPlayerTeams: false });
  // A tournament event's own bots win over the mode's switch.
  assert.deepEqual([matchBots(bots, { enabled: true, count: 7 }, "duo").forcePlayerAIs, matchBots(bots, { enabled: true, count: 7 }, "duo").count], [true, 7]);
  assert.equal(matchBots(bots, null, "duo").forcePlayerAIs, false);
  // Sanitizing: every known mode, a boolean or the current one (on unless false); anything else is dropped.
  const modes = sanitizeBotModes({ solo: false, duo: "no", nope: false }, { duo: false });
  assert.deepEqual(Object.keys(modes).sort(), [...botModeIds].sort());
  assert.deepEqual([modes.solo, modes.duo, modes.squad, "nope" in modes], [false, false, true, false]);
  assert.ok(Object.values(sanitizeBotModes(null)).every((on) => on === true));
});

test("a settings file from before #352 keeps the bots in every mode, and one saved after keeps its switches", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-352-"));
  try {
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ bots: { forcePlayerAIs: true, count: 40, level: 8 } }));
    const migrated = createSettingsStore(dataDir).get().bots;
    assert.deepEqual([migrated.forcePlayerAIs, migrated.count, migrated.level], [true, 40, 8]);
    assert.deepEqual(Object.keys(migrated.modes).sort(), [...botModeIds].sort());
    assert.ok(Object.values(migrated.modes).every((on) => on === true));
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ bots: { forcePlayerAIs: true, count: 40, modes: { duo: false, fiftyFifty: false } } }));
    const kept = createSettingsStore(dataDir).get().bots.modes;
    assert.deepEqual([kept.solo, kept.duo, kept.squad, kept.fiftyFifty, kept.playground], [true, false, true, false, true]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

const overview = async (backend) => (await get(backend.port, "/admin/api/matchmaking/overview")).body;
const mmConfig = (backend, body) => post(backend.port, "/admin/api/matchmaking/config", undefined, body);

test("the panel's game modes with bots: every one on, the config round-trip, partial updates and reset (#352)", async () => {
  const backend = await startBackend();
  try {
    const first = await overview(backend);
    assert.deepEqual(Object.keys(first.bots.modes).sort(), [...botModeIds].sort());
    assert.ok(Object.values(first.bots.modes).every((on) => on === true));
    // Every mode the panel lists has a switch.
    for (const playlist of first.playlists) assert.equal(first.bots.modes[playlist.id], true, playlist.id);

    let res = await mmConfig(backend, { bots: { modes: { duo: false, squad: false, fiftyFifty: false } } });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.bots.modes.solo, res.body.bots.modes.duo, res.body.bots.modes.squad, res.body.bots.modes.fiftyFifty], [true, false, false, false]);
    assert.deepEqual((await overview(backend)).bots.modes, res.body.bots.modes);
    // A partial update merges; a value that isn't a boolean, or a mode Core doesn't know, changes nothing.
    res = await mmConfig(backend, { bots: { modes: { squad: true, duo: "yes", nope: false } } });
    assert.deepEqual([res.body.bots.modes.duo, res.body.bots.modes.squad, "nope" in res.body.bots.modes], [false, true, false]);
    // The other bot settings leave the modes alone.
    res = await mmConfig(backend, { bots: { count: 20 } });
    assert.deepEqual([res.body.bots.count, res.body.bots.modes.duo], [20, false]);

    res = await post(backend.port, "/admin/api/matchmaking/actions/reset-defaults", undefined, {});
    assert.ok(Object.values(res.body.bots.modes).every((on) => on === true));
  } finally {
    backend.close();
  }
});

test("the warmup answer has no bots in a mode the panel has them off in, by the playlist the gameserver reports (#352)", async () => {
  const backend = await startBackend();
  try {
    const token = await dedicatedServerToken(backend.port);
    const ask = async (body) => (await post(backend.port, "/fortnite/api/game/v2/matchmakingservice/warmup", token, { phase: "Setup", accountIds: [], ...body })).body;
    await mmConfig(backend, { bots: { forcePlayerAIs: true, count: 30, fillPlayerTeams: true, modes: { duo: false } } });

    let answer = await ask({ playlistId: 10 });
    assert.deepEqual([answer.bots, answer.botsMode], [null, { id: "duo", enabled: false }]);
    answer = await ask({ playlistId: 2 });
    assert.deepEqual([answer.bots.count, answer.bots.teams, answer.botsMode], [30, true, { id: "solo", enabled: true }]);
    // 5.30 on: the playlist's name, its id 0.
    answer = await ask({ playlistId: 0, playlistName: "Playlist_DefaultDuo" });
    assert.deepEqual([answer.bots, answer.botsMode], [null, { id: "duo", enabled: false }]);
    // A gameserver from before #352 reports no playlist: the panel's bots, as before.
    answer = await ask({});
    assert.deepEqual([answer.bots.count, answer.botsMode], [30, null]);
    // Nor does one Core has no mode for.
    answer = await ask({ playlistId: 999999 });
    assert.deepEqual([answer.bots.count, answer.botsMode], [30, null]);

    // Turned back on, the duo's bots come back.
    await mmConfig(backend, { bots: { modes: { duo: true } } });
    answer = await ask({ playlistId: 10 });
    assert.deepEqual([answer.bots.count, answer.botsMode], [30, { id: "duo", enabled: true }]);
  } finally {
    backend.close();
  }
});

// The follow-up: each mode's own bot count (bots.modeCounts), blank for the shared count.
test("each mode's own bot count: set, kept, cleared and checked (#352)", () => {
  assert.deepEqual(sanitizeBotModeCounts({ solo: 20, duo: "35", squad: 101, nope: 5, fiftyFifty: -1 }, { squad: 40 }), { solo: 20, duo: 35, squad: 40 });
  // A partial update keeps the others; null or "" clears one.
  assert.deepEqual(sanitizeBotModeCounts({ duo: null, squad: "" }, { solo: 20, duo: 35, squad: 40 }), { solo: 20 });
  assert.deepEqual(sanitizeBotModeCounts(undefined, { solo: 0 }), { solo: 0 });
  const bots = { forcePlayerAIs: true, count: 30, modes: { duo: false }, modeCounts: { solo: 12, duo: 50, squad: 0 } };
  assert.equal(botsForMode(bots, "solo").count, 12);
  assert.equal(botsForMode(bots, "squad").count, 0);
  assert.equal(botsForMode(bots, "fiftyFifty").count, 30);
  assert.equal(botsForMode(bots, null).count, 30);
  // A mode that is off stays off whatever its count.
  assert.equal(botsForMode(bots, "duo").forcePlayerAIs, false);
  // A tournament event's count wins.
  assert.equal(matchBots(bots, { enabled: true, count: 7 }, "solo").count, 7);
});

test("the panel's per-mode bot counts and the warmup answer's count (#352)", async () => {
  const backend = await startBackend();
  try {
    assert.deepEqual((await overview(backend)).bots.modeCounts, {});
    let res = await mmConfig(backend, { bots: { forcePlayerAIs: true, count: 30, modeCounts: { solo: 12, squad: 0, duo: 200 } } });
    assert.deepEqual(res.body.bots.modeCounts, { solo: 12, squad: 0 });
    res = await mmConfig(backend, { bots: { modeCounts: { squad: null, fiftyFifty: 60 } } });
    assert.deepEqual(res.body.bots.modeCounts, { solo: 12, fiftyFifty: 60 });
    assert.deepEqual((await overview(backend)).bots.modeCounts, res.body.bots.modeCounts);

    const token = await dedicatedServerToken(backend.port);
    const ask = async (body) => (await post(backend.port, "/fortnite/api/game/v2/matchmakingservice/warmup", token, { phase: "Setup", accountIds: [], ...body })).body;
    assert.equal((await ask({ playlistId: 2 })).bots.count, 12);
    assert.equal((await ask({ playlistId: 10 })).bots.count, 30);
    // A server that reports no playlist gets the shared count, as before.
    assert.equal((await ask({})).bots.count, 30);
    // A mode's count of 0 is no bots on teams of their own there.
    await mmConfig(backend, { bots: { modeCounts: { duo: 0 } } });
    assert.equal((await ask({ playlistId: 10 })).bots, null);

    res = await post(backend.port, "/admin/api/matchmaking/actions/reset-defaults", undefined, {});
    assert.deepEqual(res.body.bots.modeCounts, {});
  } finally {
    backend.close();
  }
});

test("a settings file from before the per-mode counts has none, and one saved after keeps them (#352)", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-352b-"));
  try {
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ bots: { forcePlayerAIs: true, count: 40, modes: { duo: false } } }));
    assert.deepEqual(createSettingsStore(dataDir).get().bots.modeCounts, {});
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ bots: { count: 40, modeCounts: { solo: 15, nope: 3 } } }));
    assert.deepEqual(createSettingsStore(dataDir).get().bots.modeCounts, { solo: 15 });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// The follow-up: each mode's "Fill the lobby with bots" (bots.fillLobby), off by default.
test("each mode's lobby filling: set, kept and cleared, and the bots it asks for (#352)", () => {
  assert.deepEqual(sanitizeBotFillLobby({ solo: true, duo: "yes", nope: true, squad: false }, { duo: true, squad: true }), { solo: true, duo: true });
  assert.deepEqual(sanitizeBotFillLobby(undefined), {});
  const bots = { forcePlayerAIs: false, count: 10, fillPlayerTeams: false, modes: { duo: false }, modeCounts: { solo: 5 }, fillLobby: { solo: true, duo: true, squad: true } };
  // It asks for 100 whatever the counts and Force player AIs: the gameserver caps them to the match's room.
  assert.deepEqual([botsForMode(bots, "solo").forcePlayerAIs, botsForMode(bots, "solo").count], [true, 100]);
  assert.equal(botsForMode(bots, "squad").count, 100);
  // A mode that is off stays off, one that doesn't fill keeps its counts, and an unknown mode doesn't fill.
  assert.equal(botsForMode(bots, "duo").forcePlayerAIs, false);
  assert.deepEqual([botsForMode(bots, "fiftyFifty").forcePlayerAIs, botsForMode(bots, null).forcePlayerAIs], [false, false]);
  // A tournament event's bots win.
  assert.equal(matchBots(bots, { enabled: true, count: 7 }, "solo").count, 7);
});

test("the panel's lobby filling and the warmup answer: 100 bots asked for in a mode that fills, off by default (#352)", async () => {
  const backend = await startBackend();
  try {
    assert.deepEqual((await overview(backend)).bots.fillLobby, {});
    const token = await dedicatedServerToken(backend.port);
    const ask = async (body) => (await post(backend.port, "/fortnite/api/game/v2/matchmakingservice/warmup", token, { phase: "Warmup", accountIds: [], secondsLeft: 60, ...body })).body;
    // Off by default: no bots, as before.
    assert.equal((await ask({ playlistId: 9 })).bots, null);

    let res = await mmConfig(backend, { bots: { fillPlayerTeams: true, fillLobby: { squad: true, fiftyFifty: true } } });
    assert.deepEqual(res.body.bots.fillLobby, { squad: true, fiftyFifty: true });
    assert.deepEqual((await overview(backend)).bots.fillLobby, res.body.bots.fillLobby);
    const squad = (await ask({ playlistId: 9 })).bots;
    assert.deepEqual([squad.count, squad.teams], [100, true]);
    // Solo doesn't fill: only its team filling, which solo has no room for.
    assert.equal((await ask({ playlistId: 2 })).bots.count, 0);
    // Unticked, and the bot count and switches left as they were.
    res = await mmConfig(backend, { bots: { fillLobby: { squad: false } } });
    assert.deepEqual(res.body.bots.fillLobby, { fiftyFifty: true });
    assert.equal((await ask({ playlistId: 9 })).bots.count, 0);

    res = await post(backend.port, "/admin/api/matchmaking/actions/reset-defaults", undefined, {});
    assert.deepEqual(res.body.bots.fillLobby, {});
  } finally {
    backend.close();
  }
});

test("a settings file from before the lobby filling fills none, and one saved after keeps it (#352)", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-352c-"));
  try {
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ bots: { forcePlayerAIs: true, count: 40, modeCounts: { solo: 15 } } }));
    assert.deepEqual(createSettingsStore(dataDir).get().bots.fillLobby, {});
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ bots: { fillLobby: { duo: true, nope: true, solo: false } } }));
    assert.deepEqual(createSettingsStore(dataDir).get().bots.fillLobby, { duo: true });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// The bug report (#352, 6.x): Playground's bots came with "Playground v2" off. Playground's PlaylistId 35 is two modes,
// Season 4's playground (4.2 to 5.0) and Season 5's and 6's playgroundV2 (5.10 on), and CoreV2's own requests name no
// build ("Core V2"), so the warmup answer took Season 4's, which was still on.
test("Playground's mode: Season 4's or Season 5's and 6's by the build, both where the build isn't known (#352)", () => {
  for (const build of [4072250, 4117433, 4166199, 4214610]) {
    assert.deepEqual([botModeOf(35, build), botModeOf("playlist_playground", build), botModeOf("Playlist_Playground", build)], ["playground", "playground", "playground"], String(build));
  }
  for (const build of [4240749, 4288479, 4305896, 4352937, 4363240, 4402180, 4424678, 4461277, 4480234, 4497486, 4526925]) {
    assert.deepEqual([botModeOf(35, build), botModeOf("playlist_playground", build), botModeOf("Playlist_Playground", build)], ["playgroundV2", "playgroundV2", "playgroundV2"], String(build));
  }
  assert.deepEqual(botModeCandidates(35, "unknown"), ["playground", "playgroundV2"]);
  assert.deepEqual(botModeCandidates("Playlist_Playground", "unknown"), ["playground", "playgroundV2"]);
  // Not known: the one with bots off, either way round; else the newest.
  assert.equal(botModeFor({ modes: { playgroundV2: false } }, 35, "unknown"), "playgroundV2");
  assert.equal(botModeFor({ modes: { playground: false } }, 35, "unknown"), "playground");
  assert.equal(botModeFor({ modes: {} }, 35, "unknown"), "playgroundV2");
  // Known: the build's, whatever the other's switch.
  assert.equal(botModeFor({ modes: { playground: false } }, 35, "4497486"), "playgroundV2");
  assert.equal(botModeFor({ modes: { playgroundV2: false } }, 35, "4117433"), "playground");
  // A playlist of one mode stays that mode.
  assert.equal(botModeFor({ modes: { duo: false } }, 10, "unknown"), "duo");
});

const coreV2Report = (backend, token, body) => {
  const text = JSON.stringify({ phase: "Setup", accountIds: [], ...body });
  return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/fortnite/api/game/v2/matchmakingservice/warmup",
    headers: { "User-Agent": "Core V2", Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
};

test("a Playground server's report with no build gets no bots with the panel's Playground v2 off: by id, by name (#352)", async () => {
  const backend = await startBackend();
  try {
    const token = await dedicatedServerToken(backend.port);
    await mmConfig(backend, { bots: { forcePlayerAIs: true, count: 30, fillPlayerTeams: true, modes: { playgroundV2: false } } });
    for (const body of [{ playlistId: 35 }, { playlistId: 0, playlistName: "Playlist_Playground" }]) {
      const answer = (await coreV2Report(backend, token, body)).body;
      assert.deepEqual([answer.bots, answer.botsMode], [null, { id: "playgroundV2", enabled: false }], JSON.stringify(body));
    }
    // Season 4's off instead: the same.
    await mmConfig(backend, { bots: { modes: { playgroundV2: true, playground: false } } });
    assert.deepEqual((await coreV2Report(backend, token, { playlistId: 35 })).body.botsMode, { id: "playground", enabled: false });
    // Both on: bots.
    await mmConfig(backend, { bots: { modes: { playground: true } } });
    assert.equal((await coreV2Report(backend, token, { playlistId: 35 })).body.bots.count, 30);
  } finally {
    backend.close();
  }
});

function matchmakingClient(port, authorization) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/", headers: { Connection: "Upgrade", Upgrade: "websocket",
      "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"), Authorization: authorization } });
    request.on("error", reject);
    request.on("upgrade", (response, socket, head) => {
      const messages = [];
      const waiters = [];
      let buffer = Buffer.alloc(0);
      const deliver = (text) => (waiters.length ? waiters.shift()(text) : messages.push(text));
      const receive = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          let length = buffer[1] & 0x7f;
          let offset = 2;
          if (length === 126) {
            length = buffer.readUInt16BE(2);
            offset = 4;
          }
          if (buffer.length < offset + length) return;
          if ((buffer[0] & 0x0f) === 0x1) deliver(buffer.subarray(offset, offset + length).toString("utf8"));
          buffer = buffer.subarray(offset + length);
        }
      };
      receive(head);
      socket.on("data", receive);
      socket.on("close", () => {
        while (waiters.length) waiters.shift()(null);
      });
      resolve({
        send: (text) => {
          const payload = Buffer.from(text);
          const mask = crypto.randomBytes(4);
          const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length])
            : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
          socket.write(Buffer.concat([header, mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))]));
        },
        next: () => (messages.length ? Promise.resolve(messages.shift()) : new Promise((done) => waiters.push(done))),
        close: () => socket.destroy()
      });
    });
    request.end();
  });
}
const authorizationOf = ({ ticketType, payload, signature }) => `Epic-Signed ${ticketType} ${payload} ${signature}`;
async function nextOf(connection, name) {
  for (;;) {
    const text = await connection.next();
    if (text === null) return null;
    const message = JSON.parse(text);
    if (message.name === name || message.payload?.state === name) return message;
  }
}

test("a placed 6.20 Playground match gets no bots with Playground v2 off, though its server's reports name no build (#352)", async () => {
  const build = 4497486;
  const agent = `Fortnite/++Fortnite+Release-6.20-CL-${build} Windows/10.0.19045.1.256.64bit`;
  const as = (port, urlPath, token, method = "GET", body) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = { "User-Agent": agent, Authorization: `bearer ${token}` };
    if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
    return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
  };
  const backend = await startBackend({ matchmakingGatherMs: 100 });
  const clients = [];
  try {
    // Season 4's Playground on (as by default), Season 5's and 6's off, as in the report.
    await mmConfig(backend, { bots: { forcePlayerAIs: true, count: 30, fillPlayerTeams: true, modes: { playgroundV2: false } } });
    const server = await userLogin(backend.port, "Server620pg");
    const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
      ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
    })).body;
    const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
      `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
      server.token)).body));
    clients.push(gameserver);
    await nextOf(gameserver, "Registered");
    const player = await userLogin(backend.port, "PlaygroundPlayer");
    const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
      `&bucketId=${build}:0:NAE:playlist_playground&player.platform=Windows&player.option.fillTeam=true`, player.token);
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
    clients.push(client);
    const assign = await nextOf(gameserver, "AssignMatch");
    gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    await nextOf(client, "Play");
    const token = await dedicatedServerToken(backend.port);
    const answer = (await coreV2Report(backend, token, { phase: "Warmup", accountIds: [player.accountId], secondsLeft: 60, playlistId: 35 })).body;
    assert.deepEqual([answer.bots, answer.botsMode], [null, { id: "playgroundV2", enabled: false }]);
    // Its build known, Season 4's switch doesn't touch it.
    await mmConfig(backend, { bots: { modes: { playgroundV2: true, playground: false } } });
    const on = (await coreV2Report(backend, token, { phase: "Warmup", accountIds: [player.accountId], secondsLeft: 60, playlistId: 35 })).body;
    assert.deepEqual([on.bots?.teams, on.botsMode], [true, { id: "playgroundV2", enabled: true }]);
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});
