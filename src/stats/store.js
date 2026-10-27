import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

// Battle Royale's career stats (Core-Backend #59), one file per account (accounts/<id>/stats.json):
//   {playlists: {<playlistId>: {placetop1, placetop<n>..., kills, matchesplayed, secondsplayed, lastmodified}}}
// Epic's stats service kept them from what its gameservers reported. The 1.7.2 server reports only its winners
// (battleroyale/recordwin, its RecordUserStatsUrl /api/stats/bulk has no caller), so Core's server reports every
// player's place, kills and time alive when their team is out or wins (battleroyale/recordresults, CoreV2).

// The places each playlist's stats count besides wins (Balance/DataTables/LeaderboardStats, the stats screen's tabs):
// solo top 10 and 25, duo top 5 and 12, squad top 3 and 6. A place counts toward every one it is within, a win too.
export const placements = { 2: [10, 25], 10: [5, 12], 9: [3, 6] };

export function createStatsStore(dataDir) {
  const cache = new Map();
  const file = (id) => path.join(dataDir, "accounts", id, "stats.json");

  function load(id) {
    if (!cache.has(id)) {
      const saved = fs.existsSync(file(id)) ? readJson(file(id)) : {};
      cache.set(id, { playlists: saved.playlists ?? {} });
    }
    return cache.get(id);
  }

  function change(accountId, playlistId, apply) {
    const stats = load(accountId);
    const playlist = (stats.playlists[playlistId] ??= {});
    apply(playlist);
    playlist.lastmodified = Math.floor(Date.now() / 1000);
    writeJson(file(accountId), stats);
  }

  const add = (playlist, stat, amount) => { playlist[stat] = (playlist[stat] ?? 0) + amount; };

  return {
    // {<playlistId>: {<stat>: value}} for every playlist the account has played.
    playlists: (accountId) => structuredClone(load(accountId).playlists),

    recordWin(accountId, playlistId) {
      change(accountId, playlistId, (playlist) => add(playlist, "placetop1", 1));
    },

    // One match: its place counts toward the playlist's placements below a win (recordWin counts the win itself).
    recordResult(accountId, playlistId, { place, kills, secondsAlive }) {
      change(accountId, playlistId, (playlist) => {
        add(playlist, "matchesplayed", 1);
        add(playlist, "kills", kills);
        add(playlist, "secondsplayed", secondsAlive);
        for (const top of placements[playlistId] ?? []) {
          if (place <= top) add(playlist, `placetop${top}`, 1);
        }
      });
    }
  };
}
