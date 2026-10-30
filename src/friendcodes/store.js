import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

// The friend codes and promotional reward codes Core has issued, stored in <dataDir>/friendcodes.json.
// Codes can be generated automatically or customized with V-Bucks, Founder's packs, Campaign access,
// Battle Royale cosmetics, and Save the World items/materials.
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const codePattern = /^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){3}$/;

// A code that can't be redeemed (unknown, expired, used up, already redeemed by the account, or the account's own).
export class RedeemError extends Error {}

export function randomCode() {
  const group = () => Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return [group(), group(), group(), group()].join("-");
}

const founderTierNames = [
  "None",
  "Standard Founder's Pack",
  "Deluxe Founder's Pack",
  "Super Deluxe Founder's Pack",
  "Limited Edition Founder's Pack",
  "Ultimate Edition Founder's Pack"
];

function resolveRewards(entry) {
  if (entry?.rewards && typeof entry.rewards === "object") {
    const vbucks = Number.isInteger(entry.rewards.vbucks) && entry.rewards.vbucks >= 0 ? entry.rewards.vbucks : 0;
    const foundersEdition = Number.isInteger(entry.rewards.foundersEdition) && entry.rewards.foundersEdition >= 0 && entry.rewards.foundersEdition <= 5
      ? entry.rewards.foundersEdition : 0;
    const campaignAccess = Boolean(entry.rewards.campaignAccess || (foundersEdition >= 1));
    const items = Array.isArray(entry.rewards.items) ? entry.rewards.items.filter((it) => it && typeof it.templateId === "string") : [];
    return {
      vbucks,
      foundersEdition,
      foundersTierName: foundersEdition > 0 ? (founderTierNames[foundersEdition] || `Founder's Tier ${foundersEdition}`) : null,
      campaignAccess,
      items
    };
  }
  // Backward compatibility with legacy Founder's friend codes
  const isFounderToken = String(entry?.codeType ?? "").toLowerCase() === "codetoken:founderfriendinvite";
  return {
    vbucks: 0,
    foundersEdition: isFounderToken ? 1 : 0,
    foundersTierName: isFounderToken ? "Standard Founder's Pack" : null,
    campaignAccess: isFounderToken,
    items: []
  };
}

function isPlayerFriendCode(entry) {
  return String(entry?.codeType ?? "").toLowerCase() === "codetoken:founderfriendinvite"
    || (Boolean(entry?.accountId) && entry?.codeType !== "custom");
}

