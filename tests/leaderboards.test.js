import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStatsStore, windowStart } from "../src/stats/store.js";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

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
    assert.deepEqual(byAccount, { [bee.accountId]: [2, 1], [ace.accountId]: [1, 2], [cee.accountId]: [1, 2], [idle.accountId]: [0, 4] });
    assert.deepEqual(top10.body.entries.map(({ rank }) => rank), [1, 2, 2, 4]);

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
