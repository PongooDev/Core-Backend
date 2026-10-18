import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

export function receiptRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/receipts/v1/account/:accountId/receipts", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json([]);
  });

  return router;
}
