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
// Profiles made before this, or left with no hero at all, get what they lack when they next load. So does a profile
// whose lead slot is empty: its first hero in no squad takes it (heroes in other slots or on expeditions stay).
const { defaultHero } = readGameData("newaccount", {});
const fallbackSquad = "Squad_Combat_AdventureSquadOne";

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
    || Boolean(leadCandidate(profile));
}

export function setUpProfile(session) {
  for (const questId of startingQuests) grant(session, `Quest:${questId}`, 1);

  const { profile } = session.profile("profile0");
  if (defaultHero && !heroes(profile).length) grant(session, defaultHero, 1);
  const lead = leadCandidate(profile);
  if (lead) assignToSquad(session, lead, leadSquad(profile), 0);
}
