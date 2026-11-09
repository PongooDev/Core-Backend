import { test } from "node:test";
import assert from "node:assert/strict";
import { athenaPlaylistOfQueue, eventQueueOfPlaylist, hasLtm, inOriginalWindow, ltmEventFlags, ltmForcedQueues, ltmModes, ltmNewMode, ltmOn, ltmQuests, ltms,
  ltmSchedule } from "../src/events/ltms.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { configureEvents } from "../src/events/events.js";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #190: the limited-time modes and their original dates (events/ltms.js).
const v110 = "3790078";
const v111 = "3807424";
const v21 = "3825894";
const v23 = "3847564";
const v24 = "3858292";
const v242 = "3870737";
const v25 = "3889387";
const v30 = "3901517";
const v31 = "3915963";
const v32 = "3935073";
const v33 = "3942182";
const v351 = "4000805";
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

test("the event queues' LTMs are 1.11's to 3.3's, squads, and off by hand until turned on", () => {
  for (const id of ["highExplosives", "sneakySilencers", "sniperShootout"]) {
    assert.deepEqual([v110, v111, v21, v23, v24, v242, v25, v30, "3915963", "3935073", "3942182", "3950000", v351].map((build) => hasLtm(id, build)),
      [false, true, true, true, true, true, true, true, true, true, true, false, false], id);
  }
  assert.equal(ltmOn("sniperShootout", v23, { matchmakingModes: {} }), false);
  assert.equal(ltmOn("sniperShootout", v23, { matchmakingModes: { sniperShootout: true } }), true);
  assert.equal(ltmOn("sniperShootout", v110, { matchmakingModes: { sniperShootout: true } }), false);
  // 50v50 stays on unless turned off.
  assert.equal(ltmOn("fiftyFifty", v110, { matchmakingModes: {} }), true);
  assert.equal(ltmOn("fiftyFifty", v110, { matchmakingModes: { fiftyFifty: false } }), false);
  assert.deepEqual(ltmEventFlags(v24, { matchmakingModes: { sniperShootout: true, shootingTest: true, highExplosives: true } }),
    ["Event2", "Event7", "Event1"]);
  for (const playlist of [12, 13, 18]) {
    assert.deepEqual(playlistTeamsOf(`${v23}:0:NA:${playlist}`), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  }
});

// Core-Backend #195: each LTM forces the queue whose tile is its own (AthenaMatchmakingPlay's Event<N>MissionGen) and
// whose ticket is its own playlist (2.3 0x20E8C60, 2.4.2 0x20FBC90, 2.5 0xD48260); its quest is the queue's.
test("each LTM's event flag shows its own tile and queues its own playlist, and its quest is that queue's", () => {
  const expected = { shootingTest: ["Event1", 15], highExplosives: ["Event2", 13], speedyStorm: ["Event3", 14], lotsaLoot: ["Event4", 17],
    sneakySilencers: ["Event5", 12], takeToTheSkies: ["Event6", 16], sniperShootout: ["Event7", 18], blitz: ["Event8", 19] };
  for (const [id, [flag, playlist]] of Object.entries(expected)) {
    const ltm = ltms.find((one) => one.id === id);
    assert.deepEqual([ltm.eventFlag, ltm.playlistId], [flag, playlist], id);
    assert.equal(ltm.quest, `athenaevent${flag.slice(5)}_playmatches`, id);
    assert.deepEqual(ltmEventFlags(v25, { matchmakingModes: { [id]: true } }), [flag], id);
  }
  assert.deepEqual(eventQueueOfPlaylist, { 12: 5, 13: 2, 14: 3, 15: 1, 16: 6, 17: 4, 18: 7, 19: 8,
    // 3.0's queues 22 on: AthenaMatchmakingPlay's Event<N>MissionGen is MissionGen_AthenaEvent<N>, and Playlist_5x20 (22) names it.
    22: 22, 23: 23, 25: 25, 26: 26, 27: 27, 30: 30, 31: 31,
    // 3.1's Blitz children (36, 37) keep Blitz's AthenaPlaylistTag, Athena.Playlist.Event.8.
    36: 8, 37: 8 });
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
  assert.deepEqual(ltmEventFlags(v24, dated, at("2018-02-02")), ["Event7", "Event1"]);
  assert.equal(ltmOn("sniperShootout", v23, { ...dated, ltmOriginalDates: false }, at("2018-01-30")), false);

  const schedule = ltmSchedule(dated, at("2018-01-30"));
  const sniper = schedule.list.find((ltm) => ltm.id === "sniperShootout");
  assert.equal(schedule.originalDates, true);
  assert.deepEqual(sniper.original, { builds: "2.3 to 2.4", start: "2018-01-29", end: "2018-02-03", last: "2018-02-02" });
  assert.deepEqual(sniper.inWindow, { 2: true, 3: false });
  assert.deepEqual(schedule.list.find((ltm) => ltm.id === "fiftyFifty").seasons, [1, 2]);
});

// Core-Backend #191: the event queues Epic never ran in Seasons 1 and 2.
test("Speedy Storm, Take To The Skies, Lotsa Loot and Blitz: their builds, squads, off by default, no original dates", () => {
  const queues = { speedyStorm: ["Event3", 14], takeToTheSkies: ["Event6", 16], lotsaLoot: ["Event4", 17], blitz: ["Event8", 19] };
  for (const [id, [flag, playlist]] of Object.entries(queues)) {
    const from = id === "blitz" ? v242 : v21;
    // Blitz runs on to 3.5.1 (Playlist_Blitz_Squads, still 19), the others end with 3.3.
    assert.deepEqual([v111, v21, v23, v24, v242, v25, v30, "3915963", "3935073", "3942182", "3950000", v351].map((build) => hasLtm(id, build)),
      [v111, v21, v23, v24, v242, v25, v30, "3915963", "3935073", "3942182"].map((build) => Number(build) >= Number(from)).concat(id === "blitz", id === "blitz"), id);
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
    // Blitz has Season 3's dates (#258: 19 to 29 March 2018, on 3.3), the others none.
    assert.deepEqual(listed.original, id === "blitz" ? { builds: "3.3", start: "2018-03-19", end: "2018-03-30", last: "2018-03-29" } : null, id);
    assert.deepEqual(listed.inWindow, { 2: false, 3: false, ...(id === "blitz" ? { 4: false } : {}) }, id);
    assert.equal(listed.enabled, true, id);
  }
  assert.equal(hasLtm("blitz", v24), false);
  assert.equal(ltmSchedule({}).list.find((ltm) => ltm.id === "speedyStorm").builds, "2.1 to 3.3");
});

// 3.0 (CL-3901517): every mode is a playlist class in Athena_GameMode's PlaylistDataTables. 50v50 (11) and Shooting Test
// #1 (15) have none and end with 2.5; Take To The Skies is duos; 3.0's new playlists with a lobby tile run by hand.
test("3.0's LTMs are its playlist classes: no 50v50 or Shooting Test, duo Skies, and its new playlists by hand", () => {
  for (const id of ["fiftyFifty", "shootingTest"]) assert.deepEqual([v25, v30].map((build) => hasLtm(id, build)), [true, false], id);
  assert.deepEqual(playlistTeamsOf(`${v30}:0:NA:16`, v30), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
  assert.deepEqual(playlistTeamsOf(`${v25}:0:NA:16`, v25), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  const added = { fiveByTwenty: [22, { maxTeamCount: 5, maxTeamSize: 20, maxSquadSize: 4 }],
    highJump: [23, { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 }],
    useItOrLoseIt: [25, { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 }],
    steadyStorm: [26, { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 }],
    solidGold: [27, { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 }],
    skySupply: [30, { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 }],
    shotguns: [31, { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 }] };
  for (const [id, [playlist, teams]] of Object.entries(added)) {
    assert.deepEqual([v25, v30].map((build) => hasLtm(id, build)), [false, true], id);
    assert.equal(ltmOn(id, v30, { matchmakingModes: {} }), false, id);
    // 3.0's queues past AthenaEvent8 have no event flag (GetStringNameOfEventPlaylist, 0x2719BE0): each is forced on by
    // UFortGlobals' bEvent<N>ForceEnabled, N its playlist (the button's switch, 0xD660F0).
    assert.deepEqual(ltmEventFlags(v30, { matchmakingModes: { [id]: true } }), [], id);
    assert.deepEqual(ltmForcedQueues(v30, { matchmakingModes: { [id]: true } }), [playlist], id);
    assert.equal(eventQueueOfPlaylist[playlist], playlist, id);
    assert.deepEqual(playlistTeamsOf(`${v30}:0:NA:${playlist}`, v30), teams, id);
    const listed = ltmSchedule({}).list.find((ltm) => ltm.id === id);
    // Teams of 20, Solid Gold and Sky Supply have 3.5.1 playlists too (Playlist_5x20, _SolidGold_Squads, _SkySupply), which
    // 4.0 keeps.
    const onTo40 = ["fiveByTwenty", "solidGold", "skySupply"].includes(id);
    // Teams of 20 and Solid Gold have Season 3's dates (#258), the others none.
    const firstWindow = { fiveByTwenty: { builds: "3.2 to 3.3", start: "2018-03-08", end: "2018-03-20", last: "2018-03-19" },
      solidGold: { builds: "3.1 to 3.1.1", start: "2018-02-27", end: "2018-03-06", last: "2018-03-05" } }[id] ?? null;
    assert.deepEqual([listed.seasons, listed.builds, listed.original], [onTo40 ? [3, 4] : [3], onTo40 ? "3.0 to 4.2" : "3.0 to 3.3", firstWindow], id);
  }
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
    assert.deepEqual((await regionState(v23, backend.port, player.token)).EU.EventFlagsForcedOn, ["Event5"]);
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
    for (const quest of ["athenaevent1_playmatches", "athenaevent2_playmatches", "athenaevent5_playmatches", "athenaevent7_playmatches"]) {
      assert.equal(questItems(profile, quest).length, 0, quest);
    }

    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { sniperShootout: true, sneakySilencers: true, shootingTest: true } });
    profile = await login(v23);
    assert.equal(questItems(profile, "athenaevent7_playmatches").length, 1);
    assert.equal(questItems(profile, "athenaevent5_playmatches").length, 1);
    // 2.3 has no Shooting Test #1, so no quest for it; given once only.
    assert.equal(questItems(profile, "athenaevent1_playmatches").length, 0);
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
    const [[silentId, silent]] = questItems(profile, "athenaevent5_playmatches");
    assert.equal(silent.attributes.completion_athena_event_5_play_matches, 1);

    // Turned off: the unfinished Sneaky Silencers quest leaves, the completed Sniper Shootout one stays.
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { sniperShootout: false, sneakySilencers: false } });
    profile = await login(v23);
    assert.equal(profile.items[silentId], undefined);
    assert.equal(profile.items[sniperId].attributes.quest_state, "Completed");
  } finally {
    backend.close();
  }
});

