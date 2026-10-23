import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

// A two-player zone end as CoreV2 sends it: one EarnScore for both players through the first player's profile, then
// each player's EndPrimaryMission through their own. The gameserver's earnScore handler (0x762AE0) only sees
// notifications in responses to its own player's commands (0x3903DB0 addresses them to the profile group's account),
// and finalizes the player on the first one, so the second player's XP has to come in their EndPrimaryMission.
const route = (kind, accountId, name, profileId = "profile0") =>
  `/fortnite/api/game/v2/profile/${accountId}/${kind}/${name}?profileId=${profileId}&rvn=-1`;
const earnScores = (response) => (response.body.notifications ?? []).filter((entry) => entry.type === "earnScore");
const levelUps = (response) => (response.body.notifications ?? []).filter((entry) => entry.type === "levelUp").map((entry) => entry.level);

async function setup(backend) {
  const server = await userLogin(backend.port, "CoreServer1");
  const dedicated = await dedicatedServerToken(backend.port);
  const host = await userLogin(backend.port, "ZoneHost");
  const guest = await userLogin(backend.port, "ZoneGuest");
  const registered = await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
    ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
    maxPublicPlayers: 4, maxPrivatePlayers: 0, buildUniqueId: "595160781", attributes: { GAMEMODE_s: "FORTPVE" }
  });
  const sessionId = registered.body.id;
  const send = (player, name, body) => post(backend.port, route("dedicated_server", player.accountId, name), dedicated, body);
  const earnScore = () => send(host, "EarnScore", { matchmakingSessionId: sessionId, playersAndScores: [
    { accountId: host.accountId, totalScore: 2000000, bCriticalMatchBonus: false },
    { accountId: guest.accountId, totalScore: 500000, bCriticalMatchBonus: false }
  ] });
  const end = (player) => send(player, "EndPrimaryMission", { matchmakingSessionId: sessionId, missionName: "m", missionStatus: "Failed",
    advance: [], earnedBadgeData: [], numMissionPoints: 0, bCriticalMatchBonus: false });
  const stats = async (player) => {
    const response = await post(backend.port, route("client", player.accountId, "QueryProfile"), player.token, {});
    const { level, xp } = response.body.profileChanges[0].profile.stats.attributes;
    return [level, xp];
  };
  return { host, guest, send, earnScore, end, stats };
}

test("two-player zone end: each player's first earnScore notification carries their own XP, granted once", async () => {
  const backend = await startBackend();
  try {
    const { host, guest, send, earnScore, end, stats } = await setup(backend);

    const earned = await earnScore();
    assert.equal(earned.status, 200);
    // Only the host's notifications: 2,000,000 score is 1,225,802 base XP, doubled by a new account's rest XP.
    assert.deepEqual(earnScores(earned).map((entry) => [entry.baseXPEarned, entry.restXPEarned]), [[1225802, 1225802]]);
    assert.deepEqual(levelUps(earned), [2, 3]);
    // Both players have their XP now.
    assert.deepEqual(await stats(host), [3, 451604]);
    assert.deepEqual(await stats(guest), [1, 612902]);

    // The guest's EndPrimaryMission carries the guest's XP (500,000 score), first and alone: no zero one after it.
    const guestEnded = await end(guest);
    assert.equal(guestEnded.status, 200);
    assert.deepEqual(earnScores(guestEnded).map((entry) => [entry.baseXPEarned, entry.restXPEarned]), [[306451, 306451]]);
    assert.equal(guestEnded.body.notifications[0].type, "earnScore");
    assert.deepEqual(levelUps(guestEnded), []);

    // The host already had theirs: its EndPrimaryMission has only the zero one.
    const hostEnded = await end(host);
    assert.deepEqual(earnScores(hostEnded).map((entry) => entry.baseXPEarned), [0]);

    // Delivered once, granted once.
    assert.deepEqual(earnScores(await send(guest, "QueryProfile", {})), []);
    assert.deepEqual(await stats(host), [3, 451604]);
    assert.deepEqual(await stats(guest), [1, 612902]);
    // The guest's client never gets the gameserver's notification.
    const client = await post(backend.port, route("client", guest.accountId, "QueryProfile"), guest.token, {});
    assert.deepEqual(earnScores(client), []);
  } finally {
    backend.close();
  }
});

test("a guest's EndPrimaryMission that arrives before the EarnScore waits for it", async () => {
  const backend = await startBackend({ earnScoreWaitMs: 5000 });
  try {
    const { guest, earnScore, end, stats } = await setup(backend);
    const guestEnded = end(guest);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await earnScore();
    const response = await guestEnded;
    assert.deepEqual(earnScores(response).map((entry) => [entry.baseXPEarned, entry.restXPEarned]), [[306451, 306451]]);
    assert.deepEqual(await stats(guest), [1, 612902]);
  } finally {
    backend.close();
  }
});

test("an EndPrimaryMission whose session never sends EarnScore still ends with the zero notification", async () => {
  const backend = await startBackend({ earnScoreWaitMs: 150 });
  try {
    const { guest, end, stats } = await setup(backend);
    const started = Date.now();
    const ended = await end(guest);
    assert.ok(Date.now() - started >= 140);
    assert.deepEqual(earnScores(ended).map((entry) => entry.baseXPEarned), [0]);
    assert.deepEqual(await stats(guest), [1, 0]);
  } finally {
    backend.close();
  }
});
