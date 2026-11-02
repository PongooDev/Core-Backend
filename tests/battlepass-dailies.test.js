import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { athenaBattlePassDailyIds, getAthenaQuest } from "../src/gamedata/athena.js";
import { athenaQuestLogin, claimAthenaQuest, advanceAthenaObjectives, rerollAthenaDaily, seasonRewardFunctions, settleBattlePassDaily }
  from "../src/profiles/athena.js";
import { buyBattlePass, takeUpSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";

// Core-Backend #156: the Battle Pass's daily challenge, "Extra Battle Pass Daily Challenge", in 1.11 and 2.1.
const v111 = "3807424";
const v21 = "3825894";
const v110 = "3790078";

function withSession(build, run) {
  return inBuild(build, () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-bp-dailies-"));
    try {
      const session = openSession(createProfileStore(dataDir), "passholder");
      takeUpSeason(session);
      return run(session);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}
const passDailies = (tracker) => Object.entries(tracker.profile.items)
  .filter(([, item]) => getAthenaQuest(item.templateId.split(":")[1] ?? "")?.type === "AthenaBattlePassQuest");
const regularDailies = (tracker) => Object.values(tracker.profile.items)
  .filter((item) => getAthenaQuest(item.templateId.split(":")[1] ?? "")?.type === "AthenaDailyQuest");

test("1.11 and 2.1 have ten Battle Pass challenges (BR_BattlePass, 500 XP and 5 Battle Stars)", () => {
  for (const build of [v111, v21]) {
    inBuild(build, () => {
      const ids = athenaBattlePassDailyIds();
      assert.equal(ids.length, 10);
      assert.ok(ids.includes("athena_battlepass_playmatches"));
      for (const id of ids) {
        const quest = getAthenaQuest(id);
        assert.equal(quest.category, "BR_BattlePass");
        assert.deepEqual(quest.rewards.map(({ templateId, quantity }) => [templateId, quantity]),
          [["AccountResource:athenaseasonalxp", 500], ["AccountResource:athenaseasonalbp", 5]]);
      }
    });
  }
});

// 1.10 already packs eight of them, but has no Battle Pass, so nothing gives its trigger.
test("1.10, without a Battle Pass, gives no Battle Pass challenge", () => withSession(v110, (session) => {
  athenaQuestLogin(session);
  assert.equal(passDailies(session.profile("athena")).length, 0);
}));

test("buying the Battle Pass gives its daily challenge at once, besides the regular dailies; without it there is none", () => {
  for (const build of [v111, v21]) {
    withSession(build, (session) => {
      const tracker = session.profile("athena");
      athenaQuestLogin(session);
      assert.equal(passDailies(tracker).length, 0, "no Battle Pass challenge without the pass");
      const regular = regularDailies(tracker).length;
      buyBattlePass(session, seasonRewardFunctions());
      assert.equal(passDailies(tracker).length, 1);
      assert.equal(passDailies(tracker)[0][1].attributes.quest_state, "Active");
      assert.equal(regularDailies(tracker).length, regular, "the regular dailies are apart");
      athenaQuestLogin(session);
      assert.equal(passDailies(tracker).length, 1, "one a day, MaxActiveDailyQuests 1");
    });
  }
});

test("a Battle Pass challenge is done, collected for its Battle Stars, and replaced the next day", () => withSession(v111, (session) => {
  const tracker = session.profile("athena");
  const day1 = new Date("2026-11-02T10:00:00Z");
  buyBattlePass(session, seasonRewardFunctions());
  for (const [itemId] of passDailies(tracker)) tracker.removeItem(itemId);
  tracker.profile.coreBattlePassDaily = {};
  settleBattlePassDaily(session, day1);
  const [[itemId, item]] = passDailies(tracker);
  const quest = getAthenaQuest(item.templateId.split(":")[1]);
  const objective = quest.objectives[0];
  // The match-result objectives are counted from the match report; any other comes from the gameserver.
  tracker.setItemAttribute(itemId, `completion_${objective.name}`, objective.count - 1);
  advanceAthenaObjectives(session, [{ statName: objective.name, count: 1 }]);
  if (tracker.profile.items[itemId].attributes.quest_state !== "Completed") {
    tracker.setItemAttribute(itemId, `completion_${objective.name}`, objective.count);
    tracker.setItemAttribute(itemId, "quest_state", "Completed");
  }
  const stars = () => (tracker.profile.stats.attributes.book_level ?? 1) * 10 + (tracker.profile.stats.attributes.book_xp ?? 0);
  const before = stars();
  claimAthenaQuest(session, itemId);
  // Its 5 Battle Stars, and those of any season level its 500 XP reaches.
  assert.ok(stars() - before >= 5);
  settleBattlePassDaily(session, day1);
  assert.equal(tracker.profile.items[itemId].attributes.quest_state, "Claimed", "kept until the next day");
  settleBattlePassDaily(session, new Date("2026-11-03T01:00:00Z"));
  assert.equal(tracker.profile.items[itemId], undefined);
  assert.equal(passDailies(tracker).length, 1);
}));

test("a Battle Pass challenge can be rerolled once a day, apart from the daily challenges' reroll", () => withSession(v21, (session) => {
  const tracker = session.profile("athena");
  athenaQuestLogin(session);
  buyBattlePass(session, seasonRewardFunctions());
  const [[itemId, item]] = passDailies(tracker);
  const dailyRerolls = tracker.profile.stats.attributes.quest_manager.dailyQuestRerolls;
  const notifications = [];
  rerollAthenaDaily(session, itemId, notifications);
  const [[newId, newItem]] = passDailies(tracker);
  assert.notEqual(newId, itemId);
  assert.notEqual(newItem.templateId, item.templateId);
  assert.equal(notifications[0].type, "dailyQuestReroll");
  assert.equal(tracker.profile.stats.attributes.quest_manager.dailyQuestRerolls, dailyRerolls);
  assert.throws(() => rerollAthenaDaily(session, newId, []), /no_rerolls_remaining|No Battle Pass challenge rerolls/);
}));
