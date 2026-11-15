import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPayoutSettler, payoutKey, payoutsDue, settleEvent } from "../src/tournaments/payouts.js";
import { createShowdownRefresh, currentShowdownEvent, eventWindowHistory, eventWindowsOf, historiesOf, showdownTicket, tournamentAndHistory,
  tournamentInformationFor, tournamentOf } from "../src/tournaments/showdown.js";
import { createTournamentStore, isRunning, leaderboardOf, maxWindows, statusOf, validateWindows, windowsOf } from "../src/tournaments/store.js";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #364: an event's several times. Epic's in-game tournaments ran in sessions, each an event window of the
// tournament (FShowdownTournament's EventWindows of FShowdownEventWindow, 6.10 to 6.31), which the game's EVENT DETAILS
// lists one by one and scores on its own; the panel's leaderboard and prizes add them up.
const v610 = "4480234";
const at = (iso) => new Date(iso);
const day1 = { startsAt: "2026-11-20T18:00:00.000Z", endsAt: "2026-11-20T21:00:00.000Z" };
const day2 = { startsAt: "2026-11-21T18:00:00.000Z", endsAt: "2026-11-21T21:00:00.000Z" };
const day3 = { startsAt: "2026-11-22T18:00:00.000Z", endsAt: "2026-11-22T21:00:00.000Z" };
const created = at("2026-11-15T12:00:00.000Z");

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-364-"));
  try {
    return run(createTournamentStore(dataDir), dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test("an event of one time is served as it always was, and saving that one time again keeps it so (#364)", () => withStore((store, dataDir) => {
  const event = store.create({ name: "Core Cup", playlist: "showdownSolo", ...day1 }, created);
  assert.equal(Object.hasOwn(event, "windows"), false);
  assert.deepEqual(windowsOf(event), [{ id: event.id, ...day1 }]);
  store.recordResult("ann", 58071, { place: 1, kills: 3, matchId: "m1", build: v610, team: ["ann"] }, at("2026-11-20T19:00:00.000Z"));
  assert.equal(Object.hasOwn(store.get(event.id).players.ann.matches[0], "window"), false, "its matches are kept as before");
  const now = at("2026-11-20T19:30:00.000Z");
  const before = tournamentAndHistory("ann", v610, now, store);
  assert.deepEqual(before.eventTournaments[0].eventWindows.map(({ eventWindowId, countdownBeginTime, beginTime, endTime }) => [eventWindowId, countdownBeginTime, beginTime, endTime]),
    [[event.id, created.toISOString(), day1.startsAt, day1.endsAt]]);
  assert.equal(before.eventTournaments[0].endTime, day1.endsAt);
  assert.deepEqual(before.eventWindowHistories.map(({ eventWindowId }) => eventWindowId), [event.id]);
  const entry = tournamentInformationFor(v610, now, store).tournament_info.tournaments[0];
  assert.equal(entry.schedule_info, "2026-11-20 18:00 UTC to 2026-11-20 21:00 UTC");
  assert.doesNotMatch(entry.details_description, /sessions/);

  // The panel saves the same one time: nothing served changes, and it is kept as the event's own start and end.
  store.setWindows(event.id, [{ id: event.id, ...day1 }], at("2026-11-20T19:31:00.000Z"));
  const saved = store.get(event.id);
  assert.equal(Object.hasOwn(saved, "windows"), false);
  assert.deepEqual([saved.startsAt, saved.endsAt], [day1.startsAt, day1.endsAt]);
  assert.deepEqual(tournamentAndHistory("ann", v610, now, store), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "tournaments.json"), "utf8")).events[event.id].windows, undefined);
  // An open event's one time keeps its empty dates: from its creation, never ending.
  const open = store.create({ name: "Open Cup", playlist: "showdownDuos" }, created);
  store.setWindows(open.id, [{ id: open.id, startsAt: "", endsAt: null }]);
  assert.deepEqual(eventWindowsOf(store.get(open.id)), [{ id: open.id, beginTime: created.toISOString(), endTime: "9999-12-31T23:59:59.000Z" }]);
  // Made with one time in windows: the same as with startsAt and endsAt.
  const one = store.create({ playlist: "showdownSolo", windows: [day2] }, created);
  assert.equal(Object.hasOwn(one, "windows"), false);
  assert.deepEqual([one.startsAt, one.endsAt], [day2.startsAt, day2.endsAt]);
}));

