import { slotUnlockNode } from "../gamedata/homebase.js";
import { readGameData } from "../gamedata/read.js";
import { startingQuests } from "../gamedata/quests.js";
import { ownsNode } from "./homebase.js";
import { grant } from "./progress.js";
import { findQuestItem } from "./quests.js";
import { assignToSquad, characterType } from "./squads.js";

// What a new profile0 starts with that takes the game's rules to add, so the account's first login looks like any
// later one:
// - The starting quests, which ClientQuestLogin would otherwise add during the first login. The client's other
//   requests then in flight come back with a full profile update, and loading the new quest's definition from that
//   HTTP callback while the QoS ping tests have async loading suspended crashes it ("Cannot Flush Async Loading while
//   async loading is suspended", AsyncLoading.cpp:6629, 2026-10-19).
// - The default hero (UFortGameData DefaultHero, Ramirez) in the default hero squad's first slot. The lobby's lead
//   hero and the hero the server spawns (ServerSetHeroId) are that slot's; without one both are empty.
// - The tutorial's tier 0 weapon schematics (🟡 Core's set): the tutorial's crafting step needs
//   SID_Assault_Auto_C_Ore_T00 in the profile (AFortPlayerController::ServerCraftSchematic 0x767BD0 looks it up by
//   item id and does nothing without it), and nothing in the client, its quests or its game data grants any of the
//   tier 0 weapons (the tier 0 Healing Pad comes from stonewoodquest_launchballoon_d1). Every profile gets the
//   missing ones once (retail accounts always had them), so a recycled one isn't given back.
// - The bullet and shell ammo schematics, from UFortGameData DefaultInventoryList (Balance/DefaultGameData:
//   Ammo_BulletsLight/Medium/Heavy, Ammo_Shells). Without them the crafting tab and hold-R quick craft have no ammo
//   to offer. The energy cell schematic stays a reward of outpostquest_t1_l1, as Epic had it. Same once-only rule.
// Profiles made before this, or left with no hero at all, get what they lack when they next load. So does a profile
// whose lead slot is empty: its first hero in no squad takes it (heroes in other slots or on expeditions stay).
const { defaultHero } = readGameData("newaccount", {});
const fallbackSquad = "Squad_Combat_AdventureSquadOne";
// Core's own one-time changes are listed on the saved profile (coreMigrations); the client is never sent it.
const schematicMigrations = [
  { name: "starterSchematics", schematics: ["Schematic:sid_assault_auto_c_ore_t00", "Schematic:sid_assault_semiauto_c_ore_t00",
    "Schematic:sid_pistol_semiauto_c_ore_t00", "Schematic:sid_edged_sword_medium_c_ore_t00"] },
  { name: "ammoSchematics", schematics: ["Schematic:ammo_bulletsmedium", "Schematic:ammo_bulletslight", "Schematic:ammo_shells",
    "Schematic:ammo_bulletsheavy"] }
];
const migrated = (profile, name) => (profile.coreMigrations ?? []).includes(name);
const missingSchematics = (profile, schematics) => schematics
  .filter((templateId) => !Object.values(profile.items).some((item) => item.templateId.toLowerCase() === templateId.toLowerCase()));

const heroes = (profile) => Object.entries(profile.items).filter(([, item]) => characterType(item) === "Hero");
const leadSquad = (profile) => profile.stats.attributes.default_hero_squad_id || fallbackSquad;

// The hero to put in the lead slot, when that slot is empty and unlocked.
function leadCandidate(profile) {
  const squad = leadSquad(profile).toLowerCase();
  const all = heroes(profile);
  if (all.some(([, item]) => (item.attributes.squad_id ?? "").toLowerCase() === squad && item.attributes.squad_slot_idx === 0)) return null;
  const node = slotUnlockNode(squad, 0);
  if (!node || !ownsNode(profile, node)) return null;
  return all.find(([, item]) => !item.attributes.squad_id)?.[0] ?? null;
}

export function needsSetUp(profile) {
  if (profile.profileId !== "profile0") return false;
  return startingQuests.some((questId) => !findQuestItem(profile, questId)) || Boolean(defaultHero && !heroes(profile).length)
    || Boolean(leadCandidate(profile)) || schematicMigrations.some(({ name }) => !migrated(profile, name));
}

export function setUpProfile(session) {
  for (const questId of startingQuests) grant(session, `Quest:${questId}`, 1);

  const { profile } = session.profile("profile0");
  for (const { name, schematics } of schematicMigrations) {
    if (migrated(profile, name)) continue;
    for (const templateId of missingSchematics(profile, schematics)) grant(session, templateId, 1);
    profile.coreMigrations = [...(profile.coreMigrations ?? []), name];
  }
  if (defaultHero && !heroes(profile).length) grant(session, defaultHero, 1);
  const lead = leadCandidate(profile);
  if (lead) assignToSquad(session, lead, leadSquad(profile), 0);
}
