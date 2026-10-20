// The gameserver's write locks on a player's world profiles (theater0, outpost0). The game keeps a profile
// write-locked only while every response for it carries `lockExpiration` (FProfileUpdate.LockExpiration, FDateTime):
// UMcpProfile's response handler (sub_390AA80) releases the lock ("Write Lock released for *%s as part of response")
// when a locked profile's response has none, and the server only saves (IsSafeToSave) while locked. The lock is taken
// by LockProfiles ("Write Lock acquired for *%s", sub_390C470) and given back by UnlockProfiles /
// UnlockProfileForWrite. Each server command renews it; the timeout comes from the request's
// X-EpicGames-ProfileWriteLock header (`key=%s; timeout=%d; profileIds=%s`) when it has one.
const defaultTimeoutSeconds = 300;
const isWorldProfile = (profileId) => /^(theater|outpost)\d+$/.test(profileId);

export function createProfileLocks() {
  const locks = new Map();

  return {
    lock(accountId, timeoutSeconds = defaultTimeoutSeconds) {
      locks.set(accountId, { timeoutSeconds, expires: Date.now() + timeoutSeconds * 1000 });
    },

    unlock(accountId) {
      locks.delete(accountId);
    },

    renew(accountId) {
      const held = locks.get(accountId);
      if (!held) return;
      if (held.expires < Date.now()) locks.delete(accountId);
      else held.expires = Date.now() + held.timeoutSeconds * 1000;
    },

    // The lockExpiration a response for this profile carries, or undefined when it isn't locked.
    expiration(accountId, profileId) {
      const held = locks.get(accountId);
      return held && isWorldProfile(profileId) && held.expires >= Date.now() ? new Date(held.expires).toISOString() : undefined;
    }
  };
}

// X-EpicGames-ProfileWriteLock: key=...; timeout=60; profileIds=theater0,outpost0
export function lockTimeout(header) {
  const match = /(?:^|;)\s*timeout=(\d+)/.exec(header ?? "");
  return match ? Number(match[1]) : undefined;
}
