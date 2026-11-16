import { currentBuild } from "../builds/context.js";
import { isEventQuest } from "../events/quests.js";
import { getNodeByTemplateId } from "../gamedata/homebase.js";
import { getQuest, questChildren, questIds, questParents } from "../gamedata/quests.js";
import { perBuild } from "../gamedata/read.js";
import { log } from "../log.js";
import { isStory } from "../world/quests.js";
import { giveGiftBox } from "./giftboxes.js";
import { heldQuantity } from "./homebase.js";
import { expandStormShield, missedStormShieldResources } from "./outposts.js";
import { grant } from "./progress.js";
import { grantQuest, questIdOf } from "./quests.js";

// A later build's quest line can differ from the one a player went through: an update inserts quests ahead of where
// the player is, adds new ones to a quest the player already claimed, and moves rewards onto quests the player is past.
// A claim grants what the build's data says at that moment and never again, so an account that claimed a quest on an
// earlier build holds none of what a later build's data adds to it. Epic's update notes say what its servers did then:
// - 5.10 inserted Canny Valley and Twine Peaks story quests that ask for Storm Shield Defenses and give "retroactive
//   credit" for ones already won, and opened the new Canny Valley storyline to every player who could reach the zone;
// - 4.2: players past Plankerton's SSD 2 had the Perk Recombobulator quests and their starting resources at once
//   (profiles/outposts.js missedStormShieldResources);
// - 6.30 moved the skill tree's feature unlocks (Transformation, Recycling, Evolution, Expeditions) and many squad slots
//   into Stonewood's and Plankerton's reworked quests, and players already past those quests got the new rewards in a
//   Giftbox.
//   6.30's data shows both: OutpostQuest_T2_L3 (Plankerton's SSD 3) now gives HomebaseNode:QuestReward_Transformation
//   and the SSD 3 squad slots, and new quests such as StonewoodQuest_Fetch_ResearchCrates (Research) and
//   StonewoodQuest_Landmark_BuildOff (building upgrades) sit between Stonewood's SSD 3 and StonewoodQuest_Filler_1_D3.
//   Without them a player who went through Stonewood and Plankerton before 6.30 had no transform, no research and
//   locked squad slots (Core-Backend #368).
//
// So at quest login (ClientQuestLogin), with the requesting build's data, every campaign quest that a claimed quest's
// rewards or hidden rewards name is settled:
// - one the player is already past is claimed: its objectives full, no reward screen, its storm shield step taken.
//   The player is past a quest when they hold a story quest that, in this build's quest line, only that quest leads to
//   (every path from the quests nothing grants goes through it; isPastQuest): holding StonewoodQuest_Filler_1_D3 means
//   having been past Build Off and the Research Crates. An Active one the player is past is claimed the same way (one an
//   earlier quest login gave out as missed, #210's rule). A Storm Shield Defense is never claimed for the player;
// - one the player isn't past and doesn't hold is granted, as the claim would grant it on this build: 3.0's Hoverboard
//   questline from Stonewood's SSD 5 (#210), 5.10's Canny Valley storyline from its SSD 1, 6.30's tutorials;
// - the account's claimed quests' HomebaseNode rewards it doesn't own are given (the squad slots and feature unlocks).
//   From 6.30 they come in a gift box, Epic's Giftbox: GB_StwMakeGood, whose header (ItemReceivedEpicMakeGoodHeader)
//   shows its assetString param's text, here Migration.General ("Some rewards are now given out differently, so you
//   deserve this. Thanks for playing!"; 🟡 which of the header's Migration texts Epic's box used isn't recorded).
// 🟡 A quest the player is past gives its unlocks (HomebaseNode rewards) and nothing else, the new rewards the 6.30 note
// names: its other rewards (XP, schematics, V-Bucks) were the reward for playing it.
// The quests of an event's line are left to the event's own rules (events/quests.js), daily quests to
// profiles/dailies.js; deprecated ones are never given. Reward choices are left out (which one was taken isn't kept).
// Nothing changes for an account that went through the build's own quest line: everything a claim named is held.
// This also gives back a quest that was taken out of the quest log (the admin panel's Remove, which #368 found locked
// the quest line, and which the panel no longer has): it's what its claimed quest grants.
const firstMigrationGiftBoxBuild = 4573096;
export const questLineGiftBox = "GiftBox:GB_StwMakeGood";
export const questLineGiftBoxText = "Migration.General";

const isCampaignQuest = (questId) => {
  const quest = getQuest(questId);
  return Boolean(quest) && !quest.deprecated && quest.type !== "DailyQuest" && !isEventQuest(questId);
};

// The quests nothing in this build's data grants (the starting quests, the event and daily quests, the ones Epic's
// servers handed out), where every path through the quest line starts.
const roots = perBuild(() => questIds().filter((questId) => !questParents(questId).length));

// A Storm Shield Defense (OutpostQuest_T<theater>_L<level>): every build has them, in the same order, and none is ever
// inserted (Update v5.10 left the defenses and Launch the Rocket quests unchanged and still required).
const isStormShieldDefense = (questId) => /^outpostquest_t\d+_l\d+$/.test(questId);

// The quests reachable from starts, without going through skip or past a quest blocks(questId) refuses.
function walk(starts, { skip, blocks = () => false } = {}) {
  const seen = new Set();
  const pending = starts.filter((questId) => questId !== skip && !blocks(questId));
  while (pending.length) {
    const questId = pending.pop();
    if (seen.has(questId)) continue;
    seen.add(questId);
    for (const child of questChildren(questId)) if (child !== skip && !seen.has(child) && !blocks(child)) pending.push(child);
  }
  return seen;
}

