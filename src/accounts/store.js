import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

// Every account has an email, <name>@core.com (Core-Backend #64), as Epic's accounts did: its own account info carries it.
// An address can't hold whitespace, so a name's spaces are left out.
export const accountEmail = (displayName) => `${displayName.replace(/\s+/g, "")}@core.com`;

export function createAccountStore(dataDir) {
  const dir = path.join(dataDir, "accounts");
  const byId = new Map();
  const byName = new Map();

  function remember(account) {
    byId.set(account.id, account);
    byName.set(account.displayName.toLowerCase(), account);
  }

  function save(account) {
    writeJson(path.join(dir, account.id, "account.json"), account);
  }

  fs.mkdirSync(dir, { recursive: true });
  for (const id of fs.readdirSync(dir)) {
    const file = path.join(dir, id, "account.json");
    if (!fs.existsSync(file)) continue;
    const account = readJson(file);
    // Accounts made before #64 get theirs on the next start.
    if (!account.email) {
      account.email = accountEmail(account.displayName);
      save(account);
    }
    remember(account);
  }

  return {
    get(id) {
      return byId.get(id);
    },

    list() {
      return [...byId.values()];
    },

    findByName(displayName) {
      return byName.get(displayName.toLowerCase());
    },

    getOrCreate(displayName) {
      let account = byName.get(displayName.toLowerCase());
      if (!account) {
        account = { id: crypto.randomBytes(16).toString("hex"), displayName, email: accountEmail(displayName), created: new Date().toISOString() };
        save(account);
        remember(account);
      }
      return account;
    },

    recordLogin(account) {
      account.lastLogin = new Date().toISOString();
      save(account);
    },

    // ban: {reason, at} or null to lift it.
    setBan(account, ban) {
      if (ban) account.banned = ban;
      else delete account.banned;
      save(account);
    },

    // The account and everything saved for it (profiles, friends, cloud storage).
    remove(account) {
      byId.delete(account.id);
      byName.delete(account.displayName.toLowerCase());
      fs.rmSync(path.join(dir, account.id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}
