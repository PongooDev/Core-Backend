import express from "express";
import { requireAuth } from "../../accounts/auth.js";

export function eulaRoutes({ tokens }) {
  const router = express.Router();

  router.get("/eulatracking/api/shared/agreements/:key", requireAuth(tokens), (req, res) => {
    res.status(204).end();
  });

  router.get("/eulatracking/api/public/agreements/:key/account/:accountId", requireAuth(tokens), (req, res) => {
    res.status(204).end();
  });

  return router;
}