export function createFriendCodeStore(dataDir) {
  const file = path.join(dataDir, "friendcodes.json");
  let codes = null;
  let folders = null;
  const locks = new Set();

  const loadData = () => {
    if (!codes) {
      if (fs.existsSync(file)) {
        const data = readJson(file);
        codes = data.codes ?? {};
        folders = Array.isArray(data.folders) && data.folders.length > 0
          ? data.folders
          : [{ name: "Promotional", slug: "promotional" }];
      } else {
        codes = {};
        folders = [{ name: "Promotional", slug: "promotional" }];
      }
    }
    return { codes, folders };
  };

  const load = () => loadData().codes;
  const loadFolders = () => loadData().folders;
  const save = () => writeJson(file, { codes: load(), folders: loadFolders() });

  async function withLock(codeKey, fn) {
    while (locks.has(codeKey)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    locks.add(codeKey);
    try {
      return await fn();
    } finally {
      locks.delete(codeKey);
    }
  }

  function findEntry(code) {
    const all = load();
    const clean = String(code ?? "").trim().toUpperCase();
    if (!clean) return null;
    if (all[clean]) return { key: clean, entry: all[clean] };
    const match = Object.keys(all).find((k) => k.toUpperCase() === clean);
    return match ? { key: match, entry: all[match] } : null;
  }

  function formatEntry(code, entry) {
    const now = new Date();
    const maxUses = entry.maxUses ?? 1;
    const redeemedCount = entry.redeemedCount ?? (Array.isArray(entry.redeemedBy) ? entry.redeemedBy.length : (entry.redeemedBy ? 1 : 0));
    const isExpired = Boolean(entry.expiresAt && new Date(entry.expiresAt) <= now);
    const isDepleted = redeemedCount >= maxUses;
    const isFriend = isPlayerFriendCode(entry);
    return {
      code,
      ...entry,
      folder: entry.folder || "promotional",
      isFriendCode: isFriend,
      maxUses,
      redeemedCount,
      isExpired,
      isDepleted,
      rewards: resolveRewards(entry)
    };
  }

  return {
    // Folders
    listFolders() {
      const list = loadFolders();
      return list.map((f) => (typeof f === "string" ? { name: f.charAt(0).toUpperCase() + f.slice(1), slug: f } : f));
    },

    createFolder(name, slug) {
      const cleanName = String(name ?? "").trim().slice(0, 40);
      if (!cleanName) throw new Error("Folder name is required.");
      let cleanSlug = String(slug || cleanName).toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 40);
      if (!cleanSlug) cleanSlug = "folder-" + Date.now();
      const reserved = ["active", "archived-codes", "all"];
      if (reserved.includes(cleanSlug)) throw new Error(`Slug "${cleanSlug}" is reserved.`);
      const list = loadFolders();
      if (list.some((f) => (typeof f === "string" ? f : f.slug) === cleanSlug)) {
        throw new Error(`Folder with slug "${cleanSlug}" already exists.`);
      }
      list.push({ name: cleanName, slug: cleanSlug });
      save();
      return { name: cleanName, slug: cleanSlug };
    },

    deleteFolder(slug) {
      const cleanSlug = String(slug ?? "").trim().toLowerCase();
      if (cleanSlug === "promotional" || cleanSlug === "active" || cleanSlug === "archived-codes" || cleanSlug === "all") {
        throw new Error(`Cannot delete built-in folder "${cleanSlug}".`);
      }
      const list = loadFolders();
      const idx = list.findIndex((f) => (typeof f === "string" ? f : f.slug) === cleanSlug);
      if (idx === -1) return false;
      list.splice(idx, 1);
      // Its codes stay, in Promotional, so the panel still lists them in a folder.
      for (const entry of Object.values(load())) {
        if (entry.folder === cleanSlug) entry.folder = "promotional";
      }
      save();
      return true;
    },

    // Issues a player friend code (e.g. from in-game Founder's friend code tokens or admin grant)
    issue(accountId, codeType, backend = "epic") {
      const all = load();
      let code;
      do code = randomCode(); while (all[code]);
      const isFounderToken = String(codeType ?? "").toLowerCase() === "codetoken:founderfriendinvite";
      all[code] = {
        accountId,
        codeType: isFounderToken ? "CodeToken:founderfriendinvite" : (codeType || "CodeToken:founderfriendinvite"),
        backend,
        created: new Date().toISOString(),
        createdBy: accountId,
        maxUses: 1,
        redeemedCount: 0,
        redeemedBy: [],
        expiresAt: null,
        note: isFounderToken ? "Founder's Standard Edition Friend Code" : "Player Friend Code",
        rewards: {
          foundersEdition: isFounderToken ? 1 : 0,
          campaignAccess: isFounderToken,
          vbucks: 0,
          items: []
        }
      };
      save();
      return { code, codeType: all[code].codeType };
    },

    // Creates an admin/promotional redeem code
    create(options = {}) {
      const all = load();
      let code = options.code ? String(options.code).trim().toUpperCase() : randomCode();
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(code)) {
        throw new Error("Code must be between 3 and 64 characters and contain only letters, numbers, hyphens or underscores.");
      }
      if (all[code]) {
        throw new Error(`Code "${code}" already exists.`);
      }

      const vbucks = Number.isInteger(options.vbucks) && options.vbucks >= 0 && options.vbucks <= 100000 ? options.vbucks : 0;
      const foundersEdition = Number.isInteger(options.foundersEdition) && options.foundersEdition >= 0 && options.foundersEdition <= 5
        ? options.foundersEdition : 0;
      const campaignAccess = Boolean(options.campaignAccess || foundersEdition >= 1);
      const items = Array.isArray(options.items)
        ? options.items
          .filter((it) => it && typeof it.templateId === "string" && it.templateId.trim())
          .map((it) => ({
            templateId: it.templateId.trim(),
            quantity: Number.isInteger(it.quantity) && it.quantity >= 1 && it.quantity <= 100000 ? it.quantity : 1
          }))
        : [];

      const maxUses = Number.isInteger(options.maxUses) && options.maxUses >= 1 && options.maxUses <= 1000000 ? options.maxUses : 1;
      let expiresAt = null;
      if (options.expiresAt) {
        const parsed = new Date(options.expiresAt);
        if (!Number.isNaN(parsed.getTime())) {
          expiresAt = parsed.toISOString();
        }
      }

      const note = typeof options.note === "string" ? options.note.trim().slice(0, 120) : "";
      // Only a folder that exists: a code filed anywhere else would show in no folder of the panel.
      const folder = typeof options.folder === "string" && options.folder.trim() ? options.folder.trim().toLowerCase() : "promotional";
      if (!loadFolders().some((f) => (typeof f === "string" ? f : f.slug) === folder)) {
        throw new Error(`No folder "${folder}".`);
      }

      const entry = {
        codeType: "custom",
        folder,
        backend: "epic",
        created: new Date().toISOString(),
        // Only the panel makes these codes; an account id here would list the code as that player's friend code.
        createdBy: "admin",
        note,
        maxUses,
        redeemedCount: 0,
        redeemedBy: [],
        expiresAt,
        rewards: {
          vbucks,
          foundersEdition,
          campaignAccess,
          items
        }
      };

      all[code] = entry;
      save();
      return formatEntry(code, entry);
    },

    get(code) {
      const found = findEntry(code);
      if (!found) return null;
      return formatEntry(found.key, found.entry);
    },

    list() {
      const all = load();
      return Object.entries(all)
        .map(([code, entry]) => formatEntry(code, entry))
        .sort((a, b) => b.created.localeCompare(a.created));
    },

    listPlayerFriendCodes() {
      return this.list().filter((c) => c.isFriendCode);
    },

    listForAccount(accountId) {
      const cleanId = String(accountId ?? "").toLowerCase();
      return this.list().filter((c) =>
        (c.accountId && c.accountId.toLowerCase() === cleanId) ||
        (c.createdBy && c.createdBy.toLowerCase() === cleanId)
      );
    },

    listPromotionalCodes(filterFolder) {
      const promos = this.list().filter((c) => !c.isFriendCode);
      if (!filterFolder || filterFolder === "all") return promos;
      if (filterFolder === "archived-codes") {
        return promos.filter((c) => c.isDepleted || c.isExpired);
      }
      if (filterFolder === "active") {
        return promos.filter((c) => !c.isDepleted && !c.isExpired);
      }
      return promos.filter((c) => c.folder === filterFolder);
    },

    delete(code) {
      const all = load();
      const found = findEntry(code);
      if (!found) return false;
      delete all[found.key];
      save();
      return true;
    },

    // FIssuedFriendCode {CodeId, CodeType, DateCreated} for each of the account's codes on that backend, oldest first.
    unredeemed(accountId, backend = "epic") {
      const now = new Date();
      return Object.entries(load())
        .filter(([, entry]) => {
          if (entry.accountId !== accountId || entry.backend !== backend.toLowerCase()) return false;
          const maxUses = entry.maxUses ?? 1;
          const redeemedCount = entry.redeemedCount ?? (Array.isArray(entry.redeemedBy) ? entry.redeemedBy.length : (entry.redeemedBy ? 1 : 0));
          if (redeemedCount >= maxUses) return false;
          if (entry.expiresAt && new Date(entry.expiresAt) <= now) return false;
          return true;
        })
        .sort(([, a], [, b]) => a.created.localeCompare(b.created))
        .map(([codeId, entry]) => ({ codeId, codeType: entry.codeType, dateCreated: entry.created }));
    },

    // Redeems a code for the account: checks it, runs apply(rewards) (which gives them; Core-Backend #126) and only then
    // records the redemption, so a code is never used up by a redemption that gave nothing. A refusal throws a
    // RedeemError; whatever apply throws passes through with nothing recorded.
    async redeem(codeStr, account, ip = "", apply = () => {}) {
      if (!account || !account.id) throw new RedeemError("Account required for redemption.");
      if (account.banned) throw new RedeemError("This account is banned and cannot redeem codes.");

      const cleanCode = String(codeStr ?? "").trim().toUpperCase();
      if (!cleanCode) throw new RedeemError("Code is required.");

      return withLock(cleanCode, async () => {
        const found = findEntry(cleanCode);
        if (!found) throw new RedeemError("Invalid or expired code.");

        const { key: code, entry } = found;
        const now = new Date();
        if (entry.expiresAt && new Date(entry.expiresAt) <= now) throw new RedeemError("This promotional code has expired.");

        const maxUses = entry.maxUses ?? 1;
        const currentCount = entry.redeemedCount ?? (Array.isArray(entry.redeemedBy) ? entry.redeemedBy.length : (entry.redeemedBy ? 1 : 0));
        if (currentCount >= maxUses) throw new RedeemError("This code has already been redeemed.");

        // A friend code is for a friend: the player it was issued to can't redeem it themselves.
        if (isPlayerFriendCode(entry) && entry.accountId === account.id) throw new RedeemError("You can't redeem your own friend code.");

        const history = Array.isArray(entry.redeemedBy)
          ? entry.redeemedBy
          : (entry.redeemedBy ? [{ accountId: entry.redeemedBy }] : []);
        if (history.some((r) => r.accountId === account.id)) throw new RedeemError("You have already redeemed this code.");

        const rewards = resolveRewards(entry);
        const applied = await apply(rewards);

        entry.redeemedBy = [...history, {
          accountId: account.id,
          displayName: account.displayName || account.id,
          ip: String(ip || ""),
          redeemedAt: now.toISOString()
        }];
        entry.redeemedCount = entry.redeemedBy.length;
        save();

        return { code, rewards, applied };
      });
    }
  };
}
