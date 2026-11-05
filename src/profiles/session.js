import { changeTemplate, fullProfile, trackChanges, visibleChanges } from "./changes.js";
import { accountViews, isAccountView, usesCommonProfiles, viewChanges, viewProfile, viewRevision } from "./common.js";
import { needsSetUp, setUpProfile } from "./setup.js";
import { settleVault } from "./vault.js";

// The profile Core saves a profile id's data in: 3.5's campaign, common_core and common_public are views of profile0
// (profiles/common.js).
export const storedProfileId = (profileId) => (isAccountView(profileId) ? "profile0" : profileId);

// One command's view of an account's profiles: loads each on first use and saves the changed ones together.
export function openSession(profiles, accountId, { setUp = true } = {}) {
  const opened = new Map();

  // profile0's changes that are one view's.
  const changesOf = (tracker, viewId) => viewChanges(visibleChanges(tracker.changes), viewId, tracker.profile, changeTemplate);

  function update(profileId, clientRevision) {
    const { baseRevision, viewBases, tracker } = opened.get(storedProfileId(profileId));
    const { profile } = tracker;
    if (isAccountView(profileId)) {
      const base = viewBases[profileId];
      return {
        profileRevision: viewRevision(profile, profileId).rvn,
        profileId,
        profileChangesBaseRevision: base,
        profileChanges: clientRevision === base
          ? changesOf(tracker, profileId)
          : [{ changeType: "fullProfileUpdate", profile: viewProfile(fullProfile(profile), profileId) }],
        profileCommandRevision: viewRevision(profile, profileId).commandRevision
      };
    }
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

  // The ids the client knows profile0's changes by: the views that have some on 3.5 and later, profile0 before.
  const changedIds = (profileId, tracker) => {
    if (profileId !== "profile0" || !usesCommonProfiles(accountId)) return tracker.changes.length ? [profileId] : [];
    return accountViews.filter((viewId) => changesOf(tracker, viewId).length);
  };

  return {
    accountId,

    // The host's profile settings (profiles/store.js).
    settings: profiles.settings ?? {},

    // Whether the account has the profile, without making it.
    hasProfile(profileId) {
      const stored = storedProfileId(profileId);
      return opened.has(stored) || profiles.exists(accountId, stored);
    },

    profile(requestedId) {
      const profileId = storedProfileId(requestedId);
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
        const viewBases = profileId === "profile0"
          ? Object.fromEntries(accountViews.map((viewId) => [viewId, viewRevision(profile, viewId).rvn]))
          : null;
        opened.set(profileId, { baseRevision: profile.rvn, viewBases, tracker: trackChanges(profile) });
      }
      return opened.get(profileId).tracker;
    },

    // The revision the client last had of a profile when this command began, its view's for campaign, common_core
    // and common_public.
    revision(profileId) {
      const { profile } = this.profile(profileId);
      return isAccountView(profileId) ? viewRevision(profile, profileId).rvn : profile.rvn;
    },

    commit({ newRevision = true } = {}) {
      // A change to profile0 can fill or free the vault: its overflow follows (profiles/vault.js).
      const account = opened.get("profile0");
      if (account?.tracker.changes.length) {
        settleVault(account.tracker);
        // Whatever build asks, each of 3.5's views of profile0 counts the changes that are its (profiles/common.js), so
        // a 3.5 client's copy stays right while its account plays on an earlier build too.
        const { profile } = account.tracker;
        const views = Object.fromEntries(accountViews.map((viewId) => {
          const { rvn, commandRevision } = profile.coreViews?.[viewId] ?? { rvn: account.viewBases[viewId], commandRevision: profile.commandRevision };
          const changed = newRevision && changesOf(account.tracker, viewId).length > 0;
          return [viewId, { rvn: rvn + (changed ? 1 : 0), commandRevision: commandRevision + (changed ? 1 : 0) }];
        }));
        profile.coreViews = views;
      }
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
      return [...opened].flatMap(([storedId, { tracker }]) => changedIds(storedId, tracker).map((profileId) => {
        const view = isAccountView(profileId);
        const { rvn, commandRevision } = view ? viewRevision(tracker.profile, profileId) : tracker.profile;
        return {
          profileId,
          changes: view ? changesOf(tracker, profileId) : visibleChanges(tracker.changes),
          revision: rvn,
          commandRevision
        };
      }));
    },

    // whole: other profiles of the account's that go along in full (multiUpdate), changed or not; one it doesn't have
    // is left out rather than made.
    response(profileId, clientRevision, notifications = [], whole = []) {
      const result = { ...update(profileId, clientRevision), serverTime: new Date().toISOString() };
      const others = [...opened]
        .flatMap(([storedId, { tracker }]) => changedIds(storedId, tracker))
        .filter((id) => id !== profileId)
        .map((id) => update(id, isAccountView(id) ? opened.get("profile0").viewBases[id] : opened.get(id).baseRevision));
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
