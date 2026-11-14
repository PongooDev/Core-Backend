import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { buildGameData } from "../src/gamedata/read.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { settleLevel } from "../src/profiles/xp.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// 6.30's (CL-4573096) Upgrades and Research pages: PurchaseOrUpgradeHomebaseNode {nodeId}, PurchaseResearchStatUpgrade
// {statId}, RespecUpgrades and RespecResearch, on campaign. The rules are the client's own predictions of the first two
// (PurchaseOrUpgradeHomebaseNode_Mocked 0x11CF7C0, PurchaseResearchStatUpgrade_Mocked 0x11CFE50) and the respec dialogs'
// texts (a token each, every point back).
const v630 = "4573096";
const v622 = "4543176";
const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const agent630 = agentOf(v630, "6.30");
const upgradePoints = "Token:homebasepoints";
const researchPoints = "Token:collectionresource_nodegatetoken01";

function client(port, token, accountId, agent = agent630) {
  const mcp = (name, body, rvn) => {
    const text = JSON.stringify(body);
    return send({ host: "127.0.0.1", port, method: "POST",
      path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=campaign&rvn=${rvn}`,
      headers: { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
  };
  // The admin panel's grants move the revision, so each command is sent at the current one and answers with its changes.
  const call = async (name, body = {}) => mcp(name, body, (await mcp("QueryProfile", {}, -1)).body.profileRevision);
  const profile = async () => (await mcp("QueryProfile", {}, -1)).body.profileChanges[0].profile;
  const held = async (templateId) => Object.values((await profile()).items)
    .filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase()).reduce((sum, item) => sum + item.quantity, 0);
  const admin = (route, body) => post(port, `/admin/api/accounts/${accountId}/${route}`, undefined, body);
  return { call, profile, held, admin, give: (templateId, quantity) => admin("grant", { templateId, quantity }) };
}

async function signIn(backend, name, agent = agent630) {
  const { token, accountId } = await userLogin(backend.port, name);
  const account = client(backend.port, token, accountId, agent);
  await account.profile();
  return account;
}

test("6.30's Upgrades page: buy and upgrade a node by its level's cost and MinCommanderLevel, refused past them, respec gives every point back", async () => {
  const backend = await startBackend();
  try {
    const account = await signIn(backend, "Upgrades630");
    const { call, held, admin, give } = account;
    assert.equal((await admin("level", { level: 40 })).status, 200);
    await give(upgradePoints, 20);

    // Adrenaline Rush: level 1 at commander level 1 for 1 point, level 2 at 40 for 2, level 3 at 90 for 2.
    const bought = await call("PurchaseOrUpgradeHomebaseNode", { nodeId: "HomebaseNode:SkillTree_AdrenalineRush" });
    assert.equal(bought.status, 200);
    assert.ok(bought.body.profileChanges.some((change) => change.changeType === "itemAdded" && change.item.templateId === "HomebaseNode:skilltree_adrenalinerush" && change.item.quantity === 1));
    assert.equal(await held(upgradePoints), 19);
    const upgraded = await call("PurchaseOrUpgradeHomebaseNode", { nodeId: "HomebaseNode:SkillTree_AdrenalineRush" });
    assert.equal(upgraded.status, 200);
    assert.ok(upgraded.body.profileChanges.some((change) => change.changeType === "itemQuantityChanged" && change.quantity === 2), "the level is the item's quantity");
    assert.equal(await held("HomebaseNode:skilltree_adrenalinerush"), 2);
    assert.equal(await held(upgradePoints), 17);

    const early = await call("PurchaseOrUpgradeHomebaseNode", { nodeId: "HomebaseNode:SkillTree_AdrenalineRush" });
    assert.equal(early.status, 400);
    assert.match(early.body.errorMessage, /MinCommanderLevel needed is 90 and CurrentCommanderLevel is 40/);
    assert.equal(await held("HomebaseNode:skilltree_adrenalinerush"), 2);
    assert.equal(await held(upgradePoints), 17, "a refused purchase takes nothing");

    // The bare row name earlier builds sent is taken too; Banner's first level needs commander level 40.
    assert.equal((await call("PurchaseOrUpgradeHomebaseNode", { nodeId: "SkillTree_Banner" })).status, 200);
    assert.equal(await held(upgradePoints), 16);
    // Proximity Mine's first level needs 70.
    assert.equal((await call("PurchaseOrUpgradeHomebaseNode", { nodeId: "HomebaseNode:SkillTree_ProximityMine" })).status, 400);
    // Hidden nodes (quest and level-up rewards) and unknown ones aren't sold.
    assert.equal((await call("PurchaseOrUpgradeHomebaseNode", { nodeId: "HomebaseNode:QuestReward_Pickaxe" })).status, 400);
    assert.equal((await call("PurchaseOrUpgradeHomebaseNode", { nodeId: "HomebaseNode:SkillTree_Nothing" })).status, 400);

    // A node at its last level: Air Strike has 6.
    await give("HomebaseNode:skilltree_airstrike", 6);
    assert.equal(await held("HomebaseNode:skilltree_airstrike"), 6);
    await give("HomebaseNode:skilltree_airstrike", 1);
    assert.equal(await held("HomebaseNode:skilltree_airstrike"), 6, "a grant stops at the last level");
    const maxed = await call("PurchaseOrUpgradeHomebaseNode", { nodeId: "HomebaseNode:SkillTree_Airstrike" });
    assert.equal(maxed.status, 400);
    assert.match(maxed.body.errorMessage, /MaxLevel is 6/);

    // Respec, with the token the account's first 6.30 login gave.
    await give("HomebaseNode:questreward_pickaxe", 1);
    const respec = await call("RespecUpgrades");
    assert.equal(respec.status, 200);
    // 1 + 2 (Adrenaline Rush 1-2) + 1 (Banner 1) + 1 + 2 + 2 + 3 + 3 + 4 (Air Strike 1-6) back on the 16 left.
    assert.equal(await held(upgradePoints), 16 + 3 + 1 + 15);
    for (const node of ["skilltree_adrenalinerush", "skilltree_banner", "skilltree_airstrike"]) assert.equal(await held(`HomebaseNode:${node}`), 0, node);
    assert.equal(await held("HomebaseNode:questreward_pickaxe"), 1, "a Hidden node stays");
    assert.equal(await held("Token:upgrades_respec"), 0, "the token is used up");
    assert.equal((await call("RespecUpgrades")).status, 400, "no token, no respec");
  } finally {
    backend.close();
  }
});

test("6.30's Upgrades page refuses a node the points don't pay for", async () => {
  const backend = await startBackend();
  try {
    const { call, held } = await signIn(backend, "Broke630");
    const reply = await call("PurchaseOrUpgradeHomebaseNode", { nodeId: "HomebaseNode:SkillTree_AdrenalineRush" });
    assert.equal(reply.status, 400);
    assert.match(reply.body.errorMessage, /Need 1 Token:homebasepoints to pay cost/);
    assert.equal(await held("HomebaseNode:skilltree_adrenalinerush"), 0);
  } finally {
    backend.close();
  }
});

test("6.30's Research page: a level costs its _cost in Research Points and adds its _personal and _team, refused past the points or with an unknown stat, respec gives them back", async () => {
  const backend = await startBackend();
  try {
    const { call, held, profile, give } = await signIn(backend, "Research630");
    await give(researchPoints, 1000);

    // Fortitude levels 1 to 3: 300 points each, +1 Fortitude each, no Party Fortitude.
    for (let level = 1; level <= 3; level++) {
      const reply = await call("PurchaseResearchStatUpgrade", { statId: "fortitude" });
      assert.equal(reply.status, 200, `level ${level}`);
      assert.ok(reply.body.profileChanges.some((change) => change.changeType === "statModified" && change.name === "research_levels" && change.value.fortitude === level));
    }
    assert.equal(await held(researchPoints), 100);
    assert.equal(await held("Stat:fortitude"), 3);
    assert.equal(await held("Stat:fortitude_team"), 0);
    const short = await call("PurchaseResearchStatUpgrade", { statId: "fortitude" });
    assert.equal(short.status, 400);
    assert.match(short.body.errorMessage, /Need 300 Token:collectionresource_nodegatetoken01 to pay cost/);
    assert.equal((await call("PurchaseResearchStatUpgrade", { statId: "agility" })).status, 400, "no such stat");
    assert.equal(await held(researchPoints), 100);

    // Tech to level 10: 10 x 300 points, +11 Tech (nine 1s and level 10's 2) and level 10's +6 Party Tech.
    await give(researchPoints, 2900);
    for (let level = 1; level <= 10; level++) assert.equal((await call("PurchaseResearchStatUpgrade", { statId: "technology" })).status, 200);
    assert.equal(await held(researchPoints), 0);
    assert.equal(await held("Stat:technology"), 11);
    assert.equal(await held("Stat:technology_team"), 6);
    assert.deepEqual((await profile()).stats.attributes.research_levels, { fortitude: 3, technology: 10 });

    // Respec: a token, every point back, research's stats taken back (the account levels' stay), every level at 0.
    await give("Token:research_respec", 1);
    await give("Stat:fortitude", 3);
    const respec = await call("RespecResearch");
    assert.equal(respec.status, 200);
    assert.equal(await held(researchPoints), 900 + 3000);
    assert.equal(await held("Stat:fortitude"), 3, "the 3 not from research stay");
    assert.equal(await held("Stat:technology"), 0);
    assert.equal(await held("Stat:technology_team"), 0);
    assert.deepEqual((await profile()).stats.attributes.research_levels, {});
    assert.equal(await held("Token:research_respec"), 1);
    assert.equal((await call("PurchaseResearchStatUpgrade", { statId: "technology" })).status, 200, "level 1 again");
    assert.deepEqual((await profile()).stats.attributes.research_levels, { technology: 1 });
  } finally {
    backend.close();
  }
});

test("6.30's account levels give CommanderLevel_RPCollection a level each time, up to its nine", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-630hb-"));
  try {
    inBuild(v630, () => {
      const session = openSession(createProfileStore(dir), "levels630");
      const levels = buildGameData(v630, "accountlevels", []);
      const rewarding = levels.filter(({ rewards }) => rewards.some(({ templateId }) => templateId === "HomebaseNode:commanderlevel_rpcollection")).length;
      assert.equal(rewarding, 9);
      session.profile("profile0").setStat("xp", levels.reduce((sum, { xp }) => sum + xp, 0));
      settleLevel(session);
      const nodes = Object.values(session.profile("profile0").profile.items).filter(({ templateId }) => templateId === "HomebaseNode:commanderlevel_rpcollection");
      assert.deepEqual(nodes.map(({ quantity }) => quantity), [9], "one item, its quantity the level");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("6.30's first login gives one Upgrades and one Research respec token, once per account; 6.22's gives none", async () => {
  const backend = await startBackend();
  try {
    const name = "Tokens630";
    const first = await signIn(backend, name);
    assert.equal(await first.held("Token:upgrades_respec"), 1);
    assert.equal(await first.held("Token:research_respec"), 1);
    assert.equal((await first.call("RespecUpgrades")).status, 200, "the token works");
    const next = await signIn(backend, name);
    assert.equal(await next.held("Token:upgrades_respec"), 0, "not given again on the next login");
    assert.equal(await next.held("Token:research_respec"), 1);

    const older = await signIn(backend, "Tokens622", agentOf(v622, "6.22"));
    assert.equal(await older.held("Token:upgrades_respec"), 0);
    assert.equal(await older.held("Token:research_respec"), 0);
    const later = await signIn(backend, "Tokens622");
    assert.equal(await later.held("Token:upgrades_respec"), 1, "6.22 didn't note it, so 6.30 gives it");
    assert.equal(await later.held("Token:research_respec"), 1);
  } finally {
    backend.close();
  }
});
