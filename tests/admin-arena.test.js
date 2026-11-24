import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { arenaEvents, arenaMatchPoints, arenaScoringOf, createArenaStore, divisionThresholds, divisionThresholdsOf, placementTiers, shownArenaLtmsOf } from "../src/tournaments/arena.js";
import { arenaDivisionHypeValue, arenaScoringValue, createSettingsStore, defaultArenaDivisionHype, defaultArenaScoring, sanitizeMatchmakingModes } from "../src/settings/store.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// The admin panel's Arena tab (Core-Backend #423): the players by Hype and their resets, the Hype each division takes to leave
// (settings arenaDivisionHype, read by tournaments/arena.js), and the Arena modes' switches (matchmakingModes arenaSolo and
// arenaDuos, on by default).
const v830 = "5793395";
const v740 = "5046157";
const agent830 = "Fortnite/++Fortnite+Release-8.30-CL-5793395 Windows/10.0.26200.1.256.64bit";
const admin = (backend, urlPath, body) => (body === undefined ? get(backend.port, `/admin/api${urlPath}`) : post(backend.port, `/admin/api${urlPath}`, undefined, body));
const idsOf = (events) => events.map((event) => event.eventId);

test("the Arena thresholds setting: defaults, validation and a round-trip through the settings file", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-arena-settings-"));
  try {
    const settings = createSettingsStore(dataDir);
    assert.deepEqual(settings.get().arenaDivisionHype, defaultArenaDivisionHype);
    assert.deepEqual(divisionThresholdsOf(settings.get()), divisionThresholds, "the defaults are arena.js's own");
    settings.update({ arenaDivisionHype: [10, 20, 30, 40, 50, 60] });
    assert.deepEqual(createSettingsStore(dataDir).get().arenaDivisionHype, [10, 20, 30, 40, 50, 60]);
    assert.deepEqual(divisionThresholdsOf(createSettingsStore(dataDir).get()), [10, 20, 30, 40, 50, 60, 2147483647]);
    // Not six, not rising, not whole numbers, out of range: the current ones stay.
    for (const bad of [[1, 2, 3], [10, 10, 30, 40, 50, 60], [10, 20, 30, 40, 50, 25], [1.5, 2, 3, 4, 5, 6], [0, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 1e9], "x", null, ["a", 2, 3, 4, 5, 6]]) {
      settings.update({ arenaDivisionHype: bad });
      assert.deepEqual(settings.get().arenaDivisionHype, [10, 20, 30, 40, 50, 60], JSON.stringify(bad));
    }
    assert.equal(arenaDivisionHypeValue(["1", "2", "3", "4", "5", "6"]).join(), "1,2,3,4,5,6");
    assert.equal(arenaDivisionHypeValue([6, 5, 4, 3, 2, 1], null), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the Arena modes' switches are on the settings' save list: on by default, kept when set", () => {
  const defaults = sanitizeMatchmakingModes({});
  assert.deepEqual([defaults.arenaSolo, defaults.arenaDuos], [true, true]);
  const hidden = sanitizeMatchmakingModes({ arenaSolo: false });
  assert.deepEqual([hidden.arenaSolo, hidden.arenaDuos], [false, true]);
  assert.equal(sanitizeMatchmakingModes({ arenaSolo: "no" }, hidden).arenaSolo, false, "a bad value keeps the current one");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-arena-modes-"));
  try {
    const settings = createSettingsStore(dataDir);
    settings.update({ matchmakingModes: { arenaDuos: false } });
    const loaded = createSettingsStore(dataDir).get().matchmakingModes;
    assert.deepEqual([loaded.arenaSolo, loaded.arenaDuos], [true, false]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a hidden Arena mode has no event, and a changed threshold is in the events and the Hype's division", () => {
  const call = { gameId: "Fortnite" };
  assert.deepEqual(idsOf(arenaEvents(v830, call, {}).events), ["epicgames_Arena_S8_Solo", "epicgames_Arena_S8_Duos"]);
  const soloHidden = { matchmakingModes: { arenaSolo: false } };
  assert.deepEqual(idsOf(arenaEvents(v830, call, soloHidden).events), ["epicgames_Arena_S8_Duos"]);
  assert.equal(arenaEvents(v830, call, soloHidden).templates.length, 7, "the templates go with their event");
  assert.deepEqual(arenaEvents(v830, call, { matchmakingModes: { arenaSolo: false, arenaDuos: false } }), { events: [], templates: [] });
  assert.deepEqual(shownArenaLtmsOf(v740, {}), [], "no Arena before 8.20");

  const own = { arenaDivisionHype: [10, 20, 30, 40, 50, 60] };
  const { events, templates } = arenaEvents(v830, call, own);
  assert.deepEqual(events[0].eventWindows.map((window) => window.metadata.ThresholdToAdvanceDivision), [10, 20, 30, 40, 50, 60, 2147483647]);
  assert.equal(templates[0].payoutTable[0].ranks[0].threshold, 10);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-arena-store-"));
  try {
    const store = createArenaStore(dataDir, () => divisionThresholdsOf(own));
    assert.equal(store.set("ann", 25).division, 2, "25 Hype is past the first two thresholds, 10 and 20");
    assert.equal(store.record("ann", { matchId: "m1", points: 10 }).division, 3, "35 is past 30");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the store lists the players and resets one or all, keeping the matches counted", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-arena-list-"));
  try {
    const store = createArenaStore(dataDir);
    assert.deepEqual(store.list(), []);
    store.record("ann", { matchId: "m1", points: 30 });
    store.set("bob", 80);
    assert.deepEqual(store.list().map(({ accountId, hype, division }) => [accountId, hype, division]).sort(), [["ann", 30, 1], ["bob", 80, 2]]);
    assert.equal(store.reset("nobody"), false);
    assert.equal(store.reset("ann"), true);
    assert.deepEqual([store.get("ann").hype, store.get("ann").division, store.get("ann").matches], [0, 0, ["m1"]]);
    assert.equal(store.record("ann", { matchId: "m1", points: 30 }), null, "a reset player's match isn't counted twice");
    assert.equal(store.resetAll(), 2);
    assert.deepEqual(store.list().map(({ hype, division }) => [hype, division]), [[0, 0], [0, 0]]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the admin Arena tab over HTTP: the leaderboard, the thresholds, the resets and a hidden mode", async () => {
  const backend = await startBackend();
  try {
    const panel = await get(backend.port, "/admin");
    assert.ok(panel.body.includes('data-view="arena"') && panel.body.includes("async function showArena"));

    const ann = await userLogin(backend.port, "ArenaAnn");
    const bob = await userLogin(backend.port, "ArenaBob");
    const cat = await userLogin(backend.port, "ArenaCat");
    const store = createArenaStore(backend.dataDir);
    store.set(ann.accountId, 30);
    store.set(bob.accountId, 130);
    store.set(cat.accountId, 5);

    const tab = await admin(backend, "/arena");
    assert.equal(tab.status, 200, JSON.stringify(tab.body));
    assert.deepEqual(tab.body.players.map((player) => [player.rank, player.displayName, player.hype, player.division]),
      [[1, "ArenaBob", 130, 4], [2, "ArenaAnn", 30, 2], [3, "ArenaCat", 5, 1]]);
    assert.deepEqual(tab.body.hypeToLeave, defaultArenaDivisionHype);
    assert.equal(tab.body.divisions.length, 7);
    assert.deepEqual(tab.body.modes.map((mode) => [mode.id, mode.shown]), [["arenaSolo", true], ["arenaDuos", true]]);

    // The thresholds: refused when unsound, saved and served in the events, back to the defaults on null.
    for (const bad of [[1, 2, 3], [5, 4, 6, 7, 8, 9], "x", undefined]) {
      assert.equal((await admin(backend, "/arena/thresholds", { hypeToLeave: bad })).status, 400, JSON.stringify(bad));
    }
    const saved = await admin(backend, "/arena/thresholds", { hypeToLeave: [10, 20, 30, 40, 50, 60] });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.hypeToLeave, [10, 20, 30, 40, 50, 60]);
    const download = (player) => send({ host: "127.0.0.1", port: backend.port, headers: { "User-Agent": agent830, Authorization: `bearer ${player.token}` },
      path: `/api/v1/events/Fortnite/download/${player.accountId}?region=NAE&platform=Windows&teamAccountIds=${player.accountId}` });
    const withOwn = await download(ann);
    assert.deepEqual(withOwn.body.events[0].eventWindows.map((window) => window.metadata.ThresholdToAdvanceDivision).slice(0, 3), [10, 20, 30]);
    assert.deepEqual((await admin(backend, "/arena/thresholds", { hypeToLeave: null })).body.hypeToLeave, defaultArenaDivisionHype);

    // Hiding Solo on the Matchmaking tab takes its event out of the download, its entry out of the content page, and its tickets.
    const listed = (await admin(backend, "/matchmaking/overview")).body.ltms.list.filter((ltm) => ltm.arena);
    assert.deepEqual(listed.map((ltm) => [ltm.id, ltm.enabled]), [["arenaSolo", true], ["arenaDuos", true]]);
    const hidden = await admin(backend, "/matchmaking/config", { modes: { arenaSolo: false } });
    assert.deepEqual([hidden.body.modes.arenaSolo, hidden.body.modes.arenaDuos], [false, true]);
    assert.deepEqual((await admin(backend, "/arena")).body.modes.map((mode) => mode.shown), [false, true]);
    const hiddenDownload = await download(ann);
    assert.deepEqual(idsOf(hiddenDownload.body.events), ["epicgames_Arena_S8_Duos"]);
    assert.equal(hiddenDownload.body.templates.length, 7);
    const page = await send({ host: "127.0.0.1", port: backend.port, path: "/content/api/pages/fortnite-game", headers: { "User-Agent": agent830 } });
    assert.deepEqual(page.body.tournamentinformation.tournament_info.tournaments.map((entry) => entry.tournament_display_id), ["epicgames_Arena_S8_Duos"]);
    const ticket = await send({ host: "127.0.0.1", port: backend.port, headers: { "User-Agent": agent830, Authorization: `bearer ${ann.token}` },
      path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${ann.accountId}?partyPlayerIds=${ann.accountId}&bucketId=${v830}:0:NAE:playlist_showdownalt_solo`
        + `&player.platform=Windows&player.option.tournamentId=epicgames_Arena_S8_Solo&player.option.windowId=Arena_S8_Division1_Solo` });
    assert.equal(ticket.status, 400);
    assert.equal(ticket.body.errorCode, "errors.com.epicgames.fortnite.invalid_tournament_id");
    await admin(backend, "/matchmaking/config", { modes: { arenaSolo: true } });
    assert.deepEqual(idsOf((await download(ann)).body.events), ["epicgames_Arena_S8_Solo", "epicgames_Arena_S8_Duos"]);

    // The resets: one player, then everyone.
    assert.equal((await admin(backend, "/arena/accounts/nobody/reset", {})).status, 404);
    const one = await admin(backend, `/arena/accounts/${bob.accountId}/reset`, {});
    assert.deepEqual(one.body.players.map((player) => [player.displayName, player.hype, player.division]), [["ArenaAnn", 30, 2], ["ArenaCat", 5, 1], ["ArenaBob", 0, 1]]);
    const all = await admin(backend, "/arena/reset", {});
    assert.equal(all.body.reset, 3);
    assert.ok(all.body.players.every((player) => player.hype === 0 && player.division === 1));
    const player = await send({ host: "127.0.0.1", port: backend.port, path: `/api/v1/players/Fortnite/${ann.accountId}`, headers: { "User-Agent": agent830, Authorization: `bearer ${ann.token}` } });
    assert.deepEqual([player.body.persistentScores, player.body.tokens], [{ Hype: 0 }, []]);
  } finally {
    backend.close();
  }
});

// The Arena's scoring (Core-Backend #423): Victory Royale, top-N tiers per mode, elimination and bus fare points.
const ownScoring = () => ({ victoryPoints: { Solo: 10, Duos: 8 }, placements: { Solo: [[4, 5], [10, 4], [20, 1]], Duos: [[2, 6], [5, 3], [9, 2]] },
  eliminationPoints: 2, busFares: [0, 1, 2, 3, 4, 5, 6] });

test("the Arena scoring setting: defaults, validation, a settings file round-trip, and Solo and Duos kept apart", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-arena-scoring-"));
  try {
    const settings = createSettingsStore(dataDir);
    assert.deepEqual(settings.get().arenaScoring, defaultArenaScoring);
    assert.deepEqual(arenaScoringOf(settings.get()).placementTiers, placementTiers, "the defaults are arena.js's own");
    settings.update({ arenaScoring: ownScoring() });
    assert.deepEqual(createSettingsStore(dataDir).get().arenaScoring, ownScoring());
    const bad = (change) => { const value = ownScoring(); change(value); return value; };
    for (const unsound of [null, "x", [], bad((v) => { v.busFares.pop(); }), bad((v) => { v.busFares[2] = -1; }), bad((v) => { v.eliminationPoints = 1.5; }),
      bad((v) => { v.victoryPoints.Duos = 1001; }), bad((v) => { delete v.victoryPoints.Solo; }), bad((v) => { v.placements.Solo[1][0] = 4; }),
      bad((v) => { v.placements.Duos[0][0] = 1; }), bad((v) => { v.placements.Duos[2][0] = 101; }), bad((v) => { v.placements.Solo.pop(); }),
      bad((v) => { v.placements.Solo[0][1] = "3"; })]) {
      settings.update({ arenaScoring: unsound });
      assert.deepEqual(settings.get().arenaScoring, ownScoring(), JSON.stringify(unsound));
      assert.equal(arenaScoringValue(unsound, null), null);
    }
    const scoring = arenaScoringOf(settings.get());
    assert.deepEqual(scoring.placementTiers, { Solo: [[1, 10], [4, 5], [10, 4], [20, 1]], Duos: [[1, 8], [2, 6], [5, 3], [9, 2]] });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the events' scoring rules and a match's Hype follow the scoring setting", () => {
  const defaultsHype = arenaMatchPoints("Solo", 3, { place: 1, teamKills: 4 }, {});
  assert.equal(defaultsHype, 3 + 2 + 2 + 3 + 4 - 2, "the defaults as before: win, top 5, 15 and 25, 4 eliminations, Division 4's fare");
  const own = { arenaScoring: ownScoring() };
  assert.equal(arenaMatchPoints("Solo", 3, { place: 1, teamKills: 4 }, own), 10 + 5 + 4 + 1 + 4 * 2 - 3);
  assert.equal(arenaMatchPoints("Duos", 0, { place: 5, teamKills: 0 }, own), 3 + 2);
  assert.equal(arenaMatchPoints("Duos", 6, { place: 30, teamKills: 200 }, own), 99 * 2 - 6, "eliminations count to 99");

  const { templates } = arenaEvents(v830, { gameId: "Fortnite" }, own);
  const solo = templates.find((template) => template.eventTemplateId === "eventTemplate_Arena_S8_Division4_Solo");
  const duos = templates.find((template) => template.eventTemplateId === "eventTemplate_Arena_S8_Division1_Duos");
  assert.deepEqual(solo.scoringRules[0].rewardTiers, [{ keyValue: 1, pointsEarned: 10 }, { keyValue: 4, pointsEarned: 5 }, { keyValue: 10, pointsEarned: 4 }, { keyValue: 20, pointsEarned: 1 }]);
  assert.deepEqual(duos.scoringRules[0].rewardTiers.map((tier) => [tier.keyValue, tier.pointsEarned]), [[1, 8], [2, 6], [5, 3], [9, 2]]);
  assert.ok(solo.scoringRules[1].rewardTiers.every((tier) => tier.pointsEarned === 2));
  assert.deepEqual(solo.scoringRules[2].rewardTiers, [{ keyValue: 1, pointsEarned: -3 }]);
  assert.equal(duos.scoringRules.length, 2, "no bus fare in Division 1 here either (fare 0)");
});

test("the admin Arena scoring route: refused when unsound, saved, and back to the defaults", async () => {
  const backend = await startBackend();
  try {
    const tab = await admin(backend, "/arena");
    assert.deepEqual([tab.body.scoring, tab.body.defaultScoring], [defaultArenaScoring, defaultArenaScoring]);
    const unsound = ownScoring();
    unsound.placements.Solo[2][0] = 3;
    assert.equal((await admin(backend, "/arena/scoring", { scoring: unsound })).status, 400);
    assert.equal((await admin(backend, "/arena/scoring", {})).status, 400);
    const saved = await admin(backend, "/arena/scoring", { scoring: ownScoring() });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.scoring, ownScoring());
    const ann = await userLogin(backend.port, "ArenaScorer");
    const download = await send({ host: "127.0.0.1", port: backend.port, headers: { "User-Agent": agent830, Authorization: `bearer ${ann.token}` },
      path: `/api/v1/events/Fortnite/download/${ann.accountId}?region=NAE&platform=Windows&teamAccountIds=${ann.accountId}` });
    assert.equal(download.body.templates[0].scoringRules[0].rewardTiers[0].pointsEarned, 10);
    assert.deepEqual((await admin(backend, "/arena/scoring", { scoring: null })).body.scoring, defaultArenaScoring);
  } finally {
    backend.close();
  }
});
