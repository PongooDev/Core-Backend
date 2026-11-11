import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStatsStore, windowEnd, windowStart, windows } from "../src/stats/store.js";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

// 1.8's Battle Royale leaderboards (Core-Backend #71, #73), from the stats Core records.
const record = (port, token, playlistId, results) => post(port, "/fortnite/api/game/v2/battleroyale/recordresults", token, { playlistId, results });

test("1.8's leaderboards rank the accounts asked for by what Core recorded, in the window asked for", async () => {
  const backend = await startBackend();
  try {
    const [ace, bee, cee, idle] = [await userLogin(backend.port, "Ace18"), await userLogin(backend.port, "Bee18"),
      await userLogin(backend.port, "Cee18"), await userLogin(backend.port, "Idle18")];
    const dedicated = await dedicatedServerToken(backend.port);
    await record(backend.port, dedicated, 2, [
      { accountId: ace.accountId, place: 1, kills: 6, secondsAlive: 1200 },
      { accountId: bee.accountId, place: 8, kills: 2, secondsAlive: 900 },
      { accountId: cee.accountId, place: 8, kills: 2, secondsAlive: 800 }
    ]);
    await record(backend.port, dedicated, 2, [{ accountId: bee.accountId, place: 3, kills: 1, secondsAlive: 1000 }]);
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", dedicated, { playlistId: 2, accountIds: [ace.accountId] });
    // Another playlist's matches don't count toward solo's boards.
    await record(backend.port, dedicated, 10, [{ accountId: cee.accountId, place: 1, kills: 9, secondsAlive: 1000 }]);

    // The lobby's cohort: the player and the others who played the playlist, the most matches first.
    const cohort = await get(backend.port, `/fortnite/api/game/v2/leaderboards/cohort/${idle.accountId}?playlist=pc_m0_p2`, idle.token);
    assert.equal(cohort.status, 200);
    assert.deepEqual(cohort.body.cohortAccounts.slice(0, 2), [idle.accountId, bee.accountId]);
    assert.deepEqual(new Set(cohort.body.cohortAccounts), new Set([idle.accountId, ace.accountId, bee.accountId, cee.accountId]));
    assert.equal(cohort.body.playlist, "pc_m0_p2");
    assert.ok(Date.parse(cohort.body.expiresAt) > Date.now());

    // A group board (the body: the accounts to rank), as the client sends it; an unknown id is left out.
    const board = (statName, window, body, type = "group", query = "") =>
      post(backend.port, `/fortnite/api/leaderboards/type/${type}/stat/${statName}/window/${window}?ownertype=1${query}`, idle.token, body);
    const top10 = await board("br_placetop10_pc_m0_p2", "weekly", [...cohort.body.cohortAccounts, "0123456789abcdef0123456789abcdef"]);
    assert.equal(top10.status, 200);
    assert.deepEqual([top10.body.statName, top10.body.statWindow], ["br_placetop10_pc_m0_p2", "weekly"]);
    const byAccount = Object.fromEntries(top10.body.entries.map(({ accountId, value, rank }) => [accountId, [value, rank]]));
    // Ranks go down the list, equal values in account order.
    const [tiedFirst, tiedSecond] = [ace.accountId, cee.accountId].sort();
    assert.deepEqual(byAccount, { [bee.accountId]: [2, 1], [tiedFirst]: [1, 2], [tiedSecond]: [1, 3], [idle.accountId]: [0, 4] });
    assert.deepEqual(top10.body.entries.map(({ rank }) => rank), [1, 2, 3, 4]);

    const wins = (await board("br_placetop1_pc_m0_p2", "alltime", [ace.accountId, bee.accountId])).body.entries;
    assert.deepEqual(wins.map(({ accountId, value, rank }) => [accountId, value, rank]), [[ace.accountId, 1, 1], [bee.accountId, 0, 2]]);
    const minutes = (await board("br_minutesplayed_pc_m0_p2", "daily", [bee.accountId])).body.entries;
    assert.deepEqual(minutes.map(({ value }) => value), [31]);

    // Asked for no one, a group board is the player's cohort's; a global one ranks everyone with something, by page.
    assert.equal((await board("br_kills_pc_m0_p2", "monthly", [])).body.entries.length, 4);
    const kills = await board("br_kills_pc_m0_p2", "alltime", undefined, "global", "&pageNumber=0&itemsPerPage=2");
    assert.deepEqual(kills.body.entries.map(({ accountId, value, rank }) => [accountId, value, rank]), [[ace.accountId, 6, 1], [bee.accountId, 3, 2]]);
    const second = await board("br_kills_pc_m0_p2", "alltime", undefined, "global", "&pageNumber=1&itemsPerPage=2");
    assert.deepEqual(second.body.entries.map(({ accountId, rank }) => [accountId, rank]), [[cee.accountId, 3]]);

    // A stat or window there is no such thing as: nobody.
    assert.deepEqual((await board("br_placetop1_pc_m0_p2", "yearly", [ace.accountId])).body.entries, []);
    assert.deepEqual((await board("nonsense", "weekly", [ace.accountId])).body.entries, []);
  } finally {
    backend.close();
  }
});