// Core-Backend #237: Teams of 20 (Playlist_5x20, queue 22) is 3.2's new mode. Its lobby's "New Mode Available!" banner
// (AthenaMatchmakingPlay's CB_LTM_Bang) shows while an LTM queue is on, and the lobby opens on LastSelectedPlaylist.
test("Teams of 20 is 3.2's new mode: on there whatever its switch, by hand on 3.0 and 3.1 (#237)", async () => {
  for (const settings of [{ matchmakingModes: {} }, { matchmakingModes: { fiveByTwenty: false } }, { ltmOriginalDates: true, matchmakingModes: {} }]) {
    assert.equal(ltmOn("fiveByTwenty", v32, settings, at("2018-01-30")), true);
    assert.deepEqual(ltmForcedQueues(v32, settings, at("2018-01-30")), [22]);
    assert.equal(ltmNewMode(v32, settings)?.id, "fiveByTwenty");
    for (const build of [v30, v31]) {
      assert.equal(ltmOn("fiveByTwenty", build, settings), false, build);
      assert.equal(ltmNewMode(build, settings), null, build);
    }
  }
  assert.equal(ltmOn("fiveByTwenty", v31, { matchmakingModes: { fiveByTwenty: true } }), true);
  // Only Teams of 20 (3.2's) and 50v50 v2 (3.5.1's, CoreV2 #260) are a build's new mode.
  assert.deepEqual(ltms.filter((ltm) => ltm.newIn).map((ltm) => ltm.id), ["fiveByTwenty", "fiftyFiftyV2", "infinityGauntlet", "playground", "fiftyFiftyV3", "finalFight"]);
  assert.deepEqual(ltmForcedQueues(v32, { matchmakingModes: { shotguns: true } }), [22, 31]);
  assert.ok(ltmQuests({ running: true }, v32).includes("athenaevent22_playmatches"));
  // EFortAthenaPlaylist (3.2's SDK): AthenaEvent1 4, AthenaEvent8 11, AthenaPlatoon 12, AthenaEvent21 13, AthenaEvent22 14.
  assert.deepEqual([1, 8, 20, 21, 22, 54].map(athenaPlaylistOfQueue), [4, 11, 12, 13, 14, 46]);
  const listed = (id) => ltmSchedule({ matchmakingModes: {} }).list.find((ltm) => ltm.id === id);
  assert.equal(listed("fiveByTwenty").newIn, "3.2");
  assert.equal(listed("shotguns").newIn, null);
  // 3.3 adds no mode: Teams of 20 follows its normal rule there (by hand, as on 3.0 and 3.1), and nothing is 3.3's new mode.
  for (const settings of [{ matchmakingModes: {} }, { matchmakingModes: { fiveByTwenty: false } }]) {
    assert.equal(ltmOn("fiveByTwenty", v33, settings), false);
    assert.equal(ltmNewMode(v33, settings), null);
    assert.deepEqual(ltmForcedQueues(v33, settings), []);
  }
  assert.equal(ltmOn("fiveByTwenty", v33, { matchmakingModes: { fiveByTwenty: true } }), true);
  assert.equal(hasLtm("fiveByTwenty", v33), true);

  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "TeamsOf20");
    assert.equal((await ticket(v32, backend.port, player, 22)).status, 200);
    assert.equal((await ticket(v31, backend.port, player, 22)).status, 400);
    assert.equal((await ticket(v33, backend.port, player, 22)).status, 400, "by hand again on 3.3");
  } finally {
    backend.close();
  }
});

