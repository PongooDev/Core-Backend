import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { storefronts } from "../../store/catalog.js";

const refreshIntervalHrs = 24;

export function storefrontRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/storefront/v2/catalog", requireAuth(tokens), (req, res) => {
    res.json({
      refreshIntervalHrs,
      dailyPurchaseHrs: 24,
      expiration: new Date(Date.now() + refreshIntervalHrs * 60 * 60 * 1000).toISOString(),
      storefronts: storefronts()
    });
  });

  return router;
}
