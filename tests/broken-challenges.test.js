import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { athenaQuestLogin } from "../src/profiles/athena.js";
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

test("the list: two confirmed challenges, each with its issue and builds, all with a placeholder objective", () => {
  assert.deepEqual(brokenChallenges.map((entry) => entry.quest), ["quest_br_watch_replay", "quest_br_visit_scavengerhunt_stormcircles"]);
  for (const entry of brokenChallenges) {
    assert.match(entry.url, /^https:\/\/github\.com\/PongooDev\/.+\/issues\/\d+$/);
    assert.ok(entry.issue && entry.reason);
    assert.deepEqual(entry.builds, [v40, v41]);
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

test("on: a build without the broken form (4.2) is left alone", () => {
  withSession(v42, { completeBrokenChallenges: true }, (session) => {
    athenaQuestLogin(session);
    assert.equal(held(session, "quest_br_watch_replay"), undefined, "4.2's weeks do not give it");
    assert.equal(held(session, "quest_br_visit_scavengerhunt_stormcircles").attributes.quest_state, "Active", "4.2 counts its own stat");
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
    assert.equal(pass.brokenChallenges.list.length, 2);
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
