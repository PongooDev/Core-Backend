import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFrameParser, encodeFrame } from "../src/stomp/service.js";
import { matchVbucks } from "../src/services/fortnite/battleroyale.js";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

// Core-Backend #100, #124: V-Bucks for Battle Royale kills, wins and placements in solo, duos, squads and 1.10's 50v50 (#135), off unless the
// admin turns them on, paid once a match.
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

const none = { perKill: 0, perWin: 0, placements: [] };
const noRewards = { solo: none, duos: none, squads: none, fiftyFifty: none };
// The issue's example amounts.
const example = {
  solo: { perKill: 10, perWin: 100, placements: [{ top: 10, vbucks: 100 }, { top: 25, vbucks: 250 }] },
  duos: { perKill: 20, perWin: 200, placements: [{ top: 5, vbucks: 50 }, { top: 12, vbucks: 120 }] },
  squads: { perKill: 40, perWin: 400, placements: [{ top: 3, vbucks: 30 }, { top: 6, vbucks: 60 }] },
  fiftyFifty: { perKill: 5, perWin: 500, placements: [] }
};

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

test("Battle Royale V-Bucks rewards are off and zero by default: a match's kills and win pay nothing", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "RewardsOff");
    const current = (await settings(backend)).body;
    assert.deepEqual([current.battleRoyaleVbucks, current.battleRoyaleRewards], [false, noRewards]);
    assert.equal("vbucksPerKill" in current, false);
    const before = await balance(backend, player);
    assert.equal((await results(backend, await dedicatedServerToken(backend.port), {
      playlistId: 2, matchId: "match-off", results: [{ accountId: player.accountId, place: 1, kills: 6, secondsAlive: 900 }]
    })).status, 204);
    assert.equal(await balance(backend, player), before);
    // Turned on with nothing set, still nothing.
    await settings(backend, { battleRoyaleVbucks: true });
    await results(backend, await dedicatedServerToken(backend.port), {
      playlistId: 2, matchId: "match-zero", results: [{ accountId: player.accountId, place: 1, kills: 6, secondsAlive: 900 }]
    });
    assert.equal(await balance(backend, player), before);
  } finally {
    backend.close();
  }
});

test("turned on, each mode's kills, win and best placement pay V-Bucks once a match, reach an online player, and last over a restart", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-brvbucks-"));
  let backend = await startBackend({ dataDir });
  try {
    const winner = await userLogin(backend.port, "RewardsWinner");
    const loser = await userLogin(backend.port, "RewardsLoser");
    const dedicated = await dedicatedServerToken(backend.port);
    const query = await queryProfile(backend, winner);
    const start = vbucks(query.profileChanges[0].profile);
    const loserStart = await balance(backend, loser);

    // The panel turns them on and sets each mode's; amounts that aren't whole numbers from 0 to 100000 are ignored, and
    // a placement list with a bad tier is ignored whole. Tiers are kept best place first, without the ones paying 0.
    let saved = (await settings(backend, { battleRoyaleVbucks: true, battleRoyaleRewards: example })).body;
    assert.deepEqual([saved.battleRoyaleVbucks, saved.battleRoyaleRewards], [true, example]);
    saved = (await settings(backend, { battleRoyaleRewards: {
      solo: { perKill: -5, perWin: "lots", placements: [{ top: 10, vbucks: 1 }, { top: 0, vbucks: 5 }] },
      duos: { placements: [{ top: "12", vbucks: "120" }, { top: 30, vbucks: 0 }, { top: 5, vbucks: 50 }] }
    } })).body;
    assert.deepEqual(saved.battleRoyaleRewards, example);

    // The winner is online: their profile0 change reaches their client as a notification after the revision they have.
    const client = await stompClient(backend.port);
    client.send("CONNECT", { "accept-version": "1.2", login: winner.accountId, passcode: winner.token });
    await client.next();
    client.send("SUBSCRIBE", { id: "mcp-0-nil", destination: `/topic/fn/profile/${winner.accountId}/fortnite`, receipt: "r" });
    await client.next();

    // A duo match: the loser's team is out 7th with 2 kills (top 12), the winner's wins with 3 (top 5 and top 12: the
    // better, 120).
    await results(backend, dedicated, { playlistId: 10, matchId: "a1b2c3d4", results: [{ accountId: loser.accountId, place: 7, kills: 2, secondsAlive: 300 }] });
    await results(backend, dedicated, { playlistId: 10, matchId: "a1b2c3d4", results: [{ accountId: winner.accountId, place: 1, kills: 3, secondsAlive: 1200 }] });
    assert.equal(await balance(backend, loser), loserStart + 2 * 20 + 120);

    const notification = JSON.parse((await client.next()).body);
    assert.equal(notification.type, "profile/profile0/update");
    assert.equal(notification.revision, query.profileRevision + 1);
    assert.ok(notification.changes.some((change) => (change.changeType === "itemAdded" && change.item.templateId === "Currency:mtxgiveaway")
      || change.changeType === "itemQuantityChanged"), "the V-Bucks are in the notification's changes");
    const after = await queryProfile(backend, winner, -1);
    assert.equal(vbucks(after.profileChanges[0].profile), start + 3 * 20 + 200 + 120);
    assert.equal(after.profileRevision, query.profileRevision + 1);
    assert.equal("coreBattleRoyaleRewards" in after.profileChanges[0].profile, false, "the paid matches stay the backend's");

    // The same report again pays nothing, nor does one without a match id, nor a limited-time playlist's; the next
    // match pays again, with solo's amounts.
    await results(backend, dedicated, { playlistId: 10, matchId: "a1b2c3d4", results: [{ accountId: winner.accountId, place: 1, kills: 3, secondsAlive: 1200 }] });
    await results(backend, dedicated, { playlistId: 10, results: [{ accountId: winner.accountId, place: 1, kills: 3, secondsAlive: 1200 }] });
    await results(backend, dedicated, { playlistId: 35, matchId: "ltm-1", results: [{ accountId: winner.accountId, place: 1, kills: 3, secondsAlive: 1200 }] });
    assert.equal(await balance(backend, winner), start + 380);
    saved = (await settings(backend, { battleRoyaleRewards: { solo: { perKill: 10, perWin: 0 } } })).body;
    assert.deepEqual(saved.battleRoyaleRewards.solo, { ...example.solo, perWin: 0 });
    await results(backend, dedicated, { playlistId: 2, matchId: "e5f6", results: [{ accountId: winner.accountId, place: 1, kills: 4, secondsAlive: 800 }] });
    assert.equal(await balance(backend, winner), start + 670);

    client.ws.close();
    await client.closed;
    backend.close();
    backend = await startBackend({ dataDir });
    const again = await userLogin(backend.port, "RewardsWinner");
    saved = (await settings(backend)).body;
    assert.deepEqual([saved.battleRoyaleVbucks, saved.battleRoyaleRewards.solo.perWin, saved.battleRoyaleRewards.squads], [true, 0, example.squads]);
    // A replay after the restart still pays nothing.
    await results(backend, await dedicatedServerToken(backend.port), { playlistId: 10, matchId: "a1b2c3d4",
      results: [{ accountId: again.accountId, place: 1, kills: 3, secondsAlive: 1200 }] });
    assert.equal(await balance(backend, again), start + 670);

    // Off again: nothing more.
    await settings(backend, { battleRoyaleVbucks: false });
    await results(backend, await dedicatedServerToken(backend.port), { playlistId: 2, matchId: "later", results: [{ accountId: again.accountId, place: 1, kills: 9, secondsAlive: 800 }] });
    assert.equal(await balance(backend, again), start + 670);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("only a gameserver's report pays: a player's own token earns nothing", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "RewardsCheater");
    await settings(backend, { battleRoyaleVbucks: true, battleRoyaleRewards: example });
    const before = await balance(backend, player);
    assert.equal((await results(backend, player.token, { playlistId: 2, matchId: "self", results: [{ accountId: player.accountId, place: 1, kills: 99, secondsAlive: 60 }] })).status, 204);
    assert.equal(await balance(backend, player), before);
  } finally {
    backend.close();
  }
});

