import express from "express";
import { requireAuth } from "../../accounts/auth.js";

export function cloudStorageRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/cloudstorage/system", requireAuth(tokens), (req, res) => {
    res.json([]);
  });

  return router;
}
