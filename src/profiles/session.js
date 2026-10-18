import { fullProfile, trackChanges } from "./changes.js";

// One command's view of an account's profiles: loads each on first use and saves the changed ones together.
export function openSession(profiles, accountId) {
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
        const profile = profiles.load(accountId, profileId);
        opened.set(profileId, { baseRevision: profile.rvn, tracker: trackChanges(profile) });
      }
      return opened.get(profileId).tracker;
    },

    commit() {
      for (const { tracker } of opened.values()) {
        if (!tracker.changes.length) continue;
        tracker.profile.rvn += 1;
        tracker.profile.commandRevision += 1;
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
