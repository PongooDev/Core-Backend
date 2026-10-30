import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #59: Battle Royale's career stats, recorded from what its gameservers report.
const stats = async (backend, player) => {
  const response = await get(backend.port, `/fortnite/api/stats/accountId/${player.accountId}/bulk/window/alltime`, player.token);
  assert.equal(response.status, 200);
  assert.ok(response.body.every((stat) => stat.window === "alltime" && stat.ownerType === 1));
  return Object.fromEntries(response.body.map((stat) => [stat.name, stat.value]));
};
const counts = (all) => Object.fromEntries(Object.entries(all).filter(([name]) => !name.startsWith("br_lastmodified_")));

// A gameserver's own login hosting a session the players are on (they fetched its key when they joined).
async function hostedMatch(backend, ...players) {
  const server = await userLogin(backend.port, `StatsServer${players.length}`);
  const session = (await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
    ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
    maxPublicPlayers: 100, buildUniqueId: "858118782", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
  })).body;
  for (const player of players) {
    await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${player.accountId}/session/${session.id}`, server.token);
  }
  return server;
}

test("a duo's win, places, kills and time alive show on the Battle Royale stats screen and last over a restart", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-stats-"));
  let backend = await startBackend({ dataDir });
  try {
    const leader = await userLogin(backend.port, "StatsLeader");
    const follower = await userLogin(backend.port, "StatsFollower");
    const server = await hostedMatch(backend, leader, follower);
    const dedicated = await dedicatedServerToken(backend.port);

    // Nothing played: no counts, and the stats are as of now.
    const before = await stats(backend, leader);
    assert.deepEqual(counts(before), {});
    assert.ok(Math.abs(before.br_lastmodified_pc_m0_p10 - Date.now() / 1000) < 60);

    // First match: the duo is out in 4th. Second: it wins, recorded by the 1.7.2 server itself and placed by CoreV2.
    const record = (body) => post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated, body);
    assert.equal((await record({ playlistId: 10, results: [
      { accountId: leader.accountId, place: 4, kills: 2, secondsAlive: 700 },
      { accountId: follower.accountId, place: 4, kills: 0, secondsAlive: 400 }
    ] })).status, 204);
    assert.equal((await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", server.token, { playlistId: 10, accountIds: [leader.accountId, follower.accountId] })).status, 204);
    await record({ playlistId: 10, results: [{ accountId: leader.accountId, place: 1, kills: 5, secondsAlive: 1100 }, { accountId: follower.accountId, place: 1, kills: 1, secondsAlive: 1100 }] });
    // A solo match of the leader's: its own playlist.
    await record({ playlistId: 2, results: [{ accountId: leader.accountId, place: 17, kills: 1, secondsAlive: 59 }] });

    const leaderStats = {
      br_matchesplayed_pc_m0_p10: 2, br_kills_pc_m0_p10: 7, br_placetop5_pc_m0_p10: 2, br_placetop12_pc_m0_p10: 2,
      br_placetop1_pc_m0_p10: 1, br_minutesplayed_pc_m0_p10: 30, br_score_pc_m0_p10: 895,
      br_matchesplayed_pc_m0_p2: 1, br_kills_pc_m0_p2: 1, br_placetop25_pc_m0_p2: 1, br_minutesplayed_pc_m0_p2: 0, br_score_pc_m0_p2: 100
    };
    assert.deepEqual(counts(await stats(backend, leader)), leaderStats);
    assert.deepEqual(counts(await stats(backend, follower)), {
      br_matchesplayed_pc_m0_p10: 2, br_kills_pc_m0_p10: 1, br_placetop5_pc_m0_p10: 2, br_placetop12_pc_m0_p10: 2,
      br_placetop1_pc_m0_p10: 1, br_minutesplayed_pc_m0_p10: 25, br_score_pc_m0_p10: 570
    });
    const after = await stats(backend, leader);
    assert.ok(Math.abs(after.br_lastmodified_pc_m0_p2 - Date.now() / 1000) < 60);
    assert.ok("br_lastmodified_pc_m0_p9" in after);

    // The other windows have what was recorded in them (1.8's leaderboards): all of it was today. One that isn't a
    // window has no counts.
    const window = async (name) => (await get(backend.port, `/fortnite/api/stats/accountId/${leader.accountId}/bulk/window/${name}`, leader.token)).body;
    const weekly = await window("weekly");
    assert.ok(weekly.every((stat) => stat.window === "weekly"));
    assert.deepEqual(counts(Object.fromEntries(weekly.map((stat) => [stat.name, stat.value]))), leaderStats);
    assert.deepEqual((await window("yearly")).map((stat) => stat.name), ["br_lastmodified_pc_m0_p2", "br_lastmodified_pc_m0_p10", "br_lastmodified_pc_m0_p9"]);

    backend.close();
    backend = await startBackend({ dataDir });
    const again = await userLogin(backend.port, "StatsLeader");
    assert.deepEqual(counts(await stats(backend, again)), leaderStats);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("only a gameserver records stats: its own login for its session's players, the DedicatedServer client for anyone", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StatsCheater");
    const stranger = await userLogin(backend.port, "StatsStranger");
    const server = await hostedMatch(backend, player);

    // A player's own token, or a server's for someone not on its session, records nothing (and is still answered 204).
    assert.equal((await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", player.token, { playlistId: 2, accountIds: [player.accountId] })).status, 204);
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", player.token, { playlistId: 2, results: [{ accountId: player.accountId, place: 1, kills: 99, secondsAlive: 60 }] });
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", server.token, { playlistId: 2, accountIds: [stranger.accountId] });
    assert.deepEqual(counts(await stats(backend, player)), {});
    assert.deepEqual(counts(await stats(backend, stranger)), {});

    // The server's own login for its player; the DedicatedServer client for anyone, skipping what isn't a result.
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", server.token, { playlistId: 2, results: [{ accountId: player.accountId, place: 3, kills: 4, secondsAlive: 125 }] });
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", await dedicatedServerToken(backend.port), { playlistId: 9, results: [
      { accountId: stranger.accountId, place: 2, kills: 3, secondsAlive: 61 },
      { accountId: stranger.accountId, place: 0, kills: 1, secondsAlive: 10 },
      { accountId: stranger.accountId, place: 5, kills: -1, secondsAlive: 10 },
      { accountId: "00000000000000000000000000000000", place: 1, kills: 1, secondsAlive: 10 },
      null
    ] });
    assert.deepEqual(counts(await stats(backend, player)), {
      br_matchesplayed_pc_m0_p2: 1, br_kills_pc_m0_p2: 4, br_placetop10_pc_m0_p2: 1, br_placetop25_pc_m0_p2: 1, br_minutesplayed_pc_m0_p2: 2, br_score_pc_m0_p2: 310
    });
    assert.deepEqual(counts(await stats(backend, stranger)), {
      br_matchesplayed_pc_m0_p9: 1, br_kills_pc_m0_p9: 3, br_placetop3_pc_m0_p9: 1, br_placetop6_pc_m0_p9: 1, br_minutesplayed_pc_m0_p9: 1, br_score_pc_m0_p9: 255
    });
    assert.equal(fs.existsSync(path.join(backend.dataDir, "accounts", "00000000000000000000000000000000")), false);
  } finally {
    backend.close();
  }
});

// Core-Backend #81: 1.8's stats screen asks what 1.7.2's does (QueryPlayerStats 0x772F20: GET .../bulk/window/alltime),
// with its own build in the User-Agent; its server has no recordwin, so CoreV2's results carry the wins (countWins).
const agent18 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489";
const stats18 = async (backend, player) => {
  const response = await send({ host: "127.0.0.1", port: backend.port,
    path: `/fortnite/api/stats/accountId/${player.accountId}/bulk/window/alltime`, headers: { "User-Agent": agent18, Authorization: `bearer ${player.token}` } });
  assert.equal(response.status, 200);
  return Object.fromEntries(response.body.map((stat) => [stat.name, stat.value]));
};

test("1.8's results count their wins in solo, duo and squad, on top of what the player did on 1.7.2", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Stats18Player");
    const mate = await userLogin(backend.port, "Stats18Mate");
    const dedicated = await dedicatedServerToken(backend.port);
    const record = (body) => post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated, body);

    // On 1.7.2 first: a solo win, reported by the server itself (recordwin) and placed by CoreV2 without countWins,
    // which counts once.
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", dedicated, { playlistId: 2, accountIds: [player.accountId] });
    await record({ playlistId: 2, results: [{ accountId: player.accountId, place: 1, kills: 3, secondsAlive: 1300 }] });
    assert.equal((await stats18(backend, player)).br_placetop1_pc_m0_p2, 1);

    // Then on 1.8, where nothing else reports the win: a solo win, a duo 3rd and a squad win (the whole squad's).
    await record({ playlistId: 2, countWins: true, results: [{ accountId: player.accountId, place: 1, kills: 4, secondsAlive: 1250 }] });
    await record({ playlistId: 10, countWins: true, results: [
      { accountId: player.accountId, place: 3, kills: 2, secondsAlive: 1000 },
      { accountId: mate.accountId, place: 3, kills: 0, secondsAlive: 700 }
    ] });
    await record({ playlistId: 9, countWins: true, results: [
      { accountId: player.accountId, place: 1, kills: 6, secondsAlive: 1500 },
      { accountId: mate.accountId, place: 1, kills: 1, secondsAlive: 1500 }
    ] });
    // A squad that was out 5th has no win, whatever the flag, but a top 6.
    await record({ playlistId: 9, countWins: true, results: [{ accountId: mate.accountId, place: 5, kills: 2, secondsAlive: 600 }] });

    // The 1.8 screen's tabs: solo wins, top 10 and 25; duo wins, top 5 and 12; squad wins, top 3 and 6; and each
    // one's kills, matches and minutes, the 1.7.2 match's included.
    assert.deepEqual(counts(await stats18(backend, player)), {
      br_placetop1_pc_m0_p2: 2, br_placetop10_pc_m0_p2: 2, br_placetop25_pc_m0_p2: 2, br_kills_pc_m0_p2: 7,
      br_matchesplayed_pc_m0_p2: 2, br_minutesplayed_pc_m0_p2: 42, br_score_pc_m0_p2: 1155,
      br_placetop5_pc_m0_p10: 1, br_placetop12_pc_m0_p10: 1, br_kills_pc_m0_p10: 2, br_matchesplayed_pc_m0_p10: 1,
      br_minutesplayed_pc_m0_p10: 16, br_score_pc_m0_p10: 280,
      br_placetop1_pc_m0_p9: 1, br_placetop3_pc_m0_p9: 1, br_placetop6_pc_m0_p9: 1, br_kills_pc_m0_p9: 6,
      br_matchesplayed_pc_m0_p9: 1, br_minutesplayed_pc_m0_p9: 25, br_score_pc_m0_p9: 725
    });
    assert.deepEqual(counts(await stats18(backend, mate)), {
      br_placetop5_pc_m0_p10: 1, br_placetop12_pc_m0_p10: 1, br_kills_pc_m0_p10: 0, br_matchesplayed_pc_m0_p10: 1,
      br_minutesplayed_pc_m0_p10: 11, br_score_pc_m0_p10: 155,
      br_placetop1_pc_m0_p9: 1, br_placetop3_pc_m0_p9: 1, br_placetop6_pc_m0_p9: 2, br_kills_pc_m0_p9: 3,
      br_matchesplayed_pc_m0_p9: 2, br_minutesplayed_pc_m0_p9: 35, br_score_pc_m0_p9: 675
    });
    // 1.7.2's screen reads the same stats.
    assert.deepEqual(counts(await stats(backend, player)), counts(await stats18(backend, player)));

    // The wins count on 1.8's leaderboards and for the 1.7.2 umbrella too.
    const wins = await post(backend.port, "/fortnite/api/leaderboards/type/global/stat/br_placetop1_pc_m0_p9/window/alltime?ownertype=1", player.token);
    assert.deepEqual(wins.body.entries.map(({ accountId, value }) => [accountId, value]).sort(),
      [[player.accountId, 1], [mate.accountId, 1]].sort());
    const winners = await post(backend.port, "/fortnite/api/game/v2/battleroyale/winners", dedicated, { playlistId: 2, accountIds: [mate.accountId] });
    assert.deepEqual(winners.body.winners, [{ accountId: mate.accountId, umbrellaType: "umbrella" }]);
  } finally {
    backend.close();
  }
});

test("1.7.2's results without countWins never count a win themselves: its recordwin does", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Stats172Player");
    const dedicated = await dedicatedServerToken(backend.port);
    const record = (body) => post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated, body);
    await record({ playlistId: 10, results: [{ accountId: player.accountId, place: 1, kills: 1, secondsAlive: 900 }] });
    await record({ playlistId: 10, countWins: "yes", results: [{ accountId: player.accountId, place: 1, kills: 1, secondsAlive: 900 }] });
    const after = counts(await stats(backend, player));
    assert.equal(after.br_placetop1_pc_m0_p10, undefined);
    assert.equal(after.br_matchesplayed_pc_m0_p10, 2);
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", dedicated, { playlistId: 10, accountIds: [player.accountId] });
    assert.equal((await stats(backend, player)).br_placetop1_pc_m0_p10, 1);
  } finally {
    backend.close();
  }
});

// Core #97: 1.7.2 gives a player who has won (in any playlist) Season 1's umbrella instead of the stock glider, from
// what the backend answers when the server asks who in its match has won before (battleroyale/winners).
test("a Battle Royale winner glides on the umbrella from the next match, everyone else on the stock glider", async () => {
  const backend = await startBackend();
  try {
    const winner = await userLogin(backend.port, "UmbrellaWinner");
    const loser = await userLogin(backend.port, "UmbrellaLoser");
    const server = await hostedMatch(backend, winner, loser);
    const ask = async (accountIds) => (await post(backend.port, "/fortnite/api/game/v2/battleroyale/winners", server.token, { playlistId: 2, accountIds })).body;

    // Nobody has won yet: no umbrellas.
    assert.deepEqual(await ask([winner.accountId, loser.accountId]), { playlistId: 2, winners: [] });

    // A squad win counts for the next solo match too; a 2nd place, unknown accounts and what isn't an id don't.
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", server.token, { playlistId: 9, accountIds: [winner.accountId] });
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", server.token, { playlistId: 9, results: [{ accountId: loser.accountId, place: 2, kills: 1, secondsAlive: 300 }] });
    assert.deepEqual(await ask([winner.accountId, loser.accountId, "00000000000000000000000000000000", 7, null]), {
      playlistId: 2, winners: [{ accountId: winner.accountId, umbrellaType: "umbrella" }]
    });
    assert.deepEqual(await ask(undefined), { playlistId: 2, winners: [] });
    assert.equal(fs.existsSync(path.join(backend.dataDir, "accounts", "00000000000000000000000000000000")), false);
  } finally {
    backend.close();
  }
});