// Whether the player is past questId: they hold a story quest (world/quests.js isStory: a main quest or a theater's side
// quest) that, in this build's quest line, only questId leads to, and that comes after it without a Storm Shield
// Defense they haven't claimed in between. Only story quests tell where the player is: an update also moves side
// quests later (6.30 put HomeBaseQuest_CompleteExpedition after StonewoodQuest_LaunchRocket_D5 and
// Challenge_WeaponUpgrade_1 after StonewoodQuest_RetrieveData_D1, both early quests on 6.22), and a defense the player
// hasn't won lies ahead of them whatever the quests around it say. A defense itself is never one the player is past:
// it is the mission that opens the zone (5.10's notes keep the defenses required).
export function isPastQuest(profile, questId) {
  const id = questId.toLowerCase();
  if (isStormShieldDefense(id)) return false;
  const states = new Map(Object.values(profile.items).filter((item) => questIdOf(item)).map((item) => [questIdOf(item), item.attributes?.quest_state]));
  const ahead = (child) => isStormShieldDefense(child) && states.get(child) !== "Claimed";
  const later = [...walk(questChildren(id), { skip: id, blocks: ahead })]
    .filter((child) => states.has(child) && getQuest(child) && isStory(child, getQuest(child)));
  if (!later.length) return false;
  const reachable = walk(roots(), { skip: id });
  return later.some((child) => !reachable.has(child));
}

const claimedQuests = (profile) => Object.values(profile.items)
  .filter((item) => item.attributes?.quest_state === "Claimed" && getQuest(questIdOf(item) ?? ""))
  .map((item) => questIdOf(item));

// The campaign quests the account's claimed quests grant that it doesn't hold, or holds Active.
function unsettledQuests(profile) {
  const held = new Map(Object.values(profile.items).filter((item) => questIdOf(item)).map((item) => [questIdOf(item), item]));
  const found = new Set();
  for (const questId of claimedQuests(profile)) {
    for (const child of questChildren(questId)) {
      const item = held.get(child);
      if ((!item || item.attributes?.quest_state === "Active") && isCampaignQuest(child)) found.add(child);
    }
  }
  return [...found];
}

// A quest the player is past: claimed in place (granted first if the account lacks it), no rewards.
function claimPassed(session, questId) {
  const tracker = session.profile("profile0");
  const itemId = Object.keys(tracker.profile.items).find((id) => questIdOf(tracker.profile.items[id]) === questId)
    ?? grantQuest(tracker, questId);
  const quest = getQuest(questId);
  for (const objective of quest.objectives) {
    const key = `completion_${objective.name}`;
    if (tracker.profile.items[itemId].attributes[key] !== objective.count) tracker.setItemAttribute(itemId, key, objective.count);
  }
  tracker.setItemAttribute(itemId, "quest_state", "Claimed");
  tracker.setItemAttribute(itemId, "last_state_change_time", new Date().toISOString());
  if (quest.expandsStormShield) expandStormShield(session, questId);
}

// The HomebaseNode rewards of the account's claimed quests that it doesn't own and this build has.
export function missingQuestUnlocks(profile) {
  const missing = new Set();
  for (const questId of claimedQuests(profile)) {
    const quest = getQuest(questId);
    for (const { templateId } of [...(quest.rewards ?? []), ...(quest.hiddenRewards ?? [])]) {
      if (!/^homebasenode:/i.test(templateId) || !getNodeByTemplateId(templateId) || heldQuantity(profile, templateId) > 0) continue;
      missing.add(templateId.toLowerCase());
    }
  }
  return [...missing];
}

// Settles the account's quest line with the requesting build's data. Returns what it did: {claimed, granted, unlocks}.
export function settleQuestLine(session) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const claimed = [];
  const granted = [];
  const missed = [];
  for (let pending = unsettledQuests(profile); pending.length; pending = unsettledQuests(profile)) {
    let changed = false;
    for (const questId of pending) {
      const item = Object.values(profile.items).find((candidate) => questIdOf(candidate) === questId);
      if (!item) missed.push(questId);
      if (isPastQuest(profile, questId)) {
        claimPassed(session, questId);
        claimed.push(questId);
        changed = true;
      } else if (!item && grant(session, `Quest:${questId}`, 1).length) {
        granted.push(questId);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // 4.2's Perk Recombobulator resources with its quest from Plankerton's SSD 2.
  for (const { templateId, quantity } of missedStormShieldResources(profile, missed)) grant(session, templateId, quantity);

  const unlocks = missingQuestUnlocks(profile).flatMap((templateId) => grant(session, templateId, 1));
  if (unlocks.length && Number(currentBuild()) >= firstMigrationGiftBoxBuild) {
    giveGiftBox(session, questLineGiftBox, unlocks, { assetString: questLineGiftBoxText });
  }
  if (claimed.length || granted.length || unlocks.length) {
    log("Quests", `${session.accountId}'s quest line: ${claimed.length} passed quests claimed (${claimed.join(", ") || "none"}), `
      + `${granted.length} granted (${granted.join(", ") || "none"}), ${unlocks.length} unlocks given`);
  }
  return { claimed, granted, unlocks: unlocks.map(({ templateId }) => templateId) };
}