// Core-Backend #258: Seasons 3 and 4's original dates, replayed on each season's clock (22 February and 1 May 2018 are
// their replays' first days), on the builds Epic ran each on and only where the build's data has its playlist.
const v311 = "3917250";
const v352 = "4008490";
const v36 = "4019403";
const v40 = "4039451";
const v41 = "4053532";
// Seasons 2 to 4's replays from their own first days, so each test day is that day of Epic's season (a backend started
// before anchors them to the day it first served them).
function onSeasonReplays(fn) {
  configureEvents({ mode: "auto", seasonStarts: { 2: "2017-12-14", 3: "2018-02-22", 4: "2018-05-01" } });
  try {
    fn();
  } finally {
    configureEvents(null);
  }
}
test("Season 3's LTMs run on their original dates and builds (#258)", () => {
  onSeasonReplays(() => {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    // Solid Gold: 27 February to 5 March, 3.1 and 3.1.1.
    assert.equal(inOriginalWindow("solidGold", v31, at("2018-02-27"), dated), true);
    assert.equal(inOriginalWindow("solidGold", v311, at("2018-03-05"), dated), true);
    assert.equal(inOriginalWindow("solidGold", v31, at("2018-03-06"), dated), false);
    assert.equal(inOriginalWindow("solidGold", v30, at("2018-03-01"), dated), false);
    // Teams of 20: 8 to 19 March, 3.2 and 3.3; Blitz from 19 March, 3.3.
    assert.equal(inOriginalWindow("fiveByTwenty", v33, at("2018-03-19"), dated), true);
    assert.equal(inOriginalWindow("fiveByTwenty", v33, at("2018-03-20"), dated), false);
    assert.equal(inOriginalWindow("blitz", v33, at("2018-03-19"), dated), true);
    assert.equal(inOriginalWindow("blitz", v33, at("2018-03-29"), dated), true);
    assert.equal(inOriginalWindow("blitz", v33, at("2018-03-30"), dated), false);
    assert.equal(inOriginalWindow("blitz", v32, at("2018-03-20"), dated), false);
    assert.equal(ltmOn("blitz", v33, dated, at("2018-03-22")), true);
    assert.equal(ltmOn("blitz", v33, dated, at("2018-03-10")), false);
    // Sniper Shootout v2: 29 March to 4 April on 3.5 (all three playlists); 3.6 came after.
    for (const id of ["sniperShootoutSolo", "sniperShootoutDuos", "sniperShootoutSquads"]) {
      assert.equal(ltmOn(id, v351, dated, at("2018-04-01")), true, id);
      assert.equal(ltmOn(id, v352, dated, at("2018-04-04")), true, id);
      assert.equal(ltmOn(id, v351, dated, at("2018-04-05")), false, id);
      assert.equal(ltmOn(id, v36, dated, at("2018-04-01")), false, id);
    }
    // 50v50 v2: 19 to 30 April, 3.5.1 to 3.6 (on 3.5.1 and 3.5.2 it is always on, their new mode).
    assert.equal(ltmOn("fiftyFiftyV2", v36, dated, at("2018-04-19")), true);
    assert.equal(ltmOn("fiftyFiftyV2", v36, dated, at("2018-04-30")), true);
    assert.equal(ltmOn("fiftyFiftyV2", v36, dated, at("2018-04-18")), false);
    // The existing seasons' dates hold.
    assert.equal(inOriginalWindow("sniperShootout", v23, at("2018-01-29"), dated), true);
    const schedule = ltmSchedule(dated, at("2018-03-22"));
    assert.deepEqual(schedule.list.find((ltm) => ltm.id === "blitz").inWindow, { 2: false, 3: true, 4: false });
  });
});

