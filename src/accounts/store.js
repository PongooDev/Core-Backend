import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

export function createAccountStore(dataDir) {
  const dir = path.join(dataDir, "accounts");
  const byId = new Map();
  const byName = new Map();

  function remember(account) {
    byId.set(account.id, account);
    byName.set(account.displayName.toLowerCase(), account);
  }

  fs.mkdirSync(dir, { recursive: true });
  for (const id of fs.readdirSync(dir)) {
    const file = path.join(dir, id, "account.json");
    if (fs.existsSync(file)) remember(readJson(file));
  }

  function save(account) {
    writeJson(path.join(dir, account.id, "account.json"), account);
  }

  return {
    get(id) {
      return byId.get(id);
    },

    getOrCreate(displayName) {
      let account = byName.get(displayName.toLowerCase());
      if (!account) {
        account = { id: crypto.randomBytes(16).toString("hex"), displayName, created: new Date().toISOString() };
        save(account);
        remember(account);
      }
      return account;
    },

    recordLogin(account) {
      account.lastLogin = new Date().toISOString();
      save(account);
    }
  };
}
