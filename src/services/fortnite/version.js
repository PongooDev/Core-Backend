import express from "express";
import { requireAuth } from "../../accounts/auth.js";

export function versionRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/versioncheck", requireAuth(tokens), (req, res) => {
    res.json({ type: "NO_UPDATE" });
  });

  return router;
}
