import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { eventRunOf, eventRuns, fortnitemares, mutantStorms, spring2018, winter2017 } from "../src/events/events.js";
import { eventQuestLine } from "../src/events/quests.js";
import { getQuest } from "../src/gamedata/quests.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #347: a returning event (6.20's Fortnitemares, on 2017's quests) starts its quest line over, once a run.
const v172 = "3700114";
const v19 = "3757339";
const v191 = "3775276";
const v30 = "3901517";
const v610 = "4480234";
const v620 = "4497486";
const v621 = "4526925";
const versions = { [v19]: "Release-Live", [v191]: "Release-Cert", [v620]: "Release-6.20", [v621]: "Release-6.21" };
const agent = (changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+${versions[changelist]}-CL-${changelist}`;
// 6.20's client asks for the campaign view (stored as profile0, profiles/common.js), 1.9's for profile0.
const profileIdOf = (changelist) => (Number(changelist) >= 4000805 ? "campaign" : "profile0");

function mcp(changelist, port, { accountId, token }, name, rvn = -1, body = {}) {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1", port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileIdOf(changelist)}&rvn=${rvn}`,
    headers: { "User-Agent": agent(changelist), Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}
const fullProfile = (response) => response.body.profileChanges.find((change) => change.changeType === "fullProfileUpdate").profile;
const questsOf = (profile) => Object.fromEntries(Object.entries(profile.items)
  .filter(([, item]) => item.templateId.startsWith("Quest:")).map(([itemId, item]) => [item.templateId.slice(6).toLowerCase(), { itemId, state: item.attributes.quest_state }]));
const line620 = inBuild(v620, () => eventQuestLine(fortnitemares));
const line2017 = inBuild(v19, () => eventQuestLine(fortnitemares));
const halloween = (quests) => Object.keys(quests).filter((questId) => line2017.has(questId)).sort();
const query = async (changelist, port, player) => fullProfile(await mcp(changelist, port, player, "QueryProfile"));

function storedProfile(backend, accountId) {
  return path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
}
function editProfile(backend, accountId, edit) {
  const file = storedProfile(backend, accountId);
  const profile = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(profile);
  fs.writeFileSync(file, JSON.stringify(profile));
}
const readProfile = (backend, accountId) => JSON.parse(fs.readFileSync(storedProfile(backend, accountId), "utf8"));

// A quest finished and claimed on a build: the claim's hidden rewards start the next quests.
async function claim(changelist, backend, player, questId) {
  const itemId = questsOf(await query(changelist, backend.port, player))[questId].itemId;
  editProfile(backend, player.accountId, (profile) => {
    profile.items[itemId].attributes.quest_state = "Completed";
  });
  const response = await mcp(changelist, backend.port, player, "ClaimQuestReward", -1, { questId: itemId, selectedRewardIndex: -1 });
  assert.equal(response.status, 200);
  return questsOf(fullProfile(response));
}

// A 2017 player: the Opener claimed on 1.9 (its hidden rewards started the chain), an unfinished quest pinned.
async function played2017(backend, name) {
  const player = await userLogin(backend.port, name);
  await mcp(v19, backend.port, player, "ClientQuestLogin");
  const quests = await claim(v19, backend, player, "halloweenquest_2017_opener");
  editProfile(backend, player.accountId, (profile) => {
    profile.stats.attributes.client_settings.pinnedQuestInstances = [quests.halloweenquest_2017_tts_intro.itemId];
  });
  return { player, quests };
}

test("Fortnitemares has two runs, 2017's and 2018's; an event's phases and following builds are one run", () => {
  assert.deepEqual(eventRuns(fortnitemares), [{ firstBuild: 3724489, lastBuild: 3757339 }, { firstBuild: 4497486, lastBuild: 4573096 }]);
  // 1.9.1 and 1.10 follow each other: the Mutant Storms ran on.
  assert.deepEqual(eventRuns(mutantStorms), [{ firstBuild: 3775276, lastBuild: 3790078 }]);
  assert.deepEqual(eventRuns(spring2018), [{ firstBuild: 3889387, lastBuild: 3942182 }]);
  assert.equal(eventRuns(winter2017).length, 1);

  assert.equal(eventRunOf(fortnitemares, v19).firstBuild, 3724489);
  assert.equal(eventRunOf(fortnitemares, v30).firstBuild, 3724489, "a build between the runs, forced: the run before it");
  assert.equal(eventRunOf(fortnitemares, v620).firstBuild, 4497486);
  assert.equal(eventRunOf(fortnitemares, v621).firstBuild, 4497486, "6.21 is 6.20's run");
  assert.equal(eventRunOf(fortnitemares, v172).firstBuild, 3724489);
});

test("6.20's Fortnitemares quests are 2017's template ids; its data traces 42 of 1.9's 56 from the starting quests", () => {
  const line19 = inBuild(v19, () => eventQuestLine(fortnitemares));
  assert.equal(line19.size, 56);
  assert.equal(line620.size, 42);
  for (const questId of line620) assert.ok(line19.has(questId), questId);
  for (const questId of line19) assert.ok(inBuild(v620, () => getQuest(questId)), `${questId} is in 6.20's data`);
  assert.ok(!line620.has("halloweenquest_2017_hidden_3"), "GatherCollect_Halloween_2 no longer grants it");
  assert.deepEqual([...inBuild(v621, () => eventQuestLine(fortnitemares))].sort(), [...line620].sort());
});

test("6.20 starts the 2017 Fortnitemares line over once: 2017's quests go, the Opener comes back, 2018's progress stays", async () => {
  const backend = await startBackend();
  try {
    const { player, quests: before } = await played2017(backend, "Mares2018");
    assert.equal(before.halloweenquest_2017_opener.state, "Claimed");
    assert.equal(before.reactivequest_findcastles?.state, "Active", "the Opener's hidden rewards");
    const old = halloween(before).map((questId) => before[questId].itemId);
    const otherQuests = Object.keys(before).filter((questId) => !line2017.has(questId));
    assert.ok(otherQuests.includes("homebaseonboarding"));

    // 2017 quests 6.20's line doesn't reach (GatherCollect_Halloween_2 no longer grants Hidden_3) go too.
    editProfile(backend, player.accountId, (profile) => {
      profile.items.old_hidden3 = { templateId: "Quest:halloweenquest_2017_hidden_3", attributes: { quest_state: "Claimed" }, quantity: 1 };
      profile.items.old_fetch5 = { templateId: "Quest:reactivequest_halloween_fetch_5", attributes: { quest_state: "Completed" }, quantity: 1 };
    });

    // 6.20's first look at the quest log: every 2017 instance has left, with its pin.
    const first = await query(v620, backend.port, player);
    for (const itemId of [...old, "old_hidden3", "old_fetch5"]) assert.equal(first.items[itemId], undefined, itemId);
    assert.deepEqual(first.stats.attributes.client_settings.pinnedQuestInstances, []);

    // The quest login grants the event's starting quests again.
    assert.equal((await mcp(v620, backend.port, player, "ClientQuestLogin")).status, 200);
    let quests = questsOf(await query(v620, backend.port, player));
    assert.equal(quests.halloweenquest_2017_opener.state, "Active", "Hëxin' to do again");
    assert.notEqual(quests.halloweenquest_2017_opener.itemId, before.halloweenquest_2017_opener.itemId);
    assert.equal(quests.halloweenquest_2017_tts_intro, undefined, "the chain waits for the Opener again");
    assert.equal(quests.reactivequest_findcastles, undefined);
    for (const questId of otherQuests) assert.ok(quests[questId], `${questId} isn't the event's`);
    assert.ok(readProfile(backend, player.accountId).coreMigrations.includes(`eventRun.${fortnitemares}.${v620}`));

    // Progress in 2018's run stays: the Opener claimed on 6.20, then more logins on 6.20 and 6.21.
    quests = await claim(v620, backend, player, "halloweenquest_2017_opener");
    assert.equal(quests.halloweenquest_2017_tts_intro.state, "Active");
    for (const changelist of [v620, v621]) {
      await mcp(changelist, backend.port, player, "QueryProfile");
      const again = await mcp(changelist, backend.port, player, "ClientQuestLogin");
      assert.ok(!again.body.profileChanges.some((change) => change.changeType === "itemRemoved"), changelist);
      const now = questsOf(await query(changelist, backend.port, player));
      assert.equal(now.halloweenquest_2017_opener.state, "Claimed", changelist);
      assert.equal(now.halloweenquest_2017_tts_intro.itemId, quests.halloweenquest_2017_tts_intro.itemId, changelist);
    }
    assert.equal(readProfile(backend, player.accountId).coreMigrations.filter((note) => note.startsWith("eventRun.")).length, 1);
  } finally {
    await backend.close();
  }
});

test("the first run's builds and the builds after it never start the line over", async () => {
  const backend = await startBackend();
  try {
    const { player, quests: before } = await played2017(backend, "Mares2017");
    // 1.9 again (same run), then 1.9.1 (ended: only the unfinished ones go, #127) and 6.10 (no Fortnitemares).
    await mcp(v19, backend.port, player, "ClientQuestLogin");
    assert.deepEqual(halloween(questsOf(await query(v19, backend.port, player))), halloween(before));
    await mcp(v191, backend.port, player, "ClientQuestLogin");
    assert.deepEqual(halloween(questsOf(await query(v191, backend.port, player))), ["halloweenquest_2017_opener"]);
    await mcp(v610, backend.port, player, "ClientQuestLogin");
    const after = questsOf(await query(v610, backend.port, player));
    assert.equal(after.halloweenquest_2017_opener.itemId, before.halloweenquest_2017_opener.itemId);
    assert.ok(!(readProfile(backend, player.accountId).coreMigrations ?? []).some((note) => note.startsWith("eventRun.")));
  } finally {
    await backend.close();
  }
});

test("2018's run doesn't begin for an account while the Seasonal Events switch is off", async () => {
  const backend = await startBackend();
  try {
    const { player, quests: before } = await played2017(backend, "MaresOff");
    await post(backend.port, "/admin/api/settings", null, { seasonalEvents: false });
    await mcp(v620, backend.port, player, "ClientQuestLogin");
    // Off, the event is over there (#127): its unfinished quests go, the claimed Opener stays.
    const off = await mcp(v620, backend.port, player, "QueryProfile");
    let quests = questsOf(fullProfile(off));
    assert.equal(quests.halloweenquest_2017_opener.itemId, before.halloweenquest_2017_opener.itemId);
    assert.ok(!(readProfile(backend, player.accountId).coreMigrations ?? []).some((note) => note.startsWith("eventRun.")));

    // Switched on, the quest login of a client that has the profile so far tells it of the removal as an itemRemoved change.
    await post(backend.port, "/admin/api/settings", null, { seasonalEvents: true });
    const login = await mcp(v620, backend.port, player, "ClientQuestLogin", off.body.profileRevision);
    assert.equal(login.status, 200);
    assert.ok(login.body.profileChanges.some((change) => change.changeType === "itemRemoved" && change.itemId === before.halloweenquest_2017_opener.itemId));
    quests = questsOf(await query(v620, backend.port, player));
    assert.equal(quests.halloweenquest_2017_opener.state, "Active");
    assert.notEqual(quests.halloweenquest_2017_opener.itemId, before.halloweenquest_2017_opener.itemId);
  } finally {
    await backend.close();
  }
});

test("a new account on 6.20 just starts the line", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Mares2018New");
    await mcp(v620, backend.port, player, "ClientQuestLogin");
    const first = questsOf(await query(v620, backend.port, player));
    assert.equal(first.halloweenquest_2017_opener.state, "Active");
    await mcp(v620, backend.port, player, "ClientQuestLogin");
    assert.equal(questsOf(await query(v620, backend.port, player)).halloweenquest_2017_opener.itemId, first.halloweenquest_2017_opener.itemId);
  } finally {
    await backend.close();
  }
});
