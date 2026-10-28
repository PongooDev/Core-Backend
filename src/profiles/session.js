import { fullProfile, trackChanges, visibleChanges } from "./changes.js";
import { needsSetUp, setUpProfile } from "./setup.js";
import { settleVault } from "./vault.js";

// One command's view of an account's profiles: loads each on first use and saves the changed ones together.
export function openSession(profiles, accountId, { setUp = true } = {}) {
  const opened = new Map();

  function update(profileId, clientRevision) {
    const { baseRevision, tracker } = opened.get(profileId);
    const { profile } = tracker;
    return {
      profileRevision: profile.rvn,
      profileId,
      profileChangesBaseRevision: baseRevision,
      profileChanges: clientRevision === baseRevision
        ? visibleChanges(tracker.changes)
        : [{ changeType: "fullProfileUpdate", profile: fullProfile(profile) }],
      profileCommandRevision: profile.commandRevision
    };
  }

  return {
    accountId,

    // The host's profile settings (profiles/store.js).
    settings: profiles.settings ?? {},

    // Whether the account has the profile, without making it.
    hasProfile(profileId) {
      return opened.has(profileId) || profiles.exists(accountId, profileId);
    },

    profile(profileId) {
      if (!opened.has(profileId)) {
        const created = !profiles.exists(accountId, profileId);
        let profile = profiles.load(accountId, profileId);
        // A new profile0 or theater0 is set up as a command of its own first (profiles/setup.js), so this one starts from
        // it. No client has seen a profile made just now, so what it starts with leaves it at its first revision.
        if (setUp && needsSetUp(profile, profiles.settings ?? {})) {
          const setup = openSession(profiles, accountId, { setUp: false });
          setUpProfile(setup, profileId);
          setup.commit({ newRevision: !created });
          // The setup may only have noted a one-time migration (coreMigrations), which no tracked change saves.
          profiles.save(setup.profile(profileId).profile);
          profile = profiles.load(accountId, profileId);
        }
        opened.set(profileId, { baseRevision: profile.rvn, tracker: trackChanges(profile) });
      }
      return opened.get(profileId).tracker;
    },

    commit({ newRevision = true } = {}) {
      // A change to profile0 can fill or free the vault: its overflow follows (profiles/vault.js).
      const account = opened.get("profile0")?.tracker;
      if (account?.changes.length) settleVault(account);
      for (const { tracker } of opened.values()) {
        if (!tracker.changes.length) continue;
        if (newRevision) {
          tracker.profile.rvn += 1;
          tracker.profile.commandRevision += 1;
        }
        profiles.save(tracker.profile);
      }
    },

    // The profiles this command changed, as MCP's profile notifications carry them (FProfileUpdateNotification).
    changedProfiles() {
      return [...opened].filter(([, { tracker }]) => tracker.changes.length).map(([profileId, { tracker }]) => ({
        profileId, changes: visibleChanges(tracker.changes), revision: tracker.profile.rvn, commandRevision: tracker.profile.commandRevision
      }));
    },

    // whole: other profiles of the account's that go along in full (multiUpdate), changed or not; one it doesn't have
    // is left out rather than made.
    response(profileId, clientRevision, notifications = [], whole = []) {
      const result = { ...update(profileId, clientRevision), serverTime: new Date().toISOString() };
      const others = [...opened]
        .filter(([id, { tracker }]) => id !== profileId && tracker.changes.length)
        .map(([id, { baseRevision }]) => update(id, baseRevision));
      for (const id of whole) {
        if (id === profileId || others.some((other) => other.profileId === id) || !this.hasProfile(id)) continue;
        this.profile(id);
        others.push(update(id, null));
      }
      if (others.length) result.multiUpdate = others;
      if (notifications.length) result.notifications = notifications;
      return result;
    }
  };
}
