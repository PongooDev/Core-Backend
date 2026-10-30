import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { windows } from "../../stats/store.js";

// The playlists Battle Royale's stats screen shows (Balance/DataTables/LeaderboardStats: "<stat>_pc_m0_p<n>"): solo,
// duo and squad. The client's platform is always pc.
const playlists = [2, 10, 9];

// Battle Royale's stats screen (1.7.2: bAthenaStatsFrontendEnabled) asks for a player's lifetime stats (window alltime,
// the screen's only one: 1.7.2 0x2D6C28D, 1.8 0x2DDF4B9 into QueryPlayerStats 0x772F20, the same GET and the same
// LeaderboardStats rows; a daily, weekly or monthly window has what those days added), a list of {name,
// value, window, ownerType}: br_placetop1 (Wins), br_placetop<n>, br_kills, br_matchesplayed, br_minutesplayed
// ("Time Played") and br_score (the lobby leaderboards' Score tab, LeaderboardAndStatUIData GameplayStat.BR.Score), each
// "_pc_m0_p<playlist>", from what Core recorded
// (src/stats/store.js; a stat it hasn't is absent, 0). The screen's "Last Updated" is GameplayStat.BR.LastModified
// (br_lastmodified_*, Unix seconds; "Never" when missing): when the playlist was last recorded, else now.
export function statsRoutes({ tokens, stats, accounts }) {
  const router = express.Router();

  router.get("/fortnite/api/stats/accountId/:accountId/bulk/window/:window", requireAuth(tokens), (req, res) => {
    const { window } = req.params;
    const recorded = windows.includes(window) ? stats.windowed(req.params.accountId, window) : {};
    const now = Math.floor(Date.now() / 1000);
    const entry = (playlist, name, value) => ({ name: `br_${name}_pc_m0_p${playlist}`, value, window, ownerType: 1 });

    const ids = [...new Set([...playlists, ...Object.keys(recorded).map(Number)])];
    res.json(ids.flatMap((playlist) => {
      const { secondsplayed, lastmodified, ...counts } = recorded[playlist] ?? {};
      return [
        ...Object.entries(counts).map(([name, value]) => entry(playlist, name, value)),
        ...(secondsplayed === undefined ? [] : [entry(playlist, "minutesplayed", Math.floor(secondsplayed / 60))]),
        entry(playlist, "lastmodified", lastmodified ?? now)
      ];
    }));
  });

  // A playlist's players on this backend: the accounts with a match recorded in it.
  const playedIn = (playlistId) => accounts.list().map(({ id }) => id).filter((id) => stats.playlists(id)[playlistId]);

  // 1.8's Battle Royale lobby asks for the player's leaderboard cohort, the accounts its group leaderboards rank them
  // among ({accountId, cohortAccounts, expiresAt, playlist}, read by 1.8 sub_74DAD0; playlist "pc_m0_p<id>"). Epic's
  // were about 100 players like them; Core's (🟡) are the player and up to 99 others who played the playlist here, the
  // most matches first, for an hour.
  router.get("/fortnite/api/game/v2/leaderboards/cohort/:accountId", requireAuth(tokens), (req, res) => {
    const { accountId } = req.params;
    const playlist = String(req.query.playlist ?? "");
    const playlistId = /_p(\d+)$/.exec(playlist)?.[1];
    const others = playlistId ? playedIn(playlistId).filter((id) => id !== accountId) : [];
    others.sort((a, b) => stats.stat(b, playlistId, "matchesplayed", "alltime") - stats.stat(a, playlistId, "matchesplayed", "alltime"));
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    res.json({ accountId, cohortAccounts: [accountId, ...others.slice(0, 99)], expiresAt, playlist });
  });

  // 1.8's leaderboards (FortMcpUtils 0x771040, POST /api/leaderboards/type/`typeId/stat/`leaderboardName/window/
  // `windowId?ownertype=1). A group board's body is the accounts to rank, a JSON array of ids (the cohort; the friends
  // filter's list 🟡); a global one pages with &pageNumber=&itemsPerPage=. The answer (sub_74E120) is {statName,
  // statWindow, entries: [{accountId, value, rank}]}, from what Core recorded (src/stats/store.js) in the window: a
  // stat named as on the stats screen, br_<stat>_pc_m0_p<playlist>. A group ranks every account asked for that exists,
  // 0 when it has nothing (asked for none, the player's cohort); a global board ranks those with more than 0. Equal
  // values share a rank.
  const leaderboard = (req, res) => {
    const { type, stat: statName, window } = req.params;
    const [, stat, playlistId] = /^br_([a-z0-9]+)_pc_m0_p(\d+)$/.exec(statName) ?? [];
    if (!windows.includes(window)) return res.json({ statName, statWindow: window, entries: [] });
    const asked = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.accountIds) ? req.body.accountIds : [];
    const group = asked.length ? asked : [req.session.accountId, ...(playlistId ? playedIn(playlistId) : [])];
    const ids = type === "group"
      ? [...new Set(group.filter((id) => typeof id === "string" && accounts.get(id)))]
      : accounts.list().map(({ id }) => id);
    let entries = stat ? ids.map((accountId) => ({ accountId, value: stats.stat(accountId, playlistId, stat, window) })) : [];
    if (type !== "group") entries = entries.filter(({ value }) => value > 0);
    entries.sort((a, b) => b.value - a.value || a.accountId.localeCompare(b.accountId));
    for (const entry of entries) entry.rank = 1 + entries.filter((other) => other.value > entry.value).length;
    if (type !== "group") {
      const page = Math.max(0, Number.parseInt(req.query.pageNumber, 10) || 0);
      const size = Math.min(Math.max(1, Number.parseInt(req.query.itemsPerPage, 10) || 50), 1000);
      entries = entries.slice(page * size, (page + 1) * size);
    }
    res.json({ statName, statWindow: window, entries });
  };
  router.post("/fortnite/api/leaderboards/type/:type/stat/:stat/window/:window", requireAuth(tokens), leaderboard);
  router.get("/fortnite/api/leaderboards/type/:type/stat/:stat/window/:window", requireAuth(tokens), leaderboard);

  return router;
}
