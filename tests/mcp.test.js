import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { trackChanges } from "../src/profiles/changes.js";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, profileId, rvn = -1) =>
  `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=${rvn}`;

test("QueryProfile returns an FProfileUpdate with a full profile the client can parse", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const response = await post(backend.port, command(accountId, "QueryProfile", "profile0"), token, {});

    assert.equal(response.status, 200);
    const update = response.body;
    assert.equal(update.profileId, "profile0");
    assert.equal(update.profileRevision, 1);
    assert.equal(update.profileChangesBaseRevision, 1);
    assert.equal(update.profileCommandRevision, 0);
    assert.ok(Date.parse(update.serverTime));

    const [change] = update.profileChanges;
    assert.equal(change.changeType, "fullProfileUpdate");
    assert.equal(typeof change.profile.version, "string");
    assert.equal(typeof change.profile.wipeNumber, "number");
    assert.equal(change.profile.stats.attributes.level, 1);
    assert.deepEqual(change.profile.items, {});

    assert.ok(fs.existsSync(path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json")));

    const current = await post(backend.port, command(accountId, "QueryProfile", "profile0", 1), token, {});
    assert.deepEqual(current.body.profileChanges, []);
  } finally {
    backend.close();
  }
});

test("known profile ids are accepted and unknown ones refused", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    for (const profileId of ["collection_book_people0", "collection_book_schematics0", "theater0", "outpost0"]) {
      assert.equal((await post(backend.port, command(accountId, "QueryProfile", profileId), token, {})).status, 200);
    }
    assert.equal((await post(backend.port, command(accountId, "QueryProfile", "common_core"), token, {})).status, 400);
    assert.ok(backend.unknownLog("3532353").some((entry) => entry.kind === "profile" && entry.query.profileId === "common_core"));
  } finally {
    backend.close();
  }
});

test("unknown commands are logged and other accounts' profiles are refused", async () => {
  const backend = await startBackend();
  try {
    const me = await userLogin(backend.port, "CoreTest");
    const other = await userLogin(backend.port, "Other");

    const unknown = await post(backend.port, command(me.accountId, "SomethingNew", "profile0"), me.token, { a: 1 });
    assert.equal(unknown.status, 400);
    const logged = backend.unknownLog("3532353").find((entry) => entry.kind === "mcp");
    assert.match(logged.url, /SomethingNew/);
    assert.deepEqual(logged.body, { a: 1 });

    assert.equal((await post(backend.port, command(other.accountId, "QueryProfile", "profile0"), me.token, {})).status, 403);
  } finally {
    backend.close();
  }
});

test("the change tracker records the delta shapes the client applies", () => {
  const profile = { stats: { attributes: {} }, items: {} };
  const tracker = trackChanges(profile);
  tracker.addItem("a", { templateId: "Currency:Test", attributes: {}, quantity: 1 });
  tracker.setQuantity("a", 5);
  tracker.setItemAttribute("a", "level", 2);
  tracker.setStat("level", 3);
  tracker.removeItem("a");

  assert.deepEqual(tracker.changes.map((change) => change.changeType),
    ["itemAdded", "itemQuantityChanged", "itemAttrChanged", "statModified", "itemRemoved"]);
  assert.deepEqual(tracker.changes[2], { changeType: "itemAttrChanged", itemId: "a", attributeName: "level", attributeValue: 2 });
  assert.deepEqual(tracker.changes[3], { changeType: "statModified", name: "level", value: 3 });
  assert.deepEqual(profile, { stats: { attributes: { level: 3 } }, items: {} });
});
