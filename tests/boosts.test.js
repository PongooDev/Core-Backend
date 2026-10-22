import { test } from "node:test";
import assert from "node:assert/strict";
import { restValue } from "../src/profiles/boosts.js";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

test("rest XP refills by the minute once the delay has passed, up to its cap", () => {
  const quota = { current_value: 1000, last_mod_time: "2026-10-19T00:00:00.000Z", units_per_minute_recharge: 10, max_quota: 5000, recharge_delay_minutes: 360 };
  assert.equal(restValue(quota, new Date("2026-10-19T05:59:00Z")), 1000);
  assert.equal(restValue(quota, new Date("2026-10-19T06:00:00Z")), 1000 + 10 * 360);
  assert.equal(restValue(quota, new Date("2026-10-20T00:00:00Z")), 5000);
});

test("XP boosts fill Token:xpboost, gifts go to someone else with a notification, and matches spend them", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "BoostPlayer");
    const friend = await userLogin(backend.port, "BoostFriend");
    const give = (accountId, templateId, quantity) => post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId, quantity });
    const command = (who, name, body) => post(backend.port, `/fortnite/api/game/v2/profile/${who.accountId}/client/${name}?profileId=profile0&rvn=-1`, who.token, body);
    const items = async (who) => Object.entries((await command(who, "QueryProfile", {})).body.profileChanges[0].profile.items);
    const itemOf = async (who, templateId) => (await items(who)).find(([, item]) => item.templateId === templateId);

    await give(player.accountId, "ConsumableAccountItem:smallxpboost", 2);
    await give(player.accountId, "ConsumableAccountItem:smallxpboost_gift", 1);
    const [boostId] = await itemOf(player, "ConsumableAccountItem:smallxpboost");
    const [giftId] = await itemOf(player, "ConsumableAccountItem:smallxpboost_gift");

    assert.equal((await command(player, "ActivateConsumable", { targetItemId: boostId, targetAccountId: friend.accountId })).status, 400);
    assert.equal((await command(player, "ActivateConsumable", { targetItemId: giftId, targetAccountId: player.accountId })).status, 400);
    assert.equal((await command(player, "ActivateConsumable", { targetItemId: boostId, targetAccountId: player.accountId })).status, 200);
    assert.equal((await itemOf(player, "Token:xpboost"))[1].quantity, 784189);
    assert.equal((await itemOf(player, "ConsumableAccountItem:smallxpboost"))[1].quantity, 1);

    assert.equal((await command(player, "ActivateConsumable", { targetItemId: giftId, targetAccountId: friend.accountId })).status, 200);
    assert.equal(await itemOf(player, "ConsumableAccountItem:smallxpboost_gift"), undefined);
    const friendView = await command(friend, "QueryProfile", {});
    assert.deepEqual(friendView.body.notifications, [{ type: "receivedGiftedBoostXp", primary: false, amountBoostXpGifted: 784189, gifterAccountId: player.accountId }]);
    assert.equal(Object.values(friendView.body.profileChanges[0].profile.items).find((item) => item.templateId === "Token:xpboost").quantity, 784189);
    assert.deepEqual((await command(friend, "QueryProfile", {})).body.notifications ?? [], [], "delivered once");

    // 1,000,000 score = 612,901 base XP: 30% of it (183,870) comes out of the boost.
    const earned = await post(backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/dedicated_server/EarnScore?profileId=profile0&rvn=-1`, dedicated,
      { playersAndScores: [{ accountId: player.accountId, totalScore: 1000000, bCriticalMatchBonus: true }] });
    const [notification] = earned.body.notifications.filter((entry) => entry.type === "earnScore");
    assert.deepEqual([notification.baseXPEarned, notification.bonusXPEarned, notification.boostXPEarned, notification.boostXPMissed],
      [612901, 122580, 183870, 0]);
    assert.equal((await itemOf(player, "Token:xpboost"))[1].quantity, 784189 - 183870);
  } finally {
    backend.close();
  }
});
