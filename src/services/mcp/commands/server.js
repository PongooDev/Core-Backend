import crypto from "node:crypto";
import { McpError } from "../../../errors.js";
import { log } from "../../../log.js";
import { completeMissionAlert } from "../../../profiles/alerts.js";
import { zoneOutpost } from "../../../gamedata/world.js";
import { grantItem } from "../../../profiles/items.js";
import { completeOutpostDefense, createDeployableBase, saveDeployableBase, saveOutpost, updateOutpostCore, updateTierProgression } from "../../../profiles/outposts.js";
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
    const zone = typeof raw === "string" ? JSON.parse(raw) : raw;
    return findMission(zone.theaterMissionId, new Date(), zone.theaterMissionAlertId);
  } catch {
    return null;
  }
}

// FMcpProfileChangeRequest {baseCommandRevision, addRequests, removeRequests, changeQuantityRequests,
// changeAttributesRequests, changeStatRequests} applied to a world profile (theater0 for the player's backpack and
// storage, outpost0 for the storm shield). The server writes item ids as FGuid text (%08X-%04X-..., upper case) while
// Core's are lower case, so ids match whatever their case. An add for an item that's already there replaces it, a
// remove or change for one that isn't is skipped, and a null attribute value removes the attribute. Returns counts
// for the log.
function findItemId(tracker, itemId) {
  if (typeof itemId !== "string" || !itemId) return undefined;
  if (tracker.profile.items[itemId]) return itemId;
  const wanted = itemId.toLowerCase();
  return Object.keys(tracker.profile.items).find((id) => id.toLowerCase() === wanted);
}

function applyChanges(tracker, request) {
  const counts = { added: 0, replaced: 0, removed: 0, quantities: 0, attributes: 0, stats: 0, skipped: 0 };
  if (!request || typeof request !== "object") return counts;
  for (const { itemId, templateId, quantity, attributes } of request.addRequests ?? []) {
    if (typeof templateId !== "string" || !templateId) { counts.skipped++; continue; }
    const item = { templateId, attributes: attributes && typeof attributes === "object" ? attributes : {}, quantity: Number.isInteger(quantity) ? quantity : 1 };
    const existing = findItemId(tracker, itemId);
    if (existing) {
      tracker.removeItem(existing);
      tracker.addItem(existing, item);
      counts.replaced++;
    } else {
      tracker.addItem(typeof itemId === "string" && itemId ? itemId : crypto.randomUUID(), item);
      counts.added++;
    }
  }
  for (const { itemId } of request.removeRequests ?? []) {
    const id = findItemId(tracker, itemId);
    if (!id) { counts.skipped++; continue; }
    tracker.removeItem(id);
    counts.removed++;
  }
  for (const { itemId, deltaQuantity } of request.changeQuantityRequests ?? []) {
    const id = findItemId(tracker, itemId);
    if (!id || !Number.isInteger(deltaQuantity)) { counts.skipped++; continue; }
    const quantity = tracker.profile.items[id].quantity + deltaQuantity;
    if (quantity > 0) tracker.setQuantity(id, quantity);
    else tracker.removeItem(id);
    counts.quantities++;
  }
  for (const { itemId, attributes } of request.changeAttributesRequests ?? []) {
    const id = findItemId(tracker, itemId);
    if (!id || !attributes || typeof attributes !== "object") { counts.skipped++; continue; }
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null) {
        if (name in tracker.profile.items[id].attributes) tracker.removeItemAttribute(id, name);
      } else tracker.setItemAttribute(id, name, value);
    }
    counts.attributes++;
  }
  for (const { statName, statValue } of request.changeStatRequests ?? []) {
    if (typeof statName !== "string" || !statName) { counts.skipped++; continue; }
    tracker.setStat(statName, statValue);
    counts.stats++;
  }
  return counts;
}

function describeChanges(profileId, counts, request) {
  const added = (request?.addRequests ?? []).map((add) => `${add?.templateId}×${add?.quantity ?? 1}`).slice(0, 12).join(", ");
  return `${profileId} +${counts.added} replaced ${counts.replaced} -${counts.removed} qty ${counts.quantities} attrs ${counts.attributes} stats ${counts.stats}`
    + (counts.skipped ? ` skipped ${counts.skipped}` : "") + (added ? ` [${added}]` : "");
}

const accepted = () => {};

// For the part of a batch that mustn't undo the rest: a refusal is logged instead.
function keepGoing(command, run) {
  try {
    run();
  } catch (error) {
    if (!(error instanceof McpError)) throw error;
    log("MCP", `${command}: ${error.message}, skipped`);
  }
}

