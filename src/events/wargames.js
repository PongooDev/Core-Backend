import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { getQuest, questIds } from "../gamedata/quests.js";
import { grant } from "../profiles/progress.js";
import { findQuestItem, isDone, questIdOf } from "../profiles/quests.js";
import { isEventActive, wargames, wargamesFlag } from "./events.js";
import { removeQuests } from "./quests.js";

export { wargames, wargamesFlag };

// Save the World's Wargames (9.00, CL-6337466, PongooDev/CoreV2#655). Update v9.00: "Revisit your Storm Shield bases and
// test your defenses against some destructive and challenging simulations", "apply one of nine new challenge modifiers
// for some bonus rewards", the Boot Camp quests, a one-time quest per simulation ("Event Tickets and a unique banner")
// and per challenge ("Event Tickets"), repeatable quests, and the Daily Challenge quests ("a Simulation / Challenge
// combination in a specific zone", "a Wargames Daily Challenge slot associated with that zone for a total of 4 per day",
// "Event Tickets and Gold").
//
// A Wargame isn't a world info mission: 9.00's FFortAvailableMissionData has no field for one. The player plays their
// Storm Shield (MissionGen_TheOutpost_PvE_0n) and picks a simulation and a challenge at its computer
// (UI/InGame/Outpost/IronCityContent), so the gameserver has the choice in the match. The backend's part:
// - UFortGlobals' bEnableIronCity (GetIronCityEnabled, 9.00 0xFFFF8008253DB430 reads +0x5D; only Blueprints call it):
//   9.00's shipped DefaultGame.ini sets the simulations and challenges ([/Script/FortniteGame.FortGlobals]
//   +IronCityWargameTagList, which IronCityMission_Parent's IsUnlocked checks each one's MissionTags against) but never
//   bEnableIronCity, so the hotfix turns it on (🟡: Epic's hotfix isn't kept; the shipped list is left as it is);
// - the event's flag, EventFlag.Outpost (QuestMapData's "WARGAMES" callout);
// - the quests, which nothing in 9.00's data grants (Epic's servers handed them out), given at quest login while the
//   event runs;
// - each day's Daily Challenge quests (refreshWargamesDailies);
// - the simulation's rewards for its badges (wargameBadgeRewards), and the packs' contents (cardpacks/contents.js).

