import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inBuild } from "../src/builds/context.js";
import { certBuild, getBuild } from "../src/builds/detect.js";
import { starterBanners } from "../src/gamedata/banners.js";
import { getItem, itemIds } from "../src/gamedata/items.js";
import { getQuest, questIds, startingQuests } from "../src/gamedata/quests.js";
import { activeBuild, buildGameData, certOnlyReads, dataBuild, dataBuilds } from "../src/gamedata/read.js";
import { foreignTemplateIds, isForeignTemplate } from "../src/gamedata/templates.js";
import { upgradeData } from "../src/gamedata/upgrades.js";
import { fullProfile, trackChanges, visibleChanges } from "../src/profiles/changes.js";
import { isLimited } from "../src/profiles/vault.js";
import { certUserAgent, post, send, startBackend, userLogin } from "./helpers.js";

const build12 = "3541083";
const agent12 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3541083";
const gamedata = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "gamedata");

test("the build is the changelist a request's User-Agent names; builds without their own data get the closest earlier build's", () => {
  const agent = (value) => ({ get: () => value });
  assert.equal(getBuild(agent(agent12)), build12);
  assert.equal(getBuild(agent("game=FortniteGame, engine=UE4, version=4.16.0-3541083+++Fortnite+Release-Cert, platform=Windows")), build12);
  assert.deepEqual(dataBuilds, [certBuild, build12, "3700114", "3724489", "3729133", "3741772", "3757339"]);
  assert.equal(dataBuild(build12), build12);
  for (const other of [certBuild, "unknown", "3500000", undefined]) assert.equal(dataBuild(other), certBuild);
  // A build without its own data takes the closest earlier one's: 1.10 would play on 1.9's, 1.7.3 on 1.7.2's.
  assert.equal(dataBuild("3724489"), "3724489");
  assert.equal(dataBuild("3729133"), "3729133");
  assert.equal(dataBuild("3741772"), "3741772");
  assert.equal(dataBuild("3757339"), "3757339");
  assert.equal(dataBuild("3790078"), "3757339");
  assert.equal(dataBuild("3710000"), "3700114");
  assert.equal(dataBuild("3600000"), build12);
  assert.equal(activeBuild(), certBuild, "outside a request");
  assert.equal(inBuild(build12, activeBuild), build12);
  assert.equal(inBuild("unknown", activeBuild), certBuild);
});

test("1.2's data is Cert's with its overlay: the Founder's rare laser sword, pickaxes, Twitch quest 7, banners", () => {
  assert.deepEqual(fs.readdirSync(path.join(gamedata, build12)).sort(), ["banners.json", "items.json", "quests.json", "upgrades.json"]);
  const both = (read) => [read(), inBuild(build12, read)];
  const ore = "Schematic:sid_edged_sword_medium_laser_founders_r_ore_t01";

  // Cert's rare sword evolves with the very rare one's recipes (into the very rare sword); 1.2 has rare recipes.
  assert.deepEqual(both(() => getItem(ore).conversions),
    [["Evolve.SID.Edged.Sword.Medium.Laser.Founders.VR.Ore.T02"], ["Evolve.SID.Edged.Sword.Medium.Laser.Founders.R.Ore.T02"]]);
  assert.deepEqual(both(() => getItem("Schematic:sid_edged_sword_medium_laser_founders_r_crystal_t04").conversions),
    [["Evolve.SID.Edged.Sword.Medium.Laser.Founders.VR.Crystal.T05"], undefined]);
  assert.deepEqual(both(() => upgradeData().recipes["Evolve.SID.Edged.Sword.Medium.Laser.Founders.R.Ore.T02"]?.results),
    [undefined, [{ quantity: 1, templateId: "Schematic:sid_edged_sword_medium_laser_founders_r_ore_t02" }]]);
  assert.ok(inBuild(build12, () => upgradeData().recipes["Evolve.SID.Edged.Sword.Medium.Laser.Founders.VR.Ore.T02"]));

  // 1.2's pickaxes don't count toward the backpack (bInventorySizeLimited false on the asset).
  assert.deepEqual(both(() => isLimited({ templateId: "Weapon:wid_harvest_pickaxe_c_t01" })), [true, false]);
  assert.deepEqual(both(() => isLimited({ templateId: "Weapon:wid_assault_auto_c_ore_t01" })), [true, true]);

  // Twitch quest 7 counts BluGlo collected instead of a stat; its objective keeps its name (completion_<name>).
  const [certQuest, quest12] = both(() => getQuest("twitchquest_reactive_7").objectives[0]);
  assert.deepEqual([certQuest.name, certQuest.stat, certQuest.item], ["quest_reactive_twitch_7", "quest_reactive_twitch_7", undefined]);
  assert.deepEqual([quest12.name, quest12.stat, quest12.item, quest12.itemEvent],
    ["quest_reactive_twitch_7", undefined, "FortMissionInfo:blugloworlditemdata", "Collect"]);

  // Four Other banners became Special; the starter (Standard) banners are the same.
  assert.deepEqual([certBuild, build12].map((build) => buildGameData(build, "banners").icons.OtherBanner28), ["Other", "Special"]);
  assert.deepEqual(...both(starterBanners));

  // The same templates, so a shared account holds nothing either build lacks.
  assert.deepEqual(...both(itemIds));
  assert.deepEqual(...both(questIds));
  assert.deepEqual(...both(startingQuests));
  assert.equal(inBuild(build12, () => isForeignTemplate(ore)), false);
});

