import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tokenSchedules } from "../src/gamedata/dailyrewards.js";
import { getQuest } from "../src/gamedata/quests.js";
import { post, startBackend, userLogin } from "./helpers.js";

// Core-Backend #31: the founder's pack and its Founder's Llama.
const command = (accountId, name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;
const foundersQuest = "Quest:foundersquest_getrewards_0_1";
const foundersToken = "DailyRewardScheduleToken:founderspackdailyrewardtoken";

async function account(backend, username = "Founder") {
  const login = await userLogin(backend.port, username);
  const run = (name, body = {}) => post(backend.port, command(login.accountId, name), login.token, body);
  const profile = async () => (await run("QueryProfile")).body.profileChanges[0].profile;
  const find = (profile, templateId) => Object.entries(profile.items).filter(([, item]) => item.templateId === templateId);
  const file = path.join(backend.dataDir, "accounts", login.accountId, "profiles", "profile0.json");
  const edit = (change) => {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    change(saved);
    fs.writeFileSync(file, JSON.stringify(saved));
  };
  return { ...login, run, profile, find, file, edit };
}

test("the Standard Edition's founders quest gives the founders banners and a week of founder's daily rewards", () => {
  const quest = getQuest("foundersquest_getrewards_0_1");
  assert.equal(quest.type, "Optional");
  assert.deepEqual(quest.objectives.map((objective) => [objective.itemEvent, objective.item]),
    [["HasCompletedQuest", "Quest:homebaseonboardingafteroutpost"]]);
  assert.deepEqual(quest.rewards, [{ quantity: 1, templateId: "CardPack:cardpack_founders_banners_t01" }, { quantity: 7, templateId: foundersToken }]);
  // DailyFoundersRewards: an Upgrade Llama a day, the Founder's Llama every seventh (rows 6, 13, …).
  const [schedule] = tokenSchedules;
  assert.equal(schedule.rewards.length, 126);
  schedule.rewards.forEach((reward, row) => assert.equal(reward.templateId,
    row % 7 === 6 ? "CardPack:cardpack_event_founders" : "CardPack:cardpack_bronze", `row ${row}`));
});

test("a new account is a Standard Edition founder whose quest waits for the store tutorial", async () => {
  const backend = await startBackend();
  try {
    const user = await account(backend);
    const profile = await user.profile();
    const [[, token]] = user.find(profile, "Token:founderspack_1");
    assert.equal(token.quantity, 1);
    const [[, quest], ...others] = user.find(profile, foundersQuest);
    assert.equal(others.length, 0);
    assert.equal(quest.attributes.quest_state, "Active");
    assert.equal(quest.attributes.completion_questcomplete_homebaseonboardingafteroutpost, 0);
    assert.equal(profile.coreMigrations, undefined, "Core's bookkeeping isn't sent to the client");
    assert.ok(JSON.parse(fs.readFileSync(user.file, "utf8")).coreMigrations.includes("foundersPack"));
  } finally {
    backend.close();
  }
});

test("the founder's daily rewards bring the Founder's Llama on the seventh claim, as a Schedule llama the store opens", async () => {
  const backend = await startBackend();
  try {
    const user = await account(backend);
    await post(backend.port, `/admin/api/accounts/${user.accountId}/skip-tutorial`, undefined, {});
    const [[questId, quest]] = user.find(await user.profile(), foundersQuest);
    assert.equal(quest.attributes.quest_state, "Completed", "done with the store tutorial; the client claims it");

    const claim = await user.run("ClaimQuestReward", { questId, selectedRewardIndex: -1 });
    assert.equal(claim.status, 200);
    assert.deepEqual(claim.body.notifications[0].loot.items.map((item) => [item.itemType, item.quantity]),
      [["CardPack:cardpack_founders_banners_t01", 1], [foundersToken, 7]]);
    const afterClaim = await user.profile();
    const [[, banners]] = user.find(afterClaim, "CardPack:cardpack_founders_banners_t01");
    assert.equal(banners.attributes.pack_source, "Quest");
    assert.equal(user.find(afterClaim, foundersToken)[0][1].quantity, 7);

    const granted = [];
    for (let day = 0; day < 8; day++) {
      if (day) user.edit((saved) => { saved.stats.attributes.daily_rewards.lastClaimDate = new Date(Date.now() - 86400000).toISOString(); });
      const reply = await user.run("ClaimLoginReward");
      assert.equal(reply.status, 200);
      // The default schedule's reward comes first, then the founder's.
      granted.push(reply.body.notifications[0].items.slice(1).map((item) => item.itemType));
    }
    assert.deepEqual(granted, [...Array(6).fill(["CardPack:cardpack_bronze"]), ["CardPack:cardpack_event_founders"], []],
      "six Upgrade Llamas, the Founder's Llama, then the week is used up");

    const profile = await user.profile();
    assert.deepEqual(user.find(profile, foundersToken), [], "the last token went with the seventh claim");
    assert.deepEqual(profile.stats.attributes.daily_rewards.additionalSchedules.FoundersPackDailyRewardToken.rewardsClaimed, 7);
    const [[llamaId, llama]] = user.find(profile, "CardPack:cardpack_event_founders");
    assert.equal(llama.attributes.pack_source, "Schedule");

    const opened = await user.run("OpenCardPack", { cardPackItemId: llamaId, selectionIdx: 0 });
    assert.equal(opened.status, 200);
    const [result] = opened.body.notifications;
    assert.equal(result.type, "cardPackResult");
    assert.equal(result.lootGranted.tierGroupName, "CardPack_Event_2017_Founders");
    assert.ok(result.lootGranted.items.length > 0);
  } finally {
    backend.close();
  }
});

test("an account made before the founder's pack gets it once, its quest done at once when the tutorial was", async () => {
  const backend = await startBackend();
  try {
    const user = await account(backend, "OldFounder");
    fs.mkdirSync(path.dirname(user.file), { recursive: true });
    fs.writeFileSync(user.file, JSON.stringify({
      profileId: "profile0", accountId: user.accountId, rvn: 20, wipeNumber: 1, version: "core", commandRevision: 19,
      stats: { attributes: { level: 4 } },
      coreMigrations: ["starterSchematics", "ammoSchematics", "levelXp", "expeditionPower"],
      items: {
        hero: { templateId: "Hero:hid_commando_grenadegun_uc_t01", quantity: 1, attributes: { level: 4, squad_id: "Squad_Combat_AdventureSquadOne", squad_slot_idx: 0 } },
        ...Object.fromEntries(["homebaseonboarding", "homebaseonboardinggrantschematics", "outpostquest_t1_l1", "homebaseonboardingafteroutpost"]
          .map((questId) => [questId, { templateId: `Quest:${questId}`, quantity: 1, attributes: { quest_state: "Claimed" } }]))
      }
    }));

    const first = await user.run("QueryProfile");
    assert.ok(first.body.profileRevision > 20);
    const profile = first.body.profileChanges[0].profile;
    assert.equal(user.find(profile, "Token:founderspack_1").length, 1);
    const [[questId, quest]] = user.find(profile, foundersQuest);
    assert.equal(quest.attributes.quest_state, "Completed");
    assert.deepEqual(JSON.parse(fs.readFileSync(user.file, "utf8")).coreMigrations,
      ["starterSchematics", "ammoSchematics", "levelXp", "expeditionPower", "foundersPack"]);

    // Once only: claimed and gone, it isn't given back.
    assert.equal((await user.run("ClaimQuestReward", { questId })).status, 200);
    assert.equal((await post(backend.port, `/admin/api/accounts/${user.accountId}/items/remove`, undefined, { itemId: questId })).status, 200);
    const again = await user.profile();
    assert.deepEqual(user.find(again, foundersQuest), []);
    assert.equal(user.find(again, "Token:founderspack_1").length, 1);
  } finally {
    backend.close();
  }
});
