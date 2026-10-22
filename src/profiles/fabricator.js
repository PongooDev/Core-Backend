import crypto from "node:crypto";
import { McpError } from "../errors.js";
import { caseInsensitive, readGameData } from "../gamedata/read.js";
import { findItem, grantItem } from "./items.js";

// The storm shield fabricator and P.O.S.T. (UFortMcpProfileWorld commands the gameserver sends on the player's theater0,
// the world profile AFortPlayerControllerOutpost uses: MyPlayerInfo->WorldProfile, sub_750DD0). Their state is kept on
// theater0 items of the buildings' templates, as the server reads it back: the fabricator's fabricator_info
// (FFortOutpostFabricatorInfo {disintegrationStartTime, quantumGooCompleted, quantumGooStillToProcess}, read by
// AFortPlayerControllerOutpost::AbortDisintegration_Completed through sub_5E4AB0 from the world profile's item of the
// OutpostData fabricator's template) and the P.O.S.T.'s post_info (FFortOutpostPOSTInfo {depositedPostItems:
// [{templateId, quantity}]}). Goo values are the item templates' static_disintegration_value and
// static_fabrication_value (gamedata/fabricator.json).
const data = readGameData("fabricator", { values: {} });
const values = caseInsensitive(data.values ?? {});
const productionMs = (data.quantumGooProductionTime ?? 10) * 1000;
export const fabricatorTemplateId = data.fabricatorTemplateId ?? "Outpost:outpost_fabricator";
export const postTemplateId = data.postTemplateId ?? "Outpost:outpost_post";

const invalid = (message) => {
  throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", message);
};

export const fabricatorValue = (templateId) => values.get(String(templateId ?? "").toLowerCase());

// The server writes item ids as FGuid text (upper case), Core keeps them as made.
function findItemId(tracker, itemId) {
  if (typeof itemId !== "string" || !itemId) return undefined;
  if (tracker.profile.items[itemId]) return itemId;
  const wanted = itemId.toLowerCase();
  return Object.keys(tracker.profile.items).find((id) => id.toLowerCase() === wanted);
}

function stateItem(tracker, templateId, attribute, initial) {
  const existing = findItem(tracker.profile, templateId);
  if (existing) return existing;
  const itemId = crypto.randomUUID();
  tracker.addItem(itemId, { templateId, attributes: { [attribute]: initial }, quantity: 1 });
  return itemId;
}

// Takes up to count of an item; returns [templateId, how many] or undefined.
function takeItem(tracker, itemId, count) {
  const id = findItemId(tracker, itemId);
  const item = id && tracker.profile.items[id];
  if (!item || !Number.isInteger(count) || count <= 0) return undefined;
  const taken = Math.min(count, item.quantity);
  if (item.quantity > taken) tracker.setQuantity(id, item.quantity - taken);
  else tracker.removeItem(id);
  return [item.templateId, taken];
}

// The goo still to process turns into finished goo one unit every QuantumGooProductionTime seconds from
// disintegrationStartTime (the client's GetFabricatorDisintegrationSecondsRemaining, sub_6C8D60, counts down
// quantumGooStillToProcess × that time from it). Settling moves what is done and keeps the start on the unfinished unit.
export function settleFabricator(info, now = Date.now()) {
  const completed = Number.isInteger(info?.quantumGooCompleted) ? info.quantumGooCompleted : 0;
  const still = Number.isInteger(info?.quantumGooStillToProcess) ? Math.max(info.quantumGooStillToProcess, 0) : 0;
  const start = Date.parse(info?.disintegrationStartTime ?? "");
  if (!still || !Number.isFinite(start)) {
    return { disintegrationStartTime: new Date(now).toISOString(), quantumGooCompleted: completed, quantumGooStillToProcess: 0 };
  }
  const processed = Math.max(0, Math.min(still, Math.floor((now - start) / productionMs)));
  return {
    disintegrationStartTime: new Date(processed === still ? now : start + processed * productionMs).toISOString(),
    quantumGooCompleted: completed + processed,
    quantumGooStillToProcess: still - processed
  };
}

