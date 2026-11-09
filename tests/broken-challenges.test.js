import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { athenaQuestLogin } from "../src/profiles/athena.js";
import { getAthenaQuest } from "../src/gamedata/athena.js";
import { brokenChallenges, configureChallenges } from "../src/profiles/challenges.js";
import { openSession } from "../src/profiles/session.js";
import { buyBattlePass, takeUpSeason } from "../src/profiles/seasons.js";
import { seasonRewardFunctions } from "../src/profiles/athena.js";
import { createProfileStore } from "../src/profiles/store.js";
import { get, post, startBackend } from "./helpers.js";

// Core-Backend #269: the admin panel's option to complete the challenges that can't be completed on a build.
const v40 = "4039451";
const v41 = "4053532";
const v42 = "4072250";
const allWeeks = { challengeUnlock: { season4: { mode: "manual", manualWeeks: 10 } } };

function withSession(build, settings, run) {
  configureChallenges({ ...allWeeks, ...settings });
  try {
    return inBuild(build, () => {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-broken-"));
      try {
        const session = openSession(createProfileStore(dataDir), "player");
        takeUpSeason(session);
        buyBattlePass(session, seasonRewardFunctions());
        return run(session);
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });
  } finally {
    configureChallenges(undefined);
  }
}
const held = (session, questId) => Object.values(session.profile("athena").profile.items).find((item) => item.templateId.toLowerCase() === `quest:${questId}`);
const stars = (session) => { const stats = session.profile("athena").profile.stats.attributes; return (stats.book_level ?? 1) * 1000 + (stats.book_xp ?? 0) + (stats.xp ?? 0) + (stats.level ?? 1) * 100000; };

test("the list: each confirmed challenge has its issue and builds", () => {
  assert.deepEqual(brokenChallenges.map((entry) => entry.quest), [
    "quest_br_watch_replay", "quest_br_visit_scavengerhunt_stormcircles",
    "quest_br_eliminate_weapon_minigunlmg", "quest_br_eliminate_weapon_minigun", "quest_br_damage_minigun",
    "quest_br_score_goals", "quest_br_destroy_specifictargets"
  ]);
  for (const entry of brokenChallenges) {
    assert.match(entry.url, /^https:\/\/github\.com\/PongooDev\/.+\/issues\/\d+$/);
    assert.ok(entry.issue && entry.reason);
  }
  for (const entry of brokenChallenges.slice(0, 2)) assert.deepEqual(entry.builds, [v40, v41]);
  // CoreV2 #318: 4.2's minigun challenges want a Weapon.Ranged.Heavy.* tag no item carries.
  for (const entry of brokenChallenges.slice(2, 5)) { assert.deepEqual(entry.builds, [v42]); assert.equal(entry.issue, "CoreV2 #318"); }
  // Core-Backend #287: "Score a goal on different pitches" wants 5 of its one placeholder objective on all three 4.x builds.
  assert.deepEqual(brokenChallenges[5].builds, [v40, v41, v42]);
  // 5.0's week 3 Quest_BR_Destroy_SpecificTargets: "TBD", on the borrowed crab building visit, on both 5.0 builds.
  assert.deepEqual(brokenChallenges[6].builds, ["4204761", "4214610"]);
});

test("Score a goal on different pitches (Core-Backend #287): one placeholder objective, 5 needed, completed on 4.0-4.2 with the option on", () => {
  for (const build of [v40, v41, v42]) {
    const quest = inBuild(build, () => getAthenaQuest("quest_br_score_goals"));
    assert.deepEqual(quest.objectives.map((objective) => objective.stat), ["revive_athena_player"]);
    assert.equal(quest.objectiveCompletionCount, 5);
    withSession(build, {}, (session) => {
      athenaQuestLogin(session);
      assert.equal(held(session, "quest_br_score_goals").attributes.quest_state, "Active", build);
    });
    withSession(build, { completeBrokenChallenges: true }, (session) => {
      athenaQuestLogin(session);
      assert.equal(held(session, "quest_br_score_goals").attributes.quest_state, "Claimed", build);
    });
  }
});

test("off (the default): the broken challenges stay open", () => {
  for (const build of [v40, v41]) {
    withSession(build, {}, (session) => {
      athenaQuestLogin(session);
      assert.equal(held(session, "quest_br_watch_replay").attributes.quest_state, "Active");
      assert.equal(held(session, "quest_br_visit_scavengerhunt_stormcircles").attributes.quest_state, "Active");
    });
  }
});

test("on: they are completed on 4.0 and 4.1, paid once, and no other challenge is touched", () => {
  for (const build of [v40, v41]) {
    withSession(build, { completeBrokenChallenges: true }, (session) => {
      athenaQuestLogin(session);
      for (const id of ["quest_br_watch_replay", "quest_br_visit_scavengerhunt_stormcircles"]) {
        const quest = held(session, id);
        assert.equal(quest.attributes.quest_state, "Claimed", id);
        for (const [key, value] of Object.entries(quest.attributes)) if (key.startsWith("completion_")) assert.ok(value >= 1, key);
      }
      const bundle = Object.values(session.profile("athena").profile.items).find((item) => item.templateId.toLowerCase() === "challengebundle:questbundle_s4_week_003");
      assert.equal(bundle.attributes.num_quests_completed, 1);
      const open = Object.values(session.profile("athena").profile.items).filter((item) => item.templateId.startsWith("Quest:") && item.attributes.quest_state === "Active");
      assert.ok(open.length > 5, "the other challenges are still open");
      assert.ok(!open.some((item) => /watch_replay|stormcircles/i.test(item.templateId)));
      const paid = stars(session);
      athenaQuestLogin(session);
      athenaQuestLogin(session);
      assert.equal(stars(session), paid, "the reward is given once");
      assert.equal(held(session, "quest_br_watch_replay").attributes.quest_state, "Claimed");
      assert.equal(bundle.attributes.num_quests_completed, 1);
    });
  }
});

test("on: 4.2 completes only its listed challenges (CoreV2 #318, Core-Backend #287), the rest is left alone", () => {
  withSession(v42, { completeBrokenChallenges: true }, (session) => {
    athenaQuestLogin(session);
    assert.equal(held(session, "quest_br_watch_replay"), undefined, "4.2's weeks do not give it");
    assert.equal(held(session, "quest_br_visit_scavengerhunt_stormcircles").attributes.quest_state, "Active", "4.2 counts its own stat");
    for (const id of ["quest_br_eliminate_weapon_minigunlmg", "quest_br_eliminate_weapon_minigun", "quest_br_damage_minigun"]) {
      const quest = held(session, id);
      if (quest) assert.equal(quest.attributes.quest_state, "Claimed", id);
    }
  });
  withSession(v41, { completeBrokenChallenges: true }, (session) => {
    athenaQuestLogin(session);
    for (const id of ["quest_br_eliminate_weapon_minigunlmg", "quest_br_eliminate_weapon_minigun", "quest_br_damage_minigun"]) {
      const quest = held(session, id);
      if (quest) assert.equal(quest.attributes.quest_state, "Active", `${id} is not confirmed broken on 4.1`);
    }
  });
});

test("the paid stars equal the challenges' rewards", () => {
  const off = withSession(v41, {}, (session) => { athenaQuestLogin(session); return stars(session); });
  const on = withSession(v41, { completeBrokenChallenges: true }, (session) => { athenaQuestLogin(session); return stars(session); });
  assert.ok(on > off, `${on} stars with it on, ${off} off`);
});

test("admin panel: the option, off by default, and the list beside it", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-broken-admin-"));
  const backend = await startBackend({ dataDir });
  try {
    const pass = (await get(backend.port, "/admin/api/battlepass/overview?season=4")).body;
    assert.equal(pass.brokenChallenges.enabled, false);
    assert.equal(pass.brokenChallenges.list.length, 6);
    assert.equal((await get(backend.port, "/admin/api/battlepass/overview?season=3")).body.brokenChallenges, undefined);
    assert.equal((await post(backend.port, "/admin/api/battlepass/broken-challenges", undefined, { enabled: "yes" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/battlepass/broken-challenges", undefined, { enabled: true })).body.enabled, true);
    assert.equal((await get(backend.port, "/admin/api/battlepass/overview?season=4")).body.brokenChallenges.enabled, true);
    assert.equal((await post(backend.port, "/admin/api/battlepass/broken-challenges", undefined, { enabled: false })).body.enabled, false);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
