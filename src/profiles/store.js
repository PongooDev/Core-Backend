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
  // The most recently used profiles, keyed to the file's mtime so an edit on disk is read again. Capped: a full
  // locker's athena profile is megabytes, and a server with many accounts would otherwise keep every one in memory.
  const maxCached = 256;
  const remember = (key, target, profile, stat = fs.statSync(target, { throwIfNoEntry: false })) => {
    cache.delete(key);
    if (!stat) return;
    cache.set(key, { mtimeMs: stat.mtimeMs, profile: structuredClone(profile) });
    if (cache.size > maxCached) cache.delete(cache.keys().next().value);
  };

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
        // The cache only saves reading and parsing the file: the starting items are the requesting build's (its
        // starter banners), so a profile last loaded by another build still gets this build's added.
        const cached = cache.get(key);
        const existing = cached && cached.mtimeMs === stat.mtimeMs ? structuredClone(cached.profile) : readJson(target);
        const changed = [addMissingStats(existing), addMissingItems(existing), upgradeItems(existing)];
        if (changed.some(Boolean)) {
          existing.rvn += 1;
          writeJson(target, existing);
          remember(key, target, existing);
        } else if (!cached || cached.mtimeMs !== stat.mtimeMs) {
          remember(key, target, existing, stat);
        } else {
          cache.delete(key);
          cache.set(key, cached);
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
      remember(key, target, profile);
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
      remember(cacheKey(profile.accountId, profile.profileId), target, profile);
    }
  };
}
