import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasLtm, ltmFrontEndPlaylists, ltmOfBucketPlaylist, ltmOn } from "../src/events/ltms.js";
import { arenaEvents, arenaPlayerOf, arenaSeasonOf, arenaTicket, arenaTournamentInformation, arenaWindowHours, arenaWindowHoursOf,
  createArenaStore, hasArena } from "../src/tournaments/arena.js";
import { eventsAccountHistory, eventsDownload, eventsPlayerOf } from "../src/tournaments/eventsservice.js";
import { hasShowdown, showdownRuntimeOptions, showdownTicket } from "../src/tournaments/showdown.js";
import { createTournamentStore, tournamentPlaylists } from "../src/tournaments/store.js";
import { contentPage } from "../src/services/content/pages.js";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

// Season 9's Arena (Core-Backend #442, tournaments/arena.js): 9.00, 9.01 and 9.10 (both CLs) serve the Arena as 8.20 to
// 8.51 do, with Season 9's events and division tokens and a Hype of the season's own, apart from Season 8's.
const v820 = "5625478";
const v830 = "5793395";
const v851 = "6165369";
const v900 = "6337466";
const v901 = "6428087";
const v910a = "6573057";
const v910 = "6639283";
const season9 = [v900, v901, v910a, v910];
const created = new Date("2026-11-24T07:00:00.000Z");
const during = new Date("2026-11-24T08:00:00.000Z");

