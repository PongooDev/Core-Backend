import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

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
      br_placetop1_pc_m0_p10: 1, br_minutesplayed_pc_m0_p10: 30,
      br_matchesplayed_pc_m0_p2: 1, br_kills_pc_m0_p2: 1, br_placetop25_pc_m0_p2: 1, br_minutesplayed_pc_m0_p2: 0
    };
    assert.deepEqual(counts(await stats(backend, leader)), leaderStats);
    assert.deepEqual(counts(await stats(backend, follower)), {
      br_matchesplayed_pc_m0_p10: 2, br_kills_pc_m0_p10: 1, br_placetop5_pc_m0_p10: 2, br_placetop12_pc_m0_p10: 2,
      br_placetop1_pc_m0_p10: 1, br_minutesplayed_pc_m0_p10: 25
    });
    const after = await stats(backend, leader);
    assert.ok(Math.abs(after.br_lastmodified_pc_m0_p2 - Date.now() / 1000) < 60);
    assert.ok("br_lastmodified_pc_m0_p9" in after);

    // Other windows have no counts.
    const weekly = (await get(backend.port, `/fortnite/api/stats/accountId/${leader.accountId}/bulk/window/weekly`, leader.token)).body;
    assert.deepEqual(weekly.map((stat) => stat.name), ["br_lastmodified_pc_m0_p2", "br_lastmodified_pc_m0_p10", "br_lastmodified_pc_m0_p9"]);

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
      br_matchesplayed_pc_m0_p2: 1, br_kills_pc_m0_p2: 4, br_placetop10_pc_m0_p2: 1, br_placetop25_pc_m0_p2: 1, br_minutesplayed_pc_m0_p2: 2
    });
    assert.deepEqual(counts(await stats(backend, stranger)), {
      br_matchesplayed_pc_m0_p9: 1, br_kills_pc_m0_p9: 3, br_placetop3_pc_m0_p9: 1, br_placetop6_pc_m0_p9: 1, br_minutesplayed_pc_m0_p9: 1
    });
    assert.equal(fs.existsSync(path.join(backend.dataDir, "accounts", "00000000000000000000000000000000")), false);
  } finally {
    backend.close();
  }
});
