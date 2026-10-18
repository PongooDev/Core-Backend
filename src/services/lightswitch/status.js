import express from "express";
import { requireAuth } from "../../accounts/auth.js";

export function lightswitchRoutes({ tokens }) {
  const router = express.Router();

  router.get("/lightswitch/api/service/bulk/status", requireAuth(tokens), (req, res) => {
    const ids = [req.query.serviceId ?? []].flat().map(String);
    res.json(ids.map((serviceInstanceId) => ({ serviceInstanceId, status: "UP" })));
  });

  return router;
}
