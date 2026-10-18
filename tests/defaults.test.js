import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, profileId = "profile0", rvn = -1) =>
  `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=${rvn}`;

const isoDate = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

test("a new profile0 has every stat the Cert client reads, in its struct shape", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const response = await post(backend.port, command(accountId, "QueryProfile"), token, {});
    const stats = response.body.profileChanges[0].profile.stats.attributes;

    assert.deepEqual(Object.keys(stats).sort(), [
      "client_settings", "collection_book", "current_mtx_platform", "daily_purchases", "daily_rewards",
      "default_hero_squad_id", "gameplay_stats", "homebase", "in_app_purchases", "level", "mission_alert_redemption_record",
      "mode_loadouts", "player_loadout", "quest_manager", "weekly_purchases", "xp"
    ]);
    assert.equal(stats.level, 1);
    assert.equal(stats.xp, 0);
    assert.equal(stats.current_mtx_platform, "Epic");
    assert.equal(stats.default_hero_squad_id, "Squad_Combat_AdventureSquadOne");
    assert.deepEqual(Object.keys(stats.homebase).sort(), ["bannerColorId", "bannerIconId", "flagColor", "flagPattern", "playerXP", "townName"]);
    assert.ok(Array.isArray(stats.gameplay_stats) && Array.isArray(stats.mode_loadouts));
    assert.ok(isoDate(stats.quest_manager.dailyLoginInterval));
    assert.ok(isoDate(stats.daily_purchases.lastInterval) && isoDate(stats.weekly_purchases.lastInterval));
    assert.ok(isoDate(stats.daily_rewards.lastClaimDate));
    assert.deepEqual(stats.collection_book, { pages: [], maxBookXpLevelAchieved: 0 });

    const book = await post(backend.port, command(accountId, "QueryProfile", "collection_book_people0"), token, {});
    assert.deepEqual(book.body.profileChanges[0].profile.stats.attributes, {});
  } finally {
    backend.close();
  }
});

test("missing stats are added to existing profiles and the revision moves on", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      profileId: "profile0", accountId, rvn: 5, wipeNumber: 1, version: "core", commandRevision: 3,
      stats: { attributes: { level: 7 } }, items: {}
    }));

    const response = await post(backend.port, command(accountId, "QueryProfile"), token, {});
    assert.equal(response.body.profileRevision, 6);
    const stats = response.body.profileChanges[0].profile.stats.attributes;
    assert.equal(stats.level, 7);
    assert.equal(stats.xp, 0);
  } finally {
    backend.close();
  }
});

test("MarkNewQuestNotificationSent flags only the given quest items", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const login = await post(backend.port, command(accountId, "ClientQuestLogin", "profile0", -1), token, {});
    const questId = Object.keys(login.body.profileChanges[0].profile.items)[0];

    const marked = await post(backend.port, command(accountId, "MarkNewQuestNotificationSent", "profile0", login.body.profileRevision), token,
      { itemIds: [questId, "not-an-item"] });
    assert.deepEqual(marked.body.profileChanges, [
      { changeType: "itemAttrChanged", itemId: questId, attributeName: "sent_new_notification", attributeValue: true }
    ]);

    const again = await post(backend.port, command(accountId, "MarkNewQuestNotificationSent", "profile0", marked.body.profileRevision), token,
      { itemIds: [questId] });
    assert.deepEqual(again.body.profileChanges, []);
  } finally {
    backend.close();
  }
});
