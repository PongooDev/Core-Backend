import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readGameData } from "../src/gamedata/read.js";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
import { grant } from "../src/profiles/progress.js";
import { needsSetUp } from "../src/profiles/setup.js";
import { claimCollectedResources, collectorRates, gathered } from "../src/research/collector.js";
import { post, startBackend, userLogin } from "./helpers.js";

const collectorId = "CollectedResource:Token_collectionresource_nodegatetoken01";
const research = "Token:collectionresource_nodegatetoken01";
const unlockNode = "HomebaseNode:t1_main_fabc7c290"; // Unlock Research: Tier 1
const rate = Math.fround(0.015096618);
const now = new Date("2026-10-23T10:00:00Z");
const later = (seconds) => new Date(now.getTime() + seconds * 1000);

function memorySession() {
  const trackers = {};
  return {
    profile(profileId) {
      trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: defaultStats(profileId) }, items: {} });
      return trackers[profileId];
    }
  };
}

const collectorOf = (tracker) => Object.entries(tracker.profile.items).find(([, item]) => item.templateId === collectorId);
const held = (tracker, templateId) => Object.values(tracker.profile.items)
  .filter((item) => item.templateId === templateId).reduce((total, item) => total + item.quantity, 0);

test("research.json holds the collector and the nodes that raise its rate, capacity and wallet cap", () => {
  const { collectors, nodes, buffs } = readGameData("research", {});
  assert.deepEqual(collectors[collectorId], {
    payout: research,
    rateAttribute: "rate_per_second_collector_Token_collectionresource_nodegatetoken01",
    capacityAttribute: "max_capacity_collector_Token_collectionresource_nodegatetoken01",
    walletAttribute: "ResearchPointMaxBonus"
  });
  assert.deepEqual(nodes.T1_Main_FABC7C290, {
    ResearchPointMaxBonus: 1600,
    max_capacity_collector_Token_collectionresource_nodegatetoken01: 1065,
    rate_per_second_collector_Token_collectionresource_nodegatetoken01: 0.015096618
  });
  assert.deepEqual(Object.keys(nodes).sort(), ["T1_Main_FABC7C290", "T2_Main_E321E3463", "T3_Main_2E9E28772", "TRTrunk_2_0", "TRTrunk_3_0", "TRTrunk_4_0"]);
  assert.equal(buffs["Buff:vipstatus"].rate_per_second_collector_Token_collectionresource_nodegatetoken01, 2);
});

test("buying Unlock Research: Tier 1 adds an empty collector that fills at the nodes' rate up to the capacity", () => {
  const session = memorySession();
  const tracker = session.profile("profile0");
  assert.equal(collectorOf(tracker), undefined);
  grant(session, unlockNode, 1);
  const [, collector] = collectorOf(tracker);
  assert.equal(collector.attributes.stored_value, 0);
  assert.ok(Date.now() - Date.parse(collector.attributes.last_updated) < 5000);

  collector.attributes.last_updated = now.toISOString();
  assert.deepEqual(collectorRates(tracker.profile, collectorId), { rate, capacity: 1065, walletCap: 1600 });
  // The client's estimate: whole seconds times the rate, truncated, never over the capacity (+54 per hr).
  assert.equal(Math.trunc(gathered(tracker.profile, collector, later(3600))), 54);
  assert.equal(gathered(tracker.profile, collector, later(-60)), 0);
  assert.equal(gathered(tracker.profile, collector, later(30 * 24 * 3600)), 1065);
});

test("a node that raises the rate banks what was gathered at the old rate first", () => {
  const session = memorySession();
  const tracker = session.profile("profile0");
  grant(session, unlockNode, 1);
  const [itemId, collector] = collectorOf(tracker);
  collector.attributes.last_updated = new Date(Date.now() - 3600 * 1000).toISOString();
  grant(session, "HomebaseNode:t2_main_e321e3463", 1);
  assert.equal(Math.trunc(tracker.profile.items[itemId].attributes.stored_value), 54);
  assert.equal(collectorRates(tracker.profile, collectorId).rate, Math.fround(rate + rate));
  // A node with nothing to do with research leaves the collector alone.
  const changes = tracker.changes.length;
  grant(session, "HomebaseNode:t1_main_609c8a9a8", 1);
  assert.ok(!tracker.changes.slice(changes).some((change) => change.itemId === itemId));
});

