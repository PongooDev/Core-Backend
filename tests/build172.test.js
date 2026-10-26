import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { certBuild } from "../src/builds/detect.js";
import { bookData } from "../src/collectionbook/pages.js";
import { nodeIds } from "../src/gamedata/homebase.js";
import { cloudSaveProfile, getItem } from "../src/gamedata/items.js";
import { buildGameData } from "../src/gamedata/read.js";
import { send, startBackend, userLogin } from "./helpers.js";

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
