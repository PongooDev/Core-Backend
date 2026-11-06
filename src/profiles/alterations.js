import { McpError } from "../errors.js";
import { getItem } from "../gamedata/items.js";
import { perBuild } from "../gamedata/read.js";
import { upgradeData } from "../gamedata/upgrades.js";

// 4.2's (CL 4072250) Perk Recombobulator (Core-Backend #270): a weapon or trap schematic keeps its perks in its
// `alterations` attribute, one alteration template id per slot of its loadout ("" for none). The client reads it into
// UFortAlterableItem::Alterations (+0xE0) and AlterationInstances (+0xF0), index for index (4.2's sub_D436A0), and
// pairs instance i with loadout slot i (UFortItem::GetAlterationSlots, sub_D32730: FFortAlterationSlotStatus
// {Alteration, MinRequiredLevel, MinHostItemRarity}). A new schematic's MCP template also has `legacy_alterations`
// (the schematic item's default attributes, sub_D4A770: "alterations": [], "legacy_alterations": []), which the client
// never reads back: Core keeps a converted schematic's old perks there.
//
// The data is 4.2's (gamedata alterations.json, tools/extractor): a schematic's loadout is the one of the world item it
// crafts (UFortSchematicItemDefinition::GetResultWorldItemDefinition, sub_D66020, then UFortWeaponItemDefinition
// AlterationSlotsLoadoutRow); each slot's definition names its group (InitTierGroup) and BaseRespecCosts; the group
// lists by rarity the perks a slot can hold. Builds before 4.2 have no tables, and nothing here runs for them.
const alterationData = perBuild((read) => {
  const { slotLoadouts, slotDefinitions = {}, groups = {}, namedExclusions = {}, migration = {}, intrinsic = {} } = read("alterations", {});
  return {
    slotLoadouts,
    slotDefinitions,
    groups,
    namedExclusions,
    migration: new Map(Object.entries(migration).map(([legacy, mapping]) => [legacy.toLowerCase(), mapping])),
    intrinsic: new Map(Object.entries(intrinsic).map(([tag, alteration]) => [tag.toLowerCase(), alteration]))
  };
});

export const hasAlterationData = () => Boolean(alterationData().slotLoadouts);

// EFortRarity, Handmade (Common) first.
const rarities = ["Handmade", "Ordinary", "Sturdy", "Quality", "Fine", "Elegant", "Masterwork", "Epic", "Badass", "Legendary"];
const rank = (rarity) => Math.max(0, rarities.indexOf(rarity));
const sameId = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const fail = (message) => {
  throw new McpError("errors.com.epicgames.fortnite.item_consumption_failed", message);
};

// The world item a schematic crafts, which has its loadout, rarity and named exclusions: 4.2's schematic definition
// forwards GetRarity (vslot 0x280, sub_D65870) and the rest to it. Its own Rarity in the asset isn't what the game shows.
function resultOf(schematicTemplateId) {
  const info = getItem(schematicTemplateId);
  if (info?.class !== "FortSchematicItemDefinition") return undefined;
  const result = upgradeData().craftingRecipes[info.craftingRecipe]?.results?.[0]?.templateId;
  return result && getItem(result);
}

// The slots of a schematic's loadout, each with its definition and group, or undefined for an item without one.
export function alterationSlots(schematicTemplateId) {
  const data = alterationData();
  if (!data.slotLoadouts) return undefined;
  const result = resultOf(schematicTemplateId);
  const loadout = result?.alterationLoadout && data.slotLoadouts[result.alterationLoadout];
  if (!loadout?.length) return undefined;
  return loadout.map((slot) => {
    const definition = data.slotDefinitions[slot.slotDefinition];
    return { ...slot, respecCosts: definition?.respecCosts ?? [], group: data.groups[definition?.group] ?? {} };
  });
}

// The schematic's rarity: its crafted item's.
const schematicRarity = (templateId) => resultOf(templateId)?.rarity ?? getItem(templateId)?.rarity ?? "Ordinary";

// The exclusion names the crafted item's NamedWeightRow rules out (AlterationNamedExclusions), lower case: FString sets
// compare without case.
function namedExclusions(schematicTemplateId) {
  const row = resultOf(schematicTemplateId)?.namedWeightRow;
  return new Set((alterationData().namedExclusions[row] ?? []).map((name) => name.toLowerCase()));
}

