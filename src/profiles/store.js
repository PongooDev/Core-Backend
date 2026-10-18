import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

export function createProfileStore(dataDir) {
  const file = (accountId, profileId) => path.join(dataDir, "accounts", accountId, "profiles", `${profileId}.json`);

  return {
    load(accountId, profileId) {
      const target = file(accountId, profileId);
      if (fs.existsSync(target)) return readJson(target);

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
      writeJson(target, profile);
      return profile;
    },

    save(profile) {
      profile.updated = new Date().toISOString();
      writeJson(file(profile.accountId, profile.profileId), profile);
    }
  };
}
