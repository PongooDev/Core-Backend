import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventsAccountHistory, eventsDownload } from "../src/tournaments/eventsservice.js";
import { hasShowdown, showdownRuntimeOptions, showdownTicket, tournamentInformationFor } from "../src/tournaments/showdown.js";
import { createTournamentStore, tournamentPlaylists } from "../src/tournaments/store.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Season 8's in-game tournaments (Core-Backend #421): 8.20's Playlist_ShowdownTournament_Solo, _Duos and _Squads (58082 to
// 58084). 8.20's Events tab (CL-5625478 0x34B4F80) makes a tile for each downloaded tournament that isn't a division event,
// so an admin event of one of them is listed there, beside the Arena (Core-Backend #420), which it skips.
const v740 = "5046157";
const v800 = "5203069";
const v820 = "5625478";
const v830 = "5793395";
const v840 = "6005771";
const created = new Date("2026-11-24T07:00:00.000Z");
const during = new Date("2026-11-24T08:00:00.000Z");

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-s8tournaments-"));
  try {
    return run(createTournamentStore(dataDir));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test("Season 8's tournament playlists are the admin panel's for 8.20 to 8.40, 100 teams of 1, 2 and 4", () => {
  const ids = tournamentPlaylists.filter(({ id }) => id.startsWith("tournamentS8")).map(({ id, playlistId, inGame }) => [id, playlistId, inGame]);
  assert.deepEqual(ids, [["tournamentS8Solo", 58082, true], ["tournamentS8Duos", 58083, true], ["tournamentS8Squads", 58084, true]]);
  assert.deepEqual([v740, v800, v820, v830, v840].map(hasShowdown), [true, false, true, true, true]);
  assert.deepEqual(playlistTeamsOf(`${v820}:0:NAE:playlist_showdowntournament_duos`, v820), { maxTeamCount: 100, maxTeamSize: 2, maxSquadSize: 2 });
});

test("8.20's download lists a running Season 8 tournament with the Arena, and its content page entry; a Pop-Up Cup isn't 8.20's", () => withStore((store) => {
  const cup = store.create({ name: "Luxe Cup", playlist: "tournamentS8Duos" }, created);
  store.create({ name: "Pop-Up Cup", playlist: "scavengerSolo" }, created);
  for (const build of [v820, v830, v840]) {
    const download = eventsDownload("ann", build, { region: "NAE", platform: "Windows" }, during, store);
    assert.deepEqual(download.events.map((event) => event.eventId), [cup.id, "epicgames_Arena_S8_Solo", "epicgames_Arena_S8_Duos"], build);
    assert.equal(download.templates[0].playlistId, "Playlist_ShowdownTournament_Duos");
    assert.equal(download.events[0].eventWindows[0].metadata, undefined, "no divisionRank: a tile of the Events tab");
  }
  const entries = tournamentInformationFor(v820, during, store).tournament_info.tournaments;
  assert.deepEqual(entries.map((entry) => [entry.tournament_display_id, entry.title_line_1, entry.title_line_2]), [[cup.id, "Luxe Cup", "Duos"]]);
  assert.ok(entries[0].poster_front_image && entries[0].title_color);
  assert.deepEqual(eventsDownload("ann", v800, {}, during, store).events, [], "8.00 has neither");
}));

test("a Season 8 tournament ticket takes a full party; an empty Events tab isn't hidden on 8.20 to 8.40 (the Arena is the same manager's)", () => withStore((store) => {
  const cup = store.create({ name: "Luxe Cup", playlist: "tournamentS8Duos" }, created);
  const code = (partySize) => showdownTicket({ playlistId: 58083, tournamentId: cup.id, windowId: cup.id, partySize, build: v820 }, during, store).error?.code ?? null;
  assert.equal(code(2), null);
  assert.equal(code(1), "errors.com.epicgames.fortnite.wrong_number_of_event_players");
  withStore((empty) => {
    assert.deepEqual(showdownRuntimeOptions(v820, { hideEmptyEventsTab: true }, during, empty), ["ShowdownTournamentCacheExpirationHours=0"]);
    assert.deepEqual(showdownRuntimeOptions(v740, { hideEmptyEventsTab: true }, during, empty), ["bEnableShowdown=false"]);
  });
}));

// Core-Backend #427: 8.20's tournament details screen asks GET /api/v1/events/<gameId>/<eventId>/history/<accountId>
// (RefreshEventHistory_HttpRequestComplete, CL-5625478 0x419D40) and wants a JSON array of FEventsServiceTeamScore; a 404 made
// it ask again every 33 ms and show nothing.
test("8.20's account history: the player's scores in the event or a window as an array, empty for none and for the Arena; null for an event not theirs", () => withStore((store) => {
  const cup = store.create({ name: "Luxe Cup", playlist: "tournamentS8Solo" }, created);
  assert.deepEqual(eventsAccountHistory("ann", cup.id, null, v820, during, store), [], "listed, not played");
  store.recordResult("ann", 58082, { place: 1, kills: 3, matchId: "m1", build: v820 }, during);
  const history = eventsAccountHistory("ann", cup.id, null, v820, during, store);
  assert.equal(history.length, 1);
  assert.deepEqual([history[0].eventId, history[0].teamAccountIds], [cup.id, ["ann"]]);
  assert.ok(history[0].pointsEarned > 0 && Array.isArray(history[0].sessionHistory));
  const [window] = cup.windows?.length ? cup.windows : [{ id: cup.id }];
  assert.deepEqual(eventsAccountHistory("ann", cup.id, window.id, v820, during, store), history);
  assert.equal(eventsAccountHistory("ann", cup.id, "nope", v820, during, store), null);
  assert.equal(eventsAccountHistory("ann", "nope", null, v820, during, store), null);
  assert.deepEqual(eventsAccountHistory("ann", "epicgames_Arena_S8_Solo", null, v820, during, store), []);
  assert.deepEqual(eventsAccountHistory("ann", "epicgames_Arena_S8_Solo", "Arena_S8_Division1_Solo", v820, during, store), []);
}));

test("8.20's account history over HTTP: 200 with an array for a listed event, 404 for another, 403 for another player's", async () => {
  const backend = await startBackend();
  try {
    const agent = "Fortnite/++Fortnite+Release-8.20-CL-5625478 Windows/10.0.26200.1.256.64bit";
    const ask = (urlPath, token) => send({ host: "127.0.0.1", port: backend.port, method: "GET", path: urlPath, headers: { "User-Agent": agent, Authorization: `bearer ${token}` } });
    const text = JSON.stringify({ name: "Now Cup", playlist: "tournamentS8Solo" });
    const made = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/admin/api/tournaments",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), "User-Agent": agent } }, text);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const ann = await userLogin(backend.port, "HistoryAnn");
    const bob = await userLogin(backend.port, "HistoryBob");
    const listed = await ask(`/api/v1/events/Fortnite/${made.body.event.id}/history/${ann.accountId}`, ann.token);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.deepEqual(listed.body, []);
    assert.equal((await ask(`/api/v1/events/Fortnite/epicgames_Arena_S8_Solo/history/${ann.accountId}`, ann.token)).status, 200);
    assert.equal((await ask(`/api/v1/events/Fortnite/unknown/history/${ann.accountId}`, ann.token)).status, 404);
    assert.equal((await ask(`/api/v1/events/Fortnite/${made.body.event.id}/history/${ann.accountId}`, bob.token)).status, 403);
  } finally {
    backend.close();
  }
});
