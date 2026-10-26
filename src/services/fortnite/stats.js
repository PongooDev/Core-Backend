import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// Battle Royale's stats screen (1.7.2: bAthenaStatsFrontendEnabled) asks for a player's lifetime stats. Core keeps no
// Battle Royale stats yet, so every player has none: an empty list of {name, value, window, ownerType} 🟡.
export function statsRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/stats/accountId/:accountId/bulk/window/:window", requireAuth(tokens), (req, res) => {
    res.json([]);
  });

  return router;
}