test("a placement pays its best tier, not their sum, and kills, a win and the placement add up", () => {
  assert.equal(matchVbucks(example, 2, { place: 5, kills: 0 }), 250, "top 10 and top 25: the better");
  assert.equal(matchVbucks(example, 2, { place: 20, kills: 0 }), 250);
  assert.equal(matchVbucks(example, 2, { place: 26, kills: 1 }), 10);
  const reversed = { solo: { perKill: 0, perWin: 0, placements: [{ top: 10, vbucks: 250 }, { top: 25, vbucks: 100 }] } };
  assert.equal(matchVbucks(reversed, 2, { place: 5, kills: 0 }), 250);
  assert.equal(matchVbucks(reversed, 2, { place: 20, kills: 0 }), 100);
  assert.equal(matchVbucks(example, 9, { place: 1, kills: 2 }), 2 * 40 + 400 + 60);
  assert.equal(matchVbucks(example, 50, { place: 1, kills: 2 }), 0, "a limited-time playlist");
  // 50v50's two teams place 1st and 2nd (#135).
  assert.equal(matchVbucks(example, 11, { place: 1, kills: 4 }), 4 * 5 + 500);
  assert.equal(matchVbucks(example, 11, { place: 2, kills: 4 }), 4 * 5);
});

test("config.json can turn the rewards on and set their amounts, #100's one amount for every mode too", async () => {
  let backend = await startBackend({ battleRoyaleVbucks: true, vbucksPerKill: 25, vbucksPerWin: 1000 });
  try {
    const player = await userLogin(backend.port, "RewardsConfig");
    const current = (await settings(backend)).body;
    assert.equal(current.battleRoyaleVbucks, true);
    for (const mode of ["solo", "duos", "squads", "fiftyFifty"]) assert.deepEqual(current.battleRoyaleRewards[mode], { perKill: 25, perWin: 1000, placements: [] });
    const before = await balance(backend, player);
    await results(backend, await dedicatedServerToken(backend.port), { playlistId: 9, matchId: "squads-1", results: [{ accountId: player.accountId, place: 1, kills: 2, secondsAlive: 600 }] });
    assert.equal(await balance(backend, player), before + 1050);
    backend.close();
    backend = await startBackend({ battleRoyaleVbucks: true, battleRoyaleRewards: example });
    assert.deepEqual((await settings(backend)).body.battleRoyaleRewards, example);
  } finally {
    backend.close();
  }
});

test("a settings.json from before per-mode rewards keeps #100's amounts where they were on, and zero where off", async () => {
  for (const [on, expected] of [[true, { perKill: 30, perWin: 300, placements: [] }], [false, none]]) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-brvbucks-"));
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ battleRoyaleVbucks: on, vbucksPerKill: 30, vbucksPerWin: 300 }));
    const backend = await startBackend({ dataDir });
    try {
      const current = (await settings(backend)).body;
      assert.equal(current.battleRoyaleVbucks, on);
      assert.deepEqual(current.battleRoyaleRewards, { solo: expected, duos: expected, squads: expected, fiftyFifty: expected });
      assert.equal("vbucksPerKill" in current, false);
    } finally {
      backend.close();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});
