import crypto from "node:crypto";
import { McpError } from "../errors.js";
import { getItem } from "../gamedata/items.js";
import { findItem } from "./items.js";

// Storm shields are profile0 items (UFortOutpostItem: a UFortCloudSaveItem with outpost_core_info
// {placedBuildings: [{buildingTag, placedTag}], accountsWithEditPermission} and cloud_save_info {saveCount,
// savedRecords: [{recordIndex, archiveNumber, recordFilename}]}), one per theater (the storm shield zone theme's
// CloudSaveItemDefinition: Outpost:outpostcore_pve_01..04). The core's level is the item's level
// (UFortFrontEndContext::GetOutpostCoreLevelByTheaterId), from MinLevel 0 to MaxLevel 10.
const fail = (message) => {
  throw new McpError("errors.com.epicgames.fortnite.item_not_found", message);
};

const outpostInfo = (templateId) => {
  const info = getItem(String(templateId ?? ""));
  return info?.class === "FortOutpostItemDefinition" ? info : undefined;
};

function outpostItem(tracker, itemId) {
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  if (!item || !outpostInfo(item.templateId)) fail(`No storm shield ${itemId}`);
  return item;
}

// FFortOutpostCoreInfo as the server sent it, keeping only its fields.
function coreInfo(info) {
  const strings = (list) => (Array.isArray(list) ? list.filter((value) => typeof value === "string") : []);
  return {
    placedBuildings: (Array.isArray(info?.placedBuildings) ? info.placedBuildings : [])
      .filter((building) => building && typeof building === "object")
      .map(({ buildingTag, placedTag }) => ({ buildingTag: String(buildingTag ?? ""), placedTag: String(placedTag ?? "") })),
    accountsWithEditPermission: strings(info?.accountsWithEditPermission)
  };
}

// FFortCloudSaveInfo: which save records hold the storm shield's build.
function cloudSaveInfo(info) {
  return {
    saveCount: Number.isInteger(info?.saveCount) ? info.saveCount : 0,
    savedRecords: (Array.isArray(info?.savedRecords) ? info.savedRecords : [])
      .filter((record) => record && typeof record === "object")
      .map(({ recordIndex, archiveNumber, recordFilename }) => ({
        recordIndex: Number.isInteger(recordIndex) ? recordIndex : 0,
        archiveNumber: Number.isInteger(archiveNumber) ? archiveNumber : 0,
        recordFilename: String(recordFilename ?? "")
      }))
  };
}

// CreateOrUpgradeOutpostItem {templateId}: the client sends it when the player enters a storm shield they have no item
// for (UFortMatchmakingContext::EnterOutpost) and only goes on once it succeeds. A new core is at MinLevel with the
// player allowed to edit it. Nothing is kept about content versions, so an existing core is left as it is.
export function createOutpost(session, accountId, templateId) {
  const info = outpostInfo(templateId);
  if (!info) fail(`No storm shield ${templateId}`);
  const tracker = session.profile("profile0");
  if (findItem(tracker.profile, info.templateId)) return;
  tracker.addItem(crypto.randomUUID(), {
    templateId: info.templateId,
    attributes: {
      level: info.minLevel ?? 0,
      item_seen: 0,
      outpost_core_info: { placedBuildings: [], accountsWithEditPermission: [accountId] },
      cloud_save_info: { saveCount: 0, savedRecords: [] }
    },
    quantity: 1
  });
}

// UpdateOutpostCore {coreId, coreInfo} from the gameserver.
export function updateOutpostCore(session, coreId, info) {
  const tracker = session.profile("profile0");
  outpostItem(tracker, coreId);
  tracker.setItemAttribute(coreId, "outpost_core_info", coreInfo(info));
}

// BatchUpdatePlayerOutpost's storm shield part: {outpostId, outpostInfo, cloudSaveInfo}.
export function saveOutpost(session, outpostId, info, saves) {
  const tracker = session.profile("profile0");
  outpostItem(tracker, outpostId);
  tracker.setItemAttribute(outpostId, "outpost_core_info", coreInfo(info));
  tracker.setItemAttribute(outpostId, "cloud_save_info", cloudSaveInfo(saves));
}

