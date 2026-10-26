import { bookProfiles, claimBookLevel, claimPageRewards, slotItem } from "../../../collectionbook/book.js";
import { McpError } from "../../../errors.js";
import { convertItem, upgradeItem } from "../../../profiles/upgrades.js";
import { conversionResult } from "./Upgrades.js";

// SlotItemInCollectionBook and ClaimCollectionBookRewards are profile0 commands (UFortMcpProfileAccount); the rest
// are sent to a book profile (UFortMcpProfileCollectionBook).
function bookProfile(profileId) {
  if (!bookProfiles.includes(profileId)) throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", `${profileId} isn't a collection book`);
  return profileId;
}

export function slotItemInCollectionBook({ req, session, notifications }) {
  slotItem(session, req.body?.itemId, notifications);
}

export function claimCollectionBookRewards({ req, session, notifications }) {
  claimBookLevel(session, req.body?.requiredXp, req.body?.selectedRewardIndex ?? 0, notifications);
}

export function claimCollectionBookPageRewards({ req, session, profileId, notifications }) {
  bookProfile(profileId);
  claimPageRewards(session, req.body?.pageTemplateId, req.body?.sectionId, req.body?.selectedRewardIndex ?? 0, notifications);
}

export function upgradeSlottedItem({ req, session, profileId }) {
  upgradeItem(session, req.body?.targetItemId, bookProfile(profileId));
}

export function convertSlottedItem({ req, session, profileId, notifications }) {
  const evolved = convertItem(session, req.body?.targetItemId, req.body?.conversionIndex ?? 0, bookProfile(profileId));
  notifications.push(conversionResult(evolved));
}
