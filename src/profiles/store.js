import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";
import { addMissingItems, addMissingStats, upgradeItems } from "./defaults.js";

export function createProfileStore(dataDir) {
  const file = (accountId, profileId) => path.join(dataDir, "accounts", accountId, "profiles", `${profileId}.json`);

  return {
    exists(accountId, profileId) {
      return fs.existsSync(file(accountId, profileId));
    },

    load(accountId, profileId) {
      const target = file(accountId, profileId);
      if (fs.existsSync(target)) {
        const existing = readJson(target);
        const changed = [addMissingStats(existing), addMissingItems(existing), upgradeItems(existing)];
        if (changed.some(Boolean)) {
          existing.rvn += 1;
          writeJson(target, existing);
        }
        return existing;
      }

      const now = new Date().toISOString();
      const profile = {
        profileId,
        accountId,
        created: now,
        updated: now,
        rvn: 1,
        wipeNumber: 1,
        version: "core",
        commandRevision: 0,
        stats: { attributes: {} },
        items: {}
      };
      addMissingStats(profile);
      addMissingItems(profile);
      writeJson(target, profile);
      return profile;
    },

    // A reset: the next load makes the profile anew from the defaults.
    remove(accountId, profileId) {
      fs.rmSync(file(accountId, profileId), { force: true });
    },

    ids(accountId) {
      const dir = path.join(dataDir, "accounts", accountId, "profiles");
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)) : [];
    },

    save(profile) {
      profile.updated = new Date().toISOString();
      writeJson(file(profile.accountId, profile.profileId), profile);
    }
  };
}