export const serverCommands = {
  QueryProfile: accepted,

  // The server holds a player's world profiles while they are in its zone; Core keeps no locks.
  LockProfiles: accepted,
  UnlockProfiles: accepted,
  LockProfileForWrite: accepted,
  UnlockProfileForWrite: accepted,
  // A player's first time in a theater: the server sends it while theater0's player_loadout still says bPlayerIsNew, and
  // won't save that profile until it doesn't (UFortMcpProfileWorld::IsSafeToSave checks CachedPlayerLoadout).
  InitializeTheater({ tracker, profileId }) {
    if (!profileId.startsWith("theater")) return;
    const loadout = tracker.profile.stats.attributes.player_loadout ?? {};
    if (loadout.bPlayerIsNew === false) return;
    tracker.setStat("player_loadout", { ...loadout, bPlayerIsNew: false });
  },
  ModifyMission: accepted,
  // The fabricator: DisintegrateItems is never sent by this build, so there is nothing to abort.
  AbortDisintegration: accepted,

  ServerQuestLogin: clientQuestLogin,

  UpdateQuests({ req, session }) {
    advance(session, req.body?.advance);
  },

  StartPrimaryMission({ req, session }) {
    advance(session, req.body?.advance);
  },

  // A finished mission: its quest progress, and when it succeeded (EFortMissionStatus Succeeded) the mission's rewards
  // from world info as card packs the after-mission rewards screen opens (pack_source "Mission"). A mission alert on it
  // (the zone's theaterMissionAlertId) puts the alert's rewards in the player's pending mission alert rewards.
  // The match's score comes with it too ({numMissionPoints, bCriticalMatchBonus, earnedBadgeData}): this build never
  // sends EarnScore (nothing in the binary calls it), so the account XP is earned here, won or not. The earnScore
  // notification always goes out, with no XP for no points: the server's handler for it is what sets the player state's
  // bIsExperienceFinalized, which the results screen waits for.
  EndPrimaryMission({ req, session, context, notifications }) {
    const { advance: updates, missionStatus, matchmakingSessionId, missionName, numMissionPoints, bCriticalMatchBonus } = req.body ?? {};
    advance(session, updates);
    const score = Number.isFinite(numMissionPoints) && numMissionPoints > 0 ? numMissionPoints : 0;
    const { xpEarned, levels, ...parts } = earnScore(session, score, { criticalMatch: bCriticalMatchBonus === true });
    notifications.push({ type: "earnScore", primary: false, ...parts });
    for (const level of levels) notifications.push({ type: "levelUp", primary: false, level });
    if (!/succeeded$/i.test(String(missionStatus ?? ""))) return;
    const mission = sessionMission(context.sessions, matchmakingSessionId);
    if (!mission) {
      log("MCP", `EndPrimaryMission: no mission found for session ${matchmakingSessionId} (${missionName}), no rewards`);
      return;
    }
    for (const { itemType, quantity } of mission.missionRewards.items) grantItem(session, itemType, quantity, { packSource: "Mission" });
    if (mission.missionAlert) completeMissionAlert(session, mission.theaterId, mission.missionAlert);
    const outpost = zoneOutpost(mission.zoneTheme);
    if (outpost) completeOutpostDefense(session, req.params.accountId, outpost);
  },

  // One call for every player in the match: [{accountId, totalScore, bCriticalMatchBonus}] (FAccountIdAndScore).
  // Each player gets the XP; the caller's response carries its own earnScore notification. Kept for gameservers that
  // send it; the Cert binary itself scores through EndPrimaryMission.
  EarnScore({ req, sessionFor, session, notifications }) {
    for (const { accountId, totalScore, bCriticalMatchBonus } of Array.isArray(req.body?.playersAndScores) ? req.body.playersAndScores : []) {
      const target = typeof accountId === "string" && sessionFor(accountId);
      if (!target || !Number.isFinite(totalScore) || totalScore <= 0) continue;
      const { baseXPEarned, bonusXPEarned, boostXPEarned, boostXPMissed, restXPEarned, groupBoostXPEarned, levels } =
        earnScore(target, totalScore, { criticalMatch: bCriticalMatchBonus === true });
      if (target !== session) continue;
      notifications.push({ type: "earnScore", primary: false, baseXPEarned, bonusXPEarned, boostXPEarned, boostXPMissed,
        restXPEarned, groupBoostXPEarned });
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
    const theater = applyChanges(tracker, req.body?.theaterItemUpdate);
    const outpost = applyChanges(session.profile("outpost0"), req.body?.outpostItemUpdate);
    const quests = Array.isArray(req.body?.questObjectiveUpdates) ? req.body.questObjectiveUpdates.length : 0;
    advance(session, req.body?.questObjectiveUpdates);
    log("MCP", `${req.params.command} for ${req.params.accountId}: ${describeChanges(profileId, theater, req.body?.theaterItemUpdate)}; `
      + `${describeChanges("outpost0", outpost, req.body?.outpostItemUpdate)}; quest updates ${quests}`);
  },

  // The same from a storm shield, with the core's buildings and build saves: {outpostId, outpostInfo, cloudSaveInfo}.
  // An unknown core is logged and skipped, so the player's inventory changes still land.
  BatchUpdatePlayerOutpost(context) {
    serverCommands.BatchUpdatePlayer(context);
    const { outpostId, outpostInfo, cloudSaveInfo } = context.req.body ?? {};
    keepGoing("BatchUpdatePlayerOutpost", () => saveOutpost(context.session, outpostId, outpostInfo, cloudSaveInfo));
  },

  // A storm shield's placed buildings and who may edit it (FFortOutpostCoreInfo), on profile0's core item.
  UpdateOutpostCore({ req, session }) {
    updateOutpostCore(session, req.body?.coreId, req.body?.coreInfo);
  },

  CreateDeployableBaseItem({ req, session }) {
    createDeployableBase(session, req.body?.templateId);
  },

  UpdateDeployableBaseTierProgression({ req, session }) {
    const { deployableBaseItemId, progressionLayoutGuid, tierDefeated } = req.body ?? {};
    updateTierProgression(session, deployableBaseItemId, progressionLayoutGuid, tierDefeated);
  },

  // BatchUpdatePlayer's work plus the deployable base's build saves: {deployableBaseItemId, cloudSaveInfo}.
  BatchUpdatePlayerDeployableBase(context) {
    serverCommands.BatchUpdatePlayer(context);
    const { deployableBaseItemId, cloudSaveInfo } = context.req.body ?? {};
    keepGoing("BatchUpdatePlayerDeployableBase", () => saveDeployableBase(context.session, deployableBaseItemId, cloudSaveInfo));
  }
};

export const publicCommands = { QueryProfile: accepted };
