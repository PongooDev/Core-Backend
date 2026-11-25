import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventCard } from "../src/admin/eventschedules.js";
import { inBuild } from "../src/builds/context.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { activeEventFlags, isEventActive } from "../src/events/events.js";
import { refreshWargamesDailies, wargameBadgeRewards, wargames, wargamesFlag, wargamesGlobals } from "../src/events/wargames.js";
import { grantBadgeRewards } from "../src/profiles/badges.js";
import { grantQuest, questIdOf } from "../src/profiles/quests.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { clientQuestLogin } from "../src/services/mcp/commands/ClientQuestLogin.js";

// Save the World's Wargames (9.00, CL-6337466, PongooDev/CoreV2#655): the event's flag and hotfix switch, its quests, the
// Daily Challenge slots by unlocked zone, and the simulation's rewards.
const v900 = "6337466";
const v851 = "6165369";
const withSession = (build, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-wargames-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), "wargamer")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const questIds = (session) => Object.values(session.profile("profile0").profile.items).map(questIdOf).filter(Boolean);
const wargamesQuestIds = (session) => questIds(session).filter((id) => /^wargames?_/.test(id));
const dailies = (session) => questIds(session).filter((id) => id.startsWith("wargames_dailyquest_")).sort();
function claim(session, questId) {
  const tracker = session.profile("profile0");
  const itemId = grantQuest(tracker, questId);
  tracker.profile.items[itemId].attributes.quest_state = "Claimed";
}

test("9.00 runs Wargames: EventFlag.Outpost and the hotfix's bEnableIronCity; 8.51 neither", () => {
  assert.ok(inBuild(v900, () => activeEventFlags()).includes(wargamesFlag));
  assert.ok(inBuild(v900, () => isEventActive(wargames)));
  assert.deepEqual(wargamesGlobals(v900), ["bEnableIronCity=true"]);
  assert.ok(!inBuild(v851, () => activeEventFlags()).includes(wargamesFlag));
  assert.deepEqual(wargamesGlobals(v851), []);
  assert.deepEqual(eventCard("wargames").flags, [wargamesFlag]);
});

test("9.00's quest login gives the Boot Camp, simulation, challenge and visibility quests, without Pods", () => {
  withSession(v900, (session) => {
    clientQuestLogin({ session, notifications: [], profileId: "profile0" });
    const held = wargamesQuestIds(session);
    for (const id of ["wargame_quest_firstopen", "wargames_quest_play_wargame", "wargames_quest_play_challenge", "wargames_quest_host_wargames",
      "wargames_quest_assist_wargames", "wargames_quest_wargame_tornado", "wargames_quest_wargame_lava", "wargames_quest_wargame_anomaly",
      "wargames_quest_wargame_generators", "wargames_quest_challenge_fog", "wargames_quest_challenge_swarm", "wargames_visibilityquest_wargame_tornado",
      "wargames_visibilityquest_challenge_headgames"]) {
      assert.ok(held.includes(id), id);
    }
    assert.equal(held.filter((id) => id.startsWith("wargames_visibilityquest_")).length, 13, "4 simulations and 9 challenges");
    assert.equal(held.filter((id) => id.includes("pods")).length, 0, "Pods isn't in 9.00's shipped IronCityWargameTagList");
    assert.equal(held.filter((id) => id.endsWith("_repeatable")).length, 0, "the repeatables come from the Boot Camp's rewards");
    assert.deepEqual(dailies(session), [], "no zone's first Storm Shield Defense done yet");
  });
  withSession(v851, (session) => {
    clientQuestLogin({ session, notifications: [], profileId: "profile0" });
    assert.deepEqual(wargamesQuestIds(session), []);
  });
});

test("a Daily Challenge a day for each zone whose first Storm Shield Defense is done, up to 4, replaced the next day", () => {
  withSession(v900, (session) => {
    const day1 = new Date("2019-05-10T12:00:00.000Z");
    claim(session, "outpostquest_t1_l1");
    refreshWargamesDailies(session, day1);
    assert.equal(dailies(session).length, 1);
    assert.match(dailies(session)[0], /^wargames_dailyquest_(anomaly|generators|lava|tornado)_with_[a-z]+_stonewood$/);
    const first = dailies(session);
    refreshWargamesDailies(session, new Date("2019-05-10T20:00:00.000Z"));
    assert.deepEqual(dailies(session), first, "the same day keeps the day's daily");
    // A zone unlocked later in the day gets its slot then.
    for (const theater of [2, 3, 4]) claim(session, `outpostquest_t${theater}_l1`);
    refreshWargamesDailies(session, new Date("2019-05-10T21:00:00.000Z"));
    assert.equal(dailies(session).length, 4);
    assert.ok(dailies(session).includes(first[0]));
    assert.deepEqual(dailies(session).map((id) => id.split("_").pop()).sort(), ["canny", "plankerton", "stonewood", "twine"]);
    // The next UTC day draws four new ones in place of the day before's.
    refreshWargamesDailies(session, new Date("2019-05-11T00:30:00.000Z"));
    assert.equal(dailies(session).length, 4);
    assert.ok(dailies(session).every((id) => !id.includes("pods")));
    assert.equal(session.profile("profile0").profile.coreWargamesDay, "2019-05-11");
  });
});

test("a simulation's badge gives its zone's Wargames Rewards pack, the challenge's badge one more", () => {
  assert.deepEqual(wargameBadgeRewards([{ templateId: "WorldItem:IronCityMissionBadge03", count: 1 }]), [{ templateId: "CardPack:zcp_ironcity_t01", quantity: 1 }]);
  assert.deepEqual(wargameBadgeRewards([{ templateId: "WorldItem:IronCityMissionBadge12", count: 1 }, { templateId: "WorldItem:IronCityChallengeBadge", count: 1 }]),
    [{ templateId: "CardPack:zcp_ironcity_t03", quantity: 2 }]);
  assert.deepEqual(wargameBadgeRewards([{ templateId: "WorldItem:IronCityMissionBadge25", count: 1 }]), [{ templateId: "CardPack:zcp_ironcity_t04", quantity: 1 }]);
  assert.deepEqual(wargameBadgeRewards([{ templateId: "WorldItem:IronCityChallengeBadge", count: 1 }]), [], "no simulation badge, no zone");
  withSession(v900, (session) => {
    const granted = grantBadgeRewards(session, [{ templateId: "WorldItem:IronCityMissionBadge07", count: 1 }]);
    assert.deepEqual(granted.map(({ templateId, quantity }) => [templateId.toLowerCase(), quantity]), [["cardpack:zcp_ironcity_t02", 1]]);
  });
});

test("the Wargames packs: each simulation's banner, and each zone's rewards", () => {
  inBuild(v900, () => {
    for (const [simulation, banner] of [["tornado", "WargamesTornado"], ["lava", "WargamesLava"], ["anomaly", "WargamesAnomaly"], ["generators", "WargamesGenerators"]]) {
      assert.deepEqual(rollContents(`CardPack:cardpack_wargames_banner_${simulation}`), [{ templateId: `HomebaseBannerIcon:${banner}`, quantity: 1 }]);
    }
    assert.deepEqual(rollContents("CardPack:zcp_ironcity_t01"), [{ templateId: "AccountResource:heroxp", quantity: 200 }]);
    assert.deepEqual(rollContents("CardPack:zcp_ironcity_t04").map(({ templateId }) => templateId),
      ["AccountResource:reagent_alteration_upgrade_vr", "AccountResource:reagent_alteration_upgrade_sr"]);
  });
});