test("the leaderboards' windows count what each day added: the day, the week from Monday and the month (UTC)", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-windows-"));
  try {
    const stats = createStatsStore(dataDir);
    const at = (iso) => new Date(iso);
    // Wednesday 2026-10-28: the week began on Monday the 26th, the month on the 1st.
    const now = at("2026-10-28T12:00:00Z");
    assert.deepEqual(["daily", "weekly", "monthly", "alltime"].map((window) => windowStart(window, now)), ["2026-10-28", "2026-10-26", "2026-10-01", ""]);
    const match = (iso, kills) => stats.recordResult("windows", 2, { place: 50, kills, secondsAlive: 60 }, at(iso));
    match("2026-09-30T23:00:00Z", 1);
    match("2026-10-25T23:59:00Z", 2);
    match("2026-10-26T00:00:00Z", 4);
    match("2026-10-28T08:00:00Z", 8);
    assert.deepEqual(["daily", "weekly", "monthly", "alltime"].map((window) => stats.stat("windows", 2, "kills", window, now)), [8, 12, 14, 15]);
    assert.equal(stats.stat("windows", 2, "matchesplayed", "weekly", now), 2);
    assert.equal(stats.stat("windows", 10, "kills", "alltime", now), 0);
    // Days older than a month are dropped as new ones come; the career keeps them.
    match("2026-11-30T08:00:00Z", 16);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "accounts", "windows", "stats.json"), "utf8"));
    assert.deepEqual(Object.keys(saved.days), ["2026-11-30"]);
    assert.equal(stats.stat("windows", 2, "kills", "alltime"), 31);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// Core-Backend #128: the lobby leaderboards' Score tab (GameplayStat.BR.Score: br_score_pc_m0_p<playlist>) ranks the
// score of the matches recorded, each worth what it is in season XP unless the server sends its own score.
test("the leaderboards' Score tab ranks each player's match scores in the playlist", async () => {
  const backend = await startBackend();
  try {
    const [ace, bee, cee] = [await userLogin(backend.port, "AceScore"), await userLogin(backend.port, "BeeScore"),
      await userLogin(backend.port, "CeeScore")];
    const dedicated = await dedicatedServerToken(backend.port);
    // Squads: a win with 3 kills and 20 minutes alive is 100 + 150 + 300; a 5th place (top 6) with 1 kill, 10 minutes,
    // 50 + 50 + 50; a server's own score is taken as sent.
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated, { playlistId: 9, countWins: true, results: [
      { accountId: ace.accountId, place: 1, kills: 3, secondsAlive: 1210 },
      { accountId: bee.accountId, place: 5, kills: 1, secondsAlive: 600 },
      { accountId: cee.accountId, place: 2, kills: 0, secondsAlive: 900, score: 777 }
    ] });
    await record(backend.port, dedicated, 9, [{ accountId: bee.accountId, place: 2, kills: 0, secondsAlive: 60 }]);

    const board = await post(backend.port, "/fortnite/api/leaderboards/type/group/stat/br_score_pc_m0_p9/window/weekly?ownertype=1",
      ace.token, [ace.accountId, bee.accountId, cee.accountId]);
    assert.equal(board.status, 200);
    assert.deepEqual(board.body.entries.map(({ accountId, value, rank }) => [accountId, value, rank]),
      [[cee.accountId, 777, 1], [ace.accountId, 550, 2], [bee.accountId, 255, 3]]);

    // The stats screen has it too.
    const career = await get(backend.port, `/fortnite/api/stats/accountId/${ace.accountId}/bulk/window/alltime`, ace.token);
    assert.equal(career.body.find(({ name }) => name === "br_score_pc_m0_p9")?.value, 550);
  } finally {
    backend.close();
  }
});

