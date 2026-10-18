import express from "express";
import { requireAuth } from "../../accounts/auth.js";

export function sessionRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/matchmaking/session/findPlayer/:accountId", requireAuth(tokens), (req, res) => {
    res.json([]);
  });

  return router;
}
