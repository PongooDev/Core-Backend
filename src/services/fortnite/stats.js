import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// The playlists Battle Royale's stats screen shows (Balance/DataTables/LeaderboardStats: "<stat>_pc_m0_p<n>"): solo,
// duo and squad. The client's platform is always pc.
const playlists = [2, 10, 9];

// Battle Royale's stats screen (1.7.2: bAthenaStatsFrontendEnabled) asks for a player's lifetime stats, a list of
// {name, value, window, ownerType}. Core keeps no Battle Royale stats yet, so the counts are all absent (0). The screen's
// "Last Updated" is GameplayStat.BR.LastModified (br_lastmodified_*, Unix seconds; "Never" when missing): with nothing
// recorded, the stats are as of now.
export function statsRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/stats/accountId/:accountId/bulk/window/:window", requireAuth(tokens), (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    res.json(playlists.map((playlist) => ({ name: `br_lastmodified_pc_m0_p${playlist}`, value: now, window: req.params.window, ownerType: 1 })));
  });

  return router;
}
