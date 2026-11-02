import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { athenaSeason } from "../../gamedata/athena.js";
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
    const session = req.session.accountId ? openSession(profiles, req.session.accountId) : undefined;
    // The Battle Pass storefront leaves out a pass the player owns (battlepass/season2.js).
    const athena = session && athenaSeason() && session.hasProfile("athena") ? session.profile("athena").profile : undefined;
    res.json({
      refreshIntervalHrs,
      dailyPurchaseHrs: 24,
      expiration: nextRotation(now).toISOString(),
      storefronts: storefronts(session?.profile("profile0").profile, now, { athena })
    });
  });

  return router;
}
