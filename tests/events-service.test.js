import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventsDownload, eventsLeaderboard, eventsPlayerOf, eventsWindowHistory, isEventsServiceBuild, leaderboardPageSize,
  windowLeaderboardOf } from "../src/tournaments/eventsservice.js";
import { eventsServiceBuild, historiesOf, showdownRuntimeOptions, showdownTiers, tournamentAndHistory } from "../src/tournaments/showdown.js";
import { createTournamentStore, leaderboardOf } from "../src/tournaments/store.js";
import { dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

// 7.40's Events tab asks Epic's events service (tournaments/eventsservice.js, services/events/events.js): the same
// tournaments 6.10 to 7.30 get through FortMcpUtils, in the shapes 7.40's exe reads (CL-5046157: FEventsServiceDownload
// 0x54DDB0, FEventsServiceLeaderboard 0x54F330, FEventsServicePlayer 0x54F740). Older builds are answered as before.
const v740 = "5046157";
const v730 = "4834550";
const v610 = "4480234";
const at = (iso) => new Date(iso);
const created = at("2026-11-15T12:00:00.000Z");
const day1 = { startsAt: "2026-11-20T18:00:00.000Z", endsAt: "2026-11-20T21:00:00.000Z" };
const day2 = { startsAt: "2026-11-21T18:00:00.000Z", endsAt: "2026-11-21T21:00:00.000Z" };
const during1 = at("2026-11-20T19:00:00.000Z");
const during2 = at("2026-11-21T19:00:00.000Z");

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-events740-"));
  try {
    return run(createTournamentStore(dataDir));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
const keysOf = (object) => Object.keys(object);

test("the events service is 7.40's and later's", () => {
  assert.equal(eventsServiceBuild, Number(v740));
  assert.deepEqual([v610, v730, v740, "5203069", "unknown"].map(isEventsServiceBuild), [false, false, true, true, false]);
});

test("7.40's download: the player, each listed event with its windows, a template of its rules and the player's scores, with the fields 7.40 reads", () => withStore((store) => {
  const event = store.create({ name: "Duo Cup", playlist: "showdownDuos", windows: [day1, day2] }, created);
  const [w1, w2] = event.windows.map(({ id }) => id);
  store.recordResult("ann", 58072, { place: 1, kills: 4, matchId: "m1", build: v740, team: ["ann", "bob"] }, during1);
  store.recordResult("bob", 58072, { place: 1, kills: 4, matchId: "m1", build: v740, team: ["ann", "bob"] }, during1);
  store.recordResult("ann", 58072, { place: 12, kills: 0, matchId: "m2", build: v740, team: ["ann", "cat"] }, during2);
  const download = eventsDownload("ann", v740, { region: "NAE", platform: "Windows" }, during2, store);
  assert.deepEqual(keysOf(download), ["player", "events", "templates", "scores"]);
  assert.deepEqual(download.player, { gameId: "Fortnite", accountId: "ann", tokens: [], pendingPayouts: [], teams: {} });

  // The event (FEventsServiceEvent, 0x54EA10): its id is the content page entry's (displayDataId), as on 6.10.
  assert.equal(download.events.length, 1);
  const [served] = download.events;
  assert.deepEqual(keysOf(served), ["gameId", "eventId", "regions", "regionMappings", "platforms", "platformMappings", "displayDataId",
    "announcementTime", "beginTime", "endTime", "eventWindows"]);
  assert.deepEqual([served.gameId, served.eventId, served.displayDataId, served.announcementTime, served.beginTime, served.endTime],
    ["Fortnite", event.id, event.id, created.toISOString(), created.toISOString(), day2.endsAt]);
  assert.ok(served.regions.includes("NAE") && !served.regions.includes("NA"), "Core's regions, the one asked among them");
  assert.ok(served.platforms.includes("Windows"));
  assert.deepEqual([served.regionMappings, served.platformMappings], [{}, {}]);
  // Its windows (FEventsServiceEventWindow, 0x54F200), one for each of its times (#364), counting down from the announcement.
  assert.deepEqual(served.eventWindows, [w1, w2].map((id, index) => ({
    eventWindowId: id, eventTemplateId: event.id, countdownBeginTime: created.toISOString(), beginTime: [day1, day2][index].startsAt,
    endTime: [day1, day2][index].endsAt, round: 0, leaderboardId: id, isTBD: false, visibility: "public", requireAllTokens: [], requireAnyTokens: []
  })));
  for (const window of served.eventWindows) for (const time of ["countdownBeginTime", "beginTime", "endTime"]) assert.ok(!Number.isNaN(Date.parse(window[time])), "ISO 8601 times");

  // The template (FEventsServiceEventTemplate, 0x54EE80): the playlist by name, 6.10's tiers.
  assert.equal(download.templates.length, 1);
  const [template] = download.templates;
  const { placement, eliminations } = showdownTiers(event);
  assert.deepEqual(template, { gameId: "Fortnite", eventTemplateId: event.id, playlistId: "Playlist_Showdown_Duos", matchCap: 0, scoringRules: [
    { trackedStat: "PLACEMENT_STAT_INDEX", matchRule: "lte", rewardTiers: placement },
    { trackedStat: "TEAM_ELIMS_STAT_INDEX", matchRule: "gte", rewardTiers: eliminations }] });
  for (const rule of template.scoringRules) for (const tier of rule.rewardTiers) assert.deepEqual(keysOf(tier), ["keyValue", "pointsEarned"]);

  // The scores (FEventsServiceTeamScore, 0x550390): one per window and team, as 6.10's histories, with the matches as sessions.
  assert.deepEqual(download.scores.map(({ eventWindowId, teamAccountIds }) => [eventWindowId, teamAccountIds]), [[w1, ["ann", "bob"]], [w2, ["ann", "cat"]]]);
  const [first, second] = download.scores;
  assert.deepEqual(keysOf(first), ["gameId", "eventId", "eventWindowId", "teamId", "teamAccountIds", "pointsEarned", "rank", "percentile",
    "pointBreakdown", "sessionHistory"]);
  const histories = historiesOf(store.get(event.id), "ann");
  assert.deepEqual([first.pointsEarned, first.pointBreakdown], [histories[0].payload.pointsEarned, histories[0].payload.pointBreakdown]);
  assert.equal(first.pointsEarned, 4, "a win (3 tiers) and 3 eliminations' tier");
  assert.ok(keysOf(first.pointBreakdown).every((key) => /^(PLACEMENT_STAT_INDEX|TEAM_ELIMS_STAT_INDEX):\d+$/.test(key)), "6.10's <stat>:<keyValue> keys");
  assert.deepEqual(first.sessionHistory, [{ sessionId: "m1", endTime: during1.toISOString(), trackedStats: { PLACEMENT_STAT_INDEX: 1, TEAM_ELIMS_STAT_INDEX: 4 } }]);
  assert.deepEqual([first.rank, first.percentile, second.rank, second.percentile], [1, 1, 1, 1], "each the only team of its window");
  assert.equal(second.pointsEarned, 0);

  // Bob's list has his own score only; the same events.
  const bob = eventsDownload("bob", v740, {}, during2, store);
  assert.deepEqual(bob.scores.map(({ teamAccountIds }) => teamAccountIds), [["ann", "bob"]]);
  assert.deepEqual(bob.events.map(({ eventId }) => eventId), [event.id]);
  // The same events as 7.30's list through FortMcpUtils.
  assert.deepEqual(download.events.map(({ eventId }) => eventId), tournamentAndHistory("ann", v730, during2, store).eventTournaments.map(({ tournamentId }) => tournamentId));
}));

test("7.40's download lists only what the build's Events tab lists for the player: Showdown playlists, invite-only events for the invited (#383)", () => withStore((store) => {
  const open = store.create({ name: "Open Cup", playlist: "showdownSolo", ...day1 }, created);
  store.create({ name: "Not a tournament", playlist: "soloShowdown", ...day1 }, created);
  const finals = store.create({ name: "Finals", playlist: "showdownSolo", ...day2 }, created);
  store.setQualifier(finals.id, { eventId: open.id, places: 1 });
  store.recordResult("ann", 58071, { place: 1, kills: 0, matchId: "a", build: v740, team: ["ann"] }, during1);
  store.recordResult("bob", 58071, { place: 5, kills: 0, matchId: "b", build: v740, team: ["bob"] }, during1);
  const after = at("2026-11-21T12:00:00.000Z");
  assert.deepEqual(eventsDownload("ann", v740, {}, after, store).events.map(({ eventId }) => eventId), [open.id, finals.id]);
  assert.deepEqual(eventsDownload("bob", v740, {}, after, store).events.map(({ eventId }) => eventId), [open.id], "not invited: not listed");
  assert.deepEqual(eventsDownload("ann", "4464154", {}, after, store), { player: eventsPlayerOf("ann"), events: [], templates: [], scores: [] }, "no Events tab: nothing");
}));

test("a window's leaderboard: its teams by points in that window, the contest rules' ties, pages of 100 from 0, rank's page without one", () => withStore((store) => {
  const event = store.create({ name: "Solo Cup", playlist: "showdownSolo", ...day1 }, created);
  for (let index = 0; index < 150; index += 1) {
    store.recordResult(`p${String(index).padStart(3, "0")}`, 58071, { place: index < 2 ? 1 : 50, kills: index < 2 ? 0 : index % 4, matchId: `m${index}`, build: v740 }, during1);
  }
  const entries = windowLeaderboardOf(store.get(event.id), event.id);
  assert.equal(entries.length, 150);
  assert.deepEqual(entries.slice(0, 2).map(({ rank, pointsEarned }) => [rank, pointsEarned]), [[1, 3], [1, 3]], "a tie on points, wins, eliminations and placement shares a rank");
  assert.equal(entries[2].rank, 3);
  // A single window's ranks are the panel's leaderboard's (leaderboardOf), whose prizes they are.
  const panel = new Map(leaderboardOf(store.get(event.id)).map(({ accountId, rank }) => [accountId, rank]));
  for (const entry of entries) assert.equal(entry.rank, panel.get(entry.teamAccountIds[0]), entry.teamAccountIds[0]);
  assert.equal(entries.at(-1).percentile, entries.at(-1).rank / 150);
  assert.ok(entries.every(({ percentile }) => percentile > 0 && percentile <= 1), "(Top {Percentile}%) shows above 0");

  assert.equal(leaderboardPageSize, 100);
  const page0 = eventsLeaderboard("p000", event.id, event.id, v740, { page: "0", rank: "0" }, during1, store);
  assert.deepEqual(keysOf(page0), ["gameId", "eventId", "eventWindowId", "page", "totalPages", "entries"]);
  assert.deepEqual([page0.gameId, page0.eventId, page0.eventWindowId, page0.page, page0.totalPages, page0.entries.length], ["Fortnite", event.id, event.id, 0, 2, 100]);
  const page1 = eventsLeaderboard("p000", event.id, event.id, v740, { page: "1" }, during1, store);
  assert.deepEqual([page1.page, page1.entries.length], [1, 50]);
  assert.deepEqual(page1.entries[0], entries[100]);
  assert.equal(eventsLeaderboard("p000", event.id, event.id, v740, { page: "", rank: "120" }, during1, store).page, 1);
  assert.equal(eventsLeaderboard("p000", event.id, event.id, v740, {}, during1, store).page, 0);
  assert.equal(eventsLeaderboard("p000", event.id, "nope", v740, {}, during1, store), null);
  assert.equal(eventsLeaderboard("p000", "nope", event.id, v740, {}, during1, store), null);
  assert.deepEqual(eventsWindowHistory("p001", event.id, event.id, v740, during1, store), [entries.find(({ teamAccountIds }) => teamAccountIds[0] === "p001")]);
  assert.equal(eventsWindowHistory("p001", event.id, "nope", v740, during1, store), null);
  // An empty window: one page, no entries.
  const empty = store.create({ name: "Empty Cup", playlist: "showdownSolo", ...day2 }, created);
  assert.deepEqual(eventsLeaderboard("p000", empty.id, empty.id, v740, {}, during1, store), { gameId: "Fortnite", eventId: empty.id, eventWindowId: empty.id, page: 0, totalPages: 1, entries: [] });
}));

test("a team is one leaderboard entry, however many of its players are recorded; its eliminations are the team's", () => withStore((store) => {
  const event = store.create({ name: "Squad Cup", playlist: "showdownSquads", ...day1 }, created);
  const team = ["ann", "bob", "cat", "dan"];
  for (const accountId of team) store.recordResult(accountId, 58073, { place: 2, kills: 6, matchId: "s1", build: v740, team }, during1);
  store.recordResult("eve", 58073, { place: 1, kills: 1, matchId: "s1", build: v740, team: ["eve"] }, during1);
  const entries = windowLeaderboardOf(store.get(event.id), event.id);
  assert.deepEqual(entries.map(({ teamAccountIds, rank }) => [teamAccountIds, rank]), [[team, 1], [["eve"], 2]]);
  assert.deepEqual(entries[0].sessionHistory[0].trackedStats, { PLACEMENT_STAT_INDEX: 2, TEAM_ELIMS_STAT_INDEX: 6 });
}));

test("the hotfix turns 7.40's event leaderboards on; 6.10's and 7.30's lines are as before", () => withStore((store) => {
  const now = at("2026-11-12T12:00:00.000Z");
  assert.deepEqual(showdownRuntimeOptions(v740, {}, now, store), ["ShowdownTournamentCacheExpirationHours=0", "bEnableEventLeaderboards=true"]);
  assert.deepEqual(showdownRuntimeOptions(v740, { hideEmptyEventsTab: true }, now, store), ["bEnableShowdown=false"]);
  for (const build of [v610, v730]) assert.deepEqual(showdownRuntimeOptions(build, {}, now, store), ["ShowdownTournamentCacheExpirationHours=0"], build);
}));

const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.26200.1.256.64bit`;
const agent740 = agentOf(v740, "7.40");
const agent730 = agentOf(v730, "7.30");
const ask = (port, method, urlPath, token, agent) => send({ host: "127.0.0.1", port, method, path: urlPath,
  headers: { "User-Agent": agent, ...(token ? { Authorization: `bearer ${token}` } : {}) } });

test("7.40's events service over HTTP: download, players, leaderboards, history and processPendingRewards; 7.30 and older get the unanswered routes and FortMcpUtils' as before", async () => {
  const backend = await startBackend();
  try {
    const hour = 60 * 60 * 1000;
    const iso = (ms) => new Date(ms).toISOString();
    const made = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/admin/api/tournaments", headers: { "Content-Type": "application/json", "User-Agent": agent740 } },
      JSON.stringify({ name: "Now Cup", playlist: "showdownSolo", startsAt: iso(Date.now() - hour), endsAt: iso(Date.now() + hour) }));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const eventId = made.body.event.id;
    const ann = await userLogin(backend.port, "WindowsAnn");
    const bob = await userLogin(backend.port, "WindowsBob");
    // A match reported by the game server, as recordresults scores it.
    const serverToken = await dedicatedServerToken(backend.port);
    const text = JSON.stringify({ playlistId: 58071, matchId: "0123456789abcdef0123456789abcdef", results: [{ accountId: ann.accountId, place: 1, kills: 5, secondsAlive: 900 },
      { accountId: bob.accountId, place: 7, kills: 0, secondsAlive: 600 }] });
    const recorded = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/fortnite/api/game/v2/battleroyale/recordresults", headers: {
      "User-Agent": "Core V2", Authorization: `bearer ${serverToken}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    assert.ok(recorded.status < 300, JSON.stringify(recorded.body));

    // The download as 7.40 sends it.
    const downloadPath = `/api/v1/events/Fortnite/download/${ann.accountId}?region=NAE&platform=Windows&teamAccountIds=${ann.accountId}`;
    const download = await ask(backend.port, "GET", downloadPath, ann.token, agent740);
    assert.equal(download.status, 200, JSON.stringify(download.body));
    assert.match(download.headers["content-type"], /^application\/json/);
    assert.deepEqual(download.body.events.map((event) => event.eventId), [eventId]);
    assert.equal(download.body.templates[0].playlistId, "Playlist_Showdown_Solo");
    assert.deepEqual(download.body.scores.map(({ teamAccountIds, pointsEarned, rank }) => [teamAccountIds, pointsEarned, rank]), [[[ann.accountId], 5, 1]],
      "a win (three tiers) and the 3 and 5 eliminations' tiers, first of two");
    assert.equal((await ask(backend.port, "GET", downloadPath, bob.token, agent740)).status, 403, "another player's download");
    assert.equal((await ask(backend.port, "GET", downloadPath, null, agent740)).status, 401);

    const players = await ask(backend.port, "GET", `/api/v1/players/Fortnite/${ann.accountId}`, ann.token, agent740);
    assert.deepEqual([players.status, players.body], [200, { gameId: "Fortnite", accountId: ann.accountId, tokens: [], pendingPayouts: [], teams: {} }]);

    const board = await ask(backend.port, "GET", `/api/v1/leaderboards/Fortnite/${eventId}/${eventId}/${bob.accountId}?page=0&rank=0&teamAccountIds=${bob.accountId}`, bob.token, agent740);
    assert.equal(board.status, 200, JSON.stringify(board.body));
    assert.deepEqual([board.body.page, board.body.totalPages], [0, 1]);
    assert.deepEqual(board.body.entries.map(({ teamAccountIds, rank, percentile }) => [teamAccountIds[0], rank, percentile]), [[ann.accountId, 1, 0.5], [bob.accountId, 2, 1]]);
    assert.equal((await ask(backend.port, "GET", `/api/v1/leaderboards/Fortnite/${eventId}/nope/${bob.accountId}?page=0&rank=0&teamAccountIds=`, bob.token, agent740)).status, 404);

    const history = await ask(backend.port, "GET", `/api/v1/events/Fortnite/${eventId}/${eventId}/history`, bob.token, agent740);
    assert.deepEqual([history.status, history.body.map(({ rank }) => rank)], [200, [2]]);

    const rewards = await ask(backend.port, "POST", `/fortnite/api/game/v2/events/v2/processPendingRewards/${ann.accountId}`, ann.token, agent740);
    assert.deepEqual([rewards.status, rewards.body], [200, []]);
    assert.equal((await ask(backend.port, "POST", `/fortnite/api/game/v2/events/v2/processPendingRewards/${ann.accountId}`, bob.token, agent740)).status, 403);

    // 7.40's hotfix turns its event leaderboards on.
    const runtime = await ask(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini", ann.token, agent740);
    assert.match(runtime.body, /\r\nShowdownTournamentCacheExpirationHours=0\r\nbEnableEventLeaderboards=true\r\n/);

    // 7.30: the same requests are unanswered routes, logged as before; its Events tab is FortMcpUtils', unchanged.
    for (const [method, urlPath] of [["GET", downloadPath], ["GET", `/api/v1/players/Fortnite/${ann.accountId}`],
      ["GET", `/api/v1/leaderboards/Fortnite/${eventId}/${eventId}/${ann.accountId}?page=0&rank=0&teamAccountIds=`],
      ["GET", `/api/v1/events/Fortnite/${eventId}/${eventId}/history`], ["POST", `/fortnite/api/game/v2/events/v2/processPendingRewards/${ann.accountId}`]]) {
      const answer = await ask(backend.port, method, urlPath, ann.token, agent730);
      assert.equal(answer.status, 404, `${method} ${urlPath}`);
      assert.equal(answer.body.errorCode, "errors.com.epicgames.common.not_found", urlPath);
    }
    const unknown = backend.unknownLog(v730).map(({ path: logged }) => logged);
    assert.ok(unknown.includes("/api/v1/events/Fortnite/download/:id"), JSON.stringify(unknown));
    const old = await ask(backend.port, "GET", `/fortnite/api/game/v2/events/tournamentandhistory/${ann.accountId}/NAE/WindowsClient`, ann.token, agent730);
    assert.equal(old.status, 200);
    assert.deepEqual(old.body.eventTournaments.map(({ tournamentId }) => tournamentId), [eventId]);
    assert.equal(old.body.eventWindowHistories[0].payload.pointsEarned, 5);
    const runtime730 = await ask(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini", ann.token, agent730);
    assert.match(runtime730.body, /\r\nShowdownTournamentCacheExpirationHours=0\r\n/);
    assert.doesNotMatch(runtime730.body, /bEnableEventLeaderboards/);
    // 7.40's content page has the tournament's entry, by the event's displayDataId.
    const page = await ask(backend.port, "GET", "/content/api/pages/fortnite-game", ann.token, agent740);
    assert.deepEqual(page.body.tournamentinformation.tournament_info.tournaments.map(({ tournament_display_id: id }) => id), [eventId]);
  } finally {
    backend.close();
  }
});
