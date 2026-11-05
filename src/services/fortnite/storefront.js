import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { athenaSeason } from "../../gamedata/athena.js";
import { openSession } from "../../profiles/session.js";
import { storefronts } from "../../store/catalog.js";
import { nextRotation } from "../../store/itemshop.js";

// The catalog is good until the item shop next changes, at UTC midnight (store/itemshop.js): 1.8's Battle Royale store
// counts its daily items down to the expiration (GetDailyStoreEndDate 0x2E7C840).
const refreshIntervalHrs = 24;

export function storefrontRoutes({ tokens, profiles, settings }) {
  const router = express.Router();

  router.get("/fortnite/api/storefront/v2/catalog", requireAuth(tokens), (req, res) => {
    const now = new Date();
    const session = req.session.accountId ? openSession(profiles, req.session.accountId) : undefined;
    // The Battle Pass storefront leaves out a pass the player owns (battlepass/season2.js).
    const athena = session && athenaSeason() && session.hasProfile("athena") ? session.profile("athena").profile : undefined;
    // Always answered in full, without an ETag. The catalog helper sends its ETag back (If-None-Match, 3.3 0x80C370) and
    // keeps its catalog on a 304, but takes its next refresh time only from a catalog it parses (the expiration, 0x80DA50):
    // a 304 to a refresh that came due early (a failed one waits 30 seconds, 0x80E220) left it due for good, and every
    // store widget's timer (UFortDirectAcquisitionWidgetBase, every 5 seconds) refreshed it again (Core-Backend #242).
    res.type("json").end(JSON.stringify({
      refreshIntervalHrs,
      dailyPurchaseHrs: 24,
      expiration: nextRotation(now).toISOString(),
      // The Store tab's V-Bucks packs are the account's own (store/currency.js), while the admin panel has them on.
      storefronts: storefronts(session?.profile("profile0").profile, now,
        { athena, accountId: req.session.accountId, vbuckPacks: settings?.get?.()?.vbuckPacks !== false })
    }));
  });

  return router;
}
