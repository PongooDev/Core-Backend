import { addPageItem, bookProfiles, pageId, pages, refreshPage } from "../collectionbook/pages.js";
import { expeditionsNeedSetUp, setUpExpeditions } from "../expeditions/expeditions.js";
import { slotUnlockNode } from "../gamedata/homebase.js";
import { getItem } from "../gamedata/items.js";
import { readGameData } from "../gamedata/read.js";
import { log } from "../log.js";
import { collectorsNeedSetUp, setUpCollectors } from "../research/collector.js";
import { startingQuests } from "../gamedata/quests.js";
import { foundersNeedSetUp, setUpFounders } from "./founders.js";
import { friendCodesNeedSetUp, setUpFriendCodes } from "./friendcodes.js";
import { ownsNode } from "./homebase.js";
import { tidyWorldStacks } from "./items.js";
import { grant } from "./progress.js";
import { findQuestItem } from "./quests.js";
import { assignToSquad, characterType } from "./squads.js";
import { levelStartXp, settleLevel } from "./xp.js";

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
// - The xp stat as XP into the current level (profiles/xp.js). Profiles saved before 2026-10-22 hold the total, which
//   the client showed as an overfull bar (issue #7): theirs becomes what is past their level's start, once.
// - In a collection book profile, a page item for each of its pages profile0's collection_book.pages has unlocked
//   (collectionbook/pages.js), which the client builds the book from. Core used to keep the unlocked pages in that stat
//   only, so the book showed no categories, slotting filled nothing and the XP stayed at 0 (issue #13). Profiles saved
//   before then get their page items and their pages' states once (and lose Core's old claimed_page_rewards stat).
// - theater0 and outpost0 as the world inventory keeps them (tidyWorldStacks, profiles/items.js): Core used to give
//   never-persisted world items (ability ammo, quest pickups; the game never saves one) and, past a full first stack,
//   dropped the rest of a stackable grant. An admin grant of 3000 Bot Turret ammo (MaxStackSize 1, bNeverPersisted) made
//   3000 theater0 items; the server loads every one into the world inventory, whose first FFortItemList delta then holds
//   them all, and the client rejects more than 2048 changed entries (FastArrayDeltaSerialize<FFortItemEntry> 0x89A720,
//   "NumChanged > MAX_NUM_CHANGED"), so the player never got into the zone (issue #17). Never-persisted items go and equal
//   stacks merge, once per profile.
// - The research point collector (research/collector.js) of a profile that owns Unlock Research: Tier 1. Core had no
//   collectors before 2026-10-23, so profiles that bought the node then get theirs when they next load, filled since the
//   node was bought as far as the profile shows; the empty ones they got before that (issue #20) start then too, once.
// - Expedition offers with Epic's minimum power, 5% of the target (expeditions/expeditions.js): Core's used to sit
//   TierFactor percent below it, so the chance shown was 0 or 100% (issue #30). Older offers get it once.
// - The founder's pack (profiles/founders.js): the Standard Edition's founders quest, whose daily reward tokens bring the
//   Founder's Llama. Core gave none before 2026-10-24 (issue #31); older profiles get it once.
// - Founder's friend codes held as the consumable are turned into the code tokens the friend code screen issues codes
//   from (profiles/friendcodes.js, issue #35).
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
  if (profile.profileId === "theater0") return !migrated(profile, "itemDurability") || !migrated(profile, "worldStacks");
  if (profile.profileId === "outpost0") return !migrated(profile, "worldStacks");
  if (bookProfiles.includes(profile.profileId)) return !migrated(profile, "bookPages");
  if (profile.profileId !== "profile0") return false;
  return startingQuests.some((questId) => !findQuestItem(profile, questId)) || Boolean(defaultHero && !heroes(profile).length)
    || Boolean(leadCandidate(profile)) || schematicMigrations.some(({ name }) => !migrated(profile, name)) || !migrated(profile, "levelXp")
    || collectorsNeedSetUp(profile) || expeditionsNeedSetUp(profile) || foundersNeedSetUp(profile)
    || friendCodesNeedSetUp(profile);
}

// theater0's world items granted before Core gave new ones their template's durability (profiles/items.js) get it, once;
// an item that has a durability keeps it.
function setUpTheater(session) {
  const tracker = session.profile("theater0");
  if (!migrated(tracker.profile, "worldStacks")) setUpWorldStacks(session, "theater0");
  if (migrated(tracker.profile, "itemDurability")) return;
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    const maxDurability = getItem(item.templateId)?.maxDurability;
    if (maxDurability !== undefined && item.attributes && !("durability" in item.attributes)) tracker.setItemAttribute(itemId, "durability", maxDurability);
  }
  tracker.profile.coreMigrations = [...(tracker.profile.coreMigrations ?? []), "itemDurability"];
}

function setUpWorldStacks(session, profileId) {
  const tracker = session.profile(profileId);
  const { removed, merged } = tidyWorldStacks(tracker);
  if (removed || merged) log("Profiles", `${session.accountId} ${profileId}: ${removed} never-persisted items removed, ${merged} stacks merged`);
  tracker.profile.coreMigrations = [...(tracker.profile.coreMigrations ?? []), "worldStacks"];
}

function setUpBook(session, profileId) {
  const tracker = session.profile(profileId);
  const unlocked = session.profile("profile0").profile.stats.attributes.collection_book?.pages ?? [];
  for (const id of new Set(unlocked.map(pageId).filter(Boolean))) {
    if (pages[id].profile !== profileId) continue;
    addPageItem(session, id);
    refreshPage(session, id);
  }
  delete tracker.profile.stats.attributes.claimed_page_rewards;
  tracker.profile.coreMigrations = [...(tracker.profile.coreMigrations ?? []), "bookPages"];
}

export function setUpProfile(session, profileId = "profile0") {
  if (profileId === "theater0") return setUpTheater(session);
  if (profileId === "outpost0") return setUpWorldStacks(session, profileId);
  if (bookProfiles.includes(profileId)) return setUpBook(session, profileId);
  for (const questId of startingQuests) grant(session, `Quest:${questId}`, 1);
  setUpFounders(session);
  setUpFriendCodes(session);

  const { profile } = session.profile("profile0");
  for (const { name, schematics } of schematicMigrations) {
    if (migrated(profile, name)) continue;
    for (const templateId of missingSchematics(profile, schematics)) grant(session, templateId, 1);
    profile.coreMigrations = [...(profile.coreMigrations ?? []), name];
  }
  if (!migrated(profile, "levelXp")) {
    const { level = 1, xp = 0 } = profile.stats.attributes;
    const inLevel = Math.max(0, xp - levelStartXp(level));
    if (inLevel !== xp) session.profile("profile0").setStat("xp", inLevel);
    settleLevel(session);
    profile.coreMigrations = [...(profile.coreMigrations ?? []), "levelXp"];
  }
  setUpCollectors(session);
  setUpExpeditions(session);
  if (defaultHero && !heroes(profile).length) grant(session, defaultHero, 1);
  const lead = leadCandidate(profile);
  if (lead) assignToSquad(session, lead, leadSquad(profile), 0);
}
