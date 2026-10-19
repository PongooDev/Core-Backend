import crypto from "node:crypto";
import { McpError } from "../../../errors.js";
import { log } from "../../../log.js";
import { grantItem } from "../../../profiles/items.js";
import { advanceObjective } from "../../../profiles/progress.js";
import { earnScore } from "../../../profiles/xp.js";
import { findMission } from "../../../world/theaters.js";
import { clientQuestLogin } from "./ClientQuestLogin.js";

// Commands the gameserver sends for its players (POST .../profile/{accountId}/dedicated_server/{command}), from the
// SDK's FDedicatedServerUrlContext functions. Parameters are the UFunction's with the first letter lowered.

// Quest progress the server saw: [{statName, count}] (FFortQuestObjectiveCompletion).
function advance(session, updates) {
  for (const { statName, count } of Array.isArray(updates) ? updates : []) {
    if (typeof statName === "string" && Number.isInteger(count) && count > 0) advanceObjective(session, statName, count);
  }
}

// The mission a game session is playing: the server's ZONEINSTANCEID_s attribute is FFortZoneInstanceInfo
// {worldId, theaterId, theaterMissionId, theaterMissionAlertId, zoneThemeClass} as JSON.
export function sessionMission(sessions, sessionId) {
  const session = sessionId && sessions.get(sessionId);
  const raw = session?.attributes?.ZONEINSTANCEID_s;
  if (!raw) return null;
  try {
    return findMission((typeof raw === "string" ? JSON.parse(raw) : raw).theaterMissionId);
  } catch {
    return null;
  }
}

// FMcpProfileChangeRequest {addRequests, removeRequests, changeQuantityRequests, changeAttributesRequests} applied to
// a world profile (theater0 for the player's backpack and storage, outpost0 for the storm shield).
function applyChanges(tracker, request) {
  if (!request || typeof request !== "object") return;
  for (const { itemId, templateId, quantity, attributes } of request.addRequests ?? []) {
    if (typeof templateId !== "string" || !templateId) continue;
    const id = typeof itemId === "string" && itemId && !tracker.profile.items[itemId] ? itemId : crypto.randomUUID();
    tracker.addItem(id, { templateId, attributes: attributes && typeof attributes === "object" ? attributes : {}, quantity: Number.isInteger(quantity) ? quantity : 1 });
  }
  for (const { itemId } of request.removeRequests ?? []) {
    if (tracker.profile.items[itemId]) tracker.removeItem(itemId);
  }
  for (const { itemId, deltaQuantity } of request.changeQuantityRequests ?? []) {
    const item = tracker.profile.items[itemId];
    if (!item || !Number.isInteger(deltaQuantity)) continue;
    const quantity = item.quantity + deltaQuantity;
    if (quantity > 0) tracker.setQuantity(itemId, quantity);
    else tracker.removeItem(itemId);
  }
  for (const { itemId, attributes } of request.changeAttributesRequests ?? []) {
    if (!tracker.profile.items[itemId] || !attributes || typeof attributes !== "object") continue;
    for (const [name, value] of Object.entries(attributes)) tracker.setItemAttribute(itemId, name, value);
  }
}

const accepted = () => {};

export const serverCommands = {
  QueryProfile: accepted,

  // The server holds a player's world profiles while they are in its zone; Core keeps no locks.
  LockProfiles: accepted,
  UnlockProfiles: accepted,
  LockProfileForWrite: accepted,
  UnlockProfileForWrite: accepted,
  InitializeTheater: accepted,
  ModifyMission: accepted,

  ServerQuestLogin: clientQuestLogin,

  UpdateQuests({ req, session }) {
    advance(session, req.body?.advance);
  },

  StartPrimaryMission({ req, session }) {
    advance(session, req.body?.advance);
  },

  // A finished mission: its quest progress, and when it succeeded (EFortMissionStatus Succeeded) the mission's rewards
  // from world info as card packs the after-mission rewards screen opens (pack_source "Mission").
  EndPrimaryMission({ req, session, context }) {
    const { advance: updates, missionStatus, matchmakingSessionId, missionName } = req.body ?? {};
    advance(session, updates);
    if (!/succeeded$/i.test(String(missionStatus ?? ""))) return;
    const mission = sessionMission(context.sessions, matchmakingSessionId);
    if (!mission) {
      log("MCP", `EndPrimaryMission: no mission found for session ${matchmakingSessionId} (${missionName}), no rewards`);
      return;
    }
    for (const { itemType, quantity } of mission.missionRewards.items) grantItem(session, itemType, quantity, { packSource: "Mission" });
  },

  // One call for every player in the match: [{accountId, totalScore, bCriticalMatchBonus}] (FAccountIdAndScore).
  // Each player gets the XP; the caller's response carries its own earnScore notification.
  EarnScore({ req, sessionFor, session, notifications }) {
    for (const { accountId, totalScore } of Array.isArray(req.body?.playersAndScores) ? req.body.playersAndScores : []) {
      const target = typeof accountId === "string" && sessionFor(accountId);
      if (!target || !Number.isFinite(totalScore) || totalScore <= 0) continue;
      const { xpEarned, levels } = earnScore(target, totalScore);
      if (target !== session) continue;
      notifications.push({ type: "earnScore", primary: false, baseXPEarned: xpEarned, bonusXPEarned: 0, boostXPEarned: 0,
        boostXPMissed: 0, restXPEarned: 0, groupBoostXPEarned: 0 });
      for (const level of levels) notifications.push({ type: "levelUp", primary: false, level });
    }
  },

  // Items used up in the zone: parallel lists of item ids and counts.
  ConsumeItems({ req, tracker }) {
    const ids = req.body?.itemsToConsumeIds ?? [];
    const counts = req.body?.itemCountsToConsume ?? [];
    ids.forEach((itemId, index) => {
      const item = tracker.profile.items[itemId];
      const count = counts[index];
      if (!item || !Number.isInteger(count) || count <= 0) return;
      if (item.quantity > count) tracker.setQuantity(itemId, item.quantity - count);
      else tracker.removeItem(itemId);
    });
  },

  // The player's world inventory as the server left it (theater0), the storm shield's (outpost0), and quest progress.
  BatchUpdatePlayer({ req, session, tracker, profileId }) {
    if (!profileId.startsWith("theater")) throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", "BatchUpdatePlayer is a theater profile command");
    applyChanges(tracker, req.body?.theaterItemUpdate);
    applyChanges(session.profile("outpost0"), req.body?.outpostItemUpdate);
    advance(session, req.body?.questObjectiveUpdates);
  }
};

export const publicCommands = { QueryProfile: accepted };
