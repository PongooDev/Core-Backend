import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

export function friendsRoutes({ tokens }) {
  const router = express.Router();

  router.get("/friends/api/public/friends/:accountId", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json([]);
  });

  router.get("/friends/api/public/blocklist/:accountId", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json({ blockedUsers: [] });
  });

  router.get("/friends/api/public/list/:namespace/:accountId/recentPlayers", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json([]);
  });

  return router;
}
