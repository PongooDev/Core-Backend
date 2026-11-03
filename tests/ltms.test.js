import { test } from "node:test";
import assert from "node:assert/strict";
import { hasLtm, inOriginalWindow, ltmEventFlags, ltmModes, ltmOn, ltmSchedule } from "../src/events/ltms.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #190: the limited-time modes and their original dates (events/ltms.js).
const v110 = "3790078";
const v111 = "3807424";
const v21 = "3825894";
const v23 = "3847564";
const v24 = "3858292";
const v242 = "3870737";
const v25 = "3889387";
const at = (date) => new Date(`${date}T12:00:00Z`);

function as(changelist, port, method, urlPath, token) {
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}` };
  if (token) headers.Authorization = `bearer ${token}`;
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers });
}
const regionState = async (changelist, port, token) =>
  (await as(changelist, port, "GET", "/fortnite/api/calendar/v1/timeline", token)).body.channels["client-matchmaking"]?.states[0].state.region;
const ticket = (changelist, port, { accountId, token }, playlist) =>
  as(changelist, port, "GET", `/fortnite/api/game/v2/matchmakingservice/ticket/player/${accountId}?bucketId=${changelist}:0:NA:${playlist}`, token);

test("the event queues' LTMs are 1.11's to 2.5's, squads, and off by hand until turned on", () => {
  for (const id of ["highExplosives", "sneakySilencers", "sniperShootout"]) {
    assert.deepEqual([v110, v111, v21, v23, v24, v242, v25, "3901517"].map((build) => hasLtm(id, build)),
      [false, true, true, true, true, true, true, false], id);
  }
  assert.equal(ltmOn("sniperShootout", v23, { matchmakingModes: {} }), false);
  assert.equal(ltmOn("sniperShootout", v23, { matchmakingModes: { sniperShootout: true } }), true);
  assert.equal(ltmOn("sniperShootout", v110, { matchmakingModes: { sniperShootout: true } }), false);
  // 50v50 stays on unless turned off.
  assert.equal(ltmOn("fiftyFifty", v110, { matchmakingModes: {} }), true);
  assert.equal(ltmOn("fiftyFifty", v110, { matchmakingModes: { fiftyFifty: false } }), false);
  assert.deepEqual(ltmEventFlags(v24, { matchmakingModes: { sniperShootout: true, shootingTest: true, highExplosives: true } }),
    ["Event2", "Event7", "Event4"]);
  for (const playlist of [12, 13, 18]) {
    assert.deepEqual(playlistTeamsOf(`${v23}:0:NA:${playlist}`), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  }
});

test("original dates: each LTM runs only in its window on its season's replay, on the builds Epic ran it on", () => {
  // Season 2's replay (from 14 December 2017) and Season 1's (from 30 October 2017), with no admin start.
  assert.equal(inOriginalWindow("highExplosives", v111, at("2017-12-28")), true);
  assert.equal(inOriginalWindow("highExplosives", v111, at("2018-01-02")), true);
  assert.equal(inOriginalWindow("highExplosives", v111, at("2018-01-03")), false);
  assert.equal(inOriginalWindow("highExplosives", v21, at("2017-12-30")), false);
  assert.equal(inOriginalWindow("sneakySilencers", v111, at("2018-01-05")), true);
  assert.equal(inOriginalWindow("sneakySilencers", v111, at("2018-01-09")), false);
  assert.equal(inOriginalWindow("sniperShootout", v23, at("2018-01-29")), true);
  assert.equal(inOriginalWindow("sniperShootout", v24, at("2018-02-02")), true);
  assert.equal(inOriginalWindow("sniperShootout", v242, at("2018-01-30")), false);
  assert.equal(inOriginalWindow("shootingTest", v242, at("2018-02-12")), true);
  assert.equal(inOriginalWindow("shootingTest", v25, at("2018-02-05")), false);
  assert.equal(inOriginalWindow("fiftyFifty", v110, at("2017-12-10")), true);
  assert.equal(inOriginalWindow("fiftyFifty", v111, at("2017-12-18")), true);
  assert.equal(inOriginalWindow("fiftyFifty", v111, at("2017-12-19")), false);
  assert.equal(inOriginalWindow("fiftyFifty", v24, at("2017-12-15")), false);

  // On, the dates replace the switches; off, the switches stand.
  const dated = { ltmOriginalDates: true, matchmakingModes: { solo: true, sniperShootout: false, fiftyFifty: true } };
  assert.equal(ltmOn("sniperShootout", v23, dated, at("2018-01-30")), true);
  assert.equal(ltmOn("sniperShootout", v23, dated, at("2018-02-05")), false);
  assert.equal(ltmOn("fiftyFifty", v24, dated, at("2018-01-30")), false);
  assert.equal(ltmModes(v23, dated, at("2018-01-30")).solo, true);
  assert.deepEqual(ltmEventFlags(v24, dated, at("2018-02-02")), ["Event7", "Event4"]);
  assert.equal(ltmOn("sniperShootout", v23, { ...dated, ltmOriginalDates: false }, at("2018-01-30")), false);

  const schedule = ltmSchedule(dated, at("2018-01-30"));
  const sniper = schedule.list.find((ltm) => ltm.id === "sniperShootout");
  assert.equal(schedule.originalDates, true);
  assert.deepEqual(sniper.original, { builds: "2.3 to 2.4", start: "2018-01-29", end: "2018-02-03", last: "2018-02-02" });
  assert.deepEqual(sniper.inWindow, { 2: true });
  assert.deepEqual(schedule.list.find((ltm) => ltm.id === "fiftyFifty").seasons, [1, 2]);
});

test("the admin panel's switches and original dates offer the LTMs through the calendar and let their tickets through", async () => {
  // Season 2's replay standing at 30 January 2018: its day 1 is 47 days ago.
  const start = new Date(Date.now() - 47 * 86400000).toISOString().slice(0, 10);
  const backend = await startBackend({ events: { seasonStarts: { 1: null, 2: start } } });
  try {
    const player = await userLogin(backend.port, "LtmPlayer");
    assert.equal((await regionState(v23, backend.port, player.token))?.NA?.EventFlagsForcedOn, undefined);
    assert.equal((await ticket(v23, backend.port, player, 18)).status, 400);

    // By hand.
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { sneakySilencers: true } });
    assert.deepEqual((await regionState(v23, backend.port, player.token)).EU.EventFlagsForcedOn, ["Event1"]);
    assert.equal((await ticket(v23, backend.port, player, 12)).status, 200);
    assert.equal((await ticket(v23, backend.port, player, 18)).status, 400);

    // By the original dates: Sniper Shootout's window, so Sneaky Silencers' switch no longer counts.
    const overview = (await post(backend.port, "/admin/api/matchmaking/config", undefined, { ltmOriginalDates: true })).body;
    assert.equal(overview.ltms.originalDates, true);
    assert.equal(overview.ltms.list.find((ltm) => ltm.id === "sniperShootout").inWindow[2], true);
    assert.deepEqual((await regionState(v23, backend.port, player.token)).NA.EventFlagsForcedOn, ["Event7"]);
    assert.equal((await ticket(v23, backend.port, player, 18)).status, 200);
    assert.equal((await ticket(v23, backend.port, player, 12)).status, 400);
    // 2.4.2 came after it: nothing there.
    assert.equal((await regionState(v242, backend.port, player.token))?.NA?.EventFlagsForcedOn, undefined);
    assert.equal((await ticket(v242, backend.port, player, 18)).status, 400);
    // Out of 50v50's dates on 2.3: its queue is off.
    assert.equal((await regionState(v23, backend.port, player.token)).NA.bFiftyFiftyEnabled, false);
    assert.equal((await ticket(v23, backend.port, player, 11)).status, 400);
    // The core modes are untouched.
    assert.equal((await ticket(v23, backend.port, player, 2)).status, 200);

    const reset = (await post(backend.port, "/admin/api/matchmaking/actions/reset-defaults", undefined, {})).body;
    assert.equal(reset.ltms.originalDates, false);
  } finally {
    backend.close();
  }
});
