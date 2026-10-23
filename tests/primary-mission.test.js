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
  return { send, progress, start, end };
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