test("an event's times are checked: at least one, at most the EVENT DETAILS' 16, each with a start and an end when there are several, none overlapping (#364)", () => withStore((store) => {
  assert.equal(maxWindows, 16);
  assert.deepEqual(validateWindows([day2, day1]), [{ id: null, ...day1 }, { id: null, ...day2 }], "in order");
  // Back to back is fine.
  assert.equal(validateWindows([day1, { startsAt: day1.endsAt, endsAt: "2026-11-20T22:00:00.000Z" }]).length, 2);
  const many = Array.from({ length: maxWindows + 1 }, (_, index) => ({ startsAt: new Date(Date.parse(day1.startsAt) + index * 864e5).toISOString(),
    endsAt: new Date(Date.parse(day1.endsAt) + index * 864e5).toISOString() }));
  assert.equal(validateWindows(many.slice(0, maxWindows)).length, maxWindows);
  for (const [bad, reason] of [
    [[], /at least one/],
    [null, /at least one/],
    [many, /at most 16/],
    [[day1, { startsAt: day2.startsAt }], /start and an end/],
    [[{ endsAt: day1.endsAt }, day2], /start and an end/],
    [[day1, { startsAt: "2026-11-20T20:00:00.000Z", endsAt: "2026-11-20T23:00:00.000Z" }], /overlap/],
    [[{ startsAt: day1.endsAt, endsAt: day1.startsAt }], /ends after it starts/],
    [[{ startsAt: "soon", endsAt: day1.endsAt }], /isn't a date/],
    [["day1"], /startsAt, endsAt/]
  ]) assert.throws(() => validateWindows(bad), reason, JSON.stringify(bad));
  assert.throws(() => validateWindows([{ id: "nope", ...day1 }], ["abc"]), /no time nope/);
  assert.throws(() => validateWindows([{ id: "abc", ...day1 }, { id: "abc", ...day2 }], ["abc"]), /twice/);
  assert.throws(() => store.create({ playlist: "showdownSolo", windows: [day1, { startsAt: day1.startsAt, endsAt: day2.endsAt }] }, created), /overlap/);

  // Made with three, out of order: in order, the first keeping the event's id, the span in startsAt and endsAt.
  const event = store.create({ name: "Three Day Cup", playlist: "showdownSolo", windows: [day3, day1, day2], startsAt: "ignored" }, created);
  assert.equal(event.windows.length, 3);
  assert.deepEqual(event.windows.map(({ startsAt }) => startsAt), [day1.startsAt, day2.startsAt, day3.startsAt]);
  assert.equal(event.windows[0].id, event.id);
  assert.equal(new Set(event.windows.map(({ id }) => id)).size, 3);
  assert.deepEqual([event.startsAt, event.endsAt], [day1.startsAt, day3.endsAt]);
}));

test("an event of several times as the client reads it: one tournament, a window for each time with the event's rules, in order (#364)", () => withStore((store) => {
  const event = store.create({ name: "Three Day Cup", playlist: "showdownSolo", windows: [day1, day2, day3], pinScore: 5,
    payoutTable: [{ scoringType: "value", threshold: 5, vbucks: 100 }] }, created);
  const [w1, w2, w3] = event.windows.map(({ id }) => id);
  const { eventTournaments } = tournamentAndHistory("ann", v610, created, store);
  assert.equal(eventTournaments.length, 1);
  const [tournament] = eventTournaments;
  assert.deepEqual([tournament.tournamentId, tournament.announcementTime, tournament.beginTime, tournament.endTime],
    [event.id, created.toISOString(), created.toISOString(), day3.endsAt], "the tournament runs from its announcement to its last time's end");
  assert.deepEqual(tournament.eventWindows.map(({ eventWindowId, countdownBeginTime, beginTime, endTime, bIsTBD }) => [eventWindowId, countdownBeginTime, beginTime, endTime, bIsTBD]), [
    [w1, created.toISOString(), day1.startsAt, day1.endsAt, false],
    [w2, created.toISOString(), day2.startsAt, day2.endsAt, false],
    [w3, created.toISOString(), day3.startsAt, day3.endsAt, false]]);
  // Every window has the event's playlist, reward tiers and points prizes.
  const [first, ...others] = tournament.eventWindows.map(({ eventData }) => JSON.stringify(eventData));
  for (const other of others) assert.equal(other, first);
  assert.deepEqual(tournament.eventWindows[2].eventData.rewardTable, [{ pointsEarned: 5, mcpTokenRewards: [] }]);
  assert.equal(JSON.stringify(tournamentOf(event)), JSON.stringify(tournament));
  // The tile: its whole span and how many sessions, and what the points do across them.
  const entry = tournamentInformationFor(v610, created, store).tournament_info.tournaments[0];
  assert.equal(entry.schedule_info, "2026-11-20 18:00 UTC to 2026-11-22 21:00 UTC, 3 sessions");
  assert.match(entry.details_description, /3 sessions: each one's points show on their own, and the leaderboard and prizes add them all up\. Prizes: Reach 5 points/);
  assert.equal(entry.pin_score_requirement, 5);
}));

test("matches score only within a time, each noted with its window; the game gets each window's history, the leaderboard and prizes all of them (#364)", () => withStore((store) => {
  const event = store.create({ name: "Two Day Cup", playlist: "showdownSolo", windows: [day1, day2],
    payoutTable: [{ scoringType: "value", threshold: 7, vbucks: 100 }, { scoringType: "rank", threshold: 1, vbucks: 1000 }] }, created);
  const [w1, w2] = event.windows.map(({ id }) => id);
  const during1 = at("2026-11-20T19:00:00.000Z");
  const between = at("2026-11-21T12:00:00.000Z");
  const during2 = at("2026-11-21T19:00:00.000Z");
  assert.deepEqual([statusOf(event, at("2026-11-20T12:00:00.000Z")), statusOf(event, during1), statusOf(event, between), statusOf(event, during2),
    statusOf(event, at(day2.endsAt))], ["scheduled", "running", "scheduled", "running", "ended"]);
  assert.deepEqual([isRunning(event, during1), isRunning(event, between), isRunning(event, during2)], [true, false, true]);

  // Epic's in-game points (#427, a point a step): a win with 8 eliminations is 6, a Top 10 is 1.
  assert.deepEqual(store.recordResult("ann", 58071, { place: 1, kills: 8, matchId: "a1", build: v610, team: ["ann"] }, during1), [{ eventId: event.id, points: 6 }]);
  assert.deepEqual(store.recordResult("ann", 58071, { place: 1, kills: 8, matchId: "gap", build: v610, team: ["ann"] }, between), [], "between the times: no score");
  assert.deepEqual(payoutsDue(store.get(event.id), "ann"), [], "6 points: not yet");
  store.recordResult("ann", 58071, { place: 9, kills: 0, matchId: "a2", build: v610, team: ["ann"] }, during2);
  store.recordResult("bob", 58071, { place: 2, kills: 0, matchId: "b1", build: v610, team: ["bob"] }, during2);
  const saved = store.get(event.id);
  assert.deepEqual(saved.players.ann.matches.map(({ matchId, window }) => [matchId, window]), [["a1", w1], ["a2", w2]]);

  // The game: a history for each window, its own matches and points (the match HUD's running total starts from it).
  assert.deepEqual(historiesOf(saved, "ann").map(({ eventWindowId, matchIds, payload }) => [eventWindowId, matchIds, payload.pointsEarned]),
    [[w1, ["a1"], 6], [w2, ["a2"], 1]]);
  assert.deepEqual(eventWindowHistory("ann", w2, v610, during2, store).map(({ eventWindowId, payload }) => [eventWindowId, payload.pointsEarned]), [[w2, 1]]);
  assert.deepEqual(eventWindowHistory("ann", w1, v610, during2, store).map(({ matchIds }) => matchIds), [["a1"]]);
  assert.deepEqual(eventWindowHistory("bob", w1, v610, during2, store), []);
  assert.deepEqual(tournamentAndHistory("ann", v610, during2, store).eventWindowHistories.map(({ eventWindowId }) => eventWindowId), [w1, w2]);

  // The panel: one leaderboard of every time's matches, and the prizes by it (#361): 6 + 1 reaches the 7-point prize.
  assert.deepEqual(leaderboardOf(saved).map(({ accountId, points, matches, rank }) => [accountId, points, matches, rank]), [["ann", 7, 2, 1], ["bob", 2, 1, 2]]);
  assert.deepEqual(payoutsDue(saved, "ann").map(payoutKey), ["value:7"]);
  assert.deepEqual(payoutsDue(saved, "ann", { final: true }).map(payoutKey), ["value:7", "rank:1"]);
}));

test("placement prizes are given at the last time's end, not at the first's or in the gap between (#364)", () => withStore((store) => {
  let clock = at("2026-11-20T19:00:00.000Z");
  const timers = [];
  const settled = [];
  const context = { tournaments: { ...store, markSettled: (id, when) => { settled.push(id); return store.markSettled(id, when); } } };
  const event = store.create({ playlist: "showdownSolo", windows: [day1, day2], payoutTable: [{ scoringType: "rank", threshold: 1, vbucks: 5 }] }, created);
  const settler = createPayoutSettler(context, { now: () => clock, setTimer: (run, ms) => { timers.push({ run, ms }); return timers.length; }, clearTimer: () => {} });
  assert.equal(settler.schedule(), Date.parse(day2.endsAt), "the timer waits for the last time's end");
  assert.equal(timers.at(-1).ms, Date.parse(day2.endsAt) - clock.getTime() + 1);
  clock = at("2026-11-20T21:00:00.001Z");
  assert.equal(settleEvent(context, event.id, clock), false, "the first time's end isn't the event's");
  settler.schedule();
  assert.deepEqual(settled, []);
  clock = at("2026-11-21T21:00:00.001Z");
  timers.at(-1).run();
  assert.deepEqual(settled, [event.id]);
  assert.ok(store.get(event.id).payoutsSettledAt);
  // Settled, its times are final: a time added now would come after its prizes.
  assert.throws(() => store.setWindows(event.id, [...store.get(event.id).windows, day3]), /prizes were given/);
}));

test("the ticket's window must be the one running; between two times the tournament isn't active (#364)", () => withStore((store) => {
  const event = store.create({ name: "Two Day Cup", playlist: "showdownSolo", windows: [day1, day2] }, created);
  const [w1, w2] = event.windows.map(({ id }) => id);
  const code = (windowId, when, tournamentId = event.id) => {
    const answer = showdownTicket({ playlistId: 58071, tournamentId, windowId, partySize: 1, build: v610 }, at(when), store);
    return answer.error?.code?.split(".").pop() ?? answer.event.id;
  };
  assert.equal(code(w1, "2026-11-20T19:00:00.000Z"), event.id);
  assert.equal(code(w2, "2026-11-20T19:00:00.000Z"), "event_window_time_invalid", "the next time's window isn't open yet");
  assert.equal(code("nope", "2026-11-20T19:00:00.000Z"), "invalid_event_window_id");
  assert.equal(code(w1, "2026-11-21T12:00:00.000Z"), "event_window_time_invalid");
  assert.equal(code("", "2026-11-21T12:00:00.000Z", ""), "event_window_time_invalid", "a ticket naming none, between the times");
  assert.equal(code(w2, "2026-11-21T19:00:00.000Z"), event.id);
  assert.equal(code(w1, "2026-11-21T19:00:00.000Z"), "event_window_time_invalid", "the first time is over");
  assert.equal(code("", "2026-11-21T19:00:00.000Z", ""), event.id);
}));

test("the lobby's current event goes by window, and the lobbies are told at each time's start and end (#364)", () => withStore((store) => {
  const twoDay = store.create({ name: "Two Day Cup", playlist: "showdownSolo", windows: [day1, day3] }, created);
  const middle = store.create({ name: "Middle Cup", playlist: "showdownDuos", ...day2 }, created);
  assert.equal(currentShowdownEvent(v610, at("2026-11-20T19:00:00.000Z"), store).id, twoDay.id);
  assert.equal(currentShowdownEvent(v610, at("2026-11-20T22:00:00.000Z"), store).id, middle.id, "after its first time, the event whose time comes next");
  assert.equal(currentShowdownEvent(v610, at("2026-11-21T22:00:00.000Z"), store).id, twoDay.id, "then its second time");
  assert.equal(currentShowdownEvent(v610, at("2026-11-22T22:00:00.000Z"), store), null);

  let clock = created.getTime();
  const timers = [];
  const sent = [];
  const refresh = createShowdownRefresh({ store, xmpp: { onlineAccounts: () => [{ accountId: "ann" }], notify: (accountId) => sent.push(accountId) },
    accounts: { get: () => ({ lastBuild: v610 }) }, now: () => new Date(clock),
    setTimer: (run, delay) => { const timer = { run, delay }; timers.push(timer); return timer; }, clearTimer: () => {} });
  // Each timer fires a second after its edge, tells the lobby and sets the next (schedule()'s delay is to it, plus that
  // second).
  const edges = [];
  let edge = refresh.schedule();
  while (edge !== null && edges.length < 10) {
    edges.push(new Date(edge).toISOString());
    clock = edge + 1000;
    const timer = timers.at(-1);
    timer.run();
    edge = timers.at(-1) === timer ? null : clock + timers.at(-1).delay - 1000;
  }
  assert.deepEqual(edges, [day1.startsAt, day1.endsAt, day2.startsAt, day2.endsAt, day3.startsAt, day3.endsAt]);
  assert.equal(sent.length, 6);
}));

test("changing an event's times: an ongoing event takes new ones, a time with matches stays until the points are reset, an ended event keeps its times (#364)", () => withStore((store) => {
  const event = store.create({ name: "Core Cup", playlist: "showdownSolo", ...day1 }, created);
  const during1 = at("2026-11-20T19:00:00.000Z");
  store.recordResult("ann", 58071, { place: 1, kills: 0, matchId: "a1", build: v610, team: ["ann"] }, during1);
  // A second time added to an event that was played: its own time keeps the event's id, and the match stays in it.
  const added = store.setWindows(event.id, [{ id: event.id, ...day1 }, day2], during1);
  assert.equal(added.windows.length, 2);
  assert.equal(added.windows[0].id, event.id);
  assert.notEqual(added.windows[1].id, event.id);
  assert.deepEqual([added.startsAt, added.endsAt], [day1.startsAt, day2.endsAt]);
  assert.ok(added.windowsSetAt);
  assert.deepEqual(historiesOf(added, "ann").map(({ eventWindowId }) => eventWindowId), [event.id]);
  // Its times changed, and a third added; the content page is newer.
  const w2 = added.windows[1].id;
  store.setWindows(event.id, [{ id: event.id, ...day1 }, { id: w2, startsAt: "2026-11-21T17:00:00.000Z", endsAt: day2.endsAt }, day3], at("2026-11-20T19:05:00.000Z"));
  assert.deepEqual(windowsOf(store.get(event.id)).map(({ id, startsAt }) => [id === event.id ? "own" : id === w2 ? "w2" : "new", startsAt]),
    [["own", day1.startsAt], ["w2", "2026-11-21T17:00:00.000Z"], ["new", day3.startsAt]]);
  assert.equal(tournamentInformationFor(v610, during1, store).lastModified, "2026-11-20T19:05:00.000Z");
  // The played time can't go until its matches do.
  assert.throws(() => store.setWindows(event.id, [{ id: w2, ...day2 }]), /Time 1 had 1 match played in it: reset/);
  assert.throws(() => store.setWindows(event.id, [{ id: "elsewhere", ...day2 }]), /no time elsewhere/);
  store.reset(event.id);
  // Removed, and the one time left is a new one: it takes the event's id again, kept as the event's own start and end.
  const single = store.setWindows(event.id, [day2]);
  assert.equal(Object.hasOwn(single, "windows"), false);
  assert.deepEqual(windowsOf(single), [{ id: event.id, ...day2 }]);
  assert.equal(store.setWindows("nope", [day1]), null);
  // Ended by the admin: final.
  store.end(event.id, during1);
  assert.throws(() => store.setWindows(event.id, [day3]), /ended event keeps its times/);
}));

test("an event of several times ended by the admin: the time running then ends then, the ones not begun are left out (#364)", () => withStore((store) => {
  const during2 = at("2026-11-21T19:30:00.000Z");
  const event = store.create({ name: "Three Day Cup", playlist: "showdownSolo", windows: [day1, day2, day3] }, created);
  const [w1, w2] = event.windows.map(({ id }) => id);
  store.end(event.id, during2);
  const ended = store.get(event.id);
  assert.deepEqual(eventWindowsOf(ended), [{ id: w1, ...{ beginTime: day1.startsAt, endTime: day1.endsAt } }, { id: w2, beginTime: day2.startsAt, endTime: during2.toISOString() }]);
  assert.equal(tournamentOf(ended).endTime, during2.toISOString());
  assert.equal(statusOf(ended, during2), "ended");
  // Ended between two times: the last one played keeps its own end.
  const other = store.create({ name: "Gap Cup", playlist: "showdownDuos", windows: [day1, day2] }, created);
  store.end(other.id, at("2026-11-21T12:00:00.000Z"));
  assert.deepEqual(eventWindowsOf(store.get(other.id)).map(({ endTime }) => endTime), [day1.endsAt]);
  // Ended before it began: its first time stays listed, ending then, as an event of one time always did.
  const early = store.create({ name: "Early Cup", playlist: "showdownSquads", windows: [day2, day3] }, created);
  store.end(early.id, at("2026-11-16T00:00:00.000Z"));
  assert.deepEqual(eventWindowsOf(store.get(early.id)).map(({ id, endTime }) => [id, endTime]), [[early.id, "2026-11-16T00:00:00.000Z"]]);
}));

const agent610 = `Fortnite/++Fortnite+Release-6.10-CL-${v610} Windows/10.0.19045.1.256.64bit`;
const as610 = (port, urlPath, token) => send({ host: "127.0.0.1", port, method: "GET", path: urlPath,
  headers: { "User-Agent": agent610, ...(token ? { Authorization: `bearer ${token}` } : {}) } });

test("the admin panel's times: an event made with several, one added, changed and removed; the game lists each (#364)", async () => {
  const backend = await startBackend();
  try {
    const hour = 60 * 60 * 1000;
    const iso = (ms) => new Date(ms).toISOString();
    const now = Date.now();
    const first = { startsAt: iso(now - hour), endsAt: iso(now + hour) };
    const second = { startsAt: iso(now + 24 * hour), endsAt: iso(now + 27 * hour) };
    const third = { startsAt: iso(now + 48 * hour), endsAt: iso(now + 51 * hour) };
    const made = await post(backend.port, "/admin/api/tournaments", undefined, { name: "Weekend Cup", playlist: "showdownSolo", windows: [second, first] });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.maxWindows, 16);
    const eventId = made.body.event.id;
    assert.deepEqual(made.body.event.windows.map(({ startsAt, status, matches }) => [startsAt, status, matches]), [[first.startsAt, "running", 0], [second.startsAt, "scheduled", 0]]);
    assert.equal(made.body.event.windows[0].id, eventId);
    assert.equal(made.body.event.status, "running");

    // A match in the first time, reported by the game server.
    const ann = await userLogin(backend.port, "WindowsAnn");
    const serverToken = await dedicatedServerToken(backend.port);
    const text = JSON.stringify({ playlistId: 58071, matchId: "0123456789abcdef0123456789abcdef", results: [{ accountId: ann.accountId, place: 1, kills: 7, secondsAlive: 900 }] });
    const report = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/fortnite/api/game/v2/battleroyale/recordresults", headers: {
      "User-Agent": "Core V2", Authorization: `bearer ${serverToken}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    assert.equal(report.status, 200, JSON.stringify(report.body));

    // The game's list: one tournament of two windows, the history in the first.
    const base = "/fortnite/api/game/v2/events";
    const listed = (await as610(backend.port, `${base}/tournamentandhistory/${ann.accountId}/NAE/WindowsClient`, ann.token)).body;
    assert.equal(listed.eventTournaments.length, 1);
    const windowIds = listed.eventTournaments[0].eventWindows.map(({ eventWindowId }) => eventWindowId);
    assert.deepEqual(listed.eventTournaments[0].eventWindows.map(({ beginTime, endTime }) => [beginTime, endTime]), [[first.startsAt, first.endsAt], [second.startsAt, second.endsAt]]);
    assert.deepEqual(listed.eventWindowHistories.map(({ eventWindowId, payload }) => [eventWindowId, payload.pointsEarned]), [[eventId, 6]]);
    assert.deepEqual((await as610(backend.port, `${base}/eventwindowhistory/${ann.accountId}/${windowIds[1]}`, ann.token)).body, []);

    // Add a third time and move the second; the first has a match, so it can't go.
    const changed = await post(backend.port, `/admin/api/tournaments/${eventId}/windows`, undefined, { windows: [
      { id: eventId, ...first }, { id: windowIds[1], startsAt: iso(now + 25 * hour), endsAt: second.endsAt }, third] });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.deepEqual(changed.body.event.windows.map(({ startsAt, matches }) => [startsAt, matches]), [[first.startsAt, 1], [iso(now + 25 * hour), 0], [third.startsAt, 0]]);
    assert.equal(changed.body.event.endsAt, third.endsAt);
    const refused = await post(backend.port, `/admin/api/tournaments/${eventId}/windows`, undefined, { windows: [{ id: windowIds[1], ...second }] });
    assert.equal(refused.status, 400);
    assert.match(JSON.stringify(refused.body), /reset the event's points/);
    const overlapping = await post(backend.port, `/admin/api/tournaments/${eventId}/windows`, undefined, { windows: [{ id: eventId, ...first }, { startsAt: first.startsAt, endsAt: third.endsAt }] });
    assert.equal(overlapping.status, 400);
    assert.equal((await post(backend.port, "/admin/api/tournaments/nope/windows", undefined, { windows: [first] })).status, 404);
    // Remove the third again.
    const removed = await post(backend.port, `/admin/api/tournaments/${eventId}/windows`, undefined, { windows: changed.body.event.windows.slice(0, 2)
      .map(({ id, startsAt, endsAt }) => ({ id, startsAt, endsAt })) });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.body.event.windows.length, 2);

    // The content page's tile has the span and the sessions.
    const page = (await as610(backend.port, "/content/api/pages/fortnite-game", ann.token)).body;
    assert.match(page.tournamentinformation.tournament_info.tournaments[0].schedule_info, /, 2 sessions$/);
    assert.equal((await get(backend.port, `/admin/api/tournaments/${eventId}`)).body.windows.length, 2);
  } finally {
    backend.close();
  }
});
