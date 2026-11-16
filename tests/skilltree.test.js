import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { readGameData } from "../src/gamedata/read.js";
import { grant } from "../src/profiles/progress.js";
import { skillTreeGiftBoxText, skillTreeUnlocks, skillTreeUnlocksNeedSetUp, treeNodesOf } from "../src/profiles/skilltree.js";
import { questLineGiftBox } from "../src/profiles/questline.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { hasUnlocked } from "../src/profiles/unlocks.js";

// CoreV2 #469, Core-Backend #368: 6.30 moved the skill tree's build levels, squad slots and feature unlocks into quest
// rewards; an account that bought the tree's nodes before 6.30 keeps what they gave.
const v622 = "4543176";
const v630 = "4573096";
const v631 = "4573279";
const buildLevelNodes = ["T1_Main_38EAD7850", "T1_Main_8B125D0F0"];
const tree = readGameData("skilltree630", {});

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-skilltree-"));
  try {
    return run(createProfileStore(dataDir));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// A profile holding these HomebaseNode items, for the mapping alone.
const holding = (...nodes) => ({
  items: Object.fromEntries(nodes.map((node, index) => [`node${index}`, { templateId: `HomebaseNode:${node.toLowerCase()}`, quantity: 1, attributes: {} }]))
});
const unlocksOf = (build, ...nodes) => inBuild(build, () => skillTreeUnlocks(holding(...nodes))).map((templateId) => templateId.slice("HomebaseNode:".length));
const held = (profile, templateId) => Object.values(profile.items).some((item) => item.templateId.toLowerCase() === templateId.toLowerCase());

test("6.22's tree nodes behind the build level apply 6.30's quest rewards' effect, GE_MaxBuildingUpgradeLevel_T1", () => {
  for (const node of buildLevelNodes) assert.deepEqual(tree.nodes[node].effects, ["GE_MaxBuildingUpgradeLevel_T1"], node);
  assert.deepEqual(tree.effects.GE_MaxBuildingUpgradeLevel_T1, { attribute: "MaxBuildLevel", tags: [] });
  // 6.30 has no tree node: the account's are only 6.22's.
  inBuild(v631, () => assert.equal(treeNodesOf(holding(...buildLevelNodes)).length, 2));
  inBuild(v622, () => assert.equal(treeNodesOf(holding(...buildLevelNodes)).length, 0));
});

test("CoreV2 #469: on 6.31 the two build-level nodes give both of 6.30's build levels, once, in the migration gift box", () => withStore((store) => {
  inBuild(v622, () => {
    const session = openSession(store, "builder");
    for (const node of buildLevelNodes) grant(session, `HomebaseNode:${node}`, 1);
    const { profile } = session.profile("profile0");
    assert.ok(buildLevelNodes.every((node) => held(profile, `HomebaseNode:${node}`)));
    assert.equal(skillTreeUnlocksNeedSetUp(profile), false, "6.22 is the tree's own build");
    session.commit();
  });
  inBuild(v631, () => {
    const session = openSession(store, "builder");
    const { profile } = session.profile("profile0");
    assert.ok(held(profile, "HomebaseNode:questreward_buildingupgradelevel"));
    assert.ok(held(profile, "HomebaseNode:questreward_buildingupgradelevel2"));
    const boxes = Object.values(profile.items).filter((item) => item.templateId === questLineGiftBox);
    assert.equal(boxes.length, 1);
    assert.deepEqual(boxes[0].attributes.params, { assetString: skillTreeGiftBoxText });
    assert.deepEqual(boxes[0].attributes.lootList.map(({ itemType }) => itemType.toLowerCase()).sort(),
      ["homebasenode:questreward_buildingupgradelevel", "homebasenode:questreward_buildingupgradelevel2"]);
    assert.ok(profile.coreMigrations.includes("skillTreeUnlocks"));
    // The tree's nodes stay for the builds that have the tree.
    assert.ok(buildLevelNodes.every((node) => held(profile, `HomebaseNode:${node}`)));
    session.commit();
  });
  inBuild(v630, () => {
    const session = openSession(store, "builder");
    const { profile } = session.profile("profile0");
    assert.equal(Object.values(profile.items).filter((item) => item.templateId === questLineGiftBox).length, 1, "once per account");
    assert.equal(skillTreeUnlocksNeedSetUp(profile), false);
  });
}));

test("each build level the tree gave is one of 6.30's, less the ones the account already has from Build Off", () => {
  assert.deepEqual(unlocksOf(v631, buildLevelNodes[0]), ["questreward_buildingupgradelevel"]);
  assert.deepEqual(unlocksOf(v631, ...buildLevelNodes), ["questreward_buildingupgradelevel", "questreward_buildingupgradelevel2"]);
  const fromBuildOff = holding(...buildLevelNodes, "QuestReward_BuildingUpgradeLevel");
  assert.deepEqual(inBuild(v631, () => skillTreeUnlocks(fromBuildOff)), ["HomebaseNode:questreward_buildingupgradelevel2"]);
  const both = holding(buildLevelNodes[0], "QuestReward_BuildingUpgradeLevel");
  assert.deepEqual(inBuild(v631, () => skillTreeUnlocks(both)), []);
});

test("the tree's unlocks map to 6.30's quest rewards by effect, tag and squad slot", () => {
  // Transformation: 6.22's worker transform (GE_Transformation_People_Workers) is one of GE_Transformation_All's tags.
  assert.ok(unlocksOf(v631, "T1_Main_266068670").includes("questreward_transformation"));
  // Research: Unlock Research (T1_Main_FABC7C290) changed the research collector, as 6.30's research system does.
  assert.ok(unlocksOf(v631, "T1_Main_FABC7C290").includes("questreward_feature_researchsystem"));
  // Squad slots: QuestReward_Stonewood_Squad_SSD1's two slots need both of the nodes that unlocked them.
  const ssd1 = [{ squadId: "Squad_Attribute_Scavenging_ScoutingParty", slot: 1 }, { squadId: "Squad_Attribute_Scavenging_ScoutingParty", slot: 2 }];
  const unlocking = ssd1.map((wanted) => Object.keys(tree.nodes).find((id) => (tree.nodes[id].squadSlots ?? [])
    .some(({ squadId, slot }) => squadId === wanted.squadId && slot === wanted.slot)));
  assert.ok(unlocking.every(Boolean));
  assert.ok(unlocksOf(v631, ...new Set(unlocking)).includes("questreward_stonewood_squad_ssd1"));
  if (unlocking[0] !== unlocking[1]) assert.ok(!unlocksOf(v631, unlocking[0]).includes("questreward_stonewood_squad_ssd1"));
  // Mission defenders: 6.22 slotted them in the hero squad's Defender slots, 6.30 in Squad_Defender_MissionDefender.
  assert.ok(unlocksOf(v631, "T1_Main_20D6FB134").includes("questreward_mission_defender"));
  // A node with no tree equivalent (the front end tutorials' gates) never comes from the tree.
  const everything = unlocksOf(v631, ...Object.keys(tree.nodes));
  assert.ok(!everything.some((node) => node.startsWith("questreward_feature_") && node !== "questreward_feature_researchsystem"));
  for (const node of ["questreward_buildingupgradelevel", "questreward_buildingupgradelevel2", "questreward_transformation",
    "questreward_recyclecollection", "questreward_evolution", "questreward_evolution4", "questreward_expedition_dirtbike",
    "questreward_expedition_helicopter4", "questreward_feature_researchsystem", "questreward_pickaxe", "questreward_secondaryattack",
    "questreward_buildingresourcecap3", "questreward_stonewood_squad_ssd1", "questreward_twinepeaks_squad_ssd6",
    "questreward_homebase_defender5", "questreward_mission_defender3", "questreward_herosupport_slot"]) {
    assert.ok(everything.includes(node), node);
  }
  assert.deepEqual(unlocksOf(v631), []);
});

test("a migrated account can transform on 6.31; 6.22 and an account without tree nodes are left as they are", () => withStore((store) => {
  inBuild(v622, () => {
    const session = openSession(store, "transformer");
    grant(session, "HomebaseNode:T1_Main_266068670", 1);
    const { profile } = session.profile("profile0");
    assert.ok(hasUnlocked(profile, ["Unlocks.DirectedAcquisition.People.Worker"]));
    assert.ok(!(profile.coreMigrations ?? []).includes("skillTreeUnlocks"));
    session.commit();
  });
  inBuild(v631, () => {
    const { profile } = openSession(store, "transformer").profile("profile0");
    assert.ok(held(profile, "HomebaseNode:questreward_transformation"));
    assert.ok(hasUnlocked(profile, ["Unlocks.DirectedAcquisition.People.Worker"]));

    const fresh = openSession(store, "notree").profile("profile0").profile;
    assert.ok(!Object.values(fresh.items).some((item) => item.templateId === questLineGiftBox));
    assert.ok(!(fresh.coreMigrations ?? []).includes("skillTreeUnlocks"));
  });
}));