test("Season 4's LTMs run on their original dates, only on builds with their playlist (#258)", () => {
  onSeasonReplays(() => {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    // 50v50 v2: 1 to 8 May on 4.0 and 4.1.
    assert.equal(inOriginalWindow("fiftyFiftyV2", v40, at("2018-05-01"), dated), true);
    assert.equal(inOriginalWindow("fiftyFiftyV2", v41, at("2018-05-08"), dated), true);
    assert.equal(inOriginalWindow("fiftyFiftyV2", v40, at("2018-05-09"), dated), false);
    assert.equal(ltmOn("fiftyFiftyV2", v40, dated, at("2018-05-03")), true);
    assert.equal(ltmOn("fiftyFiftyV2", v40, dated, at("2018-05-12")), false);
    // Infinity Gauntlet: 8 to 16 May, its playlist (Playlist_Carmine, 33) 4.1's: 4.0's data has none.
    assert.equal(hasLtm("infinityGauntlet", v40), false);
    assert.equal(hasLtm("infinityGauntlet", v41), true);
    assert.equal(inOriginalWindow("infinityGauntlet", v41, at("2018-05-08"), dated), true);
    assert.equal(inOriginalWindow("infinityGauntlet", v41, at("2018-05-16"), dated), true);
    assert.equal(inOriginalWindow("infinityGauntlet", v41, at("2018-05-17"), dated), false);
    assert.equal(inOriginalWindow("infinityGauntlet", v40, at("2018-05-10"), dated), false);
    assert.equal(ltmOn("infinityGauntlet", v40, dated, at("2018-05-10")), false);
    assert.deepEqual(playlistTeamsOf(`${v41}:0:NA:33`, v41), { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 });
    // The modes of 4.2 on (Solo Showdown, Close Encounters, Blitz v2, Sniper Shootout v3, Teams of 20 v2, Playground) wait
    // for their builds: 4.0 and 4.1 have none of them, on their dates or by hand (4.2's are build42.test.js's).
    for (const [id, date] of [["soloShowdown", "2018-05-18"], ["closeEncounters", "2018-05-25"], ["blitzV2", "2018-06-02"],
      ["sniperShootoutV3", "2018-06-06"], ["teamsOf20V2", "2018-06-13"], ["playground", "2018-06-28"]]) {
      for (const build of [v40, v41]) {
        assert.equal(hasLtm(id, build), false, `${id} ${build}`);
        assert.equal(ltmOn(id, build, dated, at(date)), false, `${id} ${build}`);
        assert.equal(ltmOn(id, build, { matchmakingModes: { [id]: true } }), false, `${id} ${build}`);
      }
    }
    // Solid Gold v2's 4.2 to 4.4 window and High Explosives v2's 4.4.x one aren't on 4.0 and 4.1.
    assert.equal(ltmOn("solidGoldSolo", v40, dated, at("2018-05-23")), false);
    assert.equal(ltmOn("highExplosivesSolo", v41, dated, at("2018-06-23")), false);
    // Each is listed with its windows under Season 4.
    const list = ltmSchedule(dated, at("2018-05-10")).list;
    const of = (id) => list.find((ltm) => ltm.id === id);
    assert.deepEqual(of("infinityGauntlet").windows, [{ builds: "4.1 to 4.2", start: "2018-05-08", end: "2018-05-17", last: "2018-05-16", season: 4 }]);
    assert.equal(of("infinityGauntlet").inWindow[4], true);
    assert.deepEqual(of("fiftyFiftyV2").windows.map((window) => [window.builds, window.start, window.last, window.season]), [
      ["3.5.1 to 3.6", "2018-04-19", "2018-04-30", 3], ["4.0 to 4.1", "2018-05-01", "2018-05-08", 4],
      ["4.2", "2018-05-22", "2018-06-11", 4]]);
    assert.equal(of("teamsOf20V2").windows[0].builds, "4.4 to 4.4.x");
    assert.equal(of("playground").windows[0].builds, "4.5.0 to 4.5");
    assert.equal(of("soloShowdown").playlistId, 51);
    assert.equal(of("blitzV2").playlistId, null);
  });
});