// The simulations 9.00's shipped IronCityWargameTagList turns on, by the name their quests use: "Torn Apart"
// (Stat.Mission.IronCity.MidlandHusknado), "Hot Spots" (Eruption), "Denied" (Anomaly) and "Safety Zone" (Generators),
// the notes' "The first four". Pods (Stat.Mission.IronCity.Pods) has quests and a banner in 9.00's paks but isn't in the
// list, so its computer entry stays off and its quests aren't given. All nine challenges are in the list.
// 9.01 (CL-6428087): Update v9.01's "New Wargames simulation: Mist Pods" ("more chances for Event Tickets, a new player
// banner, and more variety to the Daily Quests"). 9.01's shipped DefaultGame.ini still lists 9.00's four, and its Pods
// quests, banner and daily quests are 9.00's, so 🟡 Epic's hotfix turned it on (not kept): the hotfix adds
// Stat.Mission.IronCity.Pods to the list on 9.01, and its quests and dailies are given with the other simulations'.
// 9.10: Update v9.10's "New Wargames simulation: Space Rocks" (meteors on the base; WargamesMissionConfigData_Wargame_Meteor's
// tag is Stat.Mission.IronCity.MStorm) and Content Update v9.10's "Hexed" (cursed heroes cleanse it at statues;
// _Wargame_Tiki's Stat.Mission.IronCity.Tiki), each with a banner (CardPack_Wargames_Banner_Meteor, _Tiki), simulation and
// challenge quests and 12 dailies, all new in CL-6639283's data. Its shipped list has Pods and MStorm (as
// Stat.Mission.Ironcity.*) but not Tiki, so the hotfix adds Tiki there. CL-6573057 (Update v9.10, no paks here) plays on
// that data but came out before Hexed: Tiki's quests and dailies aren't given on it, and 🟡 its shipped list isn't known,
// so its hotfix adds MStorm (and Pods) too. A "+" line adds only a tag the list doesn't already have.
// 9.20 (CL-6822798): Update v9.20's "New Wargames simulation: Invasion" ("A UFO invades the sky above your Storm Shield";
// WargamesMissionConfigData_Wargame_Saucer, Stat.Mission.IronCity.Saucer; CardPack_Wargames_Banner_Saucer), "Available in
// Wargames on June 5 at 8 PM Eastern Time", 9.20's first day on UTC: its quests and 12 dailies are new in 9.20's data, and
// 9.20's shipped list has it (with Pods, MStorm and Tiki). 9.20's paks also hold Update v9.21's Quantum Countdown
// (Wargame_Telebomb, Stat.Mission.IronCity.TeleBomb, not in the shipped list), whose quests and dailies wait for 9.21.
const simulations = ["anomaly", "generators", "lava", "tornado"];
// Each later simulation by its quests' name, its tag and the first build that runs it.
const laterSimulations = [
  { name: "pods", tag: "Stat.Mission.IronCity.Pods", build: 6428087 },
  { name: "meteor", tag: "Stat.Mission.IronCity.MStorm", build: 6573057 },
  { name: "tiki", tag: "Stat.Mission.IronCity.Tiki", build: 6639283 },
  { name: "saucer", tag: "Stat.Mission.IronCity.Saucer", build: 6822798 },
  { name: "telebomb", tag: "Stat.Mission.IronCity.TeleBomb", build: 6922310 }
];
export const mistPodsBuild = 6428087;
export const spaceRocksBuild = 6573057;
export const hexedBuild = 6639283;
export const invasionBuild = 6822798;
const laterOn = (changelist = currentBuild()) => laterSimulations.filter(({ build }) => Number(changelist) >= build);
const laterOff = (changelist = currentBuild()) => laterSimulations.filter(({ build }) => Number(changelist) < build);
const simulationsOn = () => [...simulations, ...laterOn().map(({ name }) => name)];
const ofSimulation = (questId, name) => new RegExp(`(^|_)${name}(_|$)`).test(questId);
const zones = ["stonewood", "plankerton", "canny", "twine"];

// Quests/Outpost/Wargames: Wargame_Quest_FirstOpen (the computer's first opening, its Claim conversation), the hidden
// visibility quests (Visibility/*: the computer lists a simulation or challenge while its IronCityMission's
// VisibilityQuest is held, GetQuestWithDefinition) and the Boot Camp (BootCamp/*). Their repeatables come from the
// Boot Camp quests' hidden rewards.
const isWargamesQuest = (questId) => questId === "wargame_quest_firstopen" || /^wargames_(visibilityquest|quest)_/.test(questId);
export function wargamesQuests() {
  const off = laterOff();
  return questIds().filter((questId) => isWargamesQuest(questId) && !questId.endsWith("_repeatable")
    && !off.some(({ name }) => ofSimulation(questId, name)) && !getQuest(questId).deprecated);
}

// Daily/<Zone>/Wargames_DailyQuest_<Sim>_With_<Challenge>_<Zone>: 15 a zone, each with its MissionConfigMetadata
// (Stat.Mission.IronCity, Stat.Mission.IronCity.Challenge, Activities.ConfigData.<Zone>), which the computer reads to
// show the zone's daily (IronCityContent, BP_PlayerController_Outpost WargamesDailyQuests). A later simulation's are left out
// before its build (laterSimulations).
const dailyPattern = /^wargames_dailyquest_([a-z]+)_with_[a-z]+_([a-z]+)$/;
const isWargamesDaily = (questId) => dailyPattern.test(questId);
export function wargamesDailyQuests(zone) {
  return questIds().filter((questId) => {
    const match = dailyPattern.exec(questId);
    return match && simulationsOn().includes(match[1]) && (zone === undefined || match[2] === zone);
  });
}

// The quest line events/quests.js takes out when the event ends: the Boot Camp's and every daily.
export const wargamesLineQuests = () => [...wargamesQuests(), ...questIds().filter(isWargamesDaily)];

export const wargamesEventQuests = () => (isEventActive(wargames) ? wargamesQuests() : []);

