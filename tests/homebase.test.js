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

test("a new homebase has a banner, so the client counts it as set up, and SetHomebaseBanner changes it", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const query = await post(backend.port, command(accountId, "QueryProfile"), token, {});
    const { homebase } = query.body.profileChanges[0].profile.stats.attributes;
    assert.deepEqual([homebase.bannerIconId, homebase.bannerColorId], ["StandardBanner1", "DefaultColor1"]);

    const changed = await post(backend.port, command(accountId, "SetHomebaseBanner", 1), token,
      { homebaseBannerIconId: "StandardBanner3", homebaseBannerColorId: "DefaultColor8" });
    const [change] = changed.body.profileChanges;
    assert.deepEqual([change.name, change.value.bannerIconId, change.value.bannerColorId], ["homebase", "StandardBanner3", "DefaultColor8"]);

    const empty = await post(backend.port, command(accountId, "SetHomebaseBanner", 2), token, { homebaseBannerIconId: "", homebaseBannerColorId: "" });
    assert.deepEqual(empty.body.profileChanges, []);
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

test("SetHomebaseMeta, SetGameplayStats and SetMtxPlatform store what the client sends", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const stats = async () => (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0].profile.stats.attributes;
    await post(backend.port, command(accountId, "SetHomebaseMeta"), token, { townName: "Flag Town", flagPattern: 3, flagColor: 0.5 });
    const { homebase } = await stats();
    assert.deepEqual([homebase.townName, homebase.flagPattern, homebase.flagColor, homebase.bannerIconId], ["Flag Town", 3, 0.5, "StandardBanner1"]);

    await post(backend.port, command(accountId, "SetGameplayStats"), token, { gameplayStats: [{ statName: "zonescompleted", statValue: 2 }, { statName: "kills", statValue: 9 }] });
    await post(backend.port, command(accountId, "SetGameplayStats"), token, { gameplayStats: [{ statName: "kills", statValue: 12 }] });
    assert.deepEqual((await stats()).gameplay_stats, [{ statName: "zonescompleted", statValue: 2 }, { statName: "kills", statValue: 12 }]);

    await post(backend.port, command(accountId, "SetMtxPlatform"), token, { newPlatform: "PSN" });
    assert.equal((await stats()).current_mtx_platform, "PSN");
    assert.equal((await post(backend.port, command(accountId, "SetMtxPlatform"), token, { newPlatform: "Steam" })).status, 400);
  } finally {
    backend.close();
  }
});
