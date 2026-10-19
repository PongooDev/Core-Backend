import { readGameData } from "../gamedata/read.js";
import { startingQuests } from "../gamedata/quests.js";
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
// Profiles made before this, or left with no hero at all, get what they lack when they next load.
const { defaultHero } = readGameData("newaccount", {});
const fallbackSquad = "Squad_Combat_AdventureSquadOne";

const hasHero = (profile) => Object.values(profile.items).some((item) => characterType(item) === "Hero");

export function needsSetUp(profile) {
  if (profile.profileId !== "profile0") return false;
  return startingQuests.some((questId) => !findQuestItem(profile, questId)) || Boolean(defaultHero && !hasHero(profile));
}

export function setUpProfile(session) {
  for (const questId of startingQuests) grant(session, `Quest:${questId}`, 1);

  const { profile } = session.profile("profile0");
  if (!defaultHero || hasHero(profile)) return;
  const [hero] = grant(session, defaultHero, 1);
  if (hero) assignToSquad(session, hero.itemId, profile.stats.attributes.default_hero_squad_id || fallbackSquad, 0);
}
