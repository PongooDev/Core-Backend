import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";
import { isCoreAddress, normalizeEmail, validateEmail } from "./email.js";
import { hashPassword, isServerAccountName } from "./password.js";

// Every account has an email, <name>@core.com (Core-Backend #64), as Epic's accounts did: its own account info carries it.
// An address can't hold whitespace, so a name's spaces are left out.
export const accountEmail = (displayName) => `${displayName.replace(/\s+/g, "")}@core.com`;

// A player's own email (#120) is account.contactEmail, normalized (email.js), one per account and never two accounts
// the same. It is for signing in and for the player and the host to see: the game keeps getting account.email.
export class EmailError extends Error {
  constructor(message, taken = false) {
    super(message);
    this.taken = taken;
  }
}

export function createAccountStore(dataDir) {
  const dir = path.join(dataDir, "accounts");
  const byId = new Map();
  const byName = new Map();
  const byEmail = new Map();

  function remember(account) {
    byId.set(account.id, account);
    byName.set(account.displayName.toLowerCase(), account);
    // A hand-edited file could repeat another account's address: the first account loaded keeps it.
    if (account.contactEmail && !byEmail.has(account.contactEmail)) byEmail.set(account.contactEmail, account);
  }

  // The normalized address, or an EmailError: a bad address, or one another account has.
  function checkedEmail(raw, account) {
    const error = validateEmail(raw);
    if (error) throw new EmailError(error);
    const address = normalizeEmail(raw);
    const holder = byEmail.get(address);
    if (holder && holder !== account) throw new EmailError("That email is already linked to another account", true);
    return address;
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

    findByEmail(raw) {
      return byEmail.get(normalizeEmail(raw));
    },

    // What a player signs in with: their name, its <name>@core.com, or their linked email.
    findByLogin(login) {
      const text = String(login ?? "").trim();
      if (!text.includes("@")) return byName.get(text.toLowerCase());
      if (isCoreAddress(text)) return byName.get(text.split("@")[0].trim().toLowerCase());
      return byEmail.get(normalizeEmail(text));
    },

    // The normalized address if a new account could link it, else throws an EmailError.
    checkEmail(raw) {
      return checkedEmail(raw, null);
    },

    // raw: the new address, or empty/null to unlink it. Throws an EmailError.
    setContactEmail(account, raw) {
      const address = raw == null || !String(raw).trim() ? null : checkedEmail(String(raw), account);
      if (account.contactEmail && byEmail.get(account.contactEmail) === account) byEmail.delete(account.contactEmail);
      if (address) {
        account.contactEmail = address;
        byEmail.set(address, account);
      } else {
        delete account.contactEmail;
      }
      save(account);
      return account;
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

    // email: an optional contact email (#120); an unusable one throws an EmailError and makes no account.
    async createWithPassword(displayName, plainPassword, { email } = {}) {
      if (byName.has(displayName.toLowerCase())) return null;
      if (!plainPassword || typeof plainPassword !== "string" || !plainPassword.trim()) {
        throw new Error("A non-empty password is required to create an account");
      }
      if (isServerAccountName(displayName)) {
        throw new Error("Server account names (CoreServer{n}, Server{n} or CoreServer-<PC>-{n}) cannot be created with a password");
      }
      const contactEmail = email == null || !String(email).trim() ? null : checkedEmail(String(email), null);
      const account = {
        id: crypto.randomBytes(16).toString("hex"),
        displayName,
        email: accountEmail(displayName),
        created: new Date().toISOString(),
        password: await hashPassword(plainPassword),
        ...(contactEmail ? { contactEmail } : {})
      };
      // Two registrations of one address at once: the hash above awaited, so look again.
      if (contactEmail && byEmail.has(contactEmail)) throw new EmailError("That email is already linked to another account", true);
      if (byName.has(displayName.toLowerCase())) return null;
      save(account);
      remember(account);
      return account;
    },

    async setPassword(account, plainPassword) {
      account.password = await hashPassword(plainPassword);
      save(account);
    },

    clearPassword(account) {
      delete account.password;
      save(account);
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
      if (account.contactEmail && byEmail.get(account.contactEmail) === account) byEmail.delete(account.contactEmail);
      fs.rmSync(path.join(dir, account.id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}
