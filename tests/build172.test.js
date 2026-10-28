import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { certBuild } from "../src/builds/detect.js";
import { bookData } from "../src/collectionbook/pages.js";
import { nodeIds } from "../src/gamedata/homebase.js";
import { cloudSaveProfile, getItem } from "../src/gamedata/items.js";
import { buildGameData } from "../src/gamedata/read.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

const build172 = "3700114";
const agents = {
  "3532353": "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3532353",
  "3541083": "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3541083",
  [build172]: "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3700114"
};

// A client of the given build running a profile command.
function command(port, build, { accountId, token }, name, profileId, body = {}) {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": agents[build], Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}

const profileOf = (response, profileId) => [response.body, ...(response.body.multiUpdate ?? [])].find((update) => update.profileId === profileId)
  ?.profileChanges.find((change) => change.changeType === "fullProfileUpdate")?.profile;
const cores = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId.startsWith("Outpost:"));

test("1.7.2's data keeps storm shields and deployable bases in the metadata profile, every other account item in profile0", () => {
  assert.equal(cloudSaveProfile(), "profile");
  assert.equal(inBuild("3541083", cloudSaveProfile), "profile");
  assert.equal(inBuild(build172, cloudSaveProfile), "metadata");
  for (const templateId of ["Outpost:outpostcore_pve_01", "Outpost:outpostcore_pve_04", "DeployableBaseCloudSave:testdeployablebaseitemdef"]) {
    assert.equal(getItem(templateId).profile, "profile", templateId);
    assert.equal(inBuild(build172, () => getItem(templateId).profile), "metadata", templateId);
  }
  assert.equal(inBuild(build172, () => getItem("Hero:hid_commando_007_r_t01").profile), "profile");
  assert.deepEqual(buildGameData(build172, "dailyrewards"), buildGameData(certBuild, "dailyrewards"), "1.7.2 moved the schedules to their own asset, unchanged");
});

test("1.7.2 gets its own skill tree and collection book, not Cert's", () => {
  assert.deepEqual([nodeIds().length, inBuild(build172, () => nodeIds().length)], [683, 772]);
  assert.deepEqual([Object.keys(bookData().pages).length, inBuild(build172, () => Object.keys(bookData().pages).length)], [33, 39]);
});

test("a 1.7.2 client's storm shield is a metadata item, and moves to the profile the build of each later request uses", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StormShield172");
    const run = (build, name, profileId, body) => command(backend.port, build, player, name, profileId, body);

    // The login's QueryProfile metadata (unknown to Core before 1.7.2, so the login failed).
    const metadata = await run(build172, "QueryProfile", "metadata");
    assert.equal(metadata.status, 200);
    assert.deepEqual(profileOf(metadata, "metadata").items, {});

    assert.equal((await run(build172, "CreateOrUpgradeOutpostItem", "metadata", { templateId: "Outpost:outpostcore_pve_01" })).status, 200);
    const [[coreId, core]] = cores(profileOf(await run(build172, "QueryProfile", "metadata"), "metadata"));
    // 1.7.2's cores start at MinLevel 1 (Cert's and 1.2's at 0).
    assert.equal(core.attributes.level, inBuild(build172, () => getItem("Outpost:outpostcore_pve_01").minLevel));
    assert.equal(core.attributes.level, 1);
    assert.deepEqual(cores(profileOf(await run(build172, "QueryProfile", "profile0"), "profile0")), []);

    // Played on 1.2 again: its client finds the core in profile0, with the same id.
    const on12 = await run("3541083", "QueryProfile", "profile0");
    assert.deepEqual(cores(profileOf(on12, "profile0")).map(([itemId]) => itemId), [coreId]);
    assert.deepEqual(cores(profileOf(await run("3541083", "QueryProfile", "metadata"), "metadata")), []);

    // And back on 1.7.2, the core is in metadata again, and profile0's QueryProfile reports the move.
    const back = await run(build172, "QueryProfile", "profile0");
    assert.deepEqual(cores(profileOf(back, "profile0")), []);
    assert.deepEqual(back.body.multiUpdate.map((update) => update.profileId), ["metadata"]);
    assert.deepEqual(cores(profileOf(await run(build172, "QueryProfile", "metadata"), "metadata")).map(([itemId]) => itemId), [coreId]);
  } finally {
    backend.close();
  }
});

