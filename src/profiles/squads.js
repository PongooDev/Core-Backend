import { McpError } from "../errors.js";
import { getSquad, slotUnlockNode } from "../gamedata/homebase.js";
import { getCharacter, getItem } from "../gamedata/items.js";
import { ownsNode } from "./homebase.js";
import { hasTag } from "./progress.js";

const characterTypes = { FortHeroType: "Hero", FortWorkerType: "Worker", FortDefenderItemDefinition: "Defender" };
const refuse = (message) => { throw new McpError("errors.com.epicgames.fortnite.invalid_squad_assignment", message); };

export const characterType = (item) => characterTypes[getItem(item.templateId)?.class];

function setAssignment(tracker, itemId, squadId, slot) {
  const { attributes } = tracker.profile.items[itemId];
  if (attributes.squad_id !== squadId) tracker.setItemAttribute(itemId, "squad_id", squadId);
  if (attributes.squad_slot_idx !== slot) tracker.setItemAttribute(itemId, "squad_slot_idx", slot);
}

export function unassign(tracker, itemId) {
  setAssignment(tracker, itemId, "", -1);
}

// squadId "" unassigns (the client sends that with slot 0). The client only checks slot locks on one of its two
// send paths, so every rule it applies in the picker is checked here too.
export function assignToSquad(session, characterId, squadId, slotIndex) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const item = profile.items[characterId];

  if (squadId === "") {
    if (!item) return; // the recycle flow unassigns, then recycles without waiting
    if (!characterType(item)) refuse(`${characterId} is not a hero, survivor or defender`);
    return unassign(tracker, characterId);
  }

  if (!item) refuse(`No item ${characterId}`);
  const type = characterType(item);
  if (!type) refuse(`${characterId} is not a hero, survivor or defender`);
  const squad = getSquad(squadId);
  if (!squad || squad.type === "ExpeditionSquad") refuse(`No squad ${squadId}`);
  const slot = Number.isInteger(slotIndex) ? squad.slots[slotIndex] : undefined;
  if (!slot) refuse(`${squad.id} has no slot ${slotIndex}`);
  if (!slot.types.includes(type)) refuse(`${squad.id} slot ${slotIndex} doesn't take a ${type}`);

  const definition = getCharacter(item.templateId) ?? { tags: [] };
  const workerOnly = slot.types.length === 1 && slot.types[0] === "Worker";
  if (workerOnly && Boolean(definition.manager) !== (slotIndex === 0)) {
    refuse(slotIndex === 0 ? "Only a lead survivor fits this slot" : "Lead survivors only fit the first slot");
  }
  if (!workerOnly && slot.tags.length && !slot.tags.some((tag) => hasTag(definition.tags, tag))) {
    refuse(`${item.templateId} doesn't fit ${squad.id} slot ${slotIndex}`);
  }
  const node = slotUnlockNode(squad.id, slotIndex);
  if (!node || !ownsNode(profile, node)) refuse(`${squad.id} slot ${slotIndex} is locked`);

  for (const [otherId, other] of Object.entries(profile.items)) {
    if (otherId === characterId || !characterType(other)) continue;
    if ((other.attributes.squad_id ?? "").toLowerCase() === squad.id.toLowerCase() && other.attributes.squad_slot_idx === slotIndex) {
      unassign(tracker, otherId);
    }
  }
  setAssignment(tracker, characterId, squad.id, slotIndex);
}
