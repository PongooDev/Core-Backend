import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { getAthenaQuest } from "../src/gamedata/athena.js";
import { advanceAthenaObjectives, athenaQuestLogin, grantAthenaQuest, setUpAthena } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";

// The secret banners of Season 5's and 6's loading screens: the hidden challenges Road Trip's and Hunting Party's stages
// lead to, whose only reward is a banner icon the quests' rewards table marks Hidden.
const v521 = "4288479";
const v530 = "4305896";
const v602 = "4461277";

function withSession(build, name, run) {
  return inBuild(build, () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-hiddenbanners-"));
    try {
      const session = openSession(createProfileStore(dataDir), name);
      setUpAthena(session);
      return run(session);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}

const bannersOf = (session, pattern) => Object.values(session.profile("profile0").profile.items).map((item) => item.templateId.toLowerCase())
  .filter((templateId) => templateId.startsWith("homebasebannericon:") && pattern.test(templateId)).sort();

// The hidden challenge given and done as the gameserver reports its interact. Returns its item id.
function find(session, questId) {
  const tracker = session.profile("athena");
  const itemId = grantAthenaQuest(tracker, questId);
  const [objective] = getAthenaQuest(questId).objectives;
  advanceAthenaObjectives(session, [{ statName: objective.name, count: objective.count }]);
  assert.equal(tracker.profile.items[itemId].attributes.quest_state, "Claimed", `${questId} is hidden, so it settles as it completes`);
  return itemId;
}

test("the data's hidden banners: Road Trip's last two from 5.30, Hunting Party's even weeks from 6.00", () => {
  const hidden = (build) => inBuild(build, () => ["quest_br_s5_cumulative_quest8", "quest_br_s5_cumulative_quest9", "quest_br_s6_cumulative_quest2",
    "quest_br_s6_cumulative_quest4"].map((id) => getAthenaQuest(id)?.hiddenRewards?.[0]?.templateId ?? null));
  assert.deepEqual(hidden(v521), [null, null, null, null]);
  // 5.21's Road Trip ends at its seventh stage: the two challenges came with 5.30.
  assert.equal(inBuild(v521, () => getAthenaQuest("quest_br_s5_cumulative_quest8")), undefined);
  assert.ok(inBuild(v521, () => getAthenaQuest("quest_br_s5_cumulative_quest7")));
  assert.deepEqual(hidden(v530), ["HomebaseBannerIcon:brseason05crown", "HomebaseBannerIcon:brseason05glyph", null, null]);
  assert.deepEqual(hidden(v602), ["HomebaseBannerIcon:brseason05crown", "HomebaseBannerIcon:brseason05glyph", "HomebaseBannerIcon:brseason06werewolf",
    "HomebaseBannerIcon:brseason05crown"]);
});

test("a hidden challenge's banner is given when it is found, once, to the account's banners", () => {
  withSession(v602, "hunting", (session) => {
    assert.deepEqual(bannersOf(session, /brseason0[56]/), []);
    find(session, "quest_br_s6_cumulative_quest2");
    assert.deepEqual(bannersOf(session, /brseason0[56]/), ["homebasebannericon:brseason06werewolf"]);
    // Weeks 4 to 10 still name Season 5's crown in 6.02's files: given once, as the data has it.
    find(session, "quest_br_s6_cumulative_quest4");
    find(session, "quest_br_s6_cumulative_quest6");
    assert.deepEqual(bannersOf(session, /brseason0[56]/), ["homebasebannericon:brseason05crown", "homebasebannericon:brseason06werewolf"]);
    // The odd weeks' hidden Battle Stars are a reward of their own, as before.
    const pass = () => { const { book_level: tier = 1, book_xp: stars = 0 } = session.profile("athena").profile.stats.attributes; return [tier, stars]; };
    const before = pass();
    find(session, "quest_br_s6_cumulative_quest1");
    assert.notDeepEqual(pass(), before, "ten Battle Stars");
    assert.equal(bannersOf(session, /brseason0[56]/).length, 2);
  });
  withSession(v530, "roadtrip", (session) => {
    find(session, "quest_br_s5_cumulative_quest8");
    find(session, "quest_br_s5_cumulative_quest9");
    assert.deepEqual(bannersOf(session, /brseason05/), ["homebasebannericon:brseason05crown", "homebasebannericon:brseason05glyph"]);
  });
});

test("a hidden challenge collected before its banner was given gives it at the next quest login", () => {
  withSession(v602, "earlier", (session) => {
    const tracker = session.profile("athena");
    const itemId = grantAthenaQuest(tracker, "quest_br_s6_cumulative_quest2");
    // As the claim left it before: Claimed, and no banner.
    tracker.setItemAttribute(itemId, "quest_state", "Claimed");
    const open = grantAthenaQuest(tracker, "quest_br_s6_cumulative_quest4");
    athenaQuestLogin(session);
    assert.deepEqual(bannersOf(session, /brseason0[56]/), ["homebasebannericon:brseason06werewolf"], "the collected one's, not the open one's");
    assert.equal(tracker.profile.items[open].attributes.quest_state, "Active");
    athenaQuestLogin(session);
    assert.equal(bannersOf(session, /brseason06werewolf/).length, 1, "once");
  });
});
