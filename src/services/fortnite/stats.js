import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// The playlists Battle Royale's stats screen shows (Balance/DataTables/LeaderboardStats: "<stat>_pc_m0_p<n>"): solo,
// duo and squad. The client's platform is always pc.
const playlists = [2, 10, 9];

// Battle Royale's stats screen (1.7.2: bAthenaStatsFrontendEnabled) asks for a player's lifetime stats (window alltime,
// the screen's only one: 0x2D6C28D), a list of {name, value, window, ownerType}: br_placetop1 (Wins), br_placetop<n>,
// br_kills, br_matchesplayed and br_minutesplayed ("Time Played"), each "_pc_m0_p<playlist>", from what Core recorded
// (src/stats/store.js; a stat it hasn't is absent, 0). The screen's "Last Updated" is GameplayStat.BR.LastModified
// (br_lastmodified_*, Unix seconds; "Never" when missing): when the playlist was last recorded, else now.
export function statsRoutes({ tokens, stats }) {
  const router = express.Router();

  router.get("/fortnite/api/stats/accountId/:accountId/bulk/window/:window", requireAuth(tokens), (req, res) => {
    const { window } = req.params;
    const recorded = window === "alltime" ? stats.playlists(req.params.accountId) : {};
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

  return router;
}
