// Quest progress that counts only in a won primary mission (objectives with bRequirePrimaryMissionCompletion, e.g.
// "Save 3 Survivors in successful missions"). The gameserver reports it as it happens, in UpdateQuests,
// BatchUpdatePlayer and EndPrimaryMission, between its StartPrimaryMission and EndPrimaryMission for the player
// (UFortQuestManager sets bHasUnsavedPrimaryMissionProgress for it meanwhile). It counts at once, so the quest item the
// response carries back has it: the server's in-zone count (AFortPlayerController.UpdatedObjectiveStats, which the
// toast and the Quests tab show) is that item's count plus what it sent and hasn't had answered yet (sub_7AD770,
// sub_793ED0). What this holds is how much each objective went up, and its quest isn't completed meanwhile:
// EndPrimaryMission completes the quests whose objectives are met when the mission succeeded and takes the progress
// back otherwise, as does the next StartPrimaryMission for a mission that never ended. Kept in memory: after a
// restart mid-mission the progress stays and the quest completes with its next progress.
export function heldProgress() {
  const counts = new Map();
  return {
    add(itemId, name, count) {
      const key = `${itemId}\n${name}`;
      counts.set(key, (counts.get(key) ?? 0) + count);
    },
    holds(itemId) {
      return [...counts.keys()].some((key) => key.startsWith(`${itemId}\n`));
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
    // Starts the player's primary mission. Returns the progress of one that never ended, or null.
    start(accountId) {
      const unended = missions.get(accountId) ?? null;
      missions.set(accountId, heldProgress());
      return unended;
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
