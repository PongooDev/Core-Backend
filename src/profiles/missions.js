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
  // The game session each player's mission results were last saved for (end below), until their next mission starts,
  // which the gameserver's failsafe save asks about (savedFor): one entry a player, in memory.
  const saved = new Map();
  return {
    // Starts the player's primary mission. Returns the progress of one that never ended, or null.
    start(accountId) {
      const unended = missions.get(accountId) ?? null;
      missions.set(accountId, heldProgress());
      saved.delete(accountId);
      return unended;
    },
    // The held progress of the player's primary mission, or null outside one.
    held(accountId) {
      return missions.get(accountId) ?? null;
    },
    // The held progress the gameserver's progress for a player goes to: their primary mission's, or one started now
    // when none was (Core-Backend #290). A build whose StartPrimaryMission never comes (4.2: CoreV2 sends the stripped
    // EndPrimaryMission itself, and nothing sends the start) counted "in successful missions" progress at once, so a
    // player who left the game kept it. A mission started this way ends with EndPrimaryMission, as any other, or is
    // abandoned when the player is back in the lobby (abandon).
    heldOrStart(accountId) {
      let held = missions.get(accountId);
      if (!held) {
        held = heldProgress();
        held.implicit = true;
        missions.set(accountId, held);
      }
      return held;
    },
    // A primary mission started by heldOrStart that never ended (the player left): its held progress, or null.
    abandon(accountId) {
      const held = missions.get(accountId);
      if (!held?.implicit) return null;
      missions.delete(accountId);
      return held;
    },
    // Ends the player's primary mission: its held progress, or null. sessionId: the game session whose results are
    // being saved with it (EndPrimaryMission, EndMatch, FailsafeSaveMissionResults).
    end(accountId, sessionId) {
      const held = missions.get(accountId) ?? null;
      missions.delete(accountId);
      if (typeof sessionId === "string" && sessionId) saved.set(accountId, sessionId);
      return held;
    },
    // Whether the player's results of that game session were saved already.
    savedFor(accountId, sessionId) {
      return typeof sessionId === "string" && sessionId !== "" && saved.get(accountId) === sessionId;
    }
  };
}