function fabricator(tracker, now) {
  const itemId = stateItem(tracker, fabricatorTemplateId, "fabricator_info", settleFabricator({}, now));
  return [itemId, settleFabricator(tracker.profile.items[itemId].attributes.fabricator_info, now)];
}

function requireTheater(profileId, command) {
  if (!profileId.startsWith("theater")) invalid(`${command} is a theater profile command`);
}

// DisintegrateItems {itemsToDisintegrateIds, itemCountsToDisintegrate}: the items go and their goo joins what is still
// to process (the server has already checked the fabricator's capacity, FabricatorCanDisintegrateItem).
export function disintegrateItems(tracker, profileId, ids, counts, now = Date.now()) {
  requireTheater(profileId, "DisintegrateItems");
  const [itemId, info] = fabricator(tracker, now);
  let goo = 0;
  (Array.isArray(ids) ? ids : []).forEach((id, index) => {
    const value = fabricatorValue(tracker.profile.items[findItemId(tracker, id)]?.templateId)?.disintegration;
    if (!(value > 0)) return;
    const taken = takeItem(tracker, id, Array.isArray(counts) ? counts[index] : undefined);
    if (taken) goo += value * taken[1];
  });
  if (goo > 0 && info.quantumGooStillToProcess === 0) info.disintegrationStartTime = new Date(now).toISOString();
  info.quantumGooStillToProcess += goo;
  tracker.setItemAttribute(itemId, "fabricator_info", info);
  return goo;
}

// AbortDisintegration: processing stops; the goo already made stays and the rest is lost (Core's reading 🟡).
export function abortDisintegration(tracker, profileId, now = Date.now()) {
  requireTheater(profileId, "AbortDisintegration");
  const [itemId, info] = fabricator(tracker, now);
  tracker.setItemAttribute(itemId, "fabricator_info", { ...info, disintegrationStartTime: new Date(now).toISOString(), quantumGooStillToProcess: 0 });
}

// FabricateItem {templateId}: spends the item's static_fabrication_value of finished goo and adds one to the backpack.
export function fabricateItem(session, tracker, profileId, templateId, now = Date.now()) {
  requireTheater(profileId, "FabricateItem");
  const value = fabricatorValue(templateId);
  if (!(value?.fabrication > 0)) invalid(`${templateId} can't be fabricated`);
  const [itemId, info] = fabricator(tracker, now);
  if (info.quantumGooCompleted < value.fabrication) invalid(`Not enough quantum goo for ${templateId} (${info.quantumGooCompleted} of ${value.fabrication})`);
  tracker.setItemAttribute(itemId, "fabricator_info", { ...info, quantumGooCompleted: info.quantumGooCompleted - value.fabrication });
  return grantItem(session, value.id, 1);
}

// DepositPostResources {itemsToDepositIds, itemCountsToDeposit}: the items go into the P.O.S.T.'s deposits.
export function depositPostResources(tracker, profileId, ids, counts) {
  requireTheater(profileId, "DepositPostResources");
  const itemId = stateItem(tracker, postTemplateId, "post_info", { depositedPostItems: [] });
  const deposited = [...(tracker.profile.items[itemId].attributes.post_info?.depositedPostItems ?? [])]
    .filter((entry) => entry && typeof entry.templateId === "string")
    .map(({ templateId, quantity }) => ({ templateId, quantity: Number.isInteger(quantity) ? quantity : 0 }));
  (Array.isArray(ids) ? ids : []).forEach((id, index) => {
    const taken = takeItem(tracker, id, Array.isArray(counts) ? counts[index] : undefined);
    if (!taken) return;
    const [templateId, quantity] = taken;
    const known = deposited.find((entry) => entry.templateId.toLowerCase() === templateId.toLowerCase());
    if (known) known.quantity += quantity;
    else deposited.push({ templateId, quantity });
  });
  tracker.setItemAttribute(itemId, "post_info", { depositedPostItems: deposited });
}
