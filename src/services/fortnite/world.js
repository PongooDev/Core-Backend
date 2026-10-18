import express from "express";
import { requireAuth } from "../../accounts/auth.js";

export function worldRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/game/v2/world/info", requireAuth(tokens), (req, res) => {
    res.json({ theaters: [], missions: [], missionAlerts: [] });
  });

  return router;
}