const excludedBy = (entry, names) => entry.exclusions.some((name) => names.has(name.toLowerCase()));

// A group's perks at a rarity, as 4.2's respec options pick them (sub_D32030): the current perk's rarity, else Sturdy
// when the group has Sturdy perks, else Handmade.
function weightSet(group, rarity) {
  if (rarity) return group[rarity] ?? [];
  return group.Sturdy?.length ? group.Sturdy : group.Handmade ?? [];
}

function weightedPick(entries, random) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return entries[Math.floor(random() * entries.length)];
  let roll = random() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

// A new perk for a slot: a rarity between the slot's SlotInitMin and SlotInitMax, then a perk of the group at that
// rarity by its InitialRollWeight, leaving out what the weapon's named exclusions and the item's other perks' exclusion
// names rule out (so a weapon doesn't roll two Damage perks). 🟡 The SlotRarityInitRow weights (StandardInit.Slot0...,
// Guarantee.Rare) are cooked out of the client, so the rarity is even between the two; when the item's own perks
// leave nothing, they're not counted.
function rollSlot(slot, excluded, taken, random) {
  const low = rank(slot.initMin);
  const high = Math.max(low, rank(slot.initMax));
  const choices = rarities.slice(low, high + 1).filter((rarity) => slot.group[rarity]?.length);
  const rarity = choices.length ? choices[Math.floor(random() * choices.length)] : Object.keys(slot.group)[0];
  const entries = (slot.group[rarity] ?? []).filter((entry) => !excludedBy(entry, excluded));
  const free = entries.filter((entry) => !excludedBy(entry, taken));
  const entry = (free.length ? free : entries).length ? weightedPick(free.length ? free : entries, random) : undefined;
  if (!entry) return "";
  for (const name of entry.exclusions) taken.add(name.toLowerCase());
  return entry.alteration;
}

// The perks of a schematic just granted, every slot's (the locked ones too: a rarity upgrade or a level unlocks them
// later), or undefined for a schematic without a loadout.
export function rollAlterations(schematicTemplateId, random = Math.random) {
  const slots = alterationSlots(schematicTemplateId);
  if (!slots) return undefined;
  const excluded = namedExclusions(schematicTemplateId);
  const taken = new Set();
  return slots.map((slot) => rollSlot(slot, excluded, taken, random));
}

// The attributes a 4.2 schematic starts with, or none.
export function newSchematicAlterations(templateId) {
  if (getItem(templateId)?.class !== "FortSchematicItemDefinition") return {};
  const alterations = rollAlterations(templateId);
  return alterations ? { alterations, legacy_alterations: [] } : {};
}

// UFortAlterableItem::HasLegacyAlterations (4.2's sub_D49140): a perk of the item is a row of AlterationMigrationMapping,
// one of the perks schematics had before 4.2. The client won't offer such an item's rarity upgrade
// (ItemInspectScreen_C.SchematicRequirementsMet) or perk changes until it is converted (ConvertLegacyAlterations).
export function hasLegacyAlterations(item) {
  if (!hasAlterationData()) return false;
  const { migration } = alterationData();
  return (Array.isArray(item?.attributes?.alterations) ? item.attributes.alterations : [])
    .some((alteration) => alteration && migration.has(String(alteration).toLowerCase()));
}

// Whether a perk is in a group at its own rarity and not ruled out by the weapon (4.2's sub_D400F0).
function fits(slot, alteration, excluded) {
  const rarity = getItem(alteration)?.rarity;
  return (slot.group[rarity] ?? []).some((entry) => sameId(entry.alteration, alteration) && !excludedBy(entry, excluded));
}