test("a 1.2 account's storm shield moves into metadata on its first 1.7.2 login; of two copies the higher level stays", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Upgrader172");
    const run = (build, name, profileId, body) => command(backend.port, build, player, name, profileId, body);
    await run("3541083", "CreateOrUpgradeOutpostItem", "profile0", { templateId: "Outpost:outpostcore_pve_02" });
    await run(build172, "CreateOrUpgradeOutpostItem", "metadata", { templateId: "Outpost:outpostcore_pve_02" });

    const metadata = profileOf(await run(build172, "QueryProfile", "metadata"), "metadata");
    assert.equal(cores(metadata).length, 1);
    assert.deepEqual(cores(profileOf(await run(build172, "QueryProfile", "profile0"), "profile0")), []);
  } finally {
    backend.close();
  }
});

test("the admin panel shows and sets a 1.7.2 player's storm shields, which are metadata items (#51)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Panel172");
    const run = (name, profileId, body) => command(backend.port, build172, player, name, profileId, body);
    await run("QueryProfile", "metadata");
    await run("CreateOrUpgradeOutpostItem", "metadata", { templateId: "Outpost:outpostcore_pve_01" });
    const shield = (details, templateId) => details.stormShields.find((entry) => entry.templateId === templateId);

    const details = (await get(backend.port, `/admin/api/accounts/${player.accountId}`)).body;
    assert.notEqual(shield(details, "Outpost:outpostcore_pve_01").level, null);
    const set = (await post(backend.port, `/admin/api/accounts/${player.accountId}/storm-shield`, undefined, { templateId: "Outpost:outpostcore_pve_01", level: 5 })).body;
    assert.equal(shield(set, "Outpost:outpostcore_pve_01").level, 5);
    // A shield the player has no core for yet is made where their others are.
    await post(backend.port, `/admin/api/accounts/${player.accountId}/storm-shield`, undefined, { templateId: "Outpost:outpostcore_pve_02", level: 3 });

    const metadata = profileOf(await run("QueryProfile", "metadata"), "metadata");
    assert.deepEqual(cores(metadata).map(([, item]) => [item.templateId, item.attributes.level]).sort(),
      [["Outpost:outpostcore_pve_01", 5], ["Outpost:outpostcore_pve_02", 3]]);
  } finally {
    backend.close();
  }
});

test("RequestEventFlags answers with no active event and when to ask again; IncrementNamedCounterStat counts in named_counters", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Events172");
    const run = (name, body) => command(backend.port, build172, player, name, "profile0", body);

    const before = Date.now();
    const flags = await run("RequestEventFlags");
    assert.equal(flags.status, 200);
    const [notification] = flags.body.notifications;
    assert.equal(notification.primary, true);
    assert.deepEqual(notification.eventFlags, []);
    assert.ok(Date.parse(notification.refreshTime) > before);

    await run("IncrementNamedCounterStat", { counterName: "HomebaseRatingViewed" });
    const second = await run("IncrementNamedCounterStat", { counterName: "HomebaseRatingViewed" });
    const counter = (await run("QueryProfile")).body.profileChanges[0].profile.stats.attributes.named_counters.HomebaseRatingViewed;
    assert.equal(second.status, 200);
    assert.equal(counter.currentCount, 2);
    assert.ok(Date.parse(counter.lastIncrementedTime) >= before);
  } finally {
    backend.close();
  }
});

test("a 1.7.2 account holds Save the World's access token and the named_counters stat its front end reads; Cert has no such token", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Access172");
    const certProfile = profileOf(await command(backend.port, certBuild, player, "QueryProfile", "profile0"), "profile0");
    assert.equal(Object.values(certProfile.items).some((item) => item.templateId.toLowerCase() === "token:campaignaccess"), false);
    assert.deepEqual(certProfile.stats.attributes.named_counters, {});

    const profile = profileOf(await command(backend.port, build172, player, "QueryProfile", "profile0"), "profile0");
    assert.equal(Object.values(profile.items).filter((item) => item.templateId.toLowerCase() === "token:campaignaccess").length, 1);
    assert.deepEqual(profile.stats.attributes.named_counters, {});
    const again = profileOf(await command(backend.port, build172, player, "QueryProfile", "profile0"), "profile0");
    assert.equal(Object.values(again.items).filter((item) => item.templateId.toLowerCase() === "token:campaignaccess").length, 1);
  } finally {
    backend.close();
  }
});