function inDataDir(run, make) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-arena9-"));
  try {
    return run(make(dataDir));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
const withArena = (run) => inDataDir(run, createArenaStore);
const withTournaments = (run) => inDataDir(run, createTournamentStore);

test("9.00, 9.01 and 9.10 have the Arena on the ShowdownAlt playlists, in Season 9; 8.20 to 8.51 stay in Season 8", () => {
  for (const build of season9) {
    assert.ok(hasArena(build) && hasLtm("arenaSolo", build) && hasLtm("arenaDuos", build), build);
    assert.equal(arenaSeasonOf(build), 9, build);
    assert.equal(ltmOn("arenaSolo", build, {}), false, "no switch: the events service's tile");
    assert.ok(!ltmFrontEndPlaylists(build, {}).some(({ name }) => /^Playlist_ShowdownAlt_/.test(name)), build);
    assert.equal(ltmOfBucketPlaylist({ playlistName: "playlist_showdownalt_duos" }, build).id, "arenaDuos");
  }
  assert.deepEqual([v820, v830, v851].map(arenaSeasonOf), [8, 8, 8]);
  assert.ok(hasArena(v851));
});

test("Season 9's events: epicgames_Arena_S9_*, seven division windows from 9.00's release, Season 9's tokens", () => {
  for (const build of season9) {
    const { events, templates } = arenaEvents(build, { gameId: "Fortnite" });
    assert.deepEqual(events.map((event) => event.eventId), ["epicgames_Arena_S9_Solo", "epicgames_Arena_S9_Duos"], build);
    const [solo] = events;
    assert.equal(solo.beginTime, "2019-05-09T00:00:00.000Z");
    assert.equal(solo.eventWindows.length, 7);
    solo.eventWindows.forEach((window, rank) => {
      assert.equal(window.eventWindowId, `Arena_S9_Division${rank + 1}_Solo`);
      assert.equal(window.eventTemplateId, `eventTemplate_Arena_S9_Division${rank + 1}_Solo`);
      assert.equal(window.leaderboardId, window.eventWindowId);
      assert.equal(window.metadata.divisionRank, rank);
      assert.deepEqual(window.requireAllTokens, rank ? [`ARENA_S9_Division${rank + 1}`] : []);
      assert.ok(Date.parse(window.countdownBeginTime) < Date.now() && Date.parse(window.endTime) > Date.now(), "live now");
    });
    assert.equal(templates.length, 14);
    const division1 = templates.find((template) => template.eventTemplateId === "eventTemplate_Arena_S9_Division1_Solo");
    assert.equal(division1.playlistId, "Playlist_ShowdownAlt_Solo");
    assert.equal(division1.persistentScoreId, "Hype");
    assert.equal(division1.payoutTable[0].ranks[0].payouts[0].value, "ARENA_S9_Division2");
  }
  // 8.20 to 8.51 keep Season 8's, unchanged.
  for (const build of [v820, v830, v851]) {
    const { events } = arenaEvents(build, { gameId: "Fortnite" });
    assert.deepEqual(events.map((event) => event.eventId), ["epicgames_Arena_S8_Solo", "epicgames_Arena_S8_Duos"], build);
    assert.equal(events[0].beginTime, "2019-03-27T00:00:00.000Z");
    assert.equal(events[0].eventWindows[1].requireAllTokens[0], "ARENA_S8_Division2");
  }
});

test("each season's Hype is its own: Season 9 starts from 0 and Season 8's stays as it was", () => withArena((store) => {
  store.record("ann", { matchId: "m1", points: 130 });
  assert.deepEqual(store.get("ann", 9), { hype: 0, division: 0, matches: [] });
  store.record("ann", { matchId: "m2", points: 30 }, 9);
  assert.equal(store.record("ann", { matchId: "m2", points: 30 }, 9), null, "a match once");
  assert.deepEqual([store.get("ann").hype, store.get("ann").division], [130, 3], "Season 8's untouched");
  assert.deepEqual([store.get("ann", 9).hype, store.get("ann", 9).division], [30, 1]);
  assert.deepEqual(arenaPlayerOf(store.get("ann", 9), 9), { tokens: ["ARENA_S9_Division2"], persistentScores: { Hype: 30 } });

  for (const build of season9) {
    const download = eventsDownload("ann", build, { region: "NAE", platform: "Windows" }, new Date(), undefined, "Fortnite", store);
    assert.deepEqual(download.events.map((event) => event.eventId), ["epicgames_Arena_S9_Solo", "epicgames_Arena_S9_Duos"], build);
    assert.deepEqual(download.player, { gameId: "Fortnite", accountId: "ann", tokens: ["ARENA_S9_Division2"], persistentScores: { Hype: 30 }, pendingPayouts: [], teams: {} });
  }
  assert.deepEqual(eventsPlayerOf("ann", "Fortnite", v851, store).persistentScores, { Hype: 130 }, "8.51 still shows Season 8's");

  store.set("bob", 80);
  assert.deepEqual(store.list(9).map(({ accountId }) => accountId), ["ann"]);
  assert.deepEqual(store.list().map(({ accountId }) => accountId).sort(), ["ann", "bob"]);
  assert.equal(store.reset("bob", 9), false, "no Season 9 record");
  assert.equal(store.resetAll(9), 1);
  assert.deepEqual([store.get("ann", 9).hype, store.get("ann").hype], [0, 130], "a Season 9 reset leaves Season 8");
}));

test("a Season 9 ticket names Season 9's event and a window held in Season 9", () => {
  const code = (ticket) => arenaTicket({ build: v901, ...ticket }).error?.code?.split(".").pop() ?? null;
  const record = { hype: 30, division: 1 };
  assert.equal(arenaTicket({ build: v901, playlistId: 58074, tournamentId: "epicgames_Arena_S9_Solo", windowId: "Arena_S9_Division2_Solo", partySize: 1, record }).rank, 1);
  assert.equal(code({ playlistId: 58074, tournamentId: "epicgames_Arena_S8_Solo", windowId: "Arena_S8_Division1_Solo", partySize: 1, record }), "invalid_tournament_id");
  assert.equal(code({ playlistId: 58074, tournamentId: "epicgames_Arena_S9_Solo", windowId: "Arena_S8_Division1_Solo", partySize: 1, record }), "invalid_event_window_id");
  assert.equal(code({ playlistId: 58074, tournamentId: "epicgames_Arena_S9_Solo", windowId: "Arena_S9_Division3_Solo", partySize: 1, record }), "invalid_event_window_id");
  assert.equal(code({ playlistId: 58075, tournamentId: "epicgames_Arena_S9_Duos", windowId: "Arena_S9_Division1_Duos", partySize: 1, record }), "wrong_number_of_event_players");
  assert.equal(arenaTicket({ build: v830, playlistId: 58074, tournamentId: "epicgames_Arena_S8_Solo", partySize: 1, record }).rank, 1, "8.30 as before");
});

test("the content page has Season 9's Arena entries; 9.x keeps the default tile picture", () => {
  for (const build of season9) {
    assert.deepEqual(arenaTournamentInformation(build).map((entry) => entry.tournament_display_id), ["epicgames_Arena_S9_Solo", "epicgames_Arena_S9_Duos"]);
    const entries = contentPage(undefined, undefined, build).tournamentinformation.tournament_info.tournaments;
    assert.deepEqual(entries.map((entry) => entry.tournament_display_id), ["epicgames_Arena_S9_Solo", "epicgames_Arena_S9_Duos"], build);
    for (const entry of entries) assert.ok(!String(entry.playlist_tile_image).includes("Arena_ModeSelect"), "Season X art is 10.00's");
  }
});

test("Season 9's tournaments: the admin panel's for 9.00 to 9.10, listed with the Arena; the callout limit leaves Season 9's Arena out", () => withTournaments((store) => {
  assert.deepEqual(tournamentPlaylists.filter(({ id }) => id.startsWith("tournamentS9")).map(({ id, playlistId, inGame }) => [id, playlistId, inGame]),
    [["tournamentS9Solo", 58082, true], ["tournamentS9Duos", 58083, true], ["tournamentS9Squads", 58084, true]]);
  assert.ok(season9.every(hasShowdown));
  const cup = store.create({ name: "Online Open", playlist: "tournamentS9Duos" }, created);
  store.create({ name: "Luxe Cup", playlist: "tournamentS8Duos" }, created);
  for (const build of season9) {
    const download = eventsDownload("ann", build, { region: "NAE", platform: "Windows" }, during, store);
    assert.deepEqual(download.events.map((event) => event.eventId), [cup.id, "epicgames_Arena_S9_Solo", "epicgames_Arena_S9_Duos"], build);
    assert.equal(showdownTicket({ playlistId: 58083, tournamentId: cup.id, windowId: cup.id, partySize: 2, build }, during, store).error, undefined);
    const limit = Number(showdownRuntimeOptions(build, {}, during, store).find((line) => line.startsWith("MaximumEventLengthHoursForCallout="))?.split("=")[1]);
    assert.equal(limit, arenaWindowHoursOf(build) - 1);
    const arenaWindow = download.events[1].eventWindows[0];
    assert.ok((Date.parse(arenaWindow.endTime) - Date.parse(arenaWindow.beginTime)) / 3600000 >= limit, "the Arena gets no lobby box");
  }
  assert.equal(arenaWindowHoursOf(v830), arenaWindowHours, "8.20 to 8.51 keep Season 8's limit");
  assert.deepEqual(eventsAccountHistory("ann", "epicgames_Arena_S9_Solo", "Arena_S9_Division1_Solo", v901, during, store), []);
  assert.equal(eventsAccountHistory("ann", "epicgames_Arena_S8_Solo", null, v901, during, store), null, "Season 8's isn't 9.01's");
}));

const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.26200.1.256.64bit`;

test("9.01 over HTTP: the download, an Arena ticket and a match's Hype go to Season 9; 8.30's Season 8 Hype is kept", async () => {
  const backend = await startBackend();
  try {
    const agent901 = agentOf(v901, "9.01");
    const agent830 = agentOf(v830, "8.30");
    const ask = (method, urlPath, token, agent, body) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      return send({ host: "127.0.0.1", port: backend.port, method, path: urlPath, headers: { "User-Agent": agent, ...(token ? { Authorization: `bearer ${token}` } : {}),
        ...(text ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } : {}) } }, text);
    };
    const ann = await userLogin(backend.port, "ArenaNine");
    createArenaStore(backend.dataDir).set(ann.accountId, 130);

    const download = await ask("GET", `/api/v1/events/Fortnite/download/${ann.accountId}?region=NAE&platform=Windows&teamAccountIds=${ann.accountId}`, ann.token, agent901);
    assert.equal(download.status, 200, JSON.stringify(download.body));
    assert.deepEqual(download.body.events.filter((event) => event.eventId.startsWith("epicgames_Arena")).map((event) => event.eventId),
      ["epicgames_Arena_S9_Solo", "epicgames_Arena_S9_Duos"]);
    assert.deepEqual([download.body.player.persistentScores, download.body.player.tokens], [{ Hype: 0 }, []], "Season 9 from 0");

    const ticketPath = (windowId) => `/fortnite/api/game/v2/matchmakingservice/ticket/player/${ann.accountId}?partyPlayerIds=${ann.accountId}`
      + `&bucketId=${v901}:0:NAE:playlist_showdownalt_solo&player.platform=Windows&player.option.tournamentId=epicgames_Arena_S9_Solo&player.option.windowId=${windowId}`;
    const ticket = await ask("GET", ticketPath("Arena_S9_Division1_Solo"), ann.token, agent901);
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    assert.equal((await ask("GET", ticketPath("Arena_S9_Division2_Solo"), ann.token, agent901)).body.errorCode,
      "errors.com.epicgames.fortnite.invalid_event_window_id", "Season 8's divisions don't carry over");

    const serverToken = await dedicatedServerToken(backend.port);
    const recorded = await ask("POST", "/fortnite/api/game/v2/battleroyale/recordresults", serverToken, agent901,
      { playlistId: 58074, matchId: "fedcba9876543210fedcba9876543210", results: [{ accountId: ann.accountId, place: 2, kills: 20, secondsAlive: 1500 }] });
    assert.ok(recorded.status < 300, JSON.stringify(recorded.body));
    const player9 = await ask("GET", `/api/v1/players/Fortnite/${ann.accountId}`, ann.token, agent901);
    assert.deepEqual([player9.body.persistentScores, player9.body.tokens], [{ Hype: 3 + 2 + 2 + 20 }, ["ARENA_S9_Division2"]]);
    const player8 = await ask("GET", `/api/v1/players/Fortnite/${ann.accountId}`, ann.token, agent830);
    assert.deepEqual([player8.body.persistentScores, player8.body.tokens.length], [{ Hype: 130 }, 3]);

    // The admin Arena tab lists and resets a season's players.
    const tab9 = await get(backend.port, "/admin/api/arena?season=9");
    assert.equal(tab9.status, 200, JSON.stringify(tab9.body));
    assert.deepEqual([tab9.body.season, tab9.body.seasons], [9, [8, 9]]);
    assert.deepEqual(tab9.body.players.map((row) => [row.displayName, row.hype]), [["ArenaNine", 27]]);
    assert.deepEqual((await get(backend.port, "/admin/api/arena")).body.players.map((row) => [row.displayName, row.hype]), [["ArenaNine", 130]], "Season 8 by default");
    assert.equal((await get(backend.port, "/admin/api/arena?season=7")).status, 400);
    const reset = await post(backend.port, "/admin/api/arena/reset", undefined, { season: 9 });
    assert.deepEqual([reset.status, reset.body.reset, reset.body.season], [200, 1, 9]);
    assert.deepEqual((await get(backend.port, "/admin/api/arena")).body.players.map((row) => row.hype), [130], "Season 8 kept");
  } finally {
    backend.close();
  }
});