// ConvertLegacyAlterations: the converted perks of a legacy schematic, as 4.2's preview of it builds them
// (UFortAlterableItem::GetAlterationSlotsPreview, sub_D32970). Every loadout slot starts empty; the element the crafted
// item's tags give it (AlterationIntrinsicMapping: Gameplay.Damage.Elemental.Fire and the rest) takes the first slot that
// can hold it; each legacy perk's new perk (AlterationMigrationMapping NewAlteration, and AdditionalAlteration when set)
// takes the first empty slot whose group holds it at its rarity; the slots left get new perks as a new schematic's do.
// 🟡 The preview shows the slots left with their Sturdy choices; which one Epic's service gave isn't in the client.
// A mapped perk no empty slot can hold is dropped.
export function convertedAlterations(item, random = Math.random) {
  const slots = alterationSlots(item.templateId);
  if (!slots) return undefined;
  const { migration, intrinsic } = alterationData();
  const excluded = namedExclusions(item.templateId);
  const converted = slots.map(() => "");
  const place = (alteration) => {
    const info = alteration && getItem(alteration);
    if (!info) return;
    const index = slots.findIndex((slot, i) => !converted[i] && fits(slot, alteration, excluded));
    if (index >= 0) converted[index] = info.templateId;
  };
  for (const tag of resultOf(item.templateId)?.tags ?? []) place(intrinsic.get(tag.toLowerCase()));
  for (const legacy of item.attributes?.alterations ?? []) {
    const mapping = legacy && migration.get(String(legacy).toLowerCase());
    if (!mapping) continue;
    place(mapping.alteration);
    place(mapping.additional);
  }
  const taken = new Set();
  converted.forEach((alteration, i) => {
    const entry = alteration && Object.values(slots[i].group).flat().find((candidate) => sameId(candidate.alteration, alteration));
    for (const name of entry?.exclusions ?? []) taken.add(name.toLowerCase());
  });
  return converted.map((alteration, i) => alteration || rollSlot(slots[i], excluded, taken, random));
}

// An existing schematic's perks fitted to its loadout: a schematic Core granted before 4.2, or one an evolution or rarity
// upgrade moved to a template whose loadout has another number of slots, gets new perks for the slots it lacks
// (a legacy schematic keeps its perks until it is converted). Returns the attributes to set, or none.
export function missingAlterations(item, random = Math.random) {
  if (!hasAlterationData() || getItem(item.templateId)?.class !== "FortSchematicItemDefinition") return {};
  if (hasLegacyAlterations(item)) return {};
  const slots = alterationSlots(item.templateId);
  if (!slots) return {};
  const current = Array.isArray(item.attributes?.alterations) ? item.attributes.alterations : undefined;
  const changes = {};
  if (!Array.isArray(item.attributes?.legacy_alterations)) changes.legacy_alterations = [];
  if (current?.length === slots.length) return changes;
  if (!current) return { ...changes, alterations: rollAlterations(item.templateId, random) };
  const excluded = namedExclusions(item.templateId);
  const taken = new Set();
  return { ...changes, alterations: slots.map((slot, i) => (i < current.length ? current[i] ?? "" : rollSlot(slot, excluded, taken, random))) };
}

// The schematic in profile0 that a perk command names, with its slots; legacy perks refuse everything but conversion.
function alterable(tracker, itemId, { legacy = false } = {}) {
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  const slots = item && alterationSlots(item.templateId);
  if (!slots) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `Item ${itemId} not found or has no perks`);
  if (hasLegacyAlterations(item) !== legacy) {
    fail(legacy ? `${item.templateId} has no legacy perks to convert` : `${item.templateId} has legacy perks: convert them first`);
  }
  return { item, slots };
}

// A slot the schematic has unlocked: UFortItem::GetActiveAlterations (sub_D31D00) counts slot i when the item's level is
// at least its MinRequiredLevel and its rarity at least its MinHostItemRarity.
function unlockedSlot(item, slots, index) {
  const slot = Number.isInteger(index) ? slots[index] : undefined;
  if (!slot) fail(`${item.templateId} has no perk slot ${index}`);
  if ((item.attributes?.level ?? 1) < slot.unlockLevel || rank(schematicRarity(item.templateId)) < rank(slot.unlockRarity)) {
    fail(`${item.templateId}'s perk slot ${index} is locked`);
  }
  return slot;
}

// The schematic's perks that work: the unlocked slots' (UFortItem::GetActiveAlterations). A weapon crafted from it
// carries them (FFortItemEntry AlterationDefinitions).
export function activeAlterations(item) {
  const slots = alterationSlots(item.templateId);
  if (!slots || hasLegacyAlterations(item)) return [];
  const level = item.attributes?.level ?? 1;
  const rarity = rank(schematicRarity(item.templateId));
  return slots.map((slot, i) => (level >= slot.unlockLevel && rarity >= rank(slot.unlockRarity) ? item.attributes?.alterations?.[i] : ""))
    .filter(Boolean);
}