test("Close Encounters runs its whole day or a chosen hour, and Solid Gold v2 stops for it (#258)", () => {
  onSeasonReplays(() => {
    const wholeDay = { ltmOriginalDates: true, ltmCloseEncounters: { wholeDay: true, hour: 15 } };
    const hour = { ltmOriginalDates: true, ltmCloseEncounters: { wholeDay: false, hour: 15 } };
    const list = (settings) => ltmSchedule(settings, at("2018-05-25")).list;
    const windows = (settings, id) => list(settings).find((ltm) => ltm.id === id).windows.map(({ start, end }) => [start, end]);
    // The whole day: 25 May, Solid Gold v2 to 24 May and again from 26 May.
    assert.deepEqual(windows(wholeDay, "closeEncounters"), [["2018-05-25", "2018-05-26"]]);
    assert.deepEqual(windows(wholeDay, "solidGold").slice(1), [["2018-05-22", "2018-05-25"], ["2018-05-26", "2018-06-01"]]);
    assert.deepEqual(windows(wholeDay, "solidGoldSolo"), [["2018-05-22", "2018-05-25"], ["2018-05-26", "2018-06-01"]]);
    // One hour, 15:00 to 16:00: Solid Gold v2 to 15:00 and again from 16:00.
    assert.deepEqual(windows(hour, "closeEncounters"), [["2018-05-25T15:00:00.000Z", "2018-05-25T16:00:00.000Z"]]);
    assert.deepEqual(windows(hour, "solidGoldSolo"), [["2018-05-22", "2018-05-25T15:00:00.000Z"], ["2018-05-25T16:00:00.000Z", "2018-06-01"]]);
    // Unset, it is the whole day; a bad hour is 0.
    assert.equal(list({}).find((ltm) => ltm.id === "closeEncounters").windows[0].start, "2018-05-25");
    assert.deepEqual(ltmSchedule({ ltmCloseEncounters: { wholeDay: false, hour: 99 } }).closeEncounters, { wholeDay: false, hour: 0 });
    assert.deepEqual(ltmSchedule(hour).closeEncounters, { wholeDay: false, hour: 15 });
  });
});

