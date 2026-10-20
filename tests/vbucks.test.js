import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`;

// The client's balance (sub_68A110) only counts Currency:Mtx* items whose platform attribute is exactly "Epic".
const vbucks = (profile) => Object.values(profile.items)
  .filter((item) => /^currency:mtx/i.test(item.templateId) && item.attributes.platform === "Epic")
  .reduce((total, item) => total + item.quantity, 0);

test("V-Bucks set in the admin panel reach the game at its next profile command", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "VbucksTest");
    const before = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body;

    assert.equal((await post(backend.port, `/admin/api/accounts/${accountId}/currency`, undefined, { key: "vbucks", quantity: 2500 })).status, 200);
    assert.equal((await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: "Currency:mtxgiveaway", quantity: 500 })).status, 200);

    // The game's next command still carries the revision it had: it gets the whole profile back.
    const after = (await post(backend.port, command(accountId, "QueryProfile", before.profileRevision), token, {})).body;
    assert.ok(after.profileRevision > before.profileRevision);
    const [change] = after.profileChanges;
    assert.equal(change.changeType, "fullProfileUpdate");
    assert.equal(vbucks(change.profile), 3000);
  } finally {
    backend.close();
  }
});

test("V-Bucks saved without a platform get Epic when the profile loads", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "OldVbucks");
    const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      profileId: "profile0", accountId, rvn: 4, wipeNumber: 1, version: "core", commandRevision: 3, stats: { attributes: { level: 2 } },
      items: { old: { templateId: "Currency:mtxgiveaway", attributes: { level: 1, item_seen: 0 }, quantity: 100 } }
    }));
    const { profile } = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0];
    assert.equal(profile.items.old.attributes.platform, "Epic");
    assert.equal(vbucks(profile), 100);
  } finally {
    backend.close();
  }
});
