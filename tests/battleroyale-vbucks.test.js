import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFrameParser, encodeFrame } from "../src/stomp/service.js";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

// Core-Backend #100: V-Bucks for Battle Royale kills and wins, off unless the admin turns them on, paid once a match.
const settings = (backend, body) => (body === undefined
  ? get(backend.port, "/admin/api/settings")
  : post(backend.port, "/admin/api/settings", undefined, body));
const queryProfile = async (backend, player, rvn = -1) => (await post(backend.port,
  `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=${rvn}`, player.token, {})).body;
// The client's balance (sub_68A110) adds up the Currency:Mtx* items with platform "Epic".
const vbucks = (profile) => Object.values(profile.items)
  .filter((item) => /^currency:mtx/i.test(item.templateId) && item.attributes.platform === "Epic")
  .reduce((total, item) => total + item.quantity, 0);
const balance = async (backend, player) => vbucks((await queryProfile(backend, player)).profileChanges[0].profile);

// What CoreV2 sends when a team is out or has won, with its match's id.
const results = (backend, token, body) => post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", token, body);

async function stompClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stomp`, ["v10.stomp", "v11.stomp", "v12.stomp"]);
  ws.binaryType = "arraybuffer";
  const frames = [];
  const waiters = [];
  const parse = createFrameParser((frame) => {
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else frames.push(frame);
  });
  ws.addEventListener("message", (event) => parse(Buffer.from(typeof event.data === "string" ? event.data : new Uint8Array(event.data))));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    ws,
    send: (command, headers, body) => ws.send(encodeFrame(command, headers, body)),
    next: () => (frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve) => waiters.push(resolve))),

    closed: new Promise((resolve) => ws.addEventListener("close", resolve, { once: true }))
  };
}

test("Battle Royale V-Bucks rewards are off by default: a match's kills and win pay nothing", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "RewardsOff");
    const current = (await settings(backend)).body;
    assert.deepEqual([current.battleRoyaleVbucks, current.vbucksPerKill, current.vbucksPerWin], [false, 50, 500]);
    const before = await balance(backend, player);
    assert.equal((await results(backend, await dedicatedServerToken(backend.port), {
      playlistId: 2, matchId: "match-off", results: [{ accountId: player.accountId, place: 1, kills: 6, secondsAlive: 900 }]
    })).status, 204);
    assert.equal(await balance(backend, player), before);
  } finally {
    backend.close();
  }
});

test("turned on, each kill and a win pay V-Bucks once a match, reach an online player, and last over a restart", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-brvbucks-"));
  let backend = await startBackend({ dataDir });
  try {
    const winner = await userLogin(backend.port, "RewardsWinner");
    const loser = await userLogin(backend.port, "RewardsLoser");
    const dedicated = await dedicatedServerToken(backend.port);
    const query = await queryProfile(backend, winner);
    const start = vbucks(query.profileChanges[0].profile);
    const loserStart = await balance(backend, loser);

    // The panel turns them on; amounts that aren't whole numbers from 0 to 100000 are ignored.
    let saved = (await settings(backend, { battleRoyaleVbucks: true, vbucksPerKill: -5, vbucksPerWin: "lots" })).body;
    assert.deepEqual([saved.battleRoyaleVbucks, saved.vbucksPerKill, saved.vbucksPerWin], [true, 50, 500]);

    // The winner is online: their profile0 change reaches their client as a notification after the revision they have.
    const client = await stompClient(backend.port);
    client.send("CONNECT", { "accept-version": "1.2", login: winner.accountId, passcode: winner.token });
    await client.next();
    client.send("SUBSCRIBE", { id: "mcp-0-nil", destination: `/topic/fn/profile/${winner.accountId}/fortnite`, receipt: "r" });
    await client.next();

    // A duo match: the loser's team is out with 2 kills, the winner's wins with 3.
    await results(backend, dedicated, { playlistId: 10, matchId: "a1b2c3d4", results: [{ accountId: loser.accountId, place: 7, kills: 2, secondsAlive: 300 }] });
    await results(backend, dedicated, { playlistId: 10, matchId: "a1b2c3d4", results: [{ accountId: winner.accountId, place: 1, kills: 3, secondsAlive: 1200 }] });
    assert.equal(await balance(backend, loser), loserStart + 100);

    const notification = JSON.parse((await client.next()).body);
    assert.equal(notification.type, "profile/profile0/update");
    assert.equal(notification.revision, query.profileRevision + 1);
    assert.ok(notification.changes.some((change) => (change.changeType === "itemAdded" && change.item.templateId === "Currency:mtxgiveaway")
      || change.changeType === "itemQuantityChanged"), "the V-Bucks are in the notification's changes");
    const after = await queryProfile(backend, winner, -1);
    assert.equal(vbucks(after.profileChanges[0].profile), start + 3 * 50 + 500);
    assert.equal(after.profileRevision, query.profileRevision + 1);
    assert.equal("coreBattleRoyaleRewards" in after.profileChanges[0].profile, false, "the paid matches stay the backend's");

    // The same report again pays nothing, nor does one without a match id; the next match pays again.
    await results(backend, dedicated, { playlistId: 10, matchId: "a1b2c3d4", results: [{ accountId: winner.accountId, place: 1, kills: 3, secondsAlive: 1200 }] });
    await results(backend, dedicated, { playlistId: 10, results: [{ accountId: winner.accountId, place: 1, kills: 3, secondsAlive: 1200 }] });
    assert.equal(await balance(backend, winner), start + 650);
    saved = (await settings(backend, { vbucksPerKill: 10, vbucksPerWin: 0 })).body;
    assert.deepEqual([saved.vbucksPerKill, saved.vbucksPerWin], [10, 0]);
    await results(backend, dedicated, { playlistId: 2, matchId: "e5f6", results: [{ accountId: winner.accountId, place: 1, kills: 4, secondsAlive: 800 }] });
    assert.equal(await balance(backend, winner), start + 690);

    client.ws.close();
    await client.closed;
    backend.close();
    backend = await startBackend({ dataDir });
    const again = await userLogin(backend.port, "RewardsWinner");
    saved = (await settings(backend)).body;
    assert.deepEqual([saved.battleRoyaleVbucks, saved.vbucksPerKill, saved.vbucksPerWin], [true, 10, 0]);
    // A replay after the restart still pays nothing.
    await results(backend, await dedicatedServerToken(backend.port), { playlistId: 10, matchId: "a1b2c3d4",
      results: [{ accountId: again.accountId, place: 1, kills: 3, secondsAlive: 1200 }] });
    assert.equal(await balance(backend, again), start + 690);

    // Off again: nothing more.
    await settings(backend, { battleRoyaleVbucks: false });
    await results(backend, await dedicatedServerToken(backend.port), { playlistId: 2, matchId: "later", results: [{ accountId: again.accountId, place: 1, kills: 9, secondsAlive: 800 }] });
    assert.equal(await balance(backend, again), start + 690);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("only a gameserver's report pays: a player's own token earns nothing", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "RewardsCheater");
    await settings(backend, { battleRoyaleVbucks: true });
    const before = await balance(backend, player);
    assert.equal((await results(backend, player.token, { playlistId: 2, matchId: "self", results: [{ accountId: player.accountId, place: 1, kills: 99, secondsAlive: 60 }] })).status, 204);
    assert.equal(await balance(backend, player), before);
  } finally {
    backend.close();
  }
});

test("config.json can turn the rewards on and set their amounts", async () => {
  const backend = await startBackend({ battleRoyaleVbucks: true, vbucksPerKill: 25, vbucksPerWin: 1000 });
  try {
    const player = await userLogin(backend.port, "RewardsConfig");
    const current = (await settings(backend)).body;
    assert.deepEqual([current.battleRoyaleVbucks, current.vbucksPerKill, current.vbucksPerWin], [true, 25, 1000]);
    const before = await balance(backend, player);
    await results(backend, await dedicatedServerToken(backend.port), { playlistId: 9, matchId: "squads-1", results: [{ accountId: player.accountId, place: 1, kills: 2, secondsAlive: 600 }] });
    assert.equal(await balance(backend, player), before + 1050);
  } finally {
    backend.close();
  }
});
