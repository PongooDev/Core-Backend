import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

export function friendCodeRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/game/v2/friendcodes/:accountId/:codeBackend", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json([]);
  });

  return router;
}