test("every file a build overlays is read per build, never as Cert's alone", async () => {
  await import("../src/app.js");
  const overlaid = dataBuilds.filter((build) => build !== certBuild)
    .flatMap((build) => fs.readdirSync(path.join(gamedata, build)).map((file) => path.basename(file, ".json")));
  assert.ok(overlaid.length);
  for (const name of overlaid) {
    assert.ok(fs.existsSync(path.join(gamedata, `${name}.json`)), `${name} overlays a Cert file`);
    assert.ok(!certOnlyReads.has(name), `${name}.json is read with readGameData; read it through perBuild`);
  }
});

test("items whose template only another build has are left out of what a client is sent, and kept", () => {
  assert.deepEqual(foreignTemplateIds(new Map([["a", new Set(["x", "y"])], ["b", new Set(["x", "z"])]])),
    new Map([["a", new Set(["z"])], ["b", new Set(["y"])]]));

  const hidden = (templateId) => templateId === "Hero:only_elsewhere";
  const profile = {
    version: "core", wipeNumber: 1, stats: { attributes: { level: 3 } },
    items: { kept: { templateId: "Hero:everywhere", attributes: {}, quantity: 1 }, gone: { templateId: "Hero:only_elsewhere", attributes: {}, quantity: 1 } }
  };
  assert.deepEqual(Object.keys(fullProfile(profile, hidden).items), ["kept"]);
  assert.deepEqual(Object.keys(profile.items), ["kept", "gone"]);

  const tracker = trackChanges(profile);
  tracker.setItemAttribute("gone", "level", 2);
  tracker.setItemAttribute("kept", "level", 2);
  tracker.setStat("level", 4);
  // An evolution keeps the item id: the client loses the old template's item and never sees the new one.
  tracker.removeItem("kept");
  tracker.addItem("kept", { templateId: "Hero:only_elsewhere", attributes: {}, quantity: 1 });
  tracker.removeItem("gone");
  assert.deepEqual(visibleChanges(tracker.changes, hidden).map(({ changeType, itemId, name }) => [changeType, itemId ?? name]),
    [["itemAttrChanged", "kept"], ["statModified", "level"], ["itemRemoved", "kept"]]);
  assert.equal(visibleChanges(tracker.changes).length, tracker.changes.length, "no real template is foreign");
});

