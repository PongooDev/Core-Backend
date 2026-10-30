import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { fortnitemares } from "../src/events/events.js";
import { eventQuestLine, isEndedEventQuest } from "../src/events/quests.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #127: an ended event's unfinished quests leave the quest log.
const builds = { "1.7.2": "3700114", "1.8": "3724489", "1.9": "3757339", "1.9.1": "3775276" };
const agent = (changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`;

function mcp(changelist, port, { accountId, token }, name, rvn = -1, body = {}) {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1", port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`,
    headers: { "User-Agent": agent(changelist), Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}
const fullProfile = (response) => response.body.profileChanges.find((change) => change.changeType === "fullProfileUpdate").profile;
const questsOf = (profile) => Object.fromEntries(Object.entries(profile.items)
  .filter(([, item]) => item.templateId.startsWith("Quest:")).map(([itemId, item]) => [item.templateId.slice(6), { itemId, state: item.attributes.quest_state }]));
const line = inBuild(builds["1.9"], () => eventQuestLine(fortnitemares));
const halloween = (quests) => Object.keys(quests).filter((questId) => line.has(questId));

function editProfile(backend, accountId, edit) {
  const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
  const profile = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(profile);
  fs.writeFileSync(file, JSON.stringify(profile));
}

// A 1.9 player who claimed the Opener (its hidden rewards started the chain) and pinned an unfinished quest.
async function playedFortnitemares(backend, name) {
  const player = await userLogin(backend.port, name);
  await mcp(builds["1.9"], backend.port, player, "ClientQuestLogin");
  let opener;
  editProfile(backend, player.accountId, (profile) => {
    const quests = questsOf(profile);
    opener = quests.halloweenquest_2017_opener.itemId;
    profile.items[opener].attributes.quest_state = "Completed";
    profile.stats.attributes.client_settings.pinnedQuestInstances = [quests.halloweenquest_2017_epicheroes.itemId];
  });
  const claim = await mcp(builds["1.9"], backend.port, player, "ClaimQuestReward", -1, { questId: opener, selectedRewardIndex: -1 });
  assert.equal(claim.status, 200);
  const quests = questsOf(fullProfile(claim));
  return { player, quests };
}

test("Fortnitemares' quest line is the 56 LTE_Fortnitemares quests of the builds that have them", () => {
  for (const build of [builds["1.8"], builds["1.9"], builds["1.9.1"]]) {
    const line = inBuild(build, () => eventQuestLine(fortnitemares));
    assert.equal(line.size, 56, build);
    for (const questId of ["halloweenquest_2017_opener", "halloweenquest_2017_completemissions_14", "halloweenquest_2017_trainhero",
      "reactivequest_halloween_fetch_7", "reactivequest_findcastles", "reactivequest_halloween_killcollect_taker"]) assert.ok(line.has(questId), questId);
    assert.ok(!line.has("stonewoodquest_tutorial_r1"));
  }
  assert.equal(inBuild(builds["1.7.2"], () => eventQuestLine(fortnitemares)).size, 0);
  assert.equal(inBuild(builds["1.9.1"], () => isEndedEventQuest("HalloweenQuest_2017_Opener")), true);
  assert.equal(inBuild(builds["1.9"], () => isEndedEventQuest("halloweenquest_2017_opener")), false);
  assert.equal(inBuild(builds["1.9.1"], () => isEndedEventQuest("homebaseonboarding")), false);
});

test("1.9.1 takes the ended Fortnitemares' unfinished quests away and keeps the claimed ones; 1.9 gives them back", async () => {
  const backend = await startBackend();
  try {
    const { player, quests: before } = await playedFortnitemares(backend, "Mares191");
    assert.equal(before.halloweenquest_2017_opener.state, "Claimed");
    assert.equal(before.halloweenquest_2017_tts_intro?.state, "Active", "the Opener's hidden rewards");
    const unfinished = halloween(before).filter((questId) => before[questId].state === "Active");
    assert.ok(unfinished.length > 5);

    // The quest login sends the removals as the profile's changes.
    const rvn = (await mcp(builds["1.9.1"], backend.port, player, "QueryProfile", -1)).body.profileRevision;
    const login = await mcp(builds["1.9.1"], backend.port, player, "ClientQuestLogin", rvn);
    assert.equal(login.status, 200);
    assert.deepEqual(login.body.notifications[0].eventFlags, ["EventFlag.Vindertech"], "the Mutant Storms' flag only");
    const after = questsOf(fullProfile(await mcp(builds["1.9.1"], backend.port, player, "QueryProfile", -1)));
    assert.deepEqual(halloween(after), ["halloweenquest_2017_opener"]);
    assert.equal(after.halloweenquest_2017_opener.state, "Claimed");
    assert.ok(after.homebaseonboarding, "other quests stay");

    // Back on 1.9, the event runs: its starting quests and the claimed Opener's quests come back, started over.
    await mcp(builds["1.9"], backend.port, player, "ClientQuestLogin");
    const back = questsOf(fullProfile(await mcp(builds["1.9"], backend.port, player, "QueryProfile", -1)));
    assert.deepEqual(halloween(back).sort(), halloween(before).sort());
    assert.equal(back.halloweenquest_2017_tts_intro.state, "Active");
    assert.equal(back.halloweenquest_2017_opener.state, "Claimed", "not granted again");
  } finally {
    backend.close();
  }
});

test("the quest login's removals reach the client as itemRemoved changes, with their pins", async () => {
  const backend = await startBackend();
  try {
    const { player, quests: before } = await playedFortnitemares(backend, "Mares191Delta");
    const unfinished = halloween(before).filter((questId) => before[questId].state === "Active");
    const { profileRevision } = (await mcp(builds["1.9"], backend.port, player, "QueryProfile", -1)).body;
    const login = await mcp(builds["1.9.1"], backend.port, player, "ClientQuestLogin", profileRevision);
    const removed = login.body.profileChanges.filter((change) => change.changeType === "itemRemoved").map((change) => change.itemId);
    assert.deepEqual(removed.sort(), unfinished.map((questId) => before[questId].itemId).sort());
    const pins = login.body.profileChanges.find((change) => change.changeType === "statModified" && change.name === "client_settings");
    assert.deepEqual(pins.value.pinnedQuestInstances, []);
  } finally {
    backend.close();
  }
});

test("1.7.2, whose data has no Fortnitemares quests, leaves them for the builds that show them", async () => {
  const backend = await startBackend();
  try {
    const { player, quests: before } = await playedFortnitemares(backend, "Mares172");
    await mcp(builds["1.7.2"], backend.port, player, "ClientQuestLogin");
    await mcp(builds["1.7.2"], backend.port, player, "QueryProfile", -1);
    const after = questsOf(fullProfile(await mcp(builds["1.9"], backend.port, player, "QueryProfile", -1)));
    assert.deepEqual(halloween(after).sort(), halloween(before).sort());
  } finally {
    backend.close();
  }
});

test("the Seasonal Events switch turned off takes the unfinished event quests away; turned on, the event gives them again", async () => {
  const backend = await startBackend();
  try {
    const { player, quests: before } = await playedFortnitemares(backend, "MaresSwitch");
    await post(backend.port, "/admin/api/settings", null, { seasonalEvents: false });
    const off = questsOf(fullProfile(await mcp(builds["1.9"], backend.port, player, "QueryProfile", -1)));
    assert.deepEqual(halloween(off), ["halloweenquest_2017_opener"]);
    // Nothing grants them while it's off, the quest login included.
    await mcp(builds["1.9"], backend.port, player, "ClientQuestLogin");
    assert.deepEqual(halloween(questsOf(fullProfile(await mcp(builds["1.9"], backend.port, player, "QueryProfile", -1)))),
      ["halloweenquest_2017_opener"]);

    await post(backend.port, "/admin/api/settings", null, { seasonalEvents: true });
    await mcp(builds["1.9"], backend.port, player, "ClientQuestLogin");
    const on = questsOf(fullProfile(await mcp(builds["1.9"], backend.port, player, "QueryProfile", -1)));
    assert.deepEqual(halloween(on).sort(), halloween(before).sort());
  } finally {
    backend.close();
  }
});
