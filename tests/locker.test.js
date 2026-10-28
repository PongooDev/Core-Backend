import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { athenaCosmetics } from "../src/gamedata/athena.js";
import { addSeasonXp, grantCosmetic } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// Battle Royale's locker (Core-Backend #77): the starters, then what is earned (victory umbrellas, season level rewards)
// or bought; giveAllCosmetics gives everything.
const agent18 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489";

function command(port, { accountId, token }, name, profileId, body = {}) {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": agent18, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}
const updateOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);
const athena = async (port, player) => updateOf((await command(port, player, "QueryProfile", "athena")).body, "athena").profileChanges[0].profile;

test("a win gives 1.8 players its playlist's victory umbrella and the Founder's Umbrella, and only a win does", async () => {
  const backend = await startBackend();
  try {
    const winner = await userLogin(backend.port, "Winner18");
    const second = await userLogin(backend.port, "Second18");
    for (const player of [winner, second]) {
      const items = (await athena(backend.port, player)).items;
      assert.ok(!items["AthenaGlider:squad_umbrella"] && !items["AthenaGlider:founderumbrella"] && !items["AthenaGlider:solo_umbrella"]);
    }
    const dedicated = await dedicatedServerToken(backend.port);
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated, { playlistId: 9, results: [
      { accountId: winner.accountId, place: 1, kills: 3, secondsAlive: 900 },
      { accountId: second.accountId, place: 2, kills: 0, secondsAlive: 800 }] });
    const items = (await athena(backend.port, winner)).items;
    assert.ok(items["AthenaGlider:squad_umbrella"] && items["AthenaGlider:founderumbrella"]);
    assert.ok(!items["AthenaGlider:solo_umbrella"] && !items["AthenaGlider:duo_umbrella"]);
    assert.ok(!(await athena(backend.port, second)).items["AthenaGlider:squad_umbrella"]);
    assert.equal((await command(backend.port, winner, "EquipBattleRoyaleCustomization", "athena",
      { slotName: "Glider", itemToSlot: "AthenaGlider:squad_umbrella" })).status, 200);

    // A recorded win from before (1.7.2's recordwin, in the stats) gives its umbrella when the athena profile next loads.
    const veteran = await userLogin(backend.port, "Veteran172");
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", dedicated, { playlistId: 2, accountIds: [veteran.accountId] });
    assert.ok((await athena(backend.port, veteran)).items["AthenaGlider:solo_umbrella"]);
  } finally {
    backend.close();
  }
});

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-locker-"));
  try {
    return run(dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("season level 25 gives the Mako glider; giveAllCosmetics turned off again takes back only what it gave", () => withStore((dataDir) => inBuild("3724489", () => {
  const locker = (settings) => openSession(createProfileStore(dataDir, settings), "lockertester");
  let session = locker({});
  addSeasonXp(session, 25000);
  session.commit();
  assert.ok(session.profile("athena").profile.items["AthenaGlider:glider_warthog"]);

  // Everything, then a purchase and an equipped item.
  session = locker({ giveAllCosmetics: true });
  assert.equal(Object.keys(session.profile("athena").profile.items).length, Object.keys(athenaCosmetics()).length);
  grantCosmetic(session, "AthenaPickaxe:halloweenscythe");
  session.profile("athena").setStat("favorite_character", "AthenaCharacter:cid_029_athena_commando_f_halloween");
  session.profile("athena").setStat("favorite_pickaxe", "AthenaPickaxe:halloweenscythe");
  session.commit();

  const { items, stats } = locker({}).profile("athena").profile;
  assert.ok(items["AthenaPickaxe:halloweenscythe"] && items["AthenaGlider:glider_warthog"] && items["AthenaGlider:defaultglider"]);
  assert.ok(!items["AthenaCharacter:cid_029_athena_commando_f_halloween"] && !items["AthenaGlider:glider_prismatic"]);
  assert.equal(stats.attributes.favorite_character, "");
  assert.equal(stats.attributes.favorite_pickaxe, "AthenaPickaxe:halloweenscythe");
})));

test("lockers made before #77, which got every cosmetic, keep only the starters and what was earned", () => withStore((dataDir) => inBuild("3724489", () => {
  const accountId = "oldlocker";
  const file = path.join(dataDir, "accounts", accountId, "profiles", "athena.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const items = Object.fromEntries(Object.keys(athenaCosmetics())
    .map((templateId) => [templateId, { templateId, attributes: { level: 1, item_seen: 1, favorite: 0 }, quantity: 1 }]));
  fs.writeFileSync(file, JSON.stringify({ profileId: "athena", accountId, rvn: 9, wipeNumber: 1, version: "core", commandRevision: 8, items,
    stats: { attributes: { level: 25, xp: 0, favorite_glider: "AthenaGlider:glider_prismatic", favorite_pickaxe: "AthenaPickaxe:halloweenscythe",
      favorite_character: "AthenaCharacter:cid_030_athena_commando_m_halloween", favorite_dance: "AthenaDance:eid_dancemoves",
      favorite_victorypose: "AthenaVictoryPose:eid_ridethepony" } } }));

  // Wins in solo were recorded for the account (the stats).
  const session = openSession(createProfileStore(dataDir, { wonPlaylists: () => [2] }), accountId);
  const { profile } = session.profile("athena");
  const held = Object.keys(profile.items).sort();
  assert.deepEqual(held, ["AthenaBattleBus:bbid_defaultbus", "AthenaCharacter:cid_001_athena_commando_f_default",
    "AthenaCharacter:cid_002_athena_commando_f_default", "AthenaCharacter:cid_003_athena_commando_f_default",
    "AthenaCharacter:cid_004_athena_commando_f_default", "AthenaCharacter:cid_005_athena_commando_m_default",
    "AthenaCharacter:cid_006_athena_commando_m_default", "AthenaCharacter:cid_007_athena_commando_m_default",
    "AthenaCharacter:cid_008_athena_commando_m_default", "AthenaDance:eid_dancemoves", "AthenaGlider:defaultglider",
    "AthenaGlider:founderglider", "AthenaGlider:founderumbrella", "AthenaGlider:glider_warthog", "AthenaGlider:solo_umbrella",
    "AthenaLoadingScreen:lsid_defaultbg", "AthenaPickaxe:defaultpickaxe"]);
  // Slots holding a removed item go back to their default; the others stay.
  const { attributes } = profile.stats;
  assert.deepEqual([attributes.favorite_glider, attributes.favorite_pickaxe, attributes.favorite_character, attributes.favorite_dance,
    attributes.favorite_victorypose], ["AthenaGlider:defaultglider", "AthenaPickaxe:defaultpickaxe", "", "AthenaDance:eid_dancemoves", ""]);
  // Once: the next load changes nothing.
  const rvn = profile.rvn;
  assert.equal(openSession(createProfileStore(dataDir, { wonPlaylists: () => [2] }), accountId).profile("athena").profile.rvn, rvn);
})));
