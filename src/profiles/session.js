import { fullProfile, trackChanges } from "./changes.js";
import { needsSetUp, setUpProfile } from "./setup.js";

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
        ? tracker.changes
        : [{ changeType: "fullProfileUpdate", profile: fullProfile(profile) }],
      profileCommandRevision: profile.commandRevision
    };
  }

  return {
    accountId,

    profile(profileId) {
      if (!opened.has(profileId)) {
        const created = !profiles.exists(accountId, profileId);
        let profile = profiles.load(accountId, profileId);
        // A new profile0 is set up as a command of its own first (profiles/setup.js), so this one starts from it. No
        // client has seen a profile made just now, so what it starts with leaves it at its first revision.
        if (setUp && needsSetUp(profile)) {
          const setup = openSession(profiles, accountId, { setUp: false });
          setUpProfile(setup);
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
      for (const { tracker } of opened.values()) {
        if (!tracker.changes.length) continue;
        if (newRevision) {
          tracker.profile.rvn += 1;
          tracker.profile.commandRevision += 1;
        }
        profiles.save(tracker.profile);
      }
    },

    response(profileId, clientRevision, notifications = []) {
      const result = { ...update(profileId, clientRevision), serverTime: new Date().toISOString() };
      const others = [...opened]
        .filter(([id, { tracker }]) => id !== profileId && tracker.changes.length)
        .map(([id, { baseRevision }]) => update(id, baseRevision));
      if (others.length) result.multiUpdate = others;
      if (notifications.length) result.notifications = notifications;
      return result;
    }
  };
}
