import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { showdownTicket, showdownTiers, tournamentAndHistory, tournamentInformationFor, tournamentOf, eventWindowHistory } from "../src/tournaments/showdown.js";
import { createTournamentStore, invitedFrom, leaderboardOf, matchPoints, rulesets, scoringOf, validateDisplay, validateQualifier } from "../src/tournaments/store.js";
import { createWinterRoyale, winterRoyaleImages, winterRoyaleQualifiersDisplay, winterRoyaleSchedule } from "../src/tournaments/winterroyale.js";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #383: Season 7's tournaments. 7.00 to 7.20 have 6.10's Events tab (FShowdownEventDownload and
// FShowdownTournamentData unchanged, no eligibility or tokens): an event's own texts and colours, invite-only finals for a
// qualifier's best, the best session counting, and Epic's Winter Royale of 2018.
const v610 = "4480234";
const v700 = "4629139";
const v710 = "4667333";
const v720 = "4727874";
const at = (iso) => new Date(iso);
const created = at("2026-11-15T12:00:00.000Z");

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-383-"));
  try {
    return run(createTournamentStore(dataDir), dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
const entryOf = (build, now, store, id) => tournamentInformationFor(build, now, store).tournament_info.tournaments.find((entry) => entry.tournament_display_id === id);

test("an event's own texts and colours go over Core's in the content page's entry, field by field, on 6.10 to 7.20 (#383)", () => withStore((store) => {
  const plain = store.create({ name: "Core Cup", playlist: "showdownSolo", pinScore: 10 }, created);
  const before = entryOf(v700, created, store, plain.id);
  const event = store.create({ name: "Winter Cup", playlist: "showdownSolo", pinScore: 25,
    display: { title_line_1: "WINTER", schedule_info: "$1,000,000 in Prizes", short_format_title: "Qualifying Sessions", pin_earned_text: "Top Competitor! Keep Going!",
      title_color: "#58fe85", background_text_color: "2D7EFCFF", flavor_description: "" } }, created);
  assert.deepEqual(event.display, { title_line_1: "WINTER", schedule_info: "$1,000,000 in Prizes", short_format_title: "Qualifying Sessions",
    pin_earned_text: "Top Competitor! Keep Going!", title_color: "58FE85", background_text_color: "2D7EFCFF" }, "colours without # in upper case, an empty field left out");
  for (const build of [v610, v700, v710, v720]) {
    const entry = entryOf(build, created, store, event.id);
    assert.equal(entry.title_line_1, "WINTER", build);
    assert.equal(entry.title_line_2, "Solo", "Core's own where none is set");
    assert.equal(entry.schedule_info, "$1,000,000 in Prizes");
    assert.equal(entry.short_format_title, "Qualifying Sessions");
    assert.equal(entry.long_format_title, "Winter Cup (Solo)");
    assert.equal(entry.flavor_description, "Solo tournament");
    assert.equal(entry.pin_score_requirement, 25);
    assert.equal(entry.pin_earned_text, "Top Competitor! Keep Going!");
    assert.equal(entry.title_color, "58FE85");
    assert.equal(entry.background_text_color, "2D7EFCFF");
    assert.equal(entry.base_color, "FFFFFF");
    assert.equal(entry._type, "Tournament Display Info");
  }
  // An event without its own is served as before.
  assert.deepEqual(entryOf(v700, created, store, plain.id), before);
  assert.equal(before.pin_earned_text, "Pin earned!");
  // Without a pin, no pin text either.
  store.setDisplay(plain.id, { pin_earned_text: "Pinned" }, at("2026-11-15T13:00:00.000Z"));
  const pinless = store.create({ name: "No Pin Cup", playlist: "showdownDuos", display: { pin_earned_text: "Pinned" } }, created);
  assert.equal(Object.hasOwn(entryOf(v700, created, store, pinless.id), "pin_earned_text"), false);
  assert.equal(entryOf(v700, created, store, plain.id).pin_earned_text, "Pinned");
  assert.equal(tournamentInformationFor(v700, created, store).lastModified, "2026-11-15T13:00:00.000Z", "a change of texts is a change of the page");
  // Back to Core's own.
  store.setDisplay(plain.id, null);
  assert.equal(Object.hasOwn(store.get(plain.id), "display"), false);
  assert.deepEqual(entryOf(v700, created, store, plain.id), before);
  // Only an in-game event has them.
  const comp = store.create({ name: "Solo Showdown", playlist: "soloShowdown", display: { title_line_1: "X" } }, created);
  assert.equal(Object.hasOwn(comp, "display"), false);
  assert.throws(() => store.setDisplay(comp.id, { title_line_1: "X" }), /Events tab/);
  for (const [bad, reason] of [
    [{ nope: "x" }, /No text or colour nope/],
    [{ title_color: "green" }, /RRGGBB/],
    [{ title_color: "12345" }, /RRGGBB/],
    [{ title_line_1: 5 }, /is text/],
    [{ details_description: "x".repeat(1001) }, /at most 1000/],
    [[], /Texts and colours/]
  ]) assert.throws(() => validateDisplay(bad), reason, JSON.stringify(bad));
}));

test("a ruleset whose best window counts ranks each player by their best session, not their sum (#383)", () => withStore((store) => {
  const sessions = [{ startsAt: "2026-11-20T18:00:00.000Z", endsAt: "2026-11-20T21:00:00.000Z" }, { startsAt: "2026-11-21T18:00:00.000Z", endsAt: "2026-11-21T21:00:00.000Z" }];
  const event = store.create({ name: "Best Of", playlist: "showdownSolo", ruleset: "winterRoyale2018Qualifiers", windows: sessions }, created);
  const [w1, w2] = event.windows.map(({ id }) => id);
  const play = (accountId, iso, place, kills, matchId) => store.recordResult(accountId, 58071, { place, kills, matchId, build: v700, team: [accountId] }, at(iso));
  // Ann: 5 + 1 in the first session (6), 8 in the second.
  play("ann", "2026-11-20T19:00:00.000Z", 1, 0, "a1");
  play("ann", "2026-11-20T20:00:00.000Z", 9, 0, "a2");
  play("ann", "2026-11-21T19:00:00.000Z", 1, 7, "a3");
  // Bob: 7 in one session.
  play("bob", "2026-11-20T19:30:00.000Z", 1, 3, "b1");
  play("bob", "2026-11-20T19:45:00.000Z", 50, 3, "b2");
  const board = leaderboardOf(store.get(event.id));
  assert.deepEqual(board.map(({ accountId, rank, points, matches, wins, eliminations, bestWindow }) => [accountId, rank, points, matches, wins, eliminations, bestWindow]),
    [["ann", 1, 8, 1, 1, 7, w2], ["bob", 2, 7, 2, 1, 6, w1]]);
  // The game still shows each window's own points.
  const histories = tournamentAndHistory("ann", v700, at("2026-11-21T20:00:00.000Z"), store).eventWindowHistories;
  assert.deepEqual(histories.map(({ eventWindowId, payload }) => [eventWindowId, payload.pointsEarned]), [[w1, 6], [w2, 8]]);
  // Other rulesets still add every match up.
  assert.equal(rulesets.inGameOctober2018.bestWindow, undefined);
  const summed = store.create({ name: "Sum", playlist: "showdownSolo", windows: sessions }, created);
  store.recordResult("ann", 58071, { place: 1, kills: 0, matchId: "s1", build: v700 }, at("2026-11-20T19:00:00.000Z"));
  store.recordResult("ann", 58071, { place: 1, kills: 0, matchId: "s2", build: v700 }, at("2026-11-21T19:00:00.000Z"));
  assert.equal(leaderboardOf(store.get(summed.id))[0].points, 6);
  assert.equal(Object.hasOwn(leaderboardOf(store.get(summed.id))[0], "bestWindow"), false);
}));

test("an invite-only event: listed, queued and scored only for its qualifier's top players once the qualifier is over (#383)", () => withStore((store) => {
  const qualifierEnd = "2026-11-20T21:00:00.000Z";
  const qualifier = store.create({ name: "Qualifier", playlist: "showdownSolo", startsAt: "2026-11-20T18:00:00.000Z", endsAt: qualifierEnd }, created);
  const finals = store.create({ name: "Finals", playlist: "showdownSolo", startsAt: "2026-11-22T18:00:00.000Z", endsAt: "2026-11-22T21:00:00.000Z",
    qualifier: { eventId: qualifier.id, places: 2 } }, created);
  assert.deepEqual(finals.qualifier, { eventId: qualifier.id, places: 2 });
  // Ann wins (3), Bob and Cal tie on Top 3 (2 each, the same wins, eliminations and placement), Dee is 10th (1).
  const play = (accountId, place, matchId) => store.recordResult(accountId, 58071, { place, kills: 0, matchId, build: v700, team: [accountId] }, at("2026-11-20T19:00:00.000Z"));
  play("ann", 1, "m1");
  play("bob", 3, "m2");
  play("cal", 3, "m3");
  play("dee", 10, "m4");
  assert.equal(store.get(finals.id).players.ann, undefined, "the qualifier's matches don't score in the finals");
  const during = at("2026-11-20T20:00:00.000Z");
  assert.equal(store.invitedTo(store.get(finals.id), during).size, 0, "nobody is invited while the qualifier runs");
  const listed = (accountId, now) => tournamentAndHistory(accountId, v700, now, store).eventTournaments.map(({ tournamentId }) => tournamentId);
  assert.deepEqual(listed("ann", during), [qualifier.id]);

  const after = at("2026-11-22T19:00:00.000Z");
  assert.deepEqual([...store.invitedTo(store.get(finals.id), after)].sort(), ["ann", "bob", "cal"], "the top 2 places, a tie sharing the second");
  assert.deepEqual(invitedFrom(store.get(qualifier.id), 1, after), new Set(["ann"]));
  for (const accountId of ["ann", "bob", "cal"]) assert.deepEqual(listed(accountId, after), [qualifier.id, finals.id], accountId);
  assert.deepEqual(listed("dee", after), [qualifier.id], "the 4th has no finals");
  // The content page is the same for everyone: the finals' entry is there.
  assert.ok(entryOf(v700, after, store, finals.id));
  // History of the finals' window: the invited only.
  assert.deepEqual(eventWindowHistory("ann", finals.id, v700, after, store), []);
  assert.equal(eventWindowHistory("dee", finals.id, v700, after, store), null);

  // Tickets: an invited player alone; a party with someone not invited, or a player not invited, as a tournament that doesn't exist.
  const ticket = (accountIds, partySize = 1) => showdownTicket({ playlistId: 58071, tournamentId: finals.id, windowId: finals.id, partySize, build: v700, accountIds }, after, store);
  assert.equal(ticket(["ann"]).event.id, finals.id);
  assert.equal(ticket(["dee"]).error.code, "errors.com.epicgames.fortnite.invalid_tournament_id");
  assert.equal(ticket(["ann", "dee"]).error.code, "errors.com.epicgames.fortnite.invalid_tournament_id");
  assert.equal(showdownTicket({ playlistId: 58071, partySize: 1, build: v700 }, after, store).event.id, finals.id, "a ticket naming no party is checked as before");

  // Scores: the invited only.
  assert.deepEqual(store.recordResult("ann", 58071, { place: 1, kills: 0, matchId: "f1", build: v700 }, after).map(({ eventId }) => eventId), [finals.id]);
  assert.deepEqual(store.recordResult("dee", 58071, { place: 1, kills: 0, matchId: "f2", build: v700 }, after), []);

  // Open to everyone again, and invite only again.
  store.setQualifier(finals.id, null);
  assert.deepEqual(listed("dee", after), [qualifier.id, finals.id]);
  store.setQualifier(finals.id, { eventId: qualifier.id, places: 1 });
  assert.deepEqual(listed("bob", after), [qualifier.id]);
  // A deleted qualifier invites nobody.
  store.remove(qualifier.id);
  assert.deepEqual(listed("ann", after), []);
}));

test("a qualifier is checked: an event that exists, 1 to 1000 places, never the event itself down a chain (#383)", () => withStore((store) => {
  const a = store.create({ name: "A", playlist: "showdownSolo" }, created);
  const b = store.create({ name: "B", playlist: "showdownSolo", qualifier: { eventId: a.id, places: 10 } }, created);
  const c = store.create({ name: "C", playlist: "showdownSolo", qualifier: { eventId: b.id, places: 5 } }, created);
  assert.equal(validateQualifier(null), null);
  assert.throws(() => store.create({ playlist: "showdownSolo", qualifier: { eventId: "nope", places: 1 } }), /No tournament event nope/);
  assert.throws(() => store.create({ playlist: "showdownSolo", qualifier: { eventId: a.id, places: 0 } }), /1 to 1000/);
  assert.throws(() => store.create({ playlist: "showdownSolo", qualifier: { eventId: a.id, places: 1001 } }), /1 to 1000/);
  assert.throws(() => store.create({ playlist: "showdownSolo", qualifier: [a.id] }), /eventId, places/);
  assert.throws(() => store.setQualifier(a.id, { eventId: a.id, places: 1 }), /itself/);
  assert.throws(() => store.setQualifier(a.id, { eventId: c.id, places: 1 }), /itself/, "A from C from B from A");
  assert.equal(store.setQualifier("nope", null), null);
  assert.equal(Object.hasOwn(store.get(a.id), "qualifier"), false);
}));

test("Epic's Winter Royale: its schedules on Epic's own dates, ET and GMT as in 2018, or moved whole days (#383)", () => {
  const nae = winterRoyaleSchedule("NAE");
  assert.deepEqual(nae.qualifiers.map(({ startsAt, endsAt }) => [startsAt, endsAt]), [
    ["2018-11-24T18:00:00.000Z", "2018-11-24T21:00:00.000Z"], ["2018-11-24T22:00:00.000Z", "2018-11-25T01:00:00.000Z"], ["2018-11-25T02:00:00.000Z", "2018-11-25T05:00:00.000Z"],
    ["2018-11-25T18:00:00.000Z", "2018-11-25T21:00:00.000Z"], ["2018-11-25T22:00:00.000Z", "2018-11-26T01:00:00.000Z"], ["2018-11-26T02:00:00.000Z", "2018-11-26T05:00:00.000Z"]],
  "1 PM-4 PM, 5 PM-8 PM and 9 PM-12 AM ET on 24 and 25 November");
  assert.deepEqual(nae.finals.map(({ startsAt, endsAt }) => [startsAt, endsAt]), [["2018-12-11T20:00:00.000Z", "2018-12-11T23:00:00.000Z"], ["2018-12-12T00:00:00.000Z", "2018-12-12T03:00:00.000Z"]],
    "Heat 1 3 PM-6 PM and Heat 2 7 PM-10 PM ET on 11 December");
  assert.deepEqual(nae.grandFinals.map(({ startsAt, endsAt }) => [startsAt, endsAt]), [["2018-12-12T22:00:00.000Z", "2018-12-13T02:00:00.000Z"]], "5 PM-9 PM ET on 12 December");
  const eu = winterRoyaleSchedule("EU");
  assert.deepEqual(eu.qualifiers.map(({ startsAt }) => startsAt.slice(0, 16)), ["2018-11-24T10:00", "2018-11-24T14:00", "2018-11-24T18:00", "2018-11-25T10:00", "2018-11-25T14:00", "2018-11-25T18:00"]);
  assert.deepEqual(eu.finals.map(({ startsAt, endsAt }) => [startsAt.slice(0, 16), endsAt.slice(0, 16)]), [["2018-11-30T16:00", "2018-11-30T19:00"], ["2018-11-30T20:00", "2018-11-30T23:00"]]);
  assert.deepEqual(eu.grandFinals.map(({ startsAt, endsAt }) => [startsAt.slice(0, 16), endsAt.slice(0, 16)]), [["2018-12-01T17:00", "2018-12-01T21:00"]]);
  // Moved to start on Saturday 5 December 2026: the same days apart and times of day.
  const moved = winterRoyaleSchedule("NAE", "2026-12-05");
  assert.equal(moved.qualifiers[0].startsAt, "2026-12-05T18:00:00.000Z");
  assert.equal(moved.qualifiers[5].endsAt, "2026-12-07T05:00:00.000Z");
  assert.equal(moved.finals[0].startsAt, "2026-12-22T20:00:00.000Z");
  assert.equal(moved.grandFinals[0].endsAt, "2026-12-24T02:00:00.000Z");
  assert.throws(() => winterRoyaleSchedule("OCE", "2026-12-05"), /regions/);
  assert.throws(() => winterRoyaleSchedule("NAE", "next week"), /YYYY-MM-DD/);
  assert.throws(() => winterRoyaleSchedule("NAE", "2026-13-40"), /YYYY-MM-DD/);
});

test("Epic's Winter Royale made: qualifiers with Epic's entry, points and best session, finals for the top 200, Grand Finals for the top 100 (#383)", () => withStore((store) => {
  const { qualifiers, finals, grandFinals } = createWinterRoyale(store, { region: "NAE", firstDay: "2026-12-05" }, created);
  assert.deepEqual([qualifiers.name, finals.name, grandFinals.name], ["Winter Royale Qualifiers (NA East)", "Winter Royale Finals (NA East)", "Winter Royale Grand Finals (NA East)"]);
  assert.deepEqual([qualifiers.playlist, finals.playlist, grandFinals.playlist], ["showdownSolo", "showdownSolo", "showdownSolo"]);
  assert.equal(qualifiers.windows.length, 6);
  assert.equal(finals.windows.length, 2);
  assert.equal(Object.hasOwn(grandFinals, "windows"), false, "one time");
  assert.deepEqual([grandFinals.startsAt, grandFinals.endsAt], ["2026-12-23T22:00:00.000Z", "2026-12-24T02:00:00.000Z"]);
  assert.deepEqual(finals.qualifier, { eventId: qualifiers.id, places: 200 });
  assert.deepEqual(grandFinals.qualifier, { eventId: finals.id, places: 100 });
  assert.equal(qualifiers.qualifier, undefined);

  // The qualifiers' entry is Epic's (the reporter's copy of winter_royale_qual), on every Season 7 build.
  for (const build of [v700, v710, v720]) {
    const entry = entryOf(build, created, store, qualifiers.id);
    assert.deepEqual({ ...entry, tournament_display_id: "winter_royale_qual" }, {
      tournament_display_id: "winter_royale_qual",
      background_text_color: "2D7EFC",
      poster_back_image: "https://cdn2.unrealengine.com/Fortnite%2Ffortnite-game%2Ftournaments%2FWinterRoyale_Solo_Back-750x1080-a2981671e815c953302121f460d93fe811ba7b12.jpg",
      flavor_description: "Play in the Winter Royale Qualifiers!  Players with the top score during any qualifying session will be invited to the Winter Royale Finals to play for $1,000,000 in prizes.",
      poster_front_image: "https://cdn2.unrealengine.com/Fortnite%2Ffortnite-game%2Ftournaments%2FWinterRoyale_Solo_Front-750x1080-f041e3551d0f764455b1b59e5d5b352736e7bd82.jpg",
      short_format_title: "Qualifying Sessions",
      title_line_2: "ROYALE",
      title_line_1: "WINTER",
      details_description: "Score points by eliminating multiple opponents and surviving against the competition! Players with the Top 200 scores will be invited to compete in the Winter Royale Finals. Only your highest scoring Qualifying Session will count toward your score. Earning a pin does not affect qualification for the Winter Royale Finals. Full rules and eligibility details can be found on www.fortnite.com/esports.",
      long_format_title: "Winter Royale Qualifiers",
      poster_fade_color: "AAFBF6",
      secondary_color: "001F8B",
      pin_score_requirement: 25,
      title_color: "58FE85",
      loading_screen_image: "https://cdn2.unrealengine.com/Fortnite%2Ffortnite-game%2Ftournaments%2FModeTile_WinterRoyale-1024x512-75547d897a08a35eeecc9c18c7e63515a1b7e439.jpg",
      background_right_color: "070B83",
      _type: "Tournament Display Info",
      pin_earned_text: "Top Competitor! Keep Going!",
      highlight_color: "6DFDFF",
      schedule_info: "$1,000,000 in Prizes",
      primary_color: "6DFDFF",
      shadow_color: "124EA8",
      background_left_color: "0E60BC",
      playlist_tile_image: "https://cdn2.unrealengine.com/Fortnite%2Ffortnite-game%2Ftournaments%2FModeTile_WinterRoyale-1024x512-75547d897a08a35eeecc9c18c7e63515a1b7e439.jpg",
      base_color: "FFFFFF"
    }, build);
  }
  assert.deepEqual(qualifiers.images, winterRoyaleImages);
  assert.deepEqual(qualifiers.display, winterRoyaleQualifiersDisplay);
  // The finals have no entry of Epic's: Core's own texts.
  assert.equal(entryOf(v700, created, store, finals.id).title_line_1, "Winter Royale Finals (NA East)");

  // The qualifiers' points: Victory Royale +3, Top 3 +1, Top 10 +1; 3, 5 and 7 eliminations +1 each; the client's tiers.
  const qualifierRules = scoringOf(qualifiers);
  assert.equal(matchPoints(qualifierRules, { place: 1, kills: 7 }), 8);
  assert.equal(matchPoints(qualifierRules, { place: 3, kills: 4 }), 3);
  assert.equal(matchPoints(qualifierRules, { place: 11, kills: 2 }), 0);
  assert.equal(qualifierRules.bestWindow, true);
  assert.deepEqual(showdownTiers(qualifiers), { placement: [{ keyValue: 1, pointsEarned: 3 }, { keyValue: 3, pointsEarned: 1 }, { keyValue: 10, pointsEarned: 1 }],
    eliminations: [{ keyValue: 3, pointsEarned: 1 }, { keyValue: 5, pointsEarned: 1 }, { keyValue: 7, pointsEarned: 1 }] });
  // The finals': Victory Royale 3, 2nd-3rd 2; 5-6 eliminations 2, 7+ 3, +1 for each after 7; five matches.
  const finalsRules = scoringOf(finals);
  assert.deepEqual([1, 2, 3, 4].map((place) => matchPoints(finalsRules, { place, kills: 0 })), [3, 2, 2, 0]);
  assert.deepEqual([4, 5, 6, 7, 8, 12].map((kills) => matchPoints(finalsRules, { place: 50, kills })), [0, 2, 2, 3, 4, 8]);
  assert.equal(finalsRules.countedMatches, 5);
  assert.equal(scoringOf(grandFinals).countedMatches, null);
  assert.equal(tournamentOf(finals).eventWindows[0].eventData.playlistId, "Playlist_Showdown_Solo");

  // A refusal keeps nothing: the store's last free places taken, the Grand Finals can't be made.
  assert.throws(() => createWinterRoyale(store, { region: "EU", firstDay: "soon" }), /YYYY-MM-DD/);
  const count = store.list().length;
  for (let i = count; i < 99; i += 1) store.create({ playlist: "showdownSolo" }, created);
  assert.throws(() => createWinterRoyale(store, { region: "EU", firstDay: "2026-12-05" }, created), /At most 100 events/);
  assert.equal(store.list().length, 99);
}));

const agent700 = `Fortnite/++Fortnite+Release-7.00-CL-${v700} Windows/10.0.19045.1.256.64bit`;
const as700 = (port, urlPath, token) => send({ host: "127.0.0.1", port, method: "GET", path: urlPath,
  headers: { "User-Agent": agent700, ...(token ? { Authorization: `bearer ${token}` } : {}) } });

test("the admin panel's Winter Royale, texts and colours, and invite only; 7.00's list and content page follow (#383)", async () => {
  const backend = await startBackend();
  try {
    const hour = 60 * 60 * 1000;
    const iso = (ms) => new Date(ms).toISOString();
    const made = await post(backend.port, "/admin/api/tournament-presets/winter-royale-2018", undefined, { region: "EU", firstDay: "2030-01-05" });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual(made.body.events.map(({ name }) => name), ["Winter Royale Qualifiers (Europe)", "Winter Royale Finals (Europe)", "Winter Royale Grand Finals (Europe)"]);
    const [qualifiers, finals] = made.body.events;
    assert.equal(qualifiers.windows[0].startsAt, "2030-01-05T10:00:00.000Z");
    assert.deepEqual(finals.qualifier, { eventId: qualifiers.id, places: 200, eventName: "Winter Royale Qualifiers (Europe)", invited: 0 });
    assert.equal(qualifiers.display.short_format_title, "Qualifying Sessions");
    assert.deepEqual(made.body.winterRoyale.regions.map(({ id }) => id), ["NAE", "EU"]);
    assert.ok(made.body.displayFields.texts.includes("short_format_title"));
    assert.equal(made.body.rulesets.find(({ id }) => id === "winterRoyale2018Qualifiers").bestWindow, true);
    assert.equal((await post(backend.port, "/admin/api/tournament-presets/winter-royale-2018", undefined, { region: "OCE", firstDay: "2030-01-05" })).status, 400);

    // An open event of now, its texts set, then invite only for the qualifiers' top 200 (nobody yet: they haven't run).
    const open = await post(backend.port, "/admin/api/tournaments", undefined, { name: "Now Cup", playlist: "showdownSolo", startsAt: iso(Date.now() - hour), endsAt: iso(Date.now() + hour) });
    const eventId = open.body.event.id;
    const shown = await post(backend.port, `/admin/api/tournaments/${eventId}/display`, undefined, { display: { schedule_info: "Duo", title_color: "#ff00ff" } });
    assert.equal(shown.status, 200, JSON.stringify(shown.body));
    assert.deepEqual(shown.body.event.display, { schedule_info: "Duo", title_color: "FF00FF" });
    assert.equal((await post(backend.port, `/admin/api/tournaments/${eventId}/display`, undefined, { display: { title_color: "pink" } })).status, 400);
    const ann = await userLogin(backend.port, "WindowsAnn");
    const page = (await as700(backend.port, "/content/api/pages/fortnite-game", ann.token)).body;
    const entry = page.tournamentinformation.tournament_info.tournaments.find((own) => own.tournament_display_id === eventId);
    assert.deepEqual([entry.schedule_info, entry.title_color], ["Duo", "FF00FF"]);
    assert.ok(page._images_.includes(qualifiers.images.posterFront), "Epic's pictures are precached");
    const base = "/fortnite/api/game/v2/events";
    const listed = async () => (await as700(backend.port, `${base}/tournamentandhistory/${ann.accountId}/NAE/WindowsClient`, ann.token)).body.eventTournaments.map(({ tournamentId }) => tournamentId);
    assert.ok((await listed()).includes(eventId));
    const invite = await post(backend.port, `/admin/api/tournaments/${eventId}/qualifier`, undefined, { qualifier: { eventId: qualifiers.id, places: 200 } });
    assert.equal(invite.status, 200, JSON.stringify(invite.body));
    assert.equal(invite.body.event.qualifier.invited, 0);
    assert.equal((await listed()).includes(eventId), false, "not invited: not listed");
    assert.equal((await post(backend.port, `/admin/api/tournaments/${eventId}/qualifier`, undefined, { qualifier: { eventId, places: 1 } })).status, 400);
    // A match reported for Ann doesn't score in it.
    const serverToken = await dedicatedServerToken(backend.port);
    const text = JSON.stringify({ playlistId: 58071, matchId: "0123456789abcdef0123456789abcdef", results: [{ accountId: ann.accountId, place: 1, kills: 0, secondsAlive: 900 }] });
    await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/fortnite/api/game/v2/battleroyale/recordresults", headers: {
      "User-Agent": "Core V2", Authorization: `bearer ${serverToken}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    const opened = await post(backend.port, `/admin/api/tournaments/${eventId}/qualifier`, undefined, { qualifier: null });
    assert.equal(opened.body.event.qualifier, null);
    assert.equal(opened.body.event.playerCount, 0, "the match while it was invite only didn't count");
    assert.ok((await listed()).includes(eventId));
  } finally {
    backend.close();
  }
});
