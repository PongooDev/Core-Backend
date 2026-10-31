import { test } from "node:test";
import assert from "node:assert/strict";
import { getQuest } from "../src/gamedata/quests.js";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

const route = (kind, accountId, name, profileId = "profile0") =>
  `/fortnite/api/game/v2/profile/${accountId}/${kind}/${name}?profileId=${profileId}&rvn=-1`;
const quest = "Quest:stonewoodquest_filler_1_d2";

async function setup(backend, username) {
  const dedicated = await dedicatedServerToken(backend.port);
  const player = await userLogin(backend.port, username);
  await post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, { templateId: quest, quantity: 1 });
  const send = (name, body, profileId) => post(backend.port, route("dedicated_server", player.accountId, name, profileId), dedicated, body);
  const progress = async () => {
    const profile = (await post(backend.port, route("client", player.accountId, "QueryProfile"), player.token, {})).body.profileChanges[0].profile;
    const { attributes } = Object.values(profile.items).find((item) => item.templateId === quest);
    return { survivors: attributes.completion_questcollect_survivoritemdata ?? 0, zone: attributes.completion_complete_pve01_diff2 ?? 0,
      state: attributes.quest_state };
  };
  const start = () => send("StartPrimaryMission", { advance: [], matchmakingSessionId: "no-session", missionName: "m" });
  const end = (missionStatus, advance = []) =>
    send("EndPrimaryMission", { advance, matchmakingSessionId: "no-session", missionName: "m", missionStatus, earnedBadgeData: [],
      numMissionPoints: 0, bCriticalMatchBonus: false });
  return { send, progress, start, end, accountId: player.accountId };
}

const survivors = (count) => [{ statName: "questcollect_survivoritemdata", count }];

test("Gimme Three's survivors only count once the primary mission is won", () => {
  const [saved, zone] = getQuest("stonewoodquest_filler_1_d2").objectives;
  assert.equal(saved.requirePrimaryMissionCompletion, true);
  assert.equal(zone.requirePrimaryMissionCompletion, undefined);
});

test("progress that needs a won primary mission counts as it comes, and the gameserver's response carries it", async () => {
  const backend = await startBackend();
  try {
    const { send, progress, start, end } = await setup(backend, "HeldWon");
    await start();
    const updated = await send("UpdateQuests", { advance: [...survivors(1), { statName: "complete_pve01_diff2", count: 1 }] });
    const { attributes } = Object.values(updated.body.profileChanges[0].profile.items).find((item) => item.templateId === quest);
    assert.equal(attributes.completion_questcollect_survivoritemdata, 1);
    assert.equal((await send("BatchUpdatePlayer", { questObjectiveUpdates: survivors(1) }, "theater0")).status, 200);
    assert.deepEqual(await progress(), { survivors: 2, zone: 1, state: "Active" });

    // Met in the zone, the quest completes when the mission is won.
    await send("UpdateQuests", { advance: survivors(1) });
    assert.deepEqual(await progress(), { survivors: 3, zone: 1, state: "Active" });
    await end("Succeeded");
    assert.notEqual((await progress()).state, "Active");
  } finally {
    backend.close();
  }
});

test("outside a primary mission the server's progress counts and completes as it comes", async () => {
  const backend = await startBackend();
  try {
    const { send, progress } = await setup(backend, "HeldNone");
    await send("UpdateQuests", { advance: [...survivors(3), { statName: "complete_pve01_diff2", count: 1 }] });
    assert.notEqual((await progress()).state, "Active");
  } finally {
    backend.close();
  }
});

test("a failed or abandoned primary mission takes back the progress it made", async () => {
  const backend = await startBackend();
  try {
    const { send, progress, start, end } = await setup(backend, "HeldLost");
    await send("UpdateQuests", { advance: survivors(1) });
    await start();
    await send("UpdateQuests", { advance: [...survivors(5), { statName: "complete_pve01_diff2", count: 1 }] });
    assert.deepEqual(await progress(), { survivors: 3, zone: 1, state: "Active" });
    await end("Failed", survivors(1));
    // What it added (capped at the objective's count) comes off; the progress from before it and the zone stay.
    assert.deepEqual(await progress(), { survivors: 1, zone: 1, state: "Active" });

    // A mission that never ended loses its progress at the next one's start.
    await start();
    await send("UpdateQuests", { advance: survivors(1) });
    await start();
    assert.equal((await progress()).survivors, 1);
    await end("Succeeded", survivors(1));
    assert.equal((await progress()).survivors, 2);
  } finally {
    backend.close();
  }
});

