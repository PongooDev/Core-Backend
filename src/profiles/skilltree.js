import { currentBuild } from "../builds/context.js";
import { getNode, nodeLevels, nodeTemplateId } from "../gamedata/homebase.js";
import { getQuest, questIds } from "../gamedata/quests.js";
import { perBuild, readGameData } from "../gamedata/read.js";
import { log } from "../log.js";
import { giveGiftBox } from "./giftboxes.js";
import { heldQuantity } from "./homebase.js";
import { grant } from "./progress.js";
import { questLineGiftBox } from "./questline.js";

// Update v6.30 (CL-4573096) replaced the skill tree with the Upgrades page and moved the tree's feature unlocks
// (Transformation, Recycling, Evolution, Expeditions), many squad slots and the build level into quest rewards, and kept
// what a player had: features acquired before stay available after the migration. 6.30's data has none of the tree's
// nodes, so an account's T1_Main_* items give it nothing there, and its build level, squad slots and the rest come only
// from the QuestReward_* nodes 6.30's quests give. An account that bought the tree's nodes but hadn't reached those quests
// lost them (CoreV2 #469: no Upgrade on building pieces on 6.30 and 6.31, FortConstructionSet.MaxBuildLevel being
// GE_MaxBuildingUpgradeLevel_T1's, which 6.22 applied from T1_Main_38EAD7850 and T1_Main_8B125D0F0 and 6.30 from
// QuestReward_BuildingUpgradeLevel and _2; Core-Backend #368). profiles/questline.js gives the rewards of quests the
// account has done; this gives those of the nodes it bought.
//
// The mapping is the game data's (gamedata/skilltree630.json, tools/skilltree): the effect rows each node of 6.22's tree,
// the last one, applied (CommandConsole/CCNodes GameplayEffectRowNames) and the squad slots it unlocked, against what each
// node a 6.30 quest gives applies (its LevelData's GameplayEffectRowNames and UnlockedSquadSlots). 6.30's effect table
// keeps all of 6.22's rows unchanged, so a quest reward node is the account's when the tree gave it everything the node
// gives:
// - each squad slot it unlocks, by a node of the account's that unlocked it (the SSD squad slots, the defender slots,
//   the expedition squads); 6.30's mission defender squad's slots were the hero squad's Defender slots;
// - each effect row it applies that 6.22's tree had, as many times as the account's nodes applied it, less the quest
//   reward nodes already held that apply it (GE_MaxBuildingUpgradeLevel_T1 twice is both build levels, once is
//   QuestReward_BuildingUpgradeLevel; GE_ResourceCap_T2, GE_HarvestTool_Upgrade_T1, GE_Squad_Expedition_*);
// - each row 6.30 added, which joins several of the tree's into one (GE_Transformation_All, GE_RecycleCollection_All,
//   GE_Evolution_T2_All to _T5_All, GE_MaxMeleeComboLevel_All, the research deltas), when one of the account's nodes
//   granted one of its tags or changed its attribute: the feature it had stays available, as one node now holds it
//   (🟡 6.30 has no finer node, so a player who had one kind of transform or evolution gets them all).
// A quest reward node with neither effects nor squad slots (QuestReward_Feature_HeroLevelUp and the other front end
// tutorials' gates) has no tree equivalent and is left to its quest.
//
// The account gets them once, on its first load on 6.30 or later while it holds the tree's nodes, in the gift box Epic
// gave for the migration: GB_StwMakeGood (as profiles/questline.js), with its header's Migration.SkillTree text ("We have
// removed the Skill Tree and introduced the new Upgrades Page..."). coreMigrations notes it (skillTreeUnlocks, Core's,
// never sent), as profiles/respec.js does its tokens. The tree's nodes stay in the profile: earlier builds, where they
// are the tree, read them as before. 🟡 Epic's Upgrade Points award and Research Points refund aren't part of this.
const firstBuild = 4573096;
const migration = "skillTreeUnlocks";
export const skillTreeGiftBoxText = "Migration.SkillTree";

