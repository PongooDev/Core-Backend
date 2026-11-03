import { test } from "node:test";
import assert from "node:assert/strict";
import { hasLtm, inOriginalWindow, ltmEventFlags, ltmModes, ltmOn, ltmSchedule } from "../src/events/ltms.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #190: the limited-time modes and their original dates (events/ltms.js).
const v110 = "3790078";
const v111 = "3807424";
const v21 = "3825894";
const v23 = "3847564";
const v24 = "3858292";
const v242 = "3870737";
const v25 = "3889387";
const at = (date) => new Date(`${date}T12:00:00Z`);

function as(agent, port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": /^\d+$/.test(agent) ? `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${agent}` : agent };
  if (token) headers.Authorization = `bearer ${token}`;
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}
const athena = (changelist, port, { accountId, token }, name, body = {}) =>
  as(changelist, port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=athena&rvn=-1`, token, body);
const athenaProfile = async (changelist, port, player) => {
  const { body } = await athena(changelist, port, player, "QueryProfile");
  return [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === "athena").profileChanges[0].profile;
};
const questItems = (profile, quest) => Object.entries(profile.items).filter(([, item]) => item.templateId === `Quest:${quest}`);
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

// Core-Backend #191: the event queues Epic never ran in Seasons 1 and 2.
test("Speedy Storm, Take To The Skies, Lotsa Loot and Blitz: their builds, squads, off by default, no original dates", () => {
  const queues = { speedyStorm: ["Event3", 14], takeToTheSkies: ["Event5", 16], lotsaLoot: ["Event6", 17], blitz: ["Event8", 19] };
  for (const [id, [flag, playlist]] of Object.entries(queues)) {
    const from = id === "blitz" ? v242 : v21;
    assert.deepEqual([v111, v21, v23, v24, v242, v25, "3901517"].map((build) => hasLtm(id, build)),
      [v111, v21, v23, v24, v242, v25].map((build) => Number(build) >= Number(from)).concat(false), id);
    assert.equal(ltmOn(id, v25, { matchmakingModes: {} }), false, id);
    assert.equal(ltmOn(id, v25, { matchmakingModes: { [id]: true } }), true, id);
    assert.deepEqual(ltmEventFlags(v25, { matchmakingModes: { [id]: true } }), [flag], id);
    assert.deepEqual(playlistTeamsOf(`${v25}:0:NA:${playlist}`), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 }, id);
    // With Original dates on they stay off, whatever their switch and the day.
    for (const day of ["2017-12-28", "2018-01-30", "2018-02-10", "2018-03-20"]) {
      assert.equal(inOriginalWindow(id, v25, at(day)), false, `${id} ${day}`);
      assert.equal(ltmOn(id, v25, { ltmOriginalDates: true, matchmakingModes: { [id]: true } }, at(day)), false, `${id} ${day}`);
    }
    const listed = ltmSchedule({ matchmakingModes: { [id]: true } }, at("2018-01-30")).list.find((ltm) => ltm.id === id);
    assert.equal(listed.original, null, id);
    assert.deepEqual(listed.inWindow, { 2: false }, id);
    assert.equal(listed.enabled, true, id);
  }
  assert.equal(hasLtm("blitz", v24), false);
  assert.equal(ltmSchedule({}).list.find((ltm) => ltm.id === "speedyStorm").builds, "2.1 to 2.5");
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

test("each LTM's event quest is given while its lobby offers it, counts its playlist's matches, and leaves unfinished once it ends", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "LtmQuests");
    const login = async (changelist) => {
      await athena(changelist, backend.port, player, "ClientQuestLogin");
      return athenaProfile(changelist, backend.port, player);
    };
    await athenaProfile(v23, backend.port, player);
    let profile = await login(v23);
    for (const quest of ["athenaevent1_playmatches", "athenaevent2_playmatches", "athenaevent4_playmatches", "athenaevent7_playmatches"]) {
      assert.equal(questItems(profile, quest).length, 0, quest);
    }

    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { sniperShootout: true, sneakySilencers: true, shootingTest: true } });
    profile = await login(v23);
    assert.equal(questItems(profile, "athenaevent7_playmatches").length, 1);
    assert.equal(questItems(profile, "athenaevent1_playmatches").length, 1);
    // 2.3 has no Shooting Test #1, so no quest for it; given once only.
    assert.equal(questItems(profile, "athenaevent4_playmatches").length, 0);
    assert.equal(questItems(await login(v23), "athenaevent7_playmatches").length, 1);
    const [[sniperId]] = questItems(profile, "athenaevent7_playmatches");

    // Three Sniper Shootout matches (playlist 18, Athena.Playlist.Event.7) reported by a Core gameserver complete it.
    const server = await userLogin(backend.port, "LtmServer");
    const session = (await as(v23, backend.port, "POST", "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "LtmServer", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "1", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
    })).body;
    await as(v23, backend.port, "POST", `/fortnite/api/matchmaking/session/${session.id}/players`, server.token, { publicPlayers: [player.accountId], privatePlayers: [] });
    const dedicated = await dedicatedServerToken(backend.port);
    const report = (playlistId, matchId) => as("Core V2", backend.port, "POST", "/fortnite/api/game/v2/battleroyale/recordresults", dedicated,
      { playlistId, matchId, countWins: true, results: [{ accountId: player.accountId, place: 40, kills: 0, secondsAlive: 30 }] });
    await report(12, "silent1");
    const progress = (items, itemId) => items[itemId].attributes.completion_athena_event_7_play_matches;
    assert.equal(progress((await athenaProfile(v23, backend.port, player)).items, sniperId), 0, "a Sneaky Silencers match isn't a Sniper Shootout one");
    for (const matchId of ["snipe1", "snipe2", "snipe3"]) await report(18, matchId);
    profile = await athenaProfile(v23, backend.port, player);
    assert.equal(progress(profile.items, sniperId), 3);
    assert.equal(profile.items[sniperId].attributes.quest_state, "Completed");
    const [[silentId, silent]] = questItems(profile, "athenaevent1_playmatches");
    assert.equal(silent.attributes.completion_athena_event_1_play_matches, 1);

    // Turned off: the unfinished Sneaky Silencers quest leaves, the completed Sniper Shootout one stays.
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { sniperShootout: false, sneakySilencers: false } });
    profile = await login(v23);
    assert.equal(profile.items[silentId], undefined);
    assert.equal(profile.items[sniperId].attributes.quest_state, "Completed");
  } finally {
    backend.close();
  }
});