// The same account, played on Cert and on 1.2.
async function sharedAccount(backend) {
  const login = await userLogin(backend.port, "BothBuilds");
  const give = (templateId, quantity = 1) => post(backend.port, `/admin/api/accounts/${login.accountId}/grant`, undefined, { templateId, quantity });
  const run = (agent, name, body = {}) => send({
    host: "127.0.0.1", port: backend.port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${login.accountId}/client/${name}?profileId=profile0&rvn=-1`,
    headers: { "User-Agent": agent, Authorization: `bearer ${login.token}`, "Content-Type": "application/json" }
  }, JSON.stringify(body));
  const profile = async (agent) => (await run(agent, "QueryProfile")).body.profileChanges[0].profile;
  const ids = async (templateId) => Object.entries((await profile(certUserAgent)).items)
    .filter(([, item]) => item.templateId === templateId).map(([itemId]) => itemId);
  const amount = async (templateId) => Object.values((await profile(certUserAgent)).items)
    .filter((item) => item.templateId === templateId).reduce((sum, item) => sum + item.quantity, 0);
  return { give, run, profile, ids, amount };
}

test("a 1.2 client evolves the Founder's rare laser sword with 1.2's recipe, a Cert client with Cert's", async () => {
  const backend = await startBackend();
  try {
    const account = await sharedAccount(backend);
    const ore = "Schematic:sid_edged_sword_medium_laser_founders_r_ore_t01";
    await account.give(ore, 2);
    await account.give("AccountResource:schematicxp", 10000);
    await account.give("AccountResource:reagent_c_t01", 100);
    await account.give("AccountResource:reagent_weapons", 10);
    await account.give("HomebaseNode:t2_main_180921fb0"); // Evolution.Schematic.Weapons.Melee.Swords.Tier2a
    const [first, second] = await account.ids(ore);

    const evolved12 = await account.run(agent12, "ConvertItem", { targetItemId: first, conversionIndex: 0 });
    assert.equal(evolved12.status, 200);
    const evolvedCert = await account.run(certUserAgent, "ConvertItem", { targetItemId: second, conversionIndex: 0 });
    assert.equal(evolvedCert.status, 200);
    assert.deepEqual(await account.ids("Schematic:sid_edged_sword_medium_laser_founders_r_ore_t02"), [first]);
    assert.deepEqual(await account.ids("Schematic:sid_edged_sword_medium_laser_founders_vr_ore_t02"), [second]);
    // 1.2's recipe: 1500 schematic XP, 10 reagent_c_t01, 1 reagent_weapons; Cert's very rare one: 2000, 15, 2.
    assert.equal(await account.amount("AccountResource:schematicxp"), 10000 - 1500 - 2000);
    assert.equal(await account.amount("AccountResource:reagent_c_t01"), 100 - 10 - 15);
    assert.equal(await account.amount("AccountResource:reagent_weapons"), 10 - 1 - 2);

    // The rare crystal sword evolves no further on 1.2; Cert still offers its (locked) recipe.
    await account.give("Schematic:sid_edged_sword_medium_laser_founders_r_crystal_t04");
    const [crystal] = await account.ids("Schematic:sid_edged_sword_medium_laser_founders_r_crystal_t04");
    const none = await account.run(agent12, "ConvertItem", { targetItemId: crystal, conversionIndex: 0 });
    assert.equal(none.status, 400);
    assert.match(none.body.errorMessage, /has no evolution 0/);
    const locked = await account.run(certUserAgent, "ConvertItem", { targetItemId: crystal, conversionIndex: 0 });
    assert.equal(locked.status, 400);
    assert.match(locked.body.errorMessage, /Swords\.Tier2a\.3a\.4a\.5a/);

    // Both builds load the whole profile.
    const [onCert, on12] = [await account.profile(certUserAgent), await account.profile(agent12)];
    assert.deepEqual(Object.keys(on12.items).sort(), Object.keys(onCert.items).sort());
  } finally {
    backend.close();
  }
});

test("a build's overlay holds every file its data differs from Cert's in, so a new build never falls back to Cert's", () => {
  // Overlays apply to Cert's data, not the build before's: 1.8.1's first overlay held only the files 1.8.1 changed, and
  // every other file (Fortnitemares' quests, Hexsylvania's world, the Halloween llama) went back to Cert's (#102).
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "gamedata");
  const builds = dataBuilds.filter((build) => build !== certBuild).sort((a, b) => Number(a) - Number(b));
  for (let i = 1; i < builds.length; i++) {
    const files = (build) => new Set(fs.readdirSync(path.join(dir, build)).filter((file) => file.endsWith(".json")));
    const later = files(builds[i]);
    for (const file of files(builds[i - 1])) assert.ok(later.has(file), `gamedata/${builds[i]} has no ${file}, which ${builds[i - 1]} has`);
  }
  // 1.8.1 plays on 1.8's data but for what its patch changed.
  const changed = ["athena", "fabricator", "homebasenodes", "items", "objectivestats", "transmog"];
  for (const file of fs.readdirSync(path.join(dir, "3724489")).map((file) => file.replace(/\.json$/, ""))) {
    if (!changed.includes(file)) assert.deepEqual(buildGameData("3729133", file, null), buildGameData("3724489", file, null), file);
  }
  assert.equal(buildGameData("3729133", "athena", {}).quests.athenadaily_playmatches.objectives[0].count, 5);
});
