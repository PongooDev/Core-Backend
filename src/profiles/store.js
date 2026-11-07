import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";
import { addMissingItems, addMissingStats, upgradeItems } from "./defaults.js";

// settings: what the host chose that changes what profiles hold, read when a profile is set up (profiles/setup.js):
// giveAllCosmetics (config.json), wonSeasons(accountId), the seasons the account has a recorded win in solo, duo or squad in,
// and twitchPrimePack(), whether Season 3's Twitch Prime pack is given (the admin panel's switch).
export function createProfileStore(dataDir, settings = {}) {
  const file = (accountId, profileId) => path.join(dataDir, "accounts", accountId, "profiles", `${profileId}.json`);
  const cache = new Map();
  const cacheKey = (accountId, profileId) => `${accountId}:${profileId}`;

  return {
    settings,

    exists(accountId, profileId) {
      return fs.existsSync(file(accountId, profileId));
    },

    load(accountId, profileId) {
      const target = file(accountId, profileId);
      const key = cacheKey(accountId, profileId);
      const stat = fs.statSync(target, { throwIfNoEntry: false });

      if (stat) {
        const cached = cache.get(key);
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          return structuredClone(cached.profile);
        }

        const existing = readJson(target);
        const changed = [addMissingStats(existing), addMissingItems(existing), upgradeItems(existing)];
        if (changed.some(Boolean)) {
          existing.rvn += 1;
          writeJson(target, existing);
          const newStat = fs.statSync(target, { throwIfNoEntry: false });
          cache.set(key, { mtimeMs: newStat ? newStat.mtimeMs : stat.mtimeMs, profile: structuredClone(existing) });
        } else {
          cache.set(key, { mtimeMs: stat.mtimeMs, profile: structuredClone(existing) });
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
      const newStat = fs.statSync(target, { throwIfNoEntry: false });
      cache.set(key, { mtimeMs: newStat ? newStat.mtimeMs : Date.now(), profile: structuredClone(profile) });
      return profile;
    },

    // A reset: the next load makes the profile anew from the defaults.
    remove(accountId, profileId) {
      cache.delete(cacheKey(accountId, profileId));
      fs.rmSync(file(accountId, profileId), { force: true });
    },

    ids(accountId) {
      const dir = path.join(dataDir, "accounts", accountId, "profiles");
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)) : [];
    },

    save(profile) {
      profile.updated = new Date().toISOString();
      const target = file(profile.accountId, profile.profileId);
      writeJson(target, profile);
      const stat = fs.statSync(target, { throwIfNoEntry: false });
      cache.set(cacheKey(profile.accountId, profile.profileId), {
        mtimeMs: stat ? stat.mtimeMs : Date.now(),
        profile: structuredClone(profile)
      });
    }
  };
}