// The storm shield follows the outpost quests: Mission_Outpost plays the leg of the active OutpostQuest_T{N}_L{L} and
// checks each leg's quest is done, and those quests are the ones with bExpandsStormShield ("Your Storm Shield has
// expanded"). Core's (inferred): completing one raises theater N's core (Outpost:outpostcore_pve_0N) to level L, so
// the level counts the legs done and the next one is level + 1. The core is made if the player has none yet.
export function expandStormShield(session, questId) {
  const [, theater, leg] = /^outpostquest_t(\d+)_l(\d+)$/i.exec(questId) ?? [];
  const info = theater && outpostInfo(`Outpost:outpostcore_pve_${theater.padStart(2, "0")}`);
  if (!info) return;
  const tracker = session.profile("profile0");
  createOutpost(session, session.accountId, info.templateId);
  const itemId = findItem(tracker.profile, info.templateId);
  const level = Math.min(Number(leg), info.maxLevel ?? 10);
  if (level > (tracker.profile.items[itemId].attributes.level ?? 0)) tracker.setItemAttribute(itemId, "level", level);
}

// The storm shield defense a player is up to: world info lists each theater's storm shield at its first defense
// (Theater_Start_Outpost1, Theater_Normal_Outpost1, ...); Core moves it to <prefix>_Outpost<level + 1> for the core's
// owner, up to the tenth.
export function outpostDifficulty(profile, templateId, difficultyInfo) {
  const info = outpostInfo(templateId);
  const itemId = info && findItem(profile, info.templateId);
  const level = itemId ? profile.items[itemId].attributes.level ?? 0 : 0;
  const rowName = String(difficultyInfo?.rowName ?? "");
  if (!/_Outpost\d+$/.test(rowName)) return difficultyInfo;
  return { ...difficultyInfo, rowName: rowName.replace(/\d+$/, String(Math.min(level + 1, info?.maxLevel ?? 10))) };
}

// Deployable bases (UFortDeployableBaseCloudSaveItem: cloud_save_info and tier_progression {progressionInfo:
// [{progressionLayoutGuid, highestDefeatedTier}]}): the server makes one (CreateDeployableBaseItem {templateId}),
// records tiers beaten (UpdateDeployableBaseTierProgression) and saves it (BatchUpdatePlayerDeployableBase). Only a
// test definition ships.
const deployableInfo = (templateId) => {
  const info = getItem(String(templateId ?? ""));
  return info?.class === "FortDeployableBaseCloudSaveItemDefinition" ? info : undefined;
};

function deployableItem(tracker, itemId) {
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  if (!item || !deployableInfo(item.templateId)) fail(`No deployable base ${itemId}`);
  return item;
}

export function createDeployableBase(session, templateId) {
  const info = deployableInfo(templateId);
  if (!info) fail(`No deployable base ${templateId}`);
  const tracker = session.profile("profile0");
  if (findItem(tracker.profile, info.templateId)) return;
  tracker.addItem(crypto.randomUUID(), {
    templateId: info.templateId,
    attributes: { level: info.minLevel ?? 1, item_seen: 0, cloud_save_info: { saveCount: 0, savedRecords: [] }, tier_progression: { progressionInfo: [] } },
    quantity: 1
  });
}

export function updateTierProgression(session, itemId, layoutGuid, tierDefeated) {
  const tracker = session.profile("profile0");
  const item = deployableItem(tracker, itemId);
  if (typeof layoutGuid !== "string" || !Number.isInteger(tierDefeated)) return;
  const progress = item.attributes.tier_progression?.progressionInfo ?? [];
  const known = progress.find((entry) => entry.progressionLayoutGuid === layoutGuid);
  const highest = Math.max(known?.highestDefeatedTier ?? -1, tierDefeated);
  tracker.setItemAttribute(itemId, "tier_progression", {
    progressionInfo: [...progress.filter((entry) => entry !== known), { progressionLayoutGuid: layoutGuid, highestDefeatedTier: highest }]
  });
}

export function saveDeployableBase(session, itemId, saves) {
  const tracker = session.profile("profile0");
  deployableItem(tracker, itemId);
  tracker.setItemAttribute(itemId, "cloud_save_info", cloudSaveInfo(saves));
}
