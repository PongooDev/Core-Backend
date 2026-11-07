import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTournamentStore, leaderboardOf, matchPoints, placementPoints, rulesets, statusOf, tournamentPlaylists } from "../src/tournaments/store.js";
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
