import { bookProfiles, claimBookLevel, claimPageRewards, slotItem } from "../../../collectionbook/book.js";
import { McpError } from "../../../errors.js";
import { convertItem, upgradeItem } from "../../../profiles/upgrades.js";

// SlotItemInCollectionBook and ClaimCollectionBookRewards are profile0 commands (UFortMcpProfileAccount); the rest
// are sent to a book profile (UFortMcpProfileCollectionBook).
function bookProfile(profileId) {
  if (!bookProfiles.includes(profileId)) throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", `${profileId} isn't a collection book`);
  return profileId;
}

export function slotItemInCollectionBook({ req, session }) {
  slotItem(session, req.body?.itemId);
}

export function claimCollectionBookRewards({ req, session }) {
  claimBookLevel(session, req.body?.requiredXp, req.body?.selectedRewardIndex ?? 0);
}

export function claimCollectionBookPageRewards({ req, session, profileId }) {
  bookProfile(profileId);
  const page = String(req.body?.pageTemplateId ?? "").replace(/^CollectionBookPage:/i, "");
  claimPageRewards(session, page, req.body?.sectionId || undefined, req.body?.selectedRewardIndex ?? 0);
}

export function upgradeSlottedItem({ req, session, profileId }) {
  upgradeItem(session, req.body?.targetItemId, bookProfile(profileId));
}

export function convertSlottedItem({ req, session, profileId }) {
  convertItem(session, req.body?.targetItemId, req.body?.conversionIndex ?? 0, bookProfile(profileId));
}
