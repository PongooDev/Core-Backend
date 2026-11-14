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
  // 6.10's three, 6.20's three and 6.30's three are the in-game ones (tests/build610.test.js, tests/build620.test.js,
  // tests/build630.test.js).
  assert.deepEqual(tournamentPlaylists.map(({ id, playlistId }) => [id, playlistId]), [["soloShowdown", 51], ["showdownSolo", 58071], ["showdownDuos", 58072], ["showdownSquads", 58073],
    ["fortnitemaresShowSolo", 59071], ["fortnitemaresShowDuos", 59072], ["fortnitemaresShowSquads", 59073],
    ["scavengerSolo", 58074], ["scavengerDuos", 58075], ["scavengerSquads", 58076]]);
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
  assert.deepEqual(scoringOf(custom), { ...may, eliminationPoints: [], ...scoring });
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

test("Epic's in-game tournament points: a point a step, every match counted, the in-game playlists' default; elimination steps in custom points (#427)", () => withStore((store, dataDir) => {
  const now = new Date("2026-11-13T12:00:00Z");
  const inGame = rulesets.inGameOctober2018;
  // Top 10, Top 3 and the win a point each; 3, 5 and 7 eliminations a point each: 6 at most.
  for (const [place, kills, points] of [[1, 7, 6], [1, 0, 3], [2, 2, 2], [3, 3, 3], [4, 4, 2], [10, 5, 3], [11, 6, 2], [50, 9, 3], [11, 2, 0]]) {
    assert.equal(matchPoints(inGame, { place, kills }), points, `place ${place}, ${kills} eliminations`);
  }
  // An in-game playlist's event without a ruleset is made on it; 4.2's keeps May 2018's.
  const event = store.create({ name: "Alpha", playlist: "showdownSolo" }, now);
  assert.equal(event.ruleset, "inGameOctober2018");
  assert.equal(store.create({ playlist: "fortnitemaresShowSquads" }, now).ruleset, "inGameOctober2018");
  assert.equal(store.create({ playlist: "soloShowdown" }, now).ruleset, "soloShowdownMay2018");
  assert.equal(store.create({ playlist: "showdownSolo", ruleset: "soloShowdownJuly2018" }, now).ruleset, "soloShowdownJuly2018");
  // Every match counts (no countedMatches), and nobody waits to be ranked.
  for (let n = 0; n < 60; n += 1) store.recordResult("a", 58071, { place: 1, kills: 7, matchId: `m${n}` }, now);
  const [row] = leaderboardOf(createTournamentStore(dataDir).get(event.id));
  assert.deepEqual([row.matches, row.points, row.qualified], [60, 360, true]);

  // Custom points with elimination steps: checked, in place of the preset's steps, and none when left out.
  const steps = { placementPoints: [[1, 10]], pointsPerElimination: 2, eliminationPoints: [[3, 5], [25, 10]] };
  assert.deepEqual(validateScoring(steps), steps);
  assert.deepEqual(validateScoring({ placementPoints: [[1, 1]], eliminationPoints: [{ eliminations: 2, points: 1 }] }), { placementPoints: [[1, 1]], pointsPerElimination: 0, eliminationPoints: [[2, 1]] });
  assert.deepEqual(validateScoring({ placementPoints: [[1, 1]], eliminationPoints: [] }), { placementPoints: [[1, 1]], pointsPerElimination: 0 });
  for (const [bad, reason] of [
    [{ eliminationPoints: "3:1" }, /elimination steps are a list/], [{ eliminationPoints: [[0, 1]] }, /step 1's eliminations are a whole number/],
    [{ eliminationPoints: [[101, 1]] }, /eliminations are a whole number from 1 to 100/], [{ eliminationPoints: [[3, -1]] }, /step 1's points/],
    [{ eliminationPoints: [[3, 1], [3, 1]] }, /step 2 must come after step 1 \(3 eliminations\)/], [{ eliminationPoints: [[5, 1], [3, 1]] }, /must come after/]
  ]) assert.throws(() => validateScoring({ placementPoints: [[1, 1]], ...bad }), reason, JSON.stringify(bad));
  assert.equal(matchPoints(scoringOf({ ruleset: "soloShowdownMay2018", scoring: validateScoring(steps) }), { place: 1, kills: 30 }), 10 + 60 + 5 + 10);
  store.setScoring(event.id, { placementPoints: [[1, 5]], pointsPerElimination: 1 });
  assert.deepEqual(scoringOf(store.get(event.id)).eliminationPoints, [], "custom points without steps have none of the preset's");
  assert.equal(leaderboardOf(store.get(event.id))[0].points, 60 * (5 + 7));
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

    // #427: an in-game playlist's event starts on Epic's in-game points, steps and all; custom steps are saved.
    const inGame = await post(backend.port, "/admin/api/tournaments", undefined, { name: "Alpha", playlist: "showdownSolo" });
    assert.equal(inGame.status, 201, JSON.stringify(inGame.body));
    assert.deepEqual(inGame.body.defaultRulesets, { inGame: "inGameOctober2018", other: "soloShowdownMay2018" });
    assert.deepEqual([inGame.body.event.ruleset, inGame.body.event.effectiveScoring],
      ["inGameOctober2018", { placementPoints: [[1, 3], [3, 2], [10, 1]], pointsPerElimination: 0, eliminationPoints: [[3, 1], [5, 1], [7, 1]] }]);
    const stepped = await post(backend.port, `/admin/api/tournaments/${inGame.body.event.id}/scoring`, undefined,
      { scoring: { placementPoints: [[1, 2]], pointsPerElimination: 0, eliminationPoints: [[2, 1], [4, 1]] } });
    assert.deepEqual(stepped.body.event.effectiveScoring, { placementPoints: [[1, 2]], pointsPerElimination: 0, eliminationPoints: [[2, 1], [4, 1]] });
    assert.equal((await post(backend.port, `/admin/api/tournaments/${inGame.body.event.id}/scoring`, undefined,
      { scoring: { placementPoints: [[1, 2]], eliminationPoints: [[4, 1], [2, 1]] } })).status, 400);
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
