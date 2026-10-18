import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

export function accessRoutes({ tokens }) {
  const router = express.Router();

  router.post("/fortnite/api/game/v2/tryPlayOnPlatform/account/:accountId", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json(true);
  });

  return router;
}
