import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { openSession } from "../../profiles/session.js";
import { storefronts } from "../../store/catalog.js";
import { nextRotation } from "../../store/itemshop.js";

// The catalog is good until the item shop next changes, at UTC midnight (store/itemshop.js): 1.8's Battle Royale store
// counts its daily items down to the expiration (GetDailyStoreEndDate 0x2E7C840).
const refreshIntervalHrs = 24;

export function storefrontRoutes({ tokens, profiles }) {
  const router = express.Router();

  router.get("/fortnite/api/storefront/v2/catalog", requireAuth(tokens), (req, res) => {
    const now = new Date();
    res.json({
      refreshIntervalHrs,
      dailyPurchaseHrs: 24,
      expiration: nextRotation(now).toISOString(),
      storefronts: storefronts(req.session.accountId ? openSession(profiles, req.session.accountId).profile("profile0").profile : undefined, now)
    });
  });

  return router;
}
