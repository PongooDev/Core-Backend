import { test } from "node:test";
import assert from "node:assert/strict";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
import { transmogItem, transmogTier } from "../src/transmog/transmog.js";
import { post, startBackend, userLogin } from "./helpers.js";

function memorySession() {
  const trackers = {};
  return {
    profile(profileId) {
      trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: defaultStats(profileId) }, items: {} });
      return trackers[profileId];
    }
  };
}

const key = "ConversionControl:cck_hero_ninja_consumable";

test("the result's rarity is the highest tier whose cost the points reach", () => {
  const tiers = [-1, 64, 160, 400, 1000, -1, -1, -1, -1, -1].map((cost) => ({ cost, quantity: 1 }));
  assert.equal(transmogTier({ tiers }, 63), -1);
  assert.equal(transmogTier({ tiers }, 64), 1);
  assert.equal(transmogTier({ tiers }, 399), 2);
  assert.equal(transmogTier({ tiers }, 5000), 4);
});

test("a key turns sacrificed items into an item of its kind, spending its resource and itself", () => {
  const session = memorySession();
  const tracker = session.profile("profile0");
  tracker.addItem("key", { templateId: key, attributes: {}, quantity: 2 });
  tracker.addItem("reagents", { templateId: "AccountResource:reagent_people", attributes: {}, quantity: 5 });
  tracker.addItem("a", { templateId: "Hero:hid_commando_007_r_t01", attributes: { level: 1, squad_id: "" }, quantity: 1 });
  tracker.addItem("b", { templateId: "Hero:hid_ninja_007_r_t01", attributes: { level: 1, squad_id: "" }, quantity: 1 });
  tracker.addItem("worker", { templateId: "Worker:workerbasic_c_t01", attributes: { level: 1, squad_id: "" }, quantity: 1 });
  tracker.addItem("busy", { templateId: "Hero:hid_ninja_008_r_t01", attributes: { level: 1, squad_id: "Squad_Attribute_Medicine_EMTSquad" }, quantity: 1 });

  const notifications = [];
  assert.throws(() => transmogItem(session, key, ["worker"], notifications), /isn't enough/);
  assert.throws(() => transmogItem(session, key, ["busy"], notifications), /in a squad/);
  assert.throws(() => transmogItem(session, "ConversionControl:cck_hero_ninja_unlimited", ["a"], notifications), /don't have/);

  // Two rare heroes: 80 + 80 = 160 points, Sturdy (rare), 4 people reagents.
  transmogItem(session, key, ["a", "b"], notifications);
  const [result] = notifications;
  assert.equal(result.type, "transmogResult");
  assert.deepEqual(result.recycledItems.map((entry) => entry.itemGuid), ["a", "b"]);
  assert.equal(result.transmoggedItems.length, 1);
  assert.match(result.transmoggedItems[0].itemType, /^Hero:hid_ninja_.*_r_t01$/);
  const { items } = tracker.profile;
  assert.equal(items.a, undefined);
  assert.equal(items.b, undefined);
  assert.equal(items.reagents.quantity, 1);
  assert.equal(items.key.quantity, 1);
  assert.ok(items[result.transmoggedItems[0].itemGuid]);

  assert.throws(() => transmogItem(session, key, ["worker", "busy"], notifications), /squad/);
});

test("TransmogItem works through the client route", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "TransmogTest");
    const give = (templateId, quantity) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
    const command = (name, body) => post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`, token, body);
    await give(key, 1);
    await give("AccountResource:reagent_people", 2);
    await give("Hero:hid_commando_007_r_t01", 1);
    const items = Object.entries((await command("QueryProfile", {})).body.profileChanges[0].profile.items);
    const [heroId] = items.find(([, item]) => item.templateId === "Hero:hid_commando_007_r_t01");
    const transformed = await command("TransmogItem", { transmogKeyTemplateId: key, sacrificeItemIds: [heroId] });
    assert.equal(transformed.status, 200);
    assert.match(transformed.body.notifications[0].transmoggedItems[0].itemType, /^Hero:hid_ninja_.*_uc_t01$/);
  } finally {
    backend.close();
  }
});
