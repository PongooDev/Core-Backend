import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventsDownload } from "../src/tournaments/eventsservice.js";
import { hasShowdown, showdownRuntimeOptions, showdownTicket, tournamentInformationFor } from "../src/tournaments/showdown.js";
import { createTournamentStore, tournamentPlaylists } from "../src/tournaments/store.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";

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
