import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

export function accessRoutes({ tokens }) {
  const router = express.Router();

  router.post("/fortnite/api/game/v2/tryPlayOnPlatform/account/:accountId", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.type("text/plain").send("true");
  });

  router.get("/fortnite/api/game/v2/enabled_features", requireAuth(tokens), (req, res) => {
    res.json([]);
  });

  return router;
}