// RespecAlteration's choices for a slot (UFortAlterableItem::GetAlterationRespecOptions, sub_D32030): the slot must be
// bRespeccable; its group's perks at the current perk's rarity (Sturdy, else Handmade, for an empty slot), without the
// current one and what the weapon's named exclusions rule out. Each costs the slot's BaseRespecCosts plus the perk's
// AdditionalRespecCosts (the element perks' FIRE-UP!, AMP-UP!, FROST-UP!).
export function respecOptions(item, slotIndex) {
  const slots = alterationSlots(item.templateId);
  const slot = slots?.[slotIndex];
  if (!slot?.respeccable) return [];
  const current = item.attributes?.alterations?.[slotIndex] || "";
  const excluded = namedExclusions(item.templateId);
  return weightSet(slot.group, current ? getItem(current)?.rarity : undefined)
    .filter((entry) => !sameId(entry.alteration, current) && !excludedBy(entry, excluded) && getItem(entry.alteration))
    .map((entry) => ({ alteration: entry.alteration, costs: [...slot.respecCosts, ...(getItem(entry.alteration).respecCosts ?? [])] }));
}

// UpgradeAlteration's recipe for a slot (sub_D33F90): the current perk's UpgradeRarityRecipeHandle (Evolve.AID.*), whose
// one result is the same perk a rarity up, for its costs (RE-PERK! and the PERK-UP! of the new rarity).
export function upgradeRecipe(item, slotIndex) {
  const current = item.attributes?.alterations?.[slotIndex];
  const recipe = current && upgradeData().recipes[getItem(current)?.rarityUpgrade];
  return recipe?.results?.length === 1 && getItem(recipe.results[0].templateId) ? recipe : undefined;
}

// The perk commands (UFortMcpProfileCampaign, from 4.2), on profile0. Each returns what the command changed for the
// command's own bookkeeping; pay is upgrades.js's.
export function convertLegacy(tracker, itemId) {
  const { item } = alterable(tracker, itemId, { legacy: true });
  const legacy = [...item.attributes.alterations];
  tracker.setItemAttribute(itemId, "alterations", convertedAlterations(item));
  tracker.setItemAttribute(itemId, "legacy_alterations", legacy);
  return tracker.profile.items[itemId];
}

export function respec(tracker, itemId, slotIndex, alterationId, pay) {
  const { item, slots } = alterable(tracker, itemId);
  const slot = unlockedSlot(item, slots, slotIndex);
  if (!slot.respeccable) fail(`${item.templateId}'s perk slot ${slotIndex} can't be changed`);
  const option = respecOptions(item, slotIndex).find((choice) => sameId(choice.alteration, alterationId));
  if (!option) fail(`${alterationId} isn't one of the perks ${item.templateId}'s slot ${slotIndex} can change to`);
  pay(option.costs);
  setSlot(tracker, itemId, slots.length, slotIndex, option.alteration);
  return tracker.profile.items[itemId];
}

export function upgrade(tracker, itemId, slotIndex, pay) {
  const { item, slots } = alterable(tracker, itemId);
  unlockedSlot(item, slots, slotIndex);
  const recipe = upgradeRecipe(item, slotIndex);
  if (!recipe) fail(`${item.templateId}'s perk in slot ${slotIndex} can't be upgraded`);
  pay(recipe.costs);
  setSlot(tracker, itemId, slots.length, slotIndex, recipe.results[0].templateId);
  return tracker.profile.items[itemId];
}

function setSlot(tracker, itemId, count, slotIndex, alteration) {
  const current = tracker.profile.items[itemId].attributes.alterations;
  const alterations = Array.from({ length: Math.max(count, current?.length ?? 0) }, (_, i) => current?.[i] ?? "");
  alterations[slotIndex] = alteration;
  tracker.setItemAttribute(itemId, "alterations", alterations);
}

// From 4.2, every schematic in profile0 with a loadout holds a perk per slot: Core granted none before 4.2, so an
// account's older schematics get new perks at its next profile0 query, as new ones do when granted. Epic's players had
// legacy perks to convert instead (🟡: Core never kept any, so its schematics have nothing to convert).
export function fitSchematicAlterations(tracker) {
  if (!hasAlterationData()) return;
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    for (const [name, value] of Object.entries(missingAlterations(item))) tracker.setItemAttribute(itemId, name, value);
  }
}