// Core-Backend #151: 1.11's leaderboards are Season 2's, from nothing, and 1.8 to 1.10's still Season 1's; the cohort lasts
// until the week the boards rank is over, which the screen counts down to as "Leaderboards reset in".
const agentOf = (build) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${build}`;
function as(build, port, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agentOf(build), Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method: text === undefined ? "GET" : "POST", path: urlPath, headers }, text);
}

test("1.11's leaderboards rank Season 2's matches and 1.10's Season 1's", async () => {
  const backend = await startBackend();
  try {
    const [ace, bee, cee] = [await userLogin(backend.port, "AceS2"), await userLogin(backend.port, "BeeS2"), await userLogin(backend.port, "CeeS2")];
    const dedicated = await dedicatedServerToken(backend.port);
    const report = (build, results) => as(build, backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated,
      { playlistId: 9, countWins: true, results });
    // Season 1 (1.10): Ace wins with 4 kills; Season 2 (1.11): Bee wins, Cee is 5th.
    assert.equal((await report("3790078", [{ accountId: ace.accountId, place: 1, kills: 4, secondsAlive: 1200 }])).status, 200);
    assert.equal((await report("3807424", [
      { accountId: bee.accountId, place: 1, kills: 2, secondsAlive: 1300 },
      { accountId: cee.accountId, place: 5, kills: 1, secondsAlive: 900 }
    ])).status, 200);

    const ids = [ace.accountId, bee.accountId, cee.accountId];
    const board = async (build, statName, window) => (await as(build, backend.port,
      `/fortnite/api/leaderboards/type/group/stat/${statName}/window/${window}?ownertype=1`, ace.token, ids)).body.entries
      .map(({ accountId, value, rank }) => [accountId, value, rank]);
    assert.deepEqual(await board("3807424", "br_placetop1_pc_m0_p9", "weekly"),
      [[bee.accountId, 1, 1], ...[ace.accountId, cee.accountId].sort().map((id, index) => [id, 0, index + 2])]);
    assert.deepEqual((await board("3807424", "br_kills_pc_m0_p9", "alltime")).slice(0, 2), [[bee.accountId, 2, 1], [cee.accountId, 1, 2]]);
    assert.deepEqual((await board("3790078", "br_kills_pc_m0_p9", "alltime"))[0], [ace.accountId, 4, 1]);
    assert.deepEqual((await board("3790078", "br_placetop3_pc_m0_p9", "daily")).map(([, value]) => value), [1, 0, 0]);

    // A global board has those with something in the season; the cohort, those who played it.
    const global = await as("3807424", backend.port, "/fortnite/api/leaderboards/type/global/stat/br_placetop6_pc_m0_p9/window/alltime?ownertype=1", ace.token, []);
    assert.deepEqual(global.body.entries.map(({ accountId }) => accountId).sort(), [bee.accountId, cee.accountId].sort());
    const cohort = (await as("3807424", backend.port, `/fortnite/api/game/v2/leaderboards/cohort/${ace.accountId}?playlist=pc_m0_p9`, ace.token)).body;
    assert.deepEqual(new Set(cohort.cohortAccounts), new Set(ids));
    const oldCohort = (await as("3790078", backend.port, `/fortnite/api/game/v2/leaderboards/cohort/${bee.accountId}?playlist=pc_m0_p9`, bee.token)).body;
    assert.deepEqual(oldCohort.cohortAccounts, [bee.accountId, ace.accountId]);
    // It expires when the week starts again: Monday, 00:00 UTC.
    assert.equal(cohort.expiresAt, windowEnd("weekly").toISOString());
    assert.equal(new Date(cohort.expiresAt).getUTCDay(), 1);

    // The stats screen is the career's, every season's.
    const career = await as("3807424", backend.port, `/fortnite/api/stats/accountId/${ace.accountId}/bulk/window/alltime`, ace.token);
    assert.equal(career.body.find(({ name }) => name === "br_kills_pc_m0_p9")?.value, 4);
  } finally {
    backend.close();
  }
});

// Core-Backend #151 again: CoreV2's own reports name no build (User-Agent "Core V2"), so a match's season comes from the
// session its player is on (the gameserver's build), else the season the player's profile is in. 2.1 is Season 2 too.
test("a Core gameserver's 2.1 and 1.11 results are Season 2's, read back by 2.1's and 1.11's cohort and boards", async () => {
  const backend = await startBackend();
  try {
    const coreV2 = (urlPath, token, body) => {
      const text = JSON.stringify(body);
      return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: urlPath, headers: { "User-Agent": "Core V2",
        Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    };
    const athena = (build, { accountId, token }) =>
      as(build, backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=athena&rvn=-1`, token, {});
    const [solo, duo, late, old] = [await userLogin(backend.port, "SoloS2"), await userLogin(backend.port, "DuoS2"),
      await userLogin(backend.port, "LateS2"), await userLogin(backend.port, "OldS1")];
    for (const player of [solo, duo]) await athena("3825894", player);
    await athena("3807424", late);
    await athena("3790078", old);

    // A 2.1 gameserver's session with Solo and Duo on it.
    const server = await userLogin(backend.port, "CoreServer1");
    const session = (await as("3825894", backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "1", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
    })).body;
    await as("3825894", backend.port, `/fortnite/api/matchmaking/session/${session.id}/players`, server.token,
      { publicPlayers: [solo.accountId, duo.accountId], privatePlayers: [] });
    const dedicated = await dedicatedServerToken(backend.port);
    const report = (playlistId, results) => coreV2("/fortnite/api/game/v2/battleroyale/recordresults", dedicated,
      { playlistId, matchId: `m${playlistId}`, countWins: true, results });
    assert.equal((await report(2, [
      { accountId: solo.accountId, place: 1, kills: 3, secondsAlive: 1000 },
      { accountId: duo.accountId, place: 7, kills: 1, secondsAlive: 600 }
    ])).status, 200);
    // On no session: the season their profile is in, Season 2 for 1.11's player and Season 1 for 1.10's.
    assert.equal((await report(2, [{ accountId: late.accountId, place: 2, kills: 2, secondsAlive: 900 }])).status, 200);
    assert.equal((await report(2, [{ accountId: old.accountId, place: 1, kills: 9, secondsAlive: 1500 }])).status, 200);

    // 2.1's lobby: the solo cohort is the player and the others who played solo this season, not Season 1's Old.
    for (const build of ["3825894", "3807424"]) {
      const cohort = (await as(build, backend.port, `/fortnite/api/game/v2/leaderboards/cohort/${solo.accountId}?playlist=pc_m0_p2`, solo.token)).body;
      assert.equal(cohort.cohortAccounts[0], solo.accountId);
      assert.deepEqual(new Set(cohort.cohortAccounts), new Set([solo.accountId, duo.accountId, late.accountId]), build);
      const board = async (statName, window) => (await as(build, backend.port,
        `/fortnite/api/leaderboards/type/group/stat/${statName}/window/${window}?ownertype=1`, solo.token, cohort.cohortAccounts)).body;
      for (const window of windows) {
        const wins = await board("br_placetop1_pc_m0_p2", window);
        assert.equal(wins.statWindow, window);
        assert.deepEqual(wins.entries[0], { accountId: solo.accountId, value: 1, rank: 1 }, `${build} ${window}`);
        assert.deepEqual((await board("br_kills_pc_m0_p2", window)).entries.map(({ accountId, value }) => [accountId, value]),
          [[solo.accountId, 3], [late.accountId, 2], [duo.accountId, 1]], `${build} ${window}`);
      }
      // The Score tab: a match's score is its season XP when the server sends none (1000 s, 3 kills, a win: 80 + 150 + 300).
      assert.deepEqual((await board("br_score_pc_m0_p2", "weekly")).entries[0], { accountId: solo.accountId, value: 530, rank: 1 });
    }
    // 1.10's boards are Season 1's: Old's win, and nothing of Season 2's.
    const s1 = (await as("3790078", backend.port, "/fortnite/api/leaderboards/type/group/stat/br_kills_pc_m0_p2/window/weekly?ownertype=1",
      old.token, [old.accountId, solo.accountId])).body.entries;
    assert.deepEqual(s1.map(({ accountId, value }) => [accountId, value]), [[old.accountId, 9], [solo.accountId, 0]]);
  } finally {
    backend.close();
  }
});

