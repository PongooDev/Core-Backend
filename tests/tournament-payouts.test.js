import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTournamentStore, leaderboardOf, validatePayoutTable } from "../src/tournaments/store.js";
import { createPayoutSettler, payoutKey, payoutLines, payoutsDue, rewardTableOf, unknownPayoutItems } from "../src/tournaments/payouts.js";
import { tournamentInformationFor, tournamentOf } from "../src/tournaments/showdown.js";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #361: an event's prizes for points reached and final places, V-Bucks and items, once per player per event.
const outfit = "AthenaCharacter:CID_028_Athena_Commando_F";

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-payouts-"));
  try {
    return run(createTournamentStore(dataDir), dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test("an event's prizes are checked and kept in order: points prizes, then places, each giving something (#361)", () => {
  assert.deepEqual(validatePayoutTable(null), []);
  assert.deepEqual(validatePayoutTable([
    { scoringType: "rank", threshold: 3, vbucks: 100 },
    { scoringType: "value", threshold: 20, vbucks: "250", items: [` ${outfit} `, outfit] },
    { scoringType: "rank", threshold: 1, items: [outfit] }
  ]), [
    { scoringType: "value", threshold: 20, vbucks: 250, items: [outfit] },
    { scoringType: "rank", threshold: 1, vbucks: 0, items: [outfit] },
    { scoringType: "rank", threshold: 3, vbucks: 100, items: [] }
  ]);
  for (const bad of [
    [{ scoringType: "best", threshold: 1, vbucks: 1 }],
    [{ scoringType: "value", threshold: 0, vbucks: 1 }],
    [{ scoringType: "rank", threshold: 1001, vbucks: 1 }],
    [{ scoringType: "value", threshold: 5 }],
    [{ scoringType: "value", threshold: 5, vbucks: -1 }],
    [{ scoringType: "value", threshold: 5, items: ["not an item"] }],
    [{ scoringType: "rank", threshold: 2, vbucks: 1 }, { scoringType: "rank", threshold: 2, vbucks: 5 }],
    "prizes"
  ]) assert.throws(() => validatePayoutTable(bad), Error, JSON.stringify(bad));
  // A points prize and a place prize may share a number.
  assert.equal(validatePayoutTable([{ scoringType: "rank", threshold: 2, vbucks: 1 }, { scoringType: "value", threshold: 2, vbucks: 1 }]).length, 2);
  assert.deepEqual(unknownPayoutItems([{ items: [outfit, "AthenaCharacter:CID_Nobody"] }]), ["AthenaCharacter:CID_Nobody"]);
});

test("points prizes are owed once reached, place prizes only once the event is over and to qualified players, ties sharing (#361)", () => withStore((store) => {
  const now = new Date("2026-11-14T12:00:00Z");
  const event = store.create({ playlist: "showdownSolo", payoutTable: [
    { scoringType: "value", threshold: 6, vbucks: 100 }, { scoringType: "value", threshold: 12, vbucks: 200 },
    { scoringType: "rank", threshold: 1, vbucks: 1000 }, { scoringType: "rank", threshold: 3, vbucks: 300 }] }, now);
  // Epic's in-game points: a win with 7 eliminations is 6.
  store.recordResult("a", 58071, { place: 1, kills: 7, matchId: "m1" }, now);
  store.recordResult("b", 58071, { place: 1, kills: 7, matchId: "m2" }, now);
  store.recordResult("c", 58071, { place: 20, kills: 0, matchId: "m3" }, now);
  let saved = store.get(event.id);
  assert.deepEqual(payoutsDue(saved, "a").map(payoutKey), ["value:6"]);
  assert.deepEqual(payoutsDue(saved, "c"), []);
  assert.deepEqual(payoutsDue(saved, "nobody"), []);
  store.markPaid(event.id, "a", ["value:6"], now);
  saved = store.get(event.id);
  assert.deepEqual(payoutsDue(saved, "a"), [], "not twice");
  // Over: a and b tie for first, so both are owed the first-place and top-3 prizes; c is ranked 3rd but scored nothing.
  assert.deepEqual(leaderboardOf(saved).map(({ accountId, rank }) => [accountId, rank]), [["a", 1], ["b", 1], ["c", 3]]);
  assert.deepEqual(payoutsDue(saved, "a", { final: true }).map(payoutKey), ["rank:1", "rank:3"]);
  assert.deepEqual(payoutsDue(saved, "b", { final: true }).map(payoutKey), ["value:6", "rank:1", "rank:3"]);
  assert.deepEqual(payoutsDue(saved, "c", { final: true }).map(payoutKey), ["rank:3"]);
  // A reset of the points doesn't give a prize again.
  store.reset(event.id);
  store.recordResult("a", 58071, { place: 1, kills: 7, matchId: "m4" }, now);
  assert.deepEqual(payoutsDue(store.get(event.id), "a").map(payoutKey), []);

  // Solo Showdown's May 2018 rules: 50 matches to qualify for a place prize.
  const showdown = store.create({ playlist: "soloShowdown", payoutTable: [{ scoringType: "rank", threshold: 1, vbucks: 5 }] }, now);
  store.recordResult("a", 51, { place: 1, kills: 0, matchId: "s1" }, now);
  assert.deepEqual(payoutsDue(store.get(showdown.id), "a", { final: true }), []);
}));

test("the game is served the points prizes as the window's rewardTable and every prize in its EVENT DETAILS text (#361)", () => withStore((store) => {
  const now = new Date("2026-11-14T12:00:00Z");
  const event = store.create({ name: "Cup", playlist: "showdownSolo", payoutTable: [
    { scoringType: "value", threshold: 6, vbucks: 1500, items: [outfit] }, { scoringType: "rank", threshold: 1, vbucks: 10000 }] }, now);
  assert.deepEqual(rewardTableOf(event), [{ pointsEarned: 6, mcpTokenRewards: [outfit] }]);
  assert.deepEqual(tournamentOf(event).eventWindows[0].eventData.rewardTable, [{ pointsEarned: 6, mcpTokenRewards: [outfit] }]);
  const [line1, line2] = payoutLines(event);
  assert.match(line1, /^Reach 6 points: 1,500 V-Bucks, \S/);
  assert.equal(line2, "1st place: 10,000 V-Bucks");
  const entry = tournamentInformationFor("4480234", now, store).tournament_info.tournaments[0];
  assert.match(entry.details_description, /Prizes: Reach 6 points: 1,500 V-Bucks, .*; 1st place: 10,000 V-Bucks\.$/);
  // Without prizes, as before.
  const plain = store.create({ name: "Plain", playlist: "showdownSolo" }, now);
  assert.deepEqual(tournamentOf(plain).eventWindows[0].eventData.rewardTable, []);
  assert.doesNotMatch(tournamentInformationFor("4480234", now, store).tournament_info.tournaments[1].details_description, /Prizes/);
}));

test("the place prizes' timer fires at the next end of an event with prizes, and settles events already over (#361)", () => withStore((store) => {
  let clock = new Date("2026-11-14T12:00:00Z");
  const timers = [];
  const settled = [];
  const context = { tournaments: { ...store, markSettled: (id, at) => { settled.push(id); return store.markSettled(id, at); } } };
  const over = store.create({ playlist: "showdownSolo", endsAt: "2026-11-14T11:00:00Z", startsAt: "2026-11-14T10:00:00Z",
    payoutTable: [{ scoringType: "rank", threshold: 1, vbucks: 5 }] }, new Date("2026-11-14T09:00:00Z"));
  const later = store.create({ playlist: "showdownSolo", endsAt: "2026-11-14T13:00:00Z", payoutTable: [{ scoringType: "rank", threshold: 1, vbucks: 5 }] }, clock);
  store.create({ playlist: "showdownSolo", endsAt: "2026-11-14T12:30:00Z" }, clock);
  const settler = createPayoutSettler(context, { now: () => clock, setTimer: (run, ms) => { timers.push({ run, ms }); return timers.length; }, clearTimer: () => {} });
  assert.equal(settler.schedule(), Date.parse("2026-11-14T13:00:00Z"), "the event without prizes sets no timer");
  assert.deepEqual(settled, [over.id]);
  assert.equal(timers.at(-1).ms, 60 * 60 * 1000 + 1);
  clock = new Date("2026-11-14T13:00:00.001Z");
  timers.at(-1).run();
  assert.deepEqual(settled, [over.id, later.id]);
  assert.ok(store.get(later.id).payoutsSettledAt);
  assert.equal(timers.length, 1, "nothing left to wait for");
}));

const queryProfile = async (backend, player, profileId) => (await post(backend.port,
  `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=${profileId}&rvn=-1`, player.token, {})).body.profileChanges[0].profile;
const vbucks = (profile) => Object.values(profile.items).filter((item) => /^currency:mtx/i.test(item.templateId) && item.attributes.platform === "Epic")
  .reduce((total, item) => total + item.quantity, 0);

test("the admin panel's prizes: refused for an unknown item, a points prize given in the match that reaches it, place prizes at the end, once (#361)", async () => {
  const backend = await startBackend();
  try {
    const winner = await userLogin(backend.port, "PrizeWinner");
    const second = await userLogin(backend.port, "PrizeSecond");
    const refused = await post(backend.port, "/admin/api/tournaments", undefined, { playlist: "showdownSolo",
      payoutTable: [{ scoringType: "rank", threshold: 1, items: ["AthenaCharacter:CID_Nobody"] }] });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage ?? JSON.stringify(refused.body), /CID_Nobody/);

    const created = await post(backend.port, "/admin/api/tournaments", undefined, { name: "Prize Cup", playlist: "showdownSolo",
      payoutTable: [{ scoringType: "value", threshold: 6, vbucks: 500 }, { scoringType: "rank", threshold: 1, vbucks: 1000, items: [outfit] }] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { id } = created.body.event;
    assert.equal(created.body.event.payoutTable.length, 2);
    assert.equal(created.body.event.paid, undefined);

    const start = { winner: vbucks(await queryProfile(backend, winner, "profile0")), second: vbucks(await queryProfile(backend, second, "profile0")) };
    const dedicated = await dedicatedServerToken(backend.port);
    const report = (matchId, results) => {
      const text = JSON.stringify({ playlistId: 58071, matchId, countWins: true, results: results.map((result) => ({ secondsAlive: 600, ...result })) });
      return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/fortnite/api/game/v2/battleroyale/recordresults", headers: {
        "User-Agent": "Core V2", Authorization: `bearer ${dedicated}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    };
    // 6 points (a win, 7 eliminations) and 1 point (Top 10).
    await report("match1", [{ accountId: winner.accountId, place: 1, kills: 7 }, { accountId: second.accountId, place: 8, kills: 0 }]);
    assert.equal(vbucks(await queryProfile(backend, winner, "profile0")), start.winner + 500);
    assert.equal(vbucks(await queryProfile(backend, second, "profile0")), start.second);
    await report("match2", [{ accountId: winner.accountId, place: 1, kills: 7 }]);
    assert.equal(vbucks(await queryProfile(backend, winner, "profile0")), start.winner + 500, "a points prize once");

    let event = (await get(backend.port, `/admin/api/tournaments/${id}`)).body;
    assert.deepEqual(event.paidPlayers, { [winner.accountId]: ["value:6"] });

    // A points prize saved at 1 point goes to the second player at once.
    const saved = await post(backend.port, `/admin/api/tournaments/${id}/payouts`, undefined, { payoutTable: [
      { scoringType: "value", threshold: 6, vbucks: 500 }, { scoringType: "value", threshold: 1, vbucks: 50 }, { scoringType: "rank", threshold: 1, vbucks: 1000, items: [outfit] }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(vbucks(await queryProfile(backend, second, "profile0")), start.second + 50);
    assert.equal(vbucks(await queryProfile(backend, winner, "profile0")), start.winner + 550);

    await post(backend.port, `/admin/api/tournaments/${id}/end`, undefined, {});
    assert.equal(vbucks(await queryProfile(backend, winner, "profile0")), start.winner + 1550);
    assert.equal(vbucks(await queryProfile(backend, second, "profile0")), start.second + 50);
    const locker = await queryProfile(backend, winner, "athena");
    assert.ok(Object.values(locker.items).some((item) => item.templateId.toLowerCase() === outfit.toLowerCase()), "the outfit is in the locker");
    event = (await get(backend.port, `/admin/api/tournaments/${id}`)).body;
    assert.ok(event.payoutsSettledAt);
    // Ending again or saving the same prizes gives nothing more.
    await post(backend.port, `/admin/api/tournaments/${id}/end`, undefined, {});
    await post(backend.port, `/admin/api/tournaments/${id}/payouts`, undefined, { payoutTable: event.payoutTable });
    assert.equal(vbucks(await queryProfile(backend, winner, "profile0")), start.winner + 1550);
  } finally {
    backend.close();
  }
});
