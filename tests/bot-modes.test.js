import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { botModeIds, botModeOf, botsForMode, botsInMode, matchBots, sanitizeBotFillLobby, sanitizeBotModeCounts, sanitizeBotModes } from "../src/matchmaking/botmodes.js";
import { createSettingsStore } from "../src/settings/store.js";
import { dedicatedServerToken, get, post, startBackend } from "./helpers.js";

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
