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
    return { survivors: attributes.completion_questcollect_survivoritemdata ?? 0, zone: attributes.completion_complete_pve01_diff2 ?? 0 };
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

test("progress that needs a won primary mission waits for EndPrimaryMission and counts when it succeeded", async () => {
  const backend = await startBackend();
  try {
    const { send, progress, start, end } = await setup(backend, "HeldWon");
    await start();
    await send("UpdateQuests", { advance: [...survivors(1), { statName: "complete_pve01_diff2", count: 1 }] });
    assert.equal((await send("BatchUpdatePlayer", { questObjectiveUpdates: survivors(1) }, "theater0")).status, 200);
    assert.deepEqual(await progress(), { survivors: 0, zone: 1 });

    await end("Succeeded");
    assert.equal((await progress()).survivors, 2);
    // Outside a primary mission the server's progress counts as it comes.
    await send("UpdateQuests", { advance: survivors(1) });
    assert.equal((await progress()).survivors, 3);
  } finally {
    backend.close();
  }
});

test("a failed or abandoned primary mission drops the progress it held", async () => {
  const backend = await startBackend();
  try {
    const { send, progress, start, end } = await setup(backend, "HeldLost");
    await start();
    await send("UpdateQuests", { advance: survivors(2) });
    await end("Failed", survivors(1));
    assert.equal((await progress()).survivors, 0);

    // A mission that never ended is dropped by the next one's start.
    await start();
    await send("UpdateQuests", { advance: survivors(2) });
    await start();
    await end("Succeeded", survivors(1));
    assert.equal((await progress()).survivors, 1);
  } finally {
    backend.close();
  }
});
