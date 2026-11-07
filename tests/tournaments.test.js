import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { botsOn, createTournamentStore, effectiveBots, validateBots, validateServers, leaderboardOf, matchPoints, placementPoints, rulesets, scoringOf, statusOf, tournamentPlaylists, validateScoring } from "../src/tournaments/store.js";
import { dedicatedServerToken, del, get, post, send, startBackend, userLogin } from "./helpers.js";

// The admin panel's Tournaments tab (Core-Backend #263): Solo Showdown events, scored by Epic's contest rules.
const may = rulesets.soloShowdownMay2018;
const july = rulesets.soloShowdownJuly2018;

test("Solo Showdown's placement table, and July 2018's 6 points an elimination (#263)", () => {
  assert.deepEqual(tournamentPlaylists.map(({ id, playlistId }) => [id, playlistId]), [["soloShowdown", 51]]);
  for (const [place, points] of [[1, 100], [2, 94], [3, 91], [4, 88], [5, 85], [6, 80], [7, 75], [8, 70], [9, 65], [10, 60],
    [11, 55], [15, 55], [16, 50], [20, 50], [21, 45], [30, 45], [31, 40], [40, 40], [41, 35], [50, 35], [51, 30], [75, 30], [76, 25], [100, 25]]) {
    assert.equal(placementPoints(may, place), points, `place ${place}`);
  }
  assert.equal(matchPoints(may, { place: 3, kills: 7 }), 91, "May 2018: placement only");
  assert.equal(matchPoints(july, { place: 3, kills: 7 }), 91 + 42);
  assert.deepEqual([may.countedMatches, may.minimumMatches, july.countedMatches, july.minimumMatches], [50, 50, 25, 25]);
});

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-tournaments-"));
  try {
    return run(createTournamentStore(dataDir), dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test("an event counts each player's first matches only, once a match, in its playlist and window, and ranks by the tiebreakers (#263)", () => withStore((store, dataDir) => {
  const now = new Date("2026-11-07T12:00:00Z");
  const event = store.create({ name: "Showdown", ruleset: "soloShowdownJuly2018" }, now);
  assert.equal(statusOf(event, now), "running");
  // 26 matches: only the first 25 count.
  for (let n = 0; n < 26; n += 1) store.recordResult("a", 51, { place: n === 25 ? 1 : 10, kills: 1, matchId: `m${n}` }, now);
  // The same report again, another playlist, or a build without Solo Showdown (4.1): nothing.
  store.recordResult("b", 51, { place: 1, kills: 2, matchId: "x" }, now);
  store.recordResult("b", 51, { place: 1, kills: 2, matchId: "x" }, now);
  store.recordResult("b", 2, { place: 1, kills: 9, matchId: "y" }, now);
  store.recordResult("b", 51, { place: 1, kills: 9, matchId: "z", build: "4053532" }, now);
  assert.equal(store.recordResult("b", 51, { place: 2, kills: 0, matchId: "w", build: "4072250" }, now).length, 1);
  // c ties b on points and wins but has fewer eliminations.
  store.recordResult("c", 51, { place: 1, kills: 0, matchId: "c1" }, now);
  store.recordResult("c", 51, { place: 2, kills: 2, matchId: "c2" }, now);

  const saved = createTournamentStore(dataDir).get(event.id);
  const board = leaderboardOf(saved);
  assert.deepEqual(board.map(({ accountId, points, matches, wins, eliminations, qualified }) => [accountId, points, matches, wins, eliminations, qualified]), [
    ["a", 25 * 66, 25, 0, 25, true],
    ["b", 100 + 12 + 94, 2, 1, 2, false],
    ["c", 100 + 94 + 12, 2, 1, 2, false]
  ].map((row) => row));
  assert.equal(board[1].averagePlacement, 1.5);
  // b and c tie on all four: same rank.
  assert.deepEqual(board.map((row) => row.rank), [1, 2, 2]);

  // Reset clears the points; ended, it takes no more.
  store.reset(event.id);
  assert.deepEqual(store.get(event.id).players, {});
  store.end(event.id, now);
  assert.equal(statusOf(store.get(event.id), now), "ended");
  assert.deepEqual(store.recordResult("a", 51, { place: 1, kills: 0, matchId: "after" }, now), []);

  // A scheduled event waits for its start.
  const later = store.create({ startsAt: "2026-11-08T00:00:00Z", endsAt: "2026-11-09T00:00:00Z" }, now);
  assert.equal(later.name, "Solo Showdown");
  assert.equal(later.ruleset, "soloShowdownMay2018");
  assert.equal(statusOf(later, now), "scheduled");
  assert.deepEqual(store.recordResult("a", 51, { place: 1, kills: 0 }, now), []);
  assert.equal(store.recordResult("a", 51, { place: 1, kills: 0 }, new Date("2026-11-08T01:00:00Z")).length, 1);
  assert.throws(() => store.create({ ruleset: "nope" }), /Unknown scoring rules/);
  assert.throws(() => store.create({ startsAt: "2026-11-09T00:00:00Z", endsAt: "2026-11-08T00:00:00Z" }), /ends after it starts/);
}));

test("the admin panel's Tournaments tab: create an event, matches reported in Solo Showdown score, reset, end, delete (#263)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Showdowner");
    const other = await userLogin(backend.port, "Runnerup");
    const overview = await get(backend.port, "/admin/api/tournaments");
    assert.equal(overview.status, 200);
    assert.deepEqual(overview.body.events, []);
    assert.equal(overview.body.playlists[0].playlistId, 51);
    assert.deepEqual(overview.body.playlists[0].versions, ["4.2"]);

    const created = await post(backend.port, "/admin/api/tournaments", undefined, { name: "Showdown Week" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { id } = created.body.event;
    assert.equal((await post(backend.port, "/admin/api/tournaments", undefined, { ruleset: "bogus" })).status, 400);

    const dedicated = await dedicatedServerToken(backend.port);
    // CoreV2's reports (User-Agent "Core V2") name no build.
    const report = (playlistId, matchId, results, agent = "Core V2") => {
      const text = JSON.stringify({ playlistId, matchId, countWins: true, results: results.map((result) => ({ secondsAlive: 600, ...result })) });
      return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/fortnite/api/game/v2/battleroyale/recordresults", headers: {
        "User-Agent": agent, Authorization: `bearer ${dedicated}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    };
    await report(51, "match1", [{ accountId: player.accountId, place: 1, kills: 5 }, { accountId: other.accountId, place: 12, kills: 1 }]);
    await report(51, "match1", [{ accountId: player.accountId, place: 1, kills: 5 }]);
    await report(2, "match2", [{ accountId: other.accountId, place: 1, kills: 9 }]);
    // A report from a build without Solo Showdown (Cert's playlist 51 isn't it): nothing.
    await report(51, "match4", [{ accountId: other.accountId, place: 1, kills: 9 }], "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3532353");

    let event = (await get(backend.port, `/admin/api/tournaments/${id}`)).body;
    assert.equal(event.status, "running");
    assert.equal(event.players, undefined, "the matches stay in the store");
    assert.deepEqual(event.leaderboard.map(({ rank, displayName, points, matches, wins }) => [rank, displayName, points, matches, wins]),
      [[1, "Showdowner", 100, 1, 1], [2, "Runnerup", 55, 1, 0]]);

    assert.deepEqual((await post(backend.port, `/admin/api/tournaments/${id}/reset`, undefined, {})).body.event.leaderboard, []);
    const ended = await post(backend.port, `/admin/api/tournaments/${id}/end`, undefined, {});
    assert.equal(ended.body.event.status, "ended");
    await report(51, "match3", [{ accountId: player.accountId, place: 1, kills: 0 }]);
    event = (await get(backend.port, `/admin/api/tournaments/${id}`)).body;
    assert.deepEqual(event.leaderboard, []);

    assert.equal((await del(backend.port, `/admin/api/tournaments/${id}`)).status, 200);
    assert.equal((await get(backend.port, `/admin/api/tournaments/${id}`)).status, 404);
    assert.equal((await post(backend.port, `/admin/api/tournaments/${id}/end`, undefined, {})).status, 404);
  } finally {
    backend.close();
  }
});

test("an event's custom points: validated, used in place of the preset's, rescoring its matches, and reset to default (#280)", () => withStore((store, dataDir) => {
  const now = new Date("2026-11-07T12:00:00Z");
  const scoring = { placementPoints: [[1, 50], [5, 20], [10, 5]], pointsPerElimination: 3 };
  assert.deepEqual(validateScoring(scoring), scoring);
  assert.deepEqual(validateScoring({ placementPoints: [{ upTo: 1, points: 10 }] }), { placementPoints: [[1, 10]], pointsPerElimination: 0 });
  for (const [bad, reason] of [
    [null, /Scoring is/], [{ placementPoints: [] }, /1 to 100 brackets/], [{ placementPoints: "1:100" }, /1 to 100 brackets/],
    [{ placementPoints: [[0, 10]] }, /last place is a whole number/], [{ placementPoints: [[101, 10]] }, /last place/],
    [{ placementPoints: [[1.5, 10]] }, /last place/], [{ placementPoints: [["1", 10]] }, /last place/],
    [{ placementPoints: [[1, -1]] }, /points are a whole number/], [{ placementPoints: [[1, null]] }, /points are/],
    [{ placementPoints: [[5, 10], [5, 9]] }, /Bracket 2's last place must come after bracket 1's \(5\)/], [{ placementPoints: [[5, 10], [3, 9]] }, /must come after/],
    [{ placementPoints: [[1, 10]], pointsPerElimination: -2 }, /Points an elimination/], [{ placementPoints: [[1, 10]], pointsPerElimination: 0.5 }, /Points an elimination/]
  ]) assert.throws(() => validateScoring(bad), reason, JSON.stringify(bad));

  // Created with custom points: they score its matches; the preset still sets the counted and qualifying matches.
  const custom = store.create({ ruleset: "soloShowdownMay2018", scoring }, now);
  assert.deepEqual(custom.scoring, scoring);
  assert.deepEqual(scoringOf(custom), { ...may, ...scoring });
  assert.deepEqual(store.recordResult("a", 51, { place: 4, kills: 2, matchId: "m1" }, now).map(({ points }) => points), [20 + 6]);
  store.recordResult("a", 51, { place: 11, kills: 1, matchId: "m2" }, now);
  let board = leaderboardOf(createTournamentStore(dataDir).get(custom.id));
  assert.deepEqual([board[0].points, board[0].qualified], [26 + 3, false]);

  // Reset to default: the preset's points rescore the matches played (May 2018: 4th 88, 11th 55, no eliminations).
  store.setScoring(custom.id, null);
  assert.equal(store.get(custom.id).scoring, null);
  assert.equal(leaderboardOf(store.get(custom.id))[0].points, 88 + 55);
  // Set again: rescored the other way, and a bad table leaves the event's points as they were.
  store.setScoring(custom.id, { placementPoints: [[100, 1]], pointsPerElimination: 10 });
  assert.equal(leaderboardOf(createTournamentStore(dataDir).get(custom.id))[0].points, 1 + 20 + 1 + 10);
  assert.throws(() => store.setScoring(custom.id, { placementPoints: [[3, 1], [2, 1]] }), /must come after/);
  assert.deepEqual(store.get(custom.id).scoring, { placementPoints: [[100, 1]], pointsPerElimination: 10 });
  assert.equal(store.setScoring("nope", null), null);
  assert.throws(() => store.create({ scoring: { placementPoints: [] } }), /brackets/);

  // An event made before #280 (no scoring field) scores by its preset.
  const old = store.create({}, now);
  delete old.scoring;
  assert.deepEqual(scoringOf(old), may);
  assert.equal(store.recordResult("b", 51, { place: 1, kills: 4, matchId: "o1" }, now).find(({ eventId }) => eventId === old.id).points, 100);
}));

test("the admin panel sets an event's custom points and resets them to its preset's (#280)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Pointer");
    const created = await post(backend.port, "/admin/api/tournaments", undefined, { ruleset: "soloShowdownJuly2018", scoring: { placementPoints: [[1, 10]], pointsPerElimination: 1 } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { id } = created.body.event;
    assert.deepEqual(created.body.event.effectiveScoring, { placementPoints: [[1, 10]], pointsPerElimination: 1 });
    assert.equal((await post(backend.port, "/admin/api/tournaments", undefined, { scoring: { placementPoints: [[2, 5], [1, 9]] } })).status, 400);

    const dedicated = await dedicatedServerToken(backend.port);
    const text = JSON.stringify({ playlistId: 51, matchId: "p1", countWins: true, results: [{ accountId: player.accountId, place: 1, kills: 3, secondsAlive: 600 }] });
    await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/fortnite/api/game/v2/battleroyale/recordresults", headers: {
      "User-Agent": "Core V2", Authorization: `bearer ${dedicated}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    assert.equal((await get(backend.port, `/admin/api/tournaments/${id}`)).body.leaderboard[0].points, 13);

    const set = await post(backend.port, `/admin/api/tournaments/${id}/scoring`, undefined, { scoring: { placementPoints: [[1, 200], [100, 1]], pointsPerElimination: 0 } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.event.leaderboard[0].points, 200);
    assert.equal((await post(backend.port, `/admin/api/tournaments/${id}/scoring`, undefined, { scoring: { placementPoints: [[1, -5]] } })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/tournaments/nope/scoring", undefined, { scoring: null })).status, 404);

    // Reset to default: July 2018's, 100 for the win and 6 an elimination.
    const reset = await post(backend.port, `/admin/api/tournaments/${id}/scoring`, undefined, { scoring: null });
    assert.equal(reset.body.event.scoring, null);
    assert.equal(reset.body.event.effectiveScoring.pointsPerElimination, 6);
    assert.equal(reset.body.event.leaderboard[0].points, 100 + 18);
  } finally {
    backend.close();
  }
});

test("an event's dedicated servers and bots: checked, only while it runs, the newest event's bots (#282)", () => withStore((store) => {
  const now = new Date("2026-11-07T12:00:00Z");
  assert.deepEqual(validateServers(undefined), []);
  assert.deepEqual(validateServers("203.0.113.5, 198.51.100.0/24 203.0.113.5"), ["203.0.113.5", "198.51.100.0/24"]);
  assert.throws(() => validateServers(["server.example.com"]), /Not an IP address/);
  assert.equal(validateBots(null), null);
  assert.deepEqual(validateBots({ enabled: false }), { enabled: false, count: 0 });
  assert.throws(() => validateBots({ enabled: true, count: 101 }), /0 to 100/);
  assert.throws(() => validateBots({ count: 5 }), /enabled/);

  // A new event: the normal pool and the Matchmaking tab's bots.
  const plain = store.create({}, now);
  assert.deepEqual([plain.servers, plain.bots], [[], null]);
  assert.deepEqual(store.runningServers(now), []);
  assert.equal(store.botsFor(51, now), null);
  const own = store.create({ servers: ["203.0.113.5"], bots: { enabled: true, count: 9 } }, new Date(now.getTime() + 1000));
  assert.deepEqual(store.runningServers(now), [{ playlistId: 51, servers: ["203.0.113.5"] }]);
  assert.deepEqual(store.botsFor(51, now), { eventId: own.id, enabled: true, count: 9 });
  assert.equal(store.botsFor(2, now), null);
  // configure leaves what isn't sent; ended, the event's servers and bots no longer apply.
  store.configure(own.id, { bots: { enabled: false } });
  assert.deepEqual([store.get(own.id).servers, store.get(own.id).bots], [["203.0.113.5"], { enabled: false, count: 0 }]);
  assert.throws(() => store.configure(own.id, { servers: ["x"] }), /Not an IP address/);
  assert.equal(store.configure("nope", {}), null);
  store.end(own.id, now);
  assert.deepEqual(store.runningServers(now), []);
  assert.equal(store.botsFor(51, now), null);

  // The match's bots: the tab's as they are, or the event's over them.
  const tab = { forcePlayerAIs: true, count: 40, level: 3, fillPlayerTeams: true };
  assert.equal(effectiveBots(tab, null), tab);
  assert.deepEqual(effectiveBots(tab, { enabled: true, count: 5 }), { ...tab, startingHealth: 100, startingShield: 0, eliminationsCountForQuests: true, botFightChance: 30, count: 5 });
  assert.equal(botsOn(effectiveBots(tab, { enabled: false, count: 5 })), false);
  assert.equal(botsOn(effectiveBots(undefined, { enabled: true, count: 5 })), true);
  assert.equal(botsOn(effectiveBots(undefined, null)), false);
}));
