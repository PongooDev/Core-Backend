import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";
import { log } from "../log.js";
import { grant } from "../profiles/progress.js";
import { spendMtx } from "../profiles/items.js";
import { creatorByCode, creatorPayout, payoutPercent } from "./creators.js";

// Support-A-Creator's payouts (Core-Backend #349). Epic paid a supported creator 5% of what their supporters spent, in
// real money; Core pays V-Bucks, the panel's share of what was spent (store/creators.js payoutPercent, 100% by default),
// into the creator's profile0 as Currency:mtxgiveaway, the way the panel's own V-Bucks and Battle Royale's match V-Bucks
// are given (services/fortnite/battleroyale.js), so the creator's game shows them on its next profile refresh (and at
// once over STOMP while it is in the lobby: services/mcp/profile.js notifies the other accounts a command changed).
// Paid for the item shop's cosmetics bought with V-Bucks (services/mcp/commands/PurchaseCatalogEntry.js), when the
// buyer's common_core holds a creator's code (mtx_affiliate, SetAffiliateName) that is enabled and belongs to an account
// other than the buyer's: a creator buying with their own code is paid nothing. A purchase returned later (3.6's
// refunds, store/refunds.js) takes its payout back from the creator, as far as their V-Bucks go.
//
// The payouts are kept in <data>/creators/payouts.json: each creator account's totals, and the latest payouts.
const keptPayouts = 1000;
// The V-Bucks spendMtx (profiles/items.js) takes from.
const vbuckTemplates = ["currency:mtxcomplimentary", "currency:mtxgiveaway", "currency:mtxpurchasebonus", "currency:mtxpurchased"];

export function createCreatorPayoutStore(dataDir) {
  const file = dataDir ? path.join(dataDir, "creators", "payouts.json") : null;
  let state = { totals: {}, payouts: [] };
  if (file && fs.existsSync(file)) {
    try {
      const loaded = readJson(file);
      state = {
        totals: loaded?.totals && typeof loaded.totals === "object" ? loaded.totals : {},
        payouts: Array.isArray(loaded?.payouts) ? loaded.payouts : []
      };
    } catch {
      // A corrupt file starts over.
    }
  }
  const save = () => {
    if (file) writeJson(file, state);
  };
  const totalsOf = (accountId) => state.totals[accountId] ?? { vbucks: 0, purchases: 0, spent: 0, reversed: 0 };

  return {
    // {creatorAccountId, code, buyerAccountId, offerId, spent, vbucks}: a payout made, with its id and time.
    record({ creatorAccountId, code, buyerAccountId, offerId, spent, vbucks, at = new Date().toISOString() }) {
      const entry = { id: crypto.randomUUID(), creatorAccountId, code, buyerAccountId, offerId, spent, vbucks, at };
      const totals = totalsOf(creatorAccountId);
      state.totals[creatorAccountId] = { ...totals, vbucks: totals.vbucks + vbucks, purchases: totals.purchases + 1, spent: totals.spent + spent };
      state.payouts = [...state.payouts, entry].slice(-keptPayouts);
      save();
      return entry;
    },
    // A returned purchase's payout, taken back: `taken` of its V-Bucks came back from the creator.
    reverse({ payoutId, creatorAccountId, vbucks, spent = 0, taken, at = new Date().toISOString() }) {
      const totals = totalsOf(creatorAccountId);
      state.totals[creatorAccountId] = { ...totals, vbucks: totals.vbucks - vbucks, purchases: Math.max(0, totals.purchases - 1),
        spent: Math.max(0, totals.spent - spent), reversed: (totals.reversed ?? 0) + 1 };
      state.payouts = state.payouts.map((entry) => (entry.id === payoutId ? { ...entry, returnedAt: at, takenBack: taken } : entry));
      save();
    },
    totals: (accountId) => ({ ...totalsOf(accountId) }),
    // The latest payouts to the account, newest first.
    recent: (accountId, count = 10) => state.payouts.filter((entry) => entry.creatorAccountId === accountId).slice(-count).reverse()
  };
}

// Pays the creator whose code the buyer supports for an item shop purchase of `spent` V-Bucks. Returns the payout
// ({payoutId, creatorAccountId, code, vbucks, spent}) or null when none is due: no code, a code no enabled creator has,
// one without an account, the buyer's own, or a share of 0. sessionFor opens the creator's profiles in the same command
// (services/mcp/profile.js), which saves them with the buyer's.
export function payCreator({ session, sessionFor, payouts, offerId, spent, settingsValue }) {
  const code = session.profile("profile0").profile.stats.attributes.mtx_affiliate;
  if (typeof code !== "string" || !code || !(spent > 0)) return null;
  const creator = creatorByCode(code, settingsValue);
  if (!creator?.accountId) return null;
  if (creator.accountId === session.accountId) {
    log("Support-A-Creator", `${session.accountId} bought ${offerId} with their own code ${creator.code}: no payout`);
    return null;
  }
  const vbucks = creatorPayout(spent, settingsValue);
  if (vbucks <= 0) return null;
  const target = sessionFor?.(creator.accountId);
  if (!target) return null;
  grant(target, "Currency:mtxgiveaway", vbucks);
  const entry = payouts?.record({ creatorAccountId: creator.accountId, code: creator.code, buyerAccountId: session.accountId, offerId, spent, vbucks });
  log("Support-A-Creator", `${creator.code} (${creator.accountId}) got ${vbucks} V-Bucks (${payoutPercent(settingsValue)}% of ${spent}) for ${session.accountId}'s ${offerId}`);
  return { payoutId: entry?.id ?? null, creatorAccountId: creator.accountId, code: creator.code, vbucks, spent };
}

// A returned purchase's payout comes back from the creator: as many of its V-Bucks as the creator still holds.
export function reverseCreatorPayout({ payout, sessionFor, payouts }) {
  if (!payout?.creatorAccountId || !(payout.vbucks > 0)) return 0;
  const target = sessionFor?.(payout.creatorAccountId);
  let taken = 0;
  if (target) {
    const tracker = target.profile("profile0");
    const held = Object.values(tracker.profile.items).filter((item) => vbuckTemplates.includes(String(item.templateId).toLowerCase()))
      .reduce((sum, item) => sum + (item.quantity ?? 0), 0);
    taken = Math.min(held, payout.vbucks);
    if (taken > 0) spendMtx(tracker, taken);
  }
  payouts?.reverse({ payoutId: payout.payoutId, creatorAccountId: payout.creatorAccountId, vbucks: payout.vbucks, spent: payout.spent ?? 0, taken });
  log("Support-A-Creator", `${payout.code} (${payout.creatorAccountId}) gave back ${taken} of ${payout.vbucks} V-Bucks for a returned purchase`);
  return taken;
}
