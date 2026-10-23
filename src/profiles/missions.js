// Quest progress that counts only in a won primary mission (objectives with bRequirePrimaryMissionCompletion, e.g.
// "Save 3 Survivors in successful missions"). The gameserver reports it as it happens, in UpdateQuests,
// BatchUpdatePlayer and EndPrimaryMission, between its StartPrimaryMission and EndPrimaryMission for the player
// (UFortQuestManager sets bHasUnsavedPrimaryMissionProgress for it meanwhile). It waits here until EndPrimaryMission,
// which applies it when the mission succeeded and drops it otherwise. A new StartPrimaryMission drops a mission that
// never ended. Kept in memory: a restart drops a mission in progress.
export function heldProgress() {
  const counts = new Map();
  return {
    add(itemId, name, count) {
      const key = `${itemId}\n${name}`;
      counts.set(key, (counts.get(key) ?? 0) + count);
    },
    entries() {
      return [...counts].map(([key, count]) => {
        const [itemId, name] = key.split("\n");
        return { itemId, name, count };
      });
    }
  };
}

export function createPrimaryMissions() {
  const missions = new Map();
  return {
    start(accountId) {
      missions.set(accountId, heldProgress());
    },
    // The held progress of the player's primary mission, or null outside one.
    held(accountId) {
      return missions.get(accountId) ?? null;
    },
    end(accountId) {
      const held = missions.get(accountId) ?? null;
      missions.delete(accountId);
      return held;
    }
  };
}
