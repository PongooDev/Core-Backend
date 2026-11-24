import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasLtm, ltmFrontEndPlaylists, ltmOfBucketPlaylist, ltmOn } from "../src/events/ltms.js";
import { arenaEvents, arenaMatchPoints, arenaPlayerOf, arenaTicket, arenaTournamentInformation, createArenaStore, divisionOfHype,
  divisionThresholds, hasArena } from "../src/tournaments/arena.js";
import { eventsDownload, eventsPlayerOf } from "../src/tournaments/eventsservice.js";
import { contentPage } from "../src/services/content/pages.js";
import { dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

// Season 8's Arena (Core-Backend #420, tournaments/arena.js): 8.20's to 8.40's events service events, one a mode with a
// window for each of the seven divisions, the player's Hype and division tokens, and Arena tickets.
const v740 = "5046157";
const v800 = "5203069";
const v820 = "5625478";
const v830 = "5793395";
const v840 = "6005771";

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-arena-"));
  try {
    return run(createArenaStore(dataDir));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test("the Arena is 8.20's to 8.40's, on the Pop-Up Cups' ShowdownAlt playlists, and no lobby mode of FrontEndPlaylistData", () => {
  assert.deepEqual([v740, v800, v820, v830, v840].map(hasArena), [false, false, true, true, true]);
  for (const build of [v820, v830, v840]) {
    assert.ok(hasLtm("arenaSolo", build) && hasLtm("arenaDuos", build), build);
    assert.equal(ltmOn("arenaSolo", build, {}), false, "no switch: the events service's tile");
    assert.ok(!ltmFrontEndPlaylists(build, {}).some(({ name }) => /^Playlist_ShowdownAlt_/.test(name)), build);
    assert.equal(ltmOfBucketPlaylist({ playlistName: "playlist_showdownalt_solo" }, build).id, "arenaSolo");
  }
  assert.equal(ltmOfBucketPlaylist({ playlistName: "playlist_showdownalt_solo" }, "4573096").id, "scavengerSolo", "6.30's Pop-Up Cup keeps the playlist");
});

test("the Arena events: one a mode, seven division windows with 8.30's metadata and 8.20's round, and a template each with the Hype score", () => {
  const { events, templates } = arenaEvents(v830, { gameId: "Fortnite" });
  assert.deepEqual(events.map((event) => event.eventId), ["epicgames_Arena_S8_Solo", "epicgames_Arena_S8_Duos"]);
  const [solo] = events;
  assert.equal(solo.displayDataId, solo.eventId);
  assert.equal(solo.eventWindows.length, 7, "seven divisions (8.30's seven badges)");
  solo.eventWindows.forEach((window, rank) => {
    assert.equal(window.eventWindowId, `Arena_S8_Division${rank + 1}_Solo`);
    assert.equal(window.eventTemplateId, `eventTemplate_Arena_S8_Division${rank + 1}_Solo`);
    assert.equal(window.round, rank, "8.20's rank");
    assert.deepEqual(window.metadata, { RoundType: "Arena", divisionRank: rank, ThresholdToAdvanceDivision: divisionThresholds[rank] });
    assert.deepEqual(window.requireAllTokens, rank ? [`ARENA_S8_Division${rank + 1}`] : [], "Division I asks no token");
    assert.ok(Date.parse(window.countdownBeginTime) < Date.now() && Date.parse(window.endTime) > Date.now(), "live now");
    assert.equal(window.visibility, "public");
  });
  assert.equal(templates.length, 14);
  const division1 = templates.find((template) => template.eventTemplateId === "eventTemplate_Arena_S8_Division1_Solo");
  assert.equal(division1.playlistId, "Playlist_ShowdownAlt_Solo");
  assert.equal(division1.persistentScoreId, "Hype");
  assert.deepEqual(division1.scoringRules.map((rule) => rule.trackedStat), ["PLACEMENT_STAT_INDEX", "TEAM_ELIMS_STAT_INDEX"], "no bus fare in the Open League");
  assert.equal(division1.scoringRules[1].rewardTiers.length, 99, "99 one-point tiers: the rules screen's EachElimination");
  assert.deepEqual(division1.payoutTable, [{ scoringType: "value", rolling: false, ranks: [{ threshold: 25,
    payouts: [{ rewardType: "token", rewardMode: "standard", value: "ARENA_S8_Division2", quantity: 1 }] }] }], "8.20's threshold");
  const division4 = templates.find((template) => template.eventTemplateId === "eventTemplate_Arena_S8_Division4_Duos");
  assert.equal(division4.playlistId, "Playlist_ShowdownAlt_Duos");
  assert.deepEqual(division4.scoringRules[2], { trackedStat: "MATCH_PLAYED_STAT", matchRule: "gte", rewardTiers: [{ keyValue: 1, pointsEarned: -2 }] });
  assert.deepEqual(templates.find((template) => template.eventTemplateId === "eventTemplate_Arena_S8_Division7_Solo").payoutTable, [], "Champion League has no next");
});

test("Hype: placement tiers, a point a team elimination, the division's bus fare; divisions kept once reached, never below 0", () => withStore((store) => {
  assert.equal(arenaMatchPoints("Solo", 0, { place: 1, teamKills: 4 }), 3 + 2 + 2 + 3 + 4);
  assert.equal(arenaMatchPoints("Solo", 0, { place: 20, teamKills: 0 }), 3);
  assert.equal(arenaMatchPoints("Duos", 0, { place: 7, teamKills: 1 }), 3 + 2 + 1);
  assert.equal(arenaMatchPoints("Solo", 6, { place: 80, teamKills: 0 }), -8);
  assert.deepEqual([0, 24, 25, 299, 300].map(divisionOfHype), [0, 0, 1, 5, 6]);

  assert.deepEqual(arenaPlayerOf(store.get("ann")), { tokens: [], persistentScores: { Hype: 0 } });
  store.record("ann", { matchId: "m1", points: 80 });
  assert.deepEqual(store.get("ann").division, 2);
  assert.equal(store.record("ann", { matchId: "m1", points: 80 }), null, "a match once");
  store.record("ann", { matchId: "m2", points: 50 });
  assert.deepEqual(arenaPlayerOf(store.get("ann")), { tokens: ["ARENA_S8_Division2", "ARENA_S8_Division3", "ARENA_S8_Division4"], persistentScores: { Hype: 130 } });
  store.record("ann", { matchId: "m3", points: -20 });
  assert.deepEqual([store.get("ann").hype, store.get("ann").division], [110, 3], "no demotion");
  store.record("bob", { matchId: "m4", points: -5 });
  assert.equal(store.get("bob").hype, 0);
}));

test("an Arena ticket: the mode's event, a window the player holds, a full party", () => {
  const code = (ticket) => arenaTicket({ build: v830, ...ticket }).error?.code?.split(".").pop() ?? null;
  const record = { hype: 80, division: 2 };
  assert.equal(arenaTicket({ build: v830, playlistId: 58074, tournamentId: "epicgames_Arena_S8_Solo", windowId: "Arena_S8_Division3_Solo", partySize: 1, record }).rank, 2);
  assert.equal(code({ playlistId: 58074, tournamentId: "epicgames_Arena_S8_Solo", windowId: "Arena_S8_Division4_Solo", partySize: 1, record }), "invalid_event_window_id");
  assert.equal(code({ playlistId: 58074, tournamentId: "epicgames_Arena_S8_Duos", partySize: 1, record }), "invalid_tournament_id");
  assert.equal(code({ playlistId: 58075, tournamentId: "epicgames_Arena_S8_Duos", windowId: "Arena_S8_Division1_Duos", partySize: 1, record }), "wrong_number_of_event_players");
  assert.equal(code({ playlistId: 58075, tournamentId: "epicgames_Arena_S8_Duos", windowId: "Arena_S8_Division1_Duos", partySize: 2, record }), null);
  assert.equal(arenaTicket({ build: v740, playlistId: 58074, partySize: 1 }).error.code, "errors.com.epicgames.fortnite.invalid_tournament_id");
});

test("the download and the player: 8.20 on get the Arena, 7.40 and 8.00 as before", () => withStore((store) => {
  store.record("ann", { matchId: "m1", points: 30 });
  for (const build of [v820, v830, v840]) {
    const download = eventsDownload("ann", build, { region: "NAE", platform: "Windows" }, new Date(), undefined, "Fortnite", store);
    assert.deepEqual(download.events.map((event) => event.eventId), ["epicgames_Arena_S8_Solo", "epicgames_Arena_S8_Duos"], build);
    assert.deepEqual(download.player, { gameId: "Fortnite", accountId: "ann", tokens: ["ARENA_S8_Division2"], persistentScores: { Hype: 30 }, pendingPayouts: [], teams: {} });
    assert.ok(download.events[0].regions.includes("NAE"));
  }
  for (const build of [v740, v800]) {
    const download = eventsDownload("ann", build, {}, new Date(), undefined, "Fortnite", store);
    assert.deepEqual(download.events, [], build);
    assert.deepEqual(download.player, { gameId: "Fortnite", accountId: "ann", tokens: [], pendingPayouts: [], teams: {} });
  }
  assert.deepEqual(eventsPlayerOf("ann", "Fortnite", v740, store), { gameId: "Fortnite", accountId: "ann", tokens: [], pendingPayouts: [], teams: {} });
}));

test("the content page has an Arena entry for each mode on 8.20 on, with colours, and none before", () => {
  assert.deepEqual(arenaTournamentInformation(v830).map((entry) => entry.tournament_display_id), ["epicgames_Arena_S8_Solo", "epicgames_Arena_S8_Duos"]);
  const page = contentPage(undefined, undefined, v830);
  const entries = page.tournamentinformation.tournament_info.tournaments;
  assert.deepEqual(entries.map((entry) => entry.tournament_display_id), ["epicgames_Arena_S8_Solo", "epicgames_Arena_S8_Duos"]);
  assert.match(entries[0].title_color, /^[0-9A-F]{6}$/);
  assert.equal(contentPage(undefined, undefined, v800).tournamentinformation, undefined);
});

const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.26200.1.256.64bit`;
const agent830 = agentOf(v830, "8.30");
const ask = (port, method, urlPath, token, agent, body) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers: { "User-Agent": agent, ...(token ? { Authorization: `bearer ${token}` } : {}),
    ...(text ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } : {}) } }, text);
};

test("8.30 over HTTP: the download, data and players routes, an Arena ticket, and a match's Hype", async () => {
  const backend = await startBackend();
  try {
    const ann = await userLogin(backend.port, "ArenaAnn");
    const download = await ask(backend.port, "GET", `/api/v1/events/Fortnite/download/${ann.accountId}?region=NAE&platform=Windows&teamAccountIds=${ann.accountId}`, ann.token, agent830);
    assert.equal(download.status, 200, JSON.stringify(download.body));
    assert.deepEqual(download.body.events.map((event) => event.eventId), ["epicgames_Arena_S8_Solo", "epicgames_Arena_S8_Duos"]);
    assert.deepEqual(download.body.player.persistentScores, { Hype: 0 });
    const data = await ask(backend.port, "GET", `/api/v1/events/Fortnite/data/${ann.accountId}`, ann.token, agent830);
    assert.equal(data.status, 200);
    assert.equal(data.body.templates.length, 14);

    const ticketPath = (windowId) => `/fortnite/api/game/v2/matchmakingservice/ticket/player/${ann.accountId}?partyPlayerIds=${ann.accountId}`
      + `&bucketId=5793395:0:NAE:playlist_showdownalt_solo&player.platform=Windows&player.option.tournamentId=epicgames_Arena_S8_Solo&player.option.windowId=${windowId}`;
    const ticket = await ask(backend.port, "GET", ticketPath("Arena_S8_Division1_Solo"), ann.token, agent830);
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    assert.equal((await ask(backend.port, "GET", ticketPath("Arena_S8_Division2_Solo"), ann.token, agent830)).body.errorCode,
      "errors.com.epicgames.fortnite.invalid_event_window_id", "a division not reached");

    const serverToken = await dedicatedServerToken(backend.port);
    const recorded = await ask(backend.port, "POST", "/fortnite/api/game/v2/battleroyale/recordresults", serverToken, agent830,
      { playlistId: 58074, matchId: "0123456789abcdef0123456789abcdef", results: [{ accountId: ann.accountId, place: 2, kills: 20, secondsAlive: 1500 }] });
    assert.ok(recorded.status < 300, JSON.stringify(recorded.body));
    const player = await ask(backend.port, "GET", `/api/v1/players/Fortnite/${ann.accountId}`, ann.token, agent830);
    assert.deepEqual([player.body.persistentScores, player.body.tokens], [{ Hype: 3 + 2 + 2 + 20 }, ["ARENA_S8_Division2"]]);
  } finally {
    backend.close();
  }
});