test("the admin panel keeps the Close Encounters choice (#258)", async () => {
  const backend = await startBackend();
  try {
    const before = (await post(backend.port, "/admin/api/matchmaking/config", undefined, {})).body;
    assert.deepEqual(before.ltms.closeEncounters, { wholeDay: true, hour: 0 });
    const saved = (await post(backend.port, "/admin/api/matchmaking/config", undefined, { ltmCloseEncounters: { wholeDay: false, hour: 20 } })).body;
    assert.deepEqual(saved.ltms.closeEncounters, { wholeDay: false, hour: 20 });
    const ce = saved.ltms.list.find((ltm) => ltm.id === "closeEncounters");
    assert.deepEqual([ce.windows[0].start, ce.windows[0].end], ["2018-05-25T20:00:00.000Z", "2018-05-25T21:00:00.000Z"]);
    // A bad hour keeps the one saved.
    const kept = (await post(backend.port, "/admin/api/matchmaking/config", undefined, { ltmCloseEncounters: { hour: 30 } })).body;
    assert.deepEqual(kept.ltms.closeEncounters, { wholeDay: false, hour: 20 });
    const reset = (await post(backend.port, "/admin/api/matchmaking/actions/reset-defaults", undefined, {})).body;
    assert.deepEqual(reset.ltms.closeEncounters, { wholeDay: true, hour: 0 });
  } finally {
    backend.close();
  }
});