const tree = readGameData("skilltree630", { nodes: {}, effects: {}, squadSlotsSince630: {} });
const treeNodes = new Map(Object.entries(tree.nodes).map(([id, node]) => [id.toLowerCase(), node]));
const effectInfo = (name) => tree.effects[name];
const slotKey = ({ squadId, slot }) => `${squadId.toLowerCase()}#${slot}`;
// A slot of a squad 6.30 added, as the 6.22 slot it stands for: Squad_Defender_MissionDefender's three are the hero
// squad's mission defender slots, Squad_Combat_AdventureSquadOne 3 to 5 (tools/skilltree).
const since630 = new Map(Object.entries(tree.squadSlotsSince630 ?? {}).map(([squadId, slots]) => [squadId.toLowerCase(), slots]));
const treeSlotOf = ({ squadId, slot }) => since630.get(squadId.toLowerCase())?.[slot] ?? { squadId, slot };

// The nodes the requesting build's quests give (their rewards and hidden rewards), with what their first level applies.
const questRewardNodes = perBuild(() => {
  const ids = new Set();
  for (const questId of questIds()) {
    const quest = getQuest(questId);
    for (const { templateId } of [...(quest.rewards ?? []), ...(quest.hiddenRewards ?? [])]) {
      const [type, name] = templateId.split(":");
      if (type.toLowerCase() === "homebasenode" && getNode(name)) ids.add(getNode(name).id);
    }
  }
  return [...ids].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)).map((id) => {
    const [level] = nodeLevels(getNode(id));
    return { id, templateId: nodeTemplateId(id), effects: level?.effects ?? [], squadSlots: level?.squadSlots ?? [] };
  });
});

// The tree's nodes the account holds: HomebaseNode items the requesting build has no node for and 6.22's tree has.
export function treeNodesOf(profile) {
  return Object.values(profile.items).flatMap((item) => {
    const [type, name = ""] = item.templateId.split(":");
    if (type.toLowerCase() !== "homebasenode" || getNode(name)) return [];
    const node = treeNodes.get(name.toLowerCase());
    return node ? [node] : [];
  });
}

export const skillTreeUnlocksNeedSetUp = (profile) => Number(currentBuild()) >= firstBuild
  && !(profile.coreMigrations ?? []).includes(migration) && treeNodesOf(profile).length > 0;

// The quest reward nodes the account's tree nodes stand for, that it doesn't hold, as template ids.
export function skillTreeUnlocks(profile) {
  const owned = treeNodesOf(profile);
  const applied = new Map();
  const tags = new Set();
  const attributes = new Set();
  const slots = new Set();
  for (const node of owned) {
    for (const name of node.effects ?? []) {
      applied.set(name, (applied.get(name) ?? 0) + 1);
      for (const tag of effectInfo(name)?.tags ?? []) tags.add(tag);
      if (effectInfo(name)?.attribute) attributes.add(effectInfo(name).attribute);
    }
    for (const slot of node.squadSlots ?? []) slots.add(slotKey(slot));
  }
  const available = (name) => {
    const info = effectInfo(name);
    if (!info?.since630) return applied.get(name) ?? 0;
    return info.tags.some((tag) => tags.has(tag)) || (info.attribute && attributes.has(info.attribute)) ? 1 : 0;
  };
  const candidates = questRewardNodes();
  const used = new Map();
  const use = (effects) => { for (const name of effects) used.set(name, (used.get(name) ?? 0) + 1); };
  for (const node of candidates) if (heldQuantity(profile, node.templateId) > 0) use(node.effects);

  const unlocks = [];
  for (const node of candidates) {
    if (heldQuantity(profile, node.templateId) > 0 || (!node.effects.length && !node.squadSlots.length)) continue;
    if (!node.squadSlots.every((slot) => slots.has(slotKey(treeSlotOf(slot))))) continue;
    const wanted = new Map();
    for (const name of node.effects) wanted.set(name, (wanted.get(name) ?? 0) + 1);
    if (![...wanted].every(([name, count]) => available(name) - (used.get(name) ?? 0) >= count)) continue;
    use(node.effects);
    unlocks.push(node.templateId);
  }
  return unlocks;
}

export function setUpSkillTreeUnlocks(session) {
  const { profile } = session.profile("profile0");
  if (!skillTreeUnlocksNeedSetUp(profile)) return;
  const unlocks = skillTreeUnlocks(profile);
  const granted = unlocks.flatMap((templateId) => grant(session, templateId, 1));
  if (granted.length) giveGiftBox(session, questLineGiftBox, granted, { assetString: skillTreeGiftBoxText });
  profile.coreMigrations = [...(profile.coreMigrations ?? []), migration];
  log("Profiles", `${session.accountId}: the skill tree's nodes give ${granted.length} of 6.30's unlocks (${unlocks.join(", ") || "none"})`);
}
