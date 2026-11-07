import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomCode } from "../friendcodes/store.js";
import { readJson, writeJson } from "../json-file.js";
import { findRealMoneyOffer } from "./currency.js";

// The promo codes that pay for the Store tab's real-money offers when the admin panel's "Purchases need a code"
// (purchaseMode "code", Core-Backend #248) is on, stored in <dataDir>/purchasecodes.json. They are not the friend and
// reward codes (friendcodes/store.js): a purchase code redeems on the purchase page, for one offer or any offer.
//
// A code is kept as a salted SHA-256 hash, not as the text: the panel shows a generated code once, as it is made, and
// afterwards only its last four characters. A generated code is four groups of five characters of a 31-character alphabet
// from crypto.randomInt (about 99 bits), which can't be guessed; a typed one is as strong as the admin made it, and
// redeeming is rate limited (services/fortnite/purchase.js).
export const anyOffer = "any";
const codePattern = /^[A-Z0-9_-]{4,64}$/;
const maxUsesLimit = 1_000_000;

export const normalizeCode = (code) => String(code ?? "").trim().toUpperCase();

// Why a purchase code isn't redeemed: the reason and its message for the purchase page.
export const codeProblems = {
  invalid: "That code isn't valid.",
  revoked: "That code has been revoked.",
  expired: "That code has expired.",
  used_up: "That code has already been used up.",
  used_by_account: "Your account has already used that code.",
  wrong_offer: "That code isn't for this offer."
};

export function createPurchaseCodeStore(dataDir) {
  const file = path.join(dataDir, "purchasecodes.json");
  let data = null;

  const load = () => {
    if (!data) {
      data = fs.existsSync(file) ? readJson(file) : {};
      data.salt ??= crypto.randomBytes(16).toString("hex");
      data.codes ??= {};
    }
    return data;
  };
  const save = () => writeJson(file, load());
  const hashOf = (code) => crypto.createHash("sha256").update(`${load().salt}\n${normalizeCode(code)}`).digest("hex");
  const findByCode = (code) => {
    const hash = hashOf(code);
    return Object.values(load().codes).find((entry) => entry.hash === hash);
  };

  // What the panel sees of a code: never the hash.
  const view = (entry, now = Date.now()) => ({
    id: entry.id,
    hint: entry.hint,
    offerId: entry.offerId,
    maxUses: entry.maxUses,
    multiplePerAccount: entry.multiplePerAccount,
    expiresAt: entry.expiresAt,
    createdAt: entry.createdAt,
    revokedAt: entry.revokedAt ?? null,
    uses: entry.uses.map(({ accountId, offerId, at }) => ({ accountId, offerId, at })),
    usedCount: entry.uses.length,
    status: entry.revokedAt ? "revoked" : entry.expiresAt && Date.parse(entry.expiresAt) <= now ? "expired"
      : entry.uses.length >= entry.maxUses ? "used_up" : "active"
  });

  return {
    list() {
      return Object.values(load().codes).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((entry) => view(entry));
    },

    // Makes a code: options.code typed in (4 to 64 letters, digits, - and _) or, without one, a random one. offerId is an
    // offer of store/currency.js or "any". Returns the code's view and, this once, its text. Throws an Error with the reason.
    create(options = {}) {
      const typed = normalizeCode(options.code);
      if (typed && !codePattern.test(typed)) throw new Error("A code is 4 to 64 letters, digits, hyphens or underscores.");
      const offerId = options.offerId === undefined || options.offerId === "" ? anyOffer : String(options.offerId);
      if (offerId !== anyOffer && !findRealMoneyOffer(offerId)) throw new Error(`Unknown offer ${offerId}.`);
      const uses = options.maxUses === undefined || options.maxUses === "" ? 1 : Number(options.maxUses);
      if (!Number.isInteger(uses) || uses < 1 || uses > maxUsesLimit) throw new Error(`Uses must be a whole number from 1 to ${maxUsesLimit.toLocaleString("en-US")}.`);
      let expiresAt = null;
      if (options.expiresAt) {
        const parsed = new Date(options.expiresAt);
        if (Number.isNaN(parsed.getTime())) throw new Error("The expiry isn't a date.");
        expiresAt = parsed.toISOString();
      }
      let code = typed;
      if (!code) do code = randomCode(); while (findByCode(code));
      else if (findByCode(code)) throw new Error("That code already exists.");
      const entry = {
        id: crypto.randomBytes(6).toString("hex"),
        hash: hashOf(code),
        hint: code.slice(-4),
        offerId,
        maxUses: uses,
        multiplePerAccount: options.multiplePerAccount === true,
        expiresAt,
        createdAt: new Date().toISOString(),
        revokedAt: null,
        uses: []
      };
      load().codes[entry.id] = entry;
      save();
      return { ...view(entry), code };
    },

    revoke(id) {
      const entry = load().codes[String(id)];
      if (!entry) return null;
      entry.revokedAt ??= new Date().toISOString();
      save();
      return view(entry);
    },

    reactivate(id) {
      const entry = load().codes[String(id)];
      if (!entry) return null;
      entry.revokedAt = null;
      save();
      return view(entry);
    },

    delete(id) {
      const entry = load().codes[String(id)];
      if (!entry) return false;
      delete load().codes[String(id)];
      save();
      return true;
    },

    // Claims one use of the code for the account's purchase of the offer. Synchronous from the check to the saved use, so
    // two requests can't both take a single-use code's last use. { id } on success, else { problem } (codeProblems).
    claim(code, { offerId, accountId, now = Date.now() }) {
      const entry = codePattern.test(normalizeCode(code)) ? findByCode(code) : undefined;
      if (!entry) return { problem: "invalid" };
      if (entry.revokedAt) return { problem: "revoked" };
      if (entry.expiresAt && Date.parse(entry.expiresAt) <= now) return { problem: "expired" };
      if (entry.offerId !== anyOffer && entry.offerId !== offerId) return { problem: "wrong_offer" };
      if (entry.uses.length >= entry.maxUses) return { problem: "used_up" };
      if (!entry.multiplePerAccount && entry.uses.some((use) => use.accountId === accountId)) return { problem: "used_by_account" };
      entry.uses.push({ accountId, offerId, at: new Date(now).toISOString() });
      save();
      return { id: entry.id };
    },

    // Gives back the account's latest use of a code, when the purchase it paid for didn't happen.
    release(id, accountId) {
      const entry = load().codes[id];
      const index = entry ? entry.uses.findLastIndex((use) => use.accountId === accountId) : -1;
      if (index < 0) return;
      entry.uses.splice(index, 1);
      save();
    }
  };
}
