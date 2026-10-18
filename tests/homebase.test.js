import { test } from "node:test";
import assert from "node:assert/strict";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`;

test("SetHomebaseName stores the town name in the homebase stat", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    await post(backend.port, command(accountId, "QueryProfile"), token, {});
    const named = await post(backend.port, command(accountId, "SetHomebaseName", 1), token, { homebaseName: "Core Base" });
    const [change] = named.body.profileChanges;
    assert.equal(change.changeType, "statModified");
    assert.equal(change.name, "homebase");
    assert.equal(change.value.townName, "Core Base");
    assert.equal(change.value.flagColor, 0);

    const same = await post(backend.port, command(accountId, "SetHomebaseName", 2), token, { homebaseName: "Core Base" });
    assert.deepEqual(same.body.profileChanges, []);
  } finally {
    backend.close();
  }
});

test("SetItemFavoriteStatus sets the int favorite attribute", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    await post(backend.port, command(accountId, "SkipTutorial"), token, {});
    const query = await post(backend.port, command(accountId, "QueryProfile"), token, {});
    const [heroId] = Object.entries(query.body.profileChanges[0].profile.items).find(([, item]) => item.templateId.startsWith("Hero:"));

    const on = await post(backend.port, command(accountId, "SetItemFavoriteStatus", 2), token, { targetItemId: heroId, bFavorite: true });
    assert.deepEqual(on.body.profileChanges, [{ changeType: "itemAttrChanged", itemId: heroId, attributeName: "favorite", attributeValue: 1 }]);
    const off = await post(backend.port, command(accountId, "SetItemFavoriteStatus", 3), token, { targetItemId: heroId, bFavorite: false });
    assert.equal(off.body.profileChanges[0].attributeValue, 0);
  } finally {
    backend.close();
  }
});