test("1.7.2 asks for general chat per sub game and reads globalChatRooms, with the Founders room in both; Battle Royale's stats are an empty list", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Chat172");
    const ask = (path, method = "POST") => send({
      host: "127.0.0.1", port: backend.port, method, path,
      headers: { "User-Agent": agents[build172], Authorization: `bearer ${player.token}`, ...(method === "POST" ? { "Content-Type": "application/json", "Content-Length": 2 } : {}) }
    }, method === "POST" ? "{}" : undefined);
    const campaign = await ask(`/fortnite/api/game/v2/chat/${player.accountId}/recommendGeneralChatRooms/Campaign/pc`);
    assert.equal(campaign.status, 200);
    assert.deepEqual(campaign.body.globalChatRooms.map((room) => [room.roomName, room.publicFacingShardName]), [["Global", ""]]);
    assert.deepEqual(campaign.body.founderChatRooms.map((room) => room.roomName), ["Founders"]);
    assert.equal(campaign.body.bIsGlobalChatDisabled, false);
    const athena = await ask(`/fortnite/api/game/v2/chat/${player.accountId}/recommendGeneralChatRooms/Athena/pc`);
    assert.deepEqual(athena.body.globalChatRooms.map((room) => room.roomName), ["GlobalBattleRoyale"]);
    // Battle Royale's Founders tab joins the same Founders room (#62: it said "Currently unavailable" until Save the World).
    assert.deepEqual([athena.body.founderChatRooms.map((room) => room.roomName), athena.body.bIsFounderChatDisabled], [["Founders"], false]);
    const stats = await ask(`/fortnite/api/stats/accountId/${player.accountId}/bulk/window/alltime`, "GET");
    assert.equal(stats.status, 200);
    assert.deepEqual(stats.body.map((stat) => stat.name), ["br_lastmodified_pc_m0_p2", "br_lastmodified_pc_m0_p10", "br_lastmodified_pc_m0_p9"]);
    assert.ok(stats.body.every((stat) => stat.window === "alltime" && Math.abs(stat.value - Date.now() / 1000) < 60));
  } finally {
    backend.close();
  }
});

test("Send Feedback's multipart upload is accepted and kept nowhere", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Feedback172");
    const body = "--b\r\nContent-Disposition: form-data; name=\"subject\"\r\n\r\nHello\r\n--b--\r\n";
    const response = await send({
      host: "127.0.0.1", port: backend.port, method: "POST", path: "/fortnite/api/feedback/usertext",
      headers: { "User-Agent": agents[build172], Authorization: `bearer ${player.token}`, "Content-Type": "multipart/form-data; boundary=b", "Content-Length": Buffer.byteLength(body) }
    }, body);
    assert.equal(response.status, 204);
  } finally {
    backend.close();
  }
});

// Issue #45: 1.7.2's quest driven missions (the tapes of Keep Circulating the Tapes) only go on theaters tagged
// Theater.MainProgression, a tag 1.7.2 defines and the theater dump predates.
test("1.7.2's main theaters carry Theater.MainProgression; Cert's and the tutorial's don't", async () => {
  const { worldInfo } = await import("../src/world/theaters.js");
  const tags = (build) => inBuild(build, () => worldInfo(new Date("2026-10-26T12:00:00Z")).theaters
    .map((theater) => [theater.runtimeInfo.theaterType, theater.runtimeInfo.theaterTags.gameplayTags.map(({ tagName }) => tagName)]));
  assert.deepEqual(tags(build172), [
    ["Standard", ["Stat.Theater.PvE01", "Theater.MainProgression"]], ["Standard", ["Stat.Theater.PvE02", "Theater.MainProgression"]],
    ["Standard", ["Stat.Theater.PvE03", "Theater.MainProgression"]], ["Standard", ["Stat.Theater.PvE04", "Theater.MainProgression"]],
    ["Tutorial", []]
  ]);
  assert.ok(tags(certBuild).every(([, list]) => !list.includes("Theater.MainProgression")));
});