// Issue #133: "Plankies Go Home" (plankertonquest_filler_3_d3), "Smash 3 Anomalies in successful missions in a 28+
// zone". Its objective complete_anomaly_2_diff3_v2 (stat row complete_anomaly_2_diff3: Complete,
// Stat.Mission.Secondary.Anomaly, Zone.Difficulty >= 16) has bRequirePrimaryMissionCompletion, so like the real game an
// anomaly smashed counts only once the zone's primary mission is won: the gameserver sends UpdateQuests the moment
// CloseRift succeeds (the in-zone counter shows it), a won mission keeps it, a failed or left one takes it back.
test("anomalies smashed count once the primary mission is won, and are lost with a failed or left one", async () => {
  const anomalyQuest = "Quest:plankertonquest_filler_3_d3";
  const [objective] = getQuest("plankertonquest_filler_3_d3").objectives;
  assert.deepEqual([objective.name, objective.stat, objective.count, objective.requirePrimaryMissionCompletion],
    ["complete_anomaly_2_diff3_v2", "complete_anomaly_2_diff3", 3, true]);
  const backend = await startBackend();
  try {
    const { send, start, end, accountId } = await setup(backend, "Anomalies");
    await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: anomalyQuest, quantity: 1 });
    const anomaly = [{ statName: "complete_anomaly_2_diff3_v2", count: 1 }];
    const smashed = async () => {
      const { profile } = (await send("QueryProfile", {})).body.profileChanges[0];
      const { attributes } = Object.values(profile.items).find((item) => item.templateId === anomalyQuest);
      return [attributes.completion_complete_anomaly_2_diff3_v2 ?? 0, attributes.quest_state];
    };

    // Smashed, then the mission failed.
    await start();
    await send("UpdateQuests", { advance: anomaly });
    assert.deepEqual(await smashed(), [1, "Active"]);
    await end("Failed");
    assert.deepEqual(await smashed(), [0, "Active"]);

    // Smashed, then left before the end: the next mission's start takes it back.
    await start();
    await send("UpdateQuests", { advance: anomaly });
    await start();
    assert.deepEqual(await smashed(), [0, "Active"]);
    await end("Succeeded");

    // Won missions keep theirs, and the third completes the quest when its mission is won.
    for (let won = 1; won <= 3; won++) {
      await start();
      await send("UpdateQuests", { advance: anomaly });
      assert.deepEqual(await smashed(), [won, "Active"]);
      await end("Succeeded");
    }
    assert.notEqual((await smashed())[1], "Active");
  } finally {
    backend.close();
  }
});

// The gameserver's earnScore handler (0x762AE0) adds an ExperienceDelta and finalizes the player's experience; the
// results screen reads the XP once it's finalized (Results_CommanderXP.Initialize -> GetXpInfo). So at zone end the
// first earnScore notification it gets has to carry the XP: CoreV2 sends EarnScore before EndPrimaryMission, whose own
// earnScore (zero XP) only finalizes players EarnScore doesn't notify (CoreV2 #34).
test("zone end in the gameserver's order: EarnScore's notification carries the XP, EndPrimaryMission still ends the mission", async () => {
  const backend = await startBackend();
  try {
    const { send, progress, start, end, accountId } = await setup(backend, "HeldXp");
    await start();
    await send("UpdateQuests", { advance: [...survivors(3), { statName: "complete_pve01_diff2", count: 1 }] });

    const earned = await send("EarnScore", { matchmakingSessionId: "no-session", playersAndScores: [
      { accountId, totalScore: 17029, bCriticalMatchBonus: false }] });
    const [first] = earned.body.notifications.filter((entry) => entry.type === "earnScore");
    // 17,029 score at ScoreToXPLinearRate is 10,437 base XP, doubled by a new account's rest XP.
    assert.deepEqual([first.baseXPEarned, first.restXPEarned], [10437, 10437]);
    // Granted while the mission is still open, the XP doesn't complete the quest its progress waits on.
    assert.deepEqual(await progress(), { survivors: 3, zone: 1, state: "Active" });

    const ended = await end("Succeeded");
    assert.deepEqual(ended.body.notifications.filter((entry) => entry.type === "earnScore").map((entry) => entry.baseXPEarned), [0]);
    assert.notEqual((await progress()).state, "Active");
    const stats = (await send("QueryProfile", {})).body.profileChanges[0].profile.stats.attributes;
    assert.deepEqual([stats.level, stats.xp], [1, 20874]);
  } finally {
    backend.close();
  }
});
