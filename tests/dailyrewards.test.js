import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { defaultSchedule, tokenSchedules } from "../src/gamedata/dailyrewards.js";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`;

function editProfile(backend, accountId, edit) {
  const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
  const profile = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(profile);
  fs.writeFileSync(file, JSON.stringify(profile));
}

const statChange = (body) => body.profileChanges.find((change) => change.changeType === "statModified" && change.name === "daily_rewards");

test("the reward schedules come from DefaultGameData in row order", () => {
  assert.equal(defaultSchedule.name, "Default");
  assert.equal(defaultSchedule.rewards.length, 336);
  assert.deepEqual(defaultSchedule.rewards[0], { major: false, quantity: 200, templateId: "AccountResource:heroxp" });
  assert.deepEqual(defaultSchedule.rewards[1], { major: true, quantity: 2, templateId: "AccountResource:voucher_basicpack" });
  assert.deepEqual(tokenSchedules.map((schedule) => [schedule.name, schedule.token, schedule.rewards.length]),
    [["FoundersPackDailyRewardToken", "DailyRewardScheduleToken:founderspackdailyrewardtoken", 126]]);
});

test("ClaimLoginReward grants today's reward once and reports it for the reward cards", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    await post(backend.port, command(accountId, "QueryProfile"), token, {});

    const claim = await post(backend.port, command(accountId, "ClaimLoginReward", 1), token, {});
    assert.equal(claim.status, 200);
    const added = claim.body.profileChanges.find((change) => change.changeType === "itemAdded");
    assert.deepEqual({ templateId: added.item.templateId, quantity: added.item.quantity }, { templateId: "AccountResource:heroxp", quantity: 200 });

    const stat = statChange(claim.body).value;
    assert.equal(stat.nextDefaultReward, 1);
    assert.equal(stat.totalDaysLoggedIn, 1);
    assert.equal(stat.lastClaimDate.slice(0, 10), new Date().toISOString().slice(0, 10));
    assert.deepEqual(stat.additionalSchedules, {});

    assert.deepEqual(claim.body.notifications, [{
      type: "daily_rewards",
      primary: true,
      daysLoggedIn: 1,
      items: [{ itemType: "AccountResource:heroxp", itemGuid: added.itemId, itemProfile: "profile0", quantity: 200 }]
    }]);

    const again = await post(backend.port, command(accountId, "ClaimLoginReward", 2), token, {});
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.profileChanges.map((change) => change.changeType), ["statModified"]);
    assert.deepEqual(statChange(again.body).value, stat);
    assert.deepEqual(again.body.notifications[0].items, []);
  } finally {
    backend.close();
  }
});

test("a new UTC day gives the next row, and a held schedule token adds its own reward and is used up", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    await post(backend.port, command(accountId, "ClaimLoginReward"), token, {});
    editProfile(backend, accountId, (profile) => {
      profile.stats.attributes.daily_rewards.lastClaimDate = new Date(Date.now() - 86400000).toISOString();
      profile.stats.attributes.daily_rewards.additionalSchedules = { FoundersPackDailyRewardToken: { rewardsClaimed: 4, claimedToday: true } };
      profile.items["founders-token"] = { templateId: "DailyRewardScheduleToken:founderspackdailyrewardtoken", attributes: {}, quantity: 2 };
    });

    const claim = await post(backend.port, command(accountId, "ClaimLoginReward"), token, {});
    const { items } = claim.body.notifications[0];
    assert.deepEqual(items.map((item) => [item.itemType, item.quantity]), [
      [defaultSchedule.rewards[1].templateId, defaultSchedule.rewards[1].quantity],
      [tokenSchedules[0].rewards[4].templateId, 1]
    ]);

    const profile = claim.body.profileChanges[0].profile;
    for (const item of items) assert.equal(profile.items[item.itemGuid].templateId, item.itemType);
    assert.equal(profile.items["founders-token"].quantity, 1);
    const stat = profile.stats.attributes.daily_rewards;
    assert.equal(stat.nextDefaultReward, 2);
    assert.equal(stat.totalDaysLoggedIn, 2);
    assert.deepEqual(stat.additionalSchedules, { FoundersPackDailyRewardToken: { rewardsClaimed: 5, claimedToday: true } });

    editProfile(backend, accountId, (saved) => {
      saved.stats.attributes.daily_rewards.lastClaimDate = new Date(Date.now() - 86400000).toISOString();
    });
    const last = await post(backend.port, command(accountId, "ClaimLoginReward"), token, {});
    const after = last.body.profileChanges[0].profile;
    assert.equal(after.items["founders-token"], undefined);
    assert.equal(last.body.notifications[0].items.length, 2);
  } finally {
    backend.close();
  }
});