// Core-Backend #168: a 1.11 solo match, reported the way CoreV2's 1.11 server reports it, read back through the requests
// 1.11's leaderboard screen sends (AthenaLeaderboardScreenBase, the 2.1 IDB's sub_2041BF0, sub_2042090 and sub_206FAC0,
// the same screen as 1.11's): the cohort "pc_m0_p2" (the solo row, EFortAthenaPlaylist::AthenaSolo, sub_2052860 "%s_m0_p%d"),
// then, Friends Only off, a group board POSTed with the cohort's ids as a JSON array for the Score, Placed Top 25 and
// Placed Top 10 tabs, and a global board (page 0 of 50) for Global Wins, bIsGlobal in LeaderboardAndStatUIData. Each is
// window weekly (sub_79AB20(1), always) and named "GameplayStat.<tag>.pc.m0.p2" less "GameplayStat.", dots to
// underscores, lowercase (sub_2054720, sub_2E4E450): br_score_pc_m0_p2, br_placetop25_pc_m0_p2, br_placetop10_pc_m0_p2,
// br_placetop1_pc_m0_p2.
test("a 1.11 solo match from a Core gameserver shows on 1.11's Score, Placed Top 25, Placed Top 10 and Global Wins boards", async () => {
  const backend = await startBackend();
  try {
    const v111 = "3807424";
    const coreV2 = (urlPath, token, body) => {
      const text = JSON.stringify(body);
      return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: urlPath, headers: { "User-Agent": "Core V2",
        Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    };
    const [winner, fifth, idle] = [await userLogin(backend.port, "Normani111"), await userLogin(backend.port, "Fifth111"),
      await userLogin(backend.port, "Idle111")];
    for (const player of [winner, fifth, idle]) {
      await as(v111, backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=athena&rvn=-1`, player.token, {});
    }
    // The 1.11 gameserver's session, its players registered.
    const server = await userLogin(backend.port, "CoreServer1");
    const session = (await as(v111, backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "1", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
    })).body;
    await as(v111, backend.port, `/fortnite/api/matchmaking/session/${session.id}/players`, server.token,
      { publicPlayers: [winner.accountId, fifth.accountId], privatePlayers: [] });
    // CoreV2's report (FortGameModeAthena.cpp CheckMatchResults): no score of its own, so each is the match's season XP;
    // a score the server sends is taken as sent.
    const dedicated = await dedicatedServerToken(backend.port);
    assert.equal((await coreV2("/fortnite/api/game/v2/battleroyale/recordresults", dedicated, { playlistId: 2, countWins: true,
      matchId: "M168", results: [
        { accountId: fifth.accountId, place: 5, kills: 1, secondsAlive: 600, score: 420 },
        { accountId: winner.accountId, place: 1, kills: 4, secondsAlive: 1260 }
      ] })).status, 200);

    // The cohort, the player's own first.
    const cohort = (await as(v111, backend.port, `/fortnite/api/game/v2/leaderboards/cohort/${idle.accountId}?playlist=pc_m0_p2`, idle.token)).body;
    assert.equal(cohort.playlist, "pc_m0_p2");
    assert.deepEqual(new Set(cohort.cohortAccounts), new Set([idle.accountId, winner.accountId, fifth.accountId]));
    const board = async (type, statName, body, query = "") => {
      const response = await as(v111, backend.port, `/fortnite/api/leaderboards/type/${type}/stat/${statName}/window/weekly?ownertype=1${query}`,
        idle.token, body);
      assert.equal(response.status, 200);
      assert.deepEqual([response.body.statName, response.body.statWindow], [statName, "weekly"]);
      return response.body.entries.map(({ accountId, value, rank }) => [accountId, value, rank]);
    };
    // Score: 21 minutes, 4 kills and the win, 105 + 200 + 300; the 5th place's own 420.
    assert.deepEqual(await board("group", "br_score_pc_m0_p2", cohort.cohortAccounts),
      [[winner.accountId, 605, 1], [fifth.accountId, 420, 2], [idle.accountId, 0, 3]]);
    assert.deepEqual((await board("group", "br_placetop25_pc_m0_p2", cohort.cohortAccounts)).map(([, value]) => value), [1, 1, 0]);
    assert.deepEqual((await board("group", "br_placetop10_pc_m0_p2", cohort.cohortAccounts)).map(([, value]) => value), [1, 1, 0]);
    assert.deepEqual(await board("global", "br_placetop1_pc_m0_p2", [], "&pageNumber=0&itemsPerPage=50"), [[winner.accountId, 1, 1]]);
    // The player's own row, asked for by the winner: theirs.
    const own = await as(v111, backend.port, "/fortnite/api/leaderboards/type/group/stat/br_score_pc_m0_p2/window/weekly?ownertype=1",
      winner.token, [winner.accountId]);
    assert.deepEqual(own.body.entries, [{ accountId: winner.accountId, value: 605, rank: 1 }]);
  } finally {
    backend.close();
  }
});

// Core-Backend #320: 5.30's leaderboard screen (UAthenaLeaderboardScreenBase, the 5.30 IDB's sub_2CBE1C0, sub_2CDD560,
// sub_2CDF0E0, sub_2CBE680, sub_2CDDBE0) asks as 1.11's does: the cohort "pc_m0_p2" (sub_1010080 "%s.m%d.%s", dots to
// underscores, sub_8DD0E0), the cohort's names from the account service (sub_10276E0, MCP user info:
// /account/api/public/account?accountId=...), then a group board POSTed with those ids and the player's own (sub_10AF420)
// for Score, Placed Top 25 and Placed Top 10, and a global board, page 0 of 50 (sub_10AB820), for Global Wins; window
// weekly (sub_109EEC0(1)); stat "<BaseGameplayTag>.pc.m0.p2" (sub_10100B0) less "GameplayStat.", dots to underscores,
// lowercase. The answer is read by sub_1090D90 (statName, statWindow, entries [{accountId, value, rank}]). A Season 5
// match from 5.30's gameserver is on all of them, and not on 4.2's Season 4 boards.
// The list itself keeps the values a row first showed (4.2's #286 too): the screen hands its row objects back out on
// every answer (sub_2CDE7E0: RowProxies to RowProxiesFreeList and back), UListView::SetListItems (sub_215D740) only
// swaps the items, and LeaderboardRowWidget redraws in OnListItemObjectSet, which the list calls only for an object it
// has no row for. The bottom row is redrawn on every answer (LocalUserRow->SetDataDirect), from the same entries.
test("a 5.30 solo match from a Core gameserver shows on 5.30's Score, Placed Top 25, Placed Top 10 and Global Wins boards", async () => {
  const backend = await startBackend();
  try {
    const [v530, v42] = ["4305896", "4072250"];
    const coreV2 = (urlPath, token, body) => {
      const text = JSON.stringify(body);
      return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: urlPath, headers: { "User-Agent": "Core V2",
        Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    };
    const [winner, other, idle] = [await userLogin(backend.port, "Normani530"), await userLogin(backend.port, "Other530"),
      await userLogin(backend.port, "Idle530")];
    for (const player of [winner, other, idle]) {
      await as(v530, backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=athena&rvn=-1`, player.token, {});
    }
    const server = await userLogin(backend.port, "CoreServer530");
    const session = (await as(v530, backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer530", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "1", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
    })).body;
    await as(v530, backend.port, `/fortnite/api/matchmaking/session/${session.id}/players`, server.token,
      { publicPlayers: [winner.accountId, other.accountId], privatePlayers: [] });
    const dedicated = await dedicatedServerToken(backend.port);
    assert.equal((await coreV2("/fortnite/api/game/v2/battleroyale/recordresults", dedicated, { playlistId: 2, countWins: true,
      matchId: "M320", results: [
        { accountId: other.accountId, place: 8, kills: 2, secondsAlive: 900, score: 1200 },
        { accountId: winner.accountId, place: 1, kills: 6, secondsAlive: 1500, score: 3255 }
      ] })).status, 200);

    // The cohort, then the names of its accounts.
    const cohort = (await as(v530, backend.port, `/fortnite/api/game/v2/leaderboards/cohort/${winner.accountId}?playlist=pc_m0_p2`, winner.token)).body;
    assert.equal(cohort.playlist, "pc_m0_p2");
    assert.equal(cohort.cohortAccounts[0], winner.accountId);
    // The others who played solo this Season 5: not Idle, who hasn't.
    assert.deepEqual(new Set(cohort.cohortAccounts), new Set([winner.accountId, other.accountId]));
    const lookup = await as(v530, backend.port,
      `/account/api/public/account?${cohort.cohortAccounts.map((id) => `accountId=${id}`).join("&")}`, winner.token);
    assert.deepEqual(new Map(lookup.body.map(({ id, displayName }) => [id, displayName])),
      new Map([[winner.accountId, "Normani530"], [other.accountId, "Other530"]]));

    const board = async (build, type, statName, body, query = "") => {
      const response = await as(build, backend.port, `/fortnite/api/leaderboards/type/${type}/stat/${statName}/window/weekly?ownertype=1${query}`,
        winner.token, body);
      assert.equal(response.status, 200);
      assert.deepEqual([response.body.statName, response.body.statWindow], [statName, "weekly"]);
      return response.body.entries.map(({ accountId, value, rank }) => [accountId, value, rank]);
    };
    // Every account asked for, ranked, the player's own row among them; one with nothing this week is 0.
    assert.deepEqual(await board(v530, "group", "br_score_pc_m0_p2", cohort.cohortAccounts),
      [[winner.accountId, 3255, 1], [other.accountId, 1200, 2]]);
    assert.deepEqual(await board(v530, "group", "br_score_pc_m0_p2", [...cohort.cohortAccounts, idle.accountId]),
      [[winner.accountId, 3255, 1], [other.accountId, 1200, 2], [idle.accountId, 0, 3]]);
    assert.deepEqual((await board(v530, "group", "br_placetop25_pc_m0_p2", cohort.cohortAccounts)).map(([, value]) => value), [1, 1]);
    assert.deepEqual((await board(v530, "group", "br_placetop10_pc_m0_p2", cohort.cohortAccounts)).map(([, value]) => value), [1, 1]);
    assert.deepEqual(await board(v530, "global", "br_placetop1_pc_m0_p2", [], "&pageNumber=0&itemsPerPage=50"), [[winner.accountId, 1, 1]]);

    // 4.2's boards are Season 4's: nothing of 5.30's match, and a cohort of just the player.
    assert.deepEqual((await board(v42, "group", "br_score_pc_m0_p2", cohort.cohortAccounts)).map(([, value]) => value), [0, 0]);
    const oldCohort = (await as(v42, backend.port, `/fortnite/api/game/v2/leaderboards/cohort/${winner.accountId}?playlist=pc_m0_p2`, winner.token)).body;
    assert.deepEqual(oldCohort.cohortAccounts, [winner.accountId]);
  } finally {
    backend.close();
  }
});

