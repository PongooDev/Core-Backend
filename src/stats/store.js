import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

// Battle Royale's career stats (Core-Backend #59), one file per account (accounts/<id>/stats.json):
//   {playlists: {<playlistId>: {placetop1, placetop<n>..., kills, matchesplayed, secondsplayed, score, lastmodified}},
//    days: {<YYYY-MM-DD>: {<playlistId>: {<stat>: count}}}}
// days holds what each UTC day added, for 1.8's leaderboards, which rank by day, week and month as well as all time;
// days older than the longest of those go.
// Epic's stats service kept them from what its gameservers reported. The 1.7.2 server reports only its winners
// (battleroyale/recordwin, its RecordUserStatsUrl /api/stats/bulk has no caller), and 1.8's nothing at all (no
// recordwin), so Core's server reports every player's place, kills and time alive when their team is out or wins
// (battleroyale/recordresults, CoreV2), with the win on a build that doesn't report it itself. Both builds' stats
// screens ask for the same stats of the same playlists, so a player's stats are the same on either.

// The places each playlist's stats count besides wins (Balance/DataTables/LeaderboardStats, the stats screen's tabs):
// solo top 10 and 25, duo top 5 and 12, squad top 3 and 6. A place counts toward every one it is within, a win too.
// 1.10's table has no 50v50 (playlist 11) rows: its matches count their wins, kills, time and score, shown nowhere.
export const placements = { 2: [10, 25], 10: [5, 12], 9: [3, 6] };

// The main modes, solo, duo and squad (the playlists above): only their wins give the victory umbrellas (Core-Backend
// #84), not a limited-time playlist's.
export const isMainPlaylist = (playlistId) => Object.hasOwn(placements, String(playlistId));

// The leaderboards' time windows (EMcpLeaderboardTimeWindow: daily, weekly, monthly, alltime), each from its start
// in UTC: the day, the week from Monday (🟡: when Epic's weeks began wasn't looked at) and the month.
export const windows = ["daily", "weekly", "monthly", "alltime"];
const dayOf = (date) => date.toISOString().slice(0, 10);
const keptDays = 31;

export function windowStart(window, now = new Date()) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (window === "daily") return dayOf(day);
  if (window === "weekly") return dayOf(new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400000));
  if (window === "monthly") return dayOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  return "";
}

// The score of matches recorded before Core kept one (Core-Backend #128), from their counts the way a match's score
// is worked out (profiles/athena.js matchXp): 5 a minute alive, 50 a kill, 300 a win, 100 a place within the playlist's
// first placement below a win and 50 within its second. Minutes are counted over all the matches together, so it can
// be a few minutes' worth above what the matches' own scores added up to.
export function estimatedScore(playlistId, counts) {
  const [first, second] = placements[playlistId] ?? [];
  const wins = counts.placetop1 ?? 0;
  const inFirst = first ? Math.max(0, (counts[`placetop${first}`] ?? 0) - wins) : 0;
  const inSecond = second ? Math.max(0, (counts[`placetop${second}`] ?? 0) - inFirst - wins) : 0;
  return Math.floor((counts.secondsplayed ?? 0) / 60) * 5 + (counts.kills ?? 0) * 50 + wins * 300 + inFirst * 100 + inSecond * 50;
}

export function createStatsStore(dataDir) {
  const cache = new Map();
  const file = (id) => path.join(dataDir, "accounts", id, "stats.json");

  // Stats saved before score was recorded get it estimated, once (it is saved with the account's next match).
  function withScores(byPlaylist) {
    for (const [playlistId, counts] of Object.entries(byPlaylist)) {
      if (counts.score === undefined && (counts.matchesplayed || counts.placetop1)) counts.score = estimatedScore(playlistId, counts);
    }
  }

  function load(id) {
    if (!cache.has(id)) {
      const saved = fs.existsSync(file(id)) ? readJson(file(id)) : {};
      const stats = { playlists: saved.playlists ?? {}, days: saved.days ?? {} };
      withScores(stats.playlists);
      for (const byPlaylist of Object.values(stats.days)) withScores(byPlaylist);
      cache.set(id, stats);
    }
    return cache.get(id);
  }

  const add = (counts, stat, amount) => { counts[stat] = (counts[stat] ?? 0) + amount; };

  function change(accountId, playlistId, counts, now = new Date()) {
    const stats = load(accountId);
    const playlist = (stats.playlists[playlistId] ??= {});
    const day = ((stats.days[dayOf(now)] ??= {})[playlistId] ??= {});
    for (const [stat, amount] of Object.entries(counts)) {
      add(playlist, stat, amount);
      add(day, stat, amount);
    }
    playlist.lastmodified = Math.floor(now.getTime() / 1000);
    const oldest = dayOf(new Date(now.getTime() - keptDays * 86400000));
    for (const date of Object.keys(stats.days)) if (date < oldest) delete stats.days[date];
    writeJson(file(accountId), stats);
  }

  // A stat as the stats screen and leaderboards name it, in a window: minutesplayed from the seconds recorded.
  function value(counts, stat) {
    if (stat === "minutesplayed") return Math.floor((counts?.secondsplayed ?? 0) / 60);
    return stat === "lastmodified" ? 0 : counts?.[stat] ?? 0;
  }

  // {<playlistId>: {<stat>: value}} in a window: alltime is the career's (playlists), the others add up the days from
  // the window's start (without lastmodified).
  function windowed(accountId, window, now = new Date()) {
    const { playlists, days } = load(accountId);
    if (window === "alltime") return structuredClone(playlists);
    const start = windowStart(window, now);
    const counts = {};
    for (const [date, byPlaylist] of Object.entries(days)) {
      if (!start || date < start) continue;
      for (const [playlistId, stats] of Object.entries(byPlaylist)) {
        for (const [name, amount] of Object.entries(stats)) add((counts[playlistId] ??= {}), name, amount);
      }
    }
    return counts;
  }

  return {
    // {<playlistId>: {<stat>: value}} for every playlist the account has played.
    playlists: (accountId) => structuredClone(load(accountId).playlists),

    // A win in solo, duo or squad (Battle Royale's umbrella, services/fortnite/battleroyale.js).
    hasWon: (accountId) => Object.entries(load(accountId).playlists)
      .some(([playlistId, playlist]) => isMainPlaylist(playlistId) && (playlist.placetop1 ?? 0) > 0),

    windowed,

    // A stat of a playlist in a window, 0 when none was recorded.
    stat(accountId, playlistId, stat, window, now = new Date()) {
      return value(windowed(accountId, window, now)[playlistId], stat);
    },

    recordWin(accountId, playlistId, now = new Date()) {
      change(accountId, playlistId, { placetop1: 1 }, now);
    },

    // One match: its place counts toward the playlist's placements below a win, and with win (1.8, whose server has no
    // recordwin) the win itself; otherwise recordWin counts it. score is the match's (br_score, the lobby leaderboards'
    // Score tab).
    recordResult(accountId, playlistId, { place, kills, secondsAlive, score = 0, win = false }, now = new Date()) {
      const counts = { matchesplayed: 1, kills, secondsplayed: secondsAlive, score };
      if (win && place === 1) counts.placetop1 = 1;
      for (const top of placements[playlistId] ?? []) {
        if (place <= top) counts[`placetop${top}`] = 1;
      }
      change(accountId, playlistId, counts, now);
    }
  };
}
