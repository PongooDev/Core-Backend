import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "../../accounts/auth.js";
import { athenaSeason } from "../../gamedata/athena.js";
import { openSession } from "../../profiles/session.js";
import { storefronts } from "../../store/catalog.js";
import { nextRotation } from "../../store/itemshop.js";

// The catalog is good until the item shop next changes, at UTC midnight (store/itemshop.js): 1.8's Battle Royale store
// counts its daily items down to the expiration (GetDailyStoreEndDate 0x2E7C840).
const refreshIntervalHrs = 24;

// The asset keychain (see the keychain route): the encrypted cosmetic paks' published keys, as LawinServer serves them
// (store/keychain.json, from Lawin0129/LawinServer responses/keychain.json). Entries are "<pak guid>:<base64 key>", later
// ones with ":<item id>" after. 5.21's handler (UFortMcpProfileCommonCore::OnNewDataEncryptionKeyAdded) takes exactly two
// parts and only logs the rest as bad strings, so each entry goes out as its GUID and key alone; a malformed one is left out.
const keychainEntry = /^([0-9A-Fa-f]{32}):([A-Za-z0-9+/]{43}=)(?::.*)?$/;
export const keychain = [...new Set(JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),
  "../../store/keychain.json"), "utf8"))
  .map((entry) => keychainEntry.exec(entry))
  .filter(Boolean)
  .map(([, guid, key]) => `${guid}:${key}`))];

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

  // The asset keychain: "<pak guid>:<base64 AES key>" strings for encrypted cosmetic paks. 5.21+ asks for it at login
  // (numKeysDownloaded, rvn). FMcpKeychainHelper's response handler only accepts a JSON array holding at least one
  // non-empty string; an empty array logs "Unable to parse json, failed download" and fails the login ("Failed to
  // download asset keychain"). Each new entry goes to UFortMcpProfileCommonCore::OnNewDataEncryptionKeyAdded, which splits
  // it on ':' (exactly two parts), parses the GUID and needs a 32-byte key, and only logs anything malformed. A key whose
  // pak isn't installed is kept and mounts nothing.
  router.get("/fortnite/api/storefront/v2/keychain", requireAuth(tokens), (req, res) => {
    res.json(keychain);
  });

  return router;
}