test("a season's stats are its own matches; Season 1's are the career's less the later seasons'", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-seasons-"));
  try {
    const stats = createStatsStore(dataDir);
    const now = new Date("2026-11-04T12:00:00Z");
    stats.recordResult("seasons", 2, { place: 1, kills: 3, secondsAlive: 600, win: true }, new Date("2026-11-02T10:00:00Z"));
    stats.recordResult("seasons", 2, { place: 7, kills: 2, secondsAlive: 300, season: 2 }, new Date("2026-11-03T10:00:00Z"));
    stats.recordWin("seasons", 2, new Date("2026-11-04T10:00:00Z"), 2);
    assert.deepEqual([undefined, 1, 2].map((season) => stats.stat("seasons", 2, "kills", "alltime", now, season)), [5, 3, 2]);
    assert.deepEqual([undefined, 1, 2].map((season) => stats.stat("seasons", 2, "placetop1", "weekly", now, season)), [2, 1, 1]);
    assert.deepEqual([undefined, 1, 2].map((season) => stats.stat("seasons", 2, "placetop10", "daily", now, season)), [0, 0, 0]);
    assert.equal(stats.stat("seasons", 2, "minutesplayed", "alltime", now, 2), 5);
    assert.deepEqual([stats.played("seasons", 2, 2), stats.played("seasons", 10, 2), stats.played("other", 2, 1)], [true, false, false]);
    // A season with nothing is nothing; it is saved, and read back.
    assert.equal(stats.stat("seasons", 2, "kills", "alltime", now, 3), 0);
    assert.equal(createStatsStore(dataDir).stat("seasons", 2, "kills", "alltime", now, 2), 2);
    // The windows end when they start again.
    const at = new Date("2026-11-02T00:48:00Z");
    assert.deepEqual(["daily", "weekly", "monthly"].map((window) => windowEnd(window, at).toISOString()),
      ["2026-11-03T00:00:00.000Z", "2026-11-09T00:00:00.000Z", "2026-12-01T00:00:00.000Z"]);
    assert.equal(windowEnd("alltime", at), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("stats saved before scores were recorded get one estimated from their counts", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-score-"));
  try {
    const dir = path.join(dataDir, "accounts", "old");
    fs.mkdirSync(dir, { recursive: true });
    // Solo: 4 matches, 1 win, 2 top 10 (the win among them), 3 top 25, 5 kills, 41 minutes.
    const counts = { matchesplayed: 4, placetop1: 1, placetop10: 2, placetop25: 3, kills: 5, secondsplayed: 2460 };
    fs.writeFileSync(path.join(dir, "stats.json"), JSON.stringify({ playlists: { 2: counts }, days: { "2026-10-28": { 2: counts } } }));
    const stats = createStatsStore(dataDir);
    const estimate = 41 * 5 + 5 * 50 + 300 + 100 + 50;
    assert.equal(stats.stat("old", 2, "score", "alltime"), estimate);
    assert.equal(stats.stat("old", 2, "score", "monthly", new Date("2026-10-30T12:00:00Z")), estimate);
    // New matches add to it.
    stats.recordResult("old", 2, { place: 30, kills: 0, secondsAlive: 120, score: 10 });
    assert.equal(stats.stat("old", 2, "score", "alltime"), estimate + 10);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