// A zone's daily slot opens with the zone's first Storm Shield Defense (OutpostQuest_T<n>_L1), the storm shield whose
// computer shows that zone's daily (IronCityContent GetOutpostTheaterTag: outpost 0 Stonewood to 3 Twine Peaks); the
// computer's Wargames button itself waits for OutpostQuest_T1_L1. 🟡 Epic's servers chose the dailies: one a zone, drawn
// at random from the zone's, at the first quest login of each UTC day, replacing the day before's.
export function unlockedWargamesZones(profile) {
  return zones.filter((zone, index) => {
    const itemId = findQuestItem(profile, `outpostquest_t${index + 1}_l1`);
    return itemId && isDone(profile.items[itemId]);
  });
}

export function refreshWargamesDailies(session, now = new Date()) {
  if (!isEventActive(wargames)) return;
  const tracker = session.profile("profile0");
  const day = now.toISOString().slice(0, 10);
  const unlocked = unlockedWargamesZones(tracker.profile);
  const held = Object.values(tracker.profile.items).map(questIdOf).filter((questId) => questId && isWargamesDaily(questId));
  const heldZones = new Set(held.map((questId) => dailyPattern.exec(questId)[2]));
  if ((tracker.profile.coreWargamesDay ?? "") === day && unlocked.every((zone) => heldZones.has(zone))) return;
  if ((tracker.profile.coreWargamesDay ?? "") !== day) {
    removeQuests(tracker, (item) => isWargamesDaily(questIdOf(item) ?? ""));
    heldZones.clear();
  }
  for (const zone of unlocked) {
    if (heldZones.has(zone)) continue;
    const choices = wargamesDailyQuests(zone);
    if (choices.length) grant(session, `Quest:${choices[crypto.randomInt(choices.length)]}`, 1);
  }
  tracker.profile.coreWargamesDay = day;
}

// What the simulation's badges give (EndMatch's earnedBadgeData, profiles/badges.js). WorldItem:IronCityMissionBadge01-25
// ("Wargames Simulation Completed!") is the IronCityDifficultyTable row the simulation ran at (RewardBadgeTag
// MissionReward.Badge.IronCity.Mission.T01-T25), whose MissionRewards is WarGames_Select_Theater1 for T01-T05, 2 for
// T06-T10, 3 for T11-T15 and 4 for T16-T25. That loot tier group is Epic's server data; the client has a "Wargames
// Rewards" pack per zone, CardPack:ZCP_IronCity_T01-T04 ("A crate of Stonewood Wargames rewards!" ... Twine Peaks), so
// a simulation gives its zone's pack, and the challenge badge (WorldItem:IronCityChallengeBadge, "Wargames Challenge
// Completed!", the notes' "bonus rewards") one more of it (🟡 Core's: one pack each).
export const wargameZoneOfBadge = (badge) => {
  const tier = Number(/^worlditem:ironcitymissionbadge(\d\d)$/i.exec(String(badge ?? ""))?.[1]);
  return tier >= 1 && tier <= 25 ? (tier <= 5 ? 1 : tier <= 10 ? 2 : tier <= 15 ? 3 : 4) : 0;
};
export const wargameRewardPack = (zone) => `CardPack:zcp_ironcity_t0${zone}`;

export function wargameBadgeRewards(earnedBadgeData) {
  const badges = Array.isArray(earnedBadgeData) ? earnedBadgeData : [];
  const zone = Math.max(0, ...badges.filter(({ count }) => count > 0).map(({ templateId }) => wargameZoneOfBadge(templateId)));
  if (!zone) return [];
  const challenge = badges.some(({ templateId, count }) => /^worlditem:ironcitychallengebadge$/i.test(String(templateId ?? "")) && count > 0);
  return [{ templateId: wargameRewardPack(zone), quantity: challenge ? 2 : 1 }];
}

// The hotfix's UFortGlobals lines while the event runs on a build that has it: the switch, and the later simulations its
// build runs (from 9.01 Mist Pods, from 9.10 Space Rocks, on Content Update v9.10's build Hexed, from 9.20 Invasion).
export const wargamesGlobals = (changelist) => (isEventActive(wargames, changelist)
  ? ["bEnableIronCity=true", ...laterOn(changelist).map(({ tag }) => `+IronCityWargameTagList=${tag}`)] : []);