test("claiming grants the whole points gathered, up to the wallet cap, and keeps the rest", () => {
  const session = memorySession();
  const tracker = session.profile("profile0");
  grant(session, unlockNode, 1);
  const [itemId, collector] = collectorOf(tracker);
  collector.attributes.last_updated = now.toISOString();

  const notifications = [];
  claimCollectedResources(session, [itemId], notifications, later(7200));
  assert.equal(held(tracker, research), 108);
  const [result] = notifications;
  assert.equal(result.type, "collectedResourceResult");
  assert.equal(result.primary, true);
  assert.equal(result.loot.tierGroupName, "");
  const tokenId = Object.keys(tracker.profile.items).find((id) => tracker.profile.items[id].templateId === research);
  assert.deepEqual(result.loot.items, [{ itemType: research, itemGuid: tokenId, itemProfile: "profile0", quantity: 108 }]);
  assert.equal(collector.attributes.last_updated, later(7200).toISOString());
  assert.ok(collector.attributes.stored_value > 0 && collector.attributes.stored_value < 1);

  // Near the wallet cap (1600) only the room left is granted; the collector keeps the rest.
  grant(session, research, 1400);
  const full = [];
  claimCollectedResources(session, [itemId], full, later(7200 + 30 * 24 * 3600));
  assert.equal(held(tracker, research), 1600);
  assert.equal(full[0].loot.items[0].quantity, 92);
  assert.equal(collector.attributes.stored_value, 1065 - 92);
  // With the wallet full nothing is granted and nothing is lost.
  const none = [];
  claimCollectedResources(session, [itemId], none, later(7200 + 31 * 24 * 3600));
  assert.deepEqual(none[0].loot.items, []);
  assert.equal(collector.attributes.stored_value, 1065);
});

test("a claim for something that isn't a collector is refused", () => {
  const session = memorySession();
  grant(session, research, 5);
  const tokenId = Object.keys(session.profile("profile0").profile.items)[0];
  assert.throws(() => claimCollectedResources(session, [tokenId], []), { errorCode: "errors.com.epicgames.fortnite.item_not_found" });
  assert.throws(() => claimCollectedResources(session, ["missing"], []), { errorCode: "errors.com.epicgames.fortnite.item_not_found" });
  const nothing = [];
  claimCollectedResources(session, [], nothing);
  assert.deepEqual(nothing[0].loot.items, []);
});

test("the VIP buff doubles the rate", () => {
  const session = memorySession();
  const tracker = session.profile("profile0");
  grant(session, unlockNode, 1);
  tracker.addItem("vip", { templateId: "Buff:vipstatus", attributes: {}, quantity: 1 });
  assert.equal(collectorRates(tracker.profile, collectorId).rate, Math.fround(rate * 2));
});

test("ClaimCollectedResources works through the client route, and older profiles that own the node get a collector", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "ResearchTest");
    const command = (name, body) => post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`, token, body);
    const items = async () => (await command("QueryProfile", {})).body.profileChanges[0].profile.items;
    assert.ok(!Object.values(await items()).some((item) => item.templateId === collectorId));

    // A profile saved before Core had collectors, owning the node already.
    const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.items.oldnode = { templateId: unlockNode, attributes: { level: 1 }, quantity: 1 };
    assert.equal(needsSetUp(saved), true);
    fs.writeFileSync(file, JSON.stringify(saved));
    const [collectorItemId] = Object.entries(await items()).find(([, item]) => item.templateId === collectorId);

    const claimed = await command("ClaimCollectedResources", { collectorsToClaim: [collectorItemId] });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.notifications[0].type, "collectedResourceResult");
    assert.deepEqual(claimed.body.notifications[0].loot.items, []);
    const refused = await command("ClaimCollectedResources", { collectorsToClaim: ["nope"] });
    assert.equal(refused.status, 400);
  } finally {
    backend.close();
  }
});
