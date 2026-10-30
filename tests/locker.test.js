import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { athenaCosmetics } from "../src/gamedata/athena.js";
import { bannerIds } from "../src/gamedata/banners.js";
import { addSeasonXp, grantCosmetic, grantFullLocker, removeFullLocker } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { createFrameParser, encodeFrame } from "../src/stomp/service.js";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

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

// Core-Backend #84: a win in any mode gives The Umbrella (Solo_Umbrella), never the Duo or Squad Umbrella.
test("a win in any playlist gives 1.8 players The Umbrella and the Founder's Umbrella, and only a win does", async () => {
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
    assert.ok(items["AthenaGlider:solo_umbrella"] && items["AthenaGlider:founderumbrella"]);
    assert.ok(!items["AthenaGlider:squad_umbrella"] && !items["AthenaGlider:duo_umbrella"]);
    assert.ok(!(await athena(backend.port, second)).items["AthenaGlider:solo_umbrella"]);
    assert.equal((await command(backend.port, winner, "EquipBattleRoyaleCustomization", "athena",
      { slotName: "Glider", itemToSlot: "AthenaGlider:solo_umbrella" })).status, 200);

    // A recorded win from before (1.7.2's recordwin, in the stats), in duos too, gives The Umbrella when the athena
    // profile next loads.
    const veteran = await userLogin(backend.port, "Veteran172");
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", dedicated, { playlistId: 10, accountIds: [veteran.accountId] });
    const veteranItems = (await athena(backend.port, veteran)).items;
    assert.ok(veteranItems["AthenaGlider:solo_umbrella"] && veteranItems["AthenaGlider:founderumbrella"]);
    assert.ok(!veteranItems["AthenaGlider:duo_umbrella"]);

    // A win in a limited-time playlist (neither solo, duo nor squad) gives no umbrella, reported or recorded
    // (Core-Backend #84).
    const limited = await userLogin(backend.port, "LimitedTime");
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated, { playlistId: 35, results: [
      { accountId: limited.accountId, place: 1, kills: 0, secondsAlive: 600 }] });
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", dedicated, { playlistId: 35, accountIds: [limited.accountId] });
    const limitedItems = (await athena(backend.port, limited)).items;
    assert.ok(!limitedItems["AthenaGlider:solo_umbrella"] && !limitedItems["AthenaGlider:founderumbrella"]);
    const umbrellas = await post(backend.port, "/fortnite/api/game/v2/battleroyale/winners", dedicated, { playlistId: 2, accountIds: [limited.accountId, veteran.accountId] });
    assert.deepEqual(umbrellas.body.winners.map(({ accountId }) => accountId), [veteran.accountId]);
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
  // Every cosmetic but the 8 random Recruit outfits (#77) and the Duo and Squad Umbrellas (#84).
  const { items: given } = session.profile("athena").profile;
  assert.equal(Object.keys(given).length, Object.keys(athenaCosmetics()).length - 10);
  assert.ok(!given["AthenaGlider:duo_umbrella"] && !given["AthenaGlider:squad_umbrella"] && given["AthenaGlider:solo_umbrella"]);
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
  assert.deepEqual(held, ["AthenaBattleBus:bbid_defaultbus", "AthenaDance:eid_dancemoves", "AthenaGlider:defaultglider",
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

// Core-Backend #84: lockers given the Duo or Squad Umbrella (a duo or squad win before #84, or giveAllCosmetics) lose
// them, once; a glider slot holding one goes back to the default glider.
test("lockers lose the Duo and Squad Umbrellas, and a glider slot holding one gets the default glider", () => withStore((dataDir) => inBuild("3724489", () => {
  const accountId = "duowinner";
  const store = () => createProfileStore(dataDir, { wonPlaylists: (id) => (id === accountId ? [10, 9] : []) });
  let session = openSession(store(), accountId);
  const tracker = session.profile("athena");
  for (const templateId of ["AthenaGlider:duo_umbrella", "AthenaGlider:squad_umbrella"]) {
    tracker.addItem(templateId, { templateId, attributes: { level: 1, item_seen: 1, favorite: 0 }, quantity: 1 });
  }
  tracker.setStat("favorite_glider", "AthenaGlider:squad_umbrella");
  session.commit();

  session = openSession(store(), accountId);
  const { items, stats, rvn } = session.profile("athena").profile;
  assert.ok(!items["AthenaGlider:duo_umbrella"] && !items["AthenaGlider:squad_umbrella"]);
  assert.ok(items["AthenaGlider:solo_umbrella"] && items["AthenaGlider:founderumbrella"]);
  assert.equal(stats.attributes.favorite_glider, "AthenaGlider:defaultglider");
  // Nothing gives them back: not a purchase or grant, and the next load changes nothing.
  assert.equal(grantCosmetic(session, "AthenaGlider:duo_umbrella"), null);
  assert.equal(openSession(store(), accountId).profile("athena").profile.rvn, rvn);
})));

// Core-Backend #97: the admin panel's full locker, every cosmetic and banner of any build, and taking it back.
test("the admin panel gives the full locker and takes back only what it gave", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "FullLocker");
    const admin = (action) => post(backend.port, `/admin/api/accounts/${player.accountId}/locker/${action}`, undefined, {});
    const account = async () => updateOf((await command(backend.port, player, "QueryProfile", "profile0")).body, "profile0").profileChanges[0].profile;
    const before = await athena(backend.port, player);
    const revision = async () => (await command(backend.port, player, "QueryProfile", "athena")).body.profileRevision;
    const beforeRvn = await revision();
    // The full locker gives every build's cosmetics: the newest build's are all of them (1.8.2 adds Aerial Assault One,
    // 1.10 the Winter Bus).
    const lockerIds = inBuild("3790078", () => Object.keys(athenaCosmetics()))
      .filter((id) => !/cid_00\d_athena_commando_\w_default|duo_umbrella|squad_umbrella/i.test(id));
    const bannerRows = inBuild("3724489", bannerIds);
    const icon = bannerRows.find((id) => /^HomebaseBannerIcon:FounderTier/.test(id));
    assert.ok(icon && !Object.values((await account()).items).some((item) => item.templateId === icon));

    // Only from the panel's own page.
    const rebound = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: `/admin/api/accounts/${player.accountId}/locker/grant-all`,
      headers: { Host: "attacker.example", "Content-Type": "application/json" } }, "{}");
    assert.equal(rebound.status, 403);

    const given = await admin("grant-all");
    assert.equal(given.status, 200);
    const starters = Object.keys(before.items).filter((id) => before.items[id].templateId === id);
    assert.equal(given.body.granted.cosmetics, lockerIds.length - starters.length);
    assert.ok(given.body.granted.banners > 0);
    const { cosmetics, banners, granted } = given.body.locker;
    assert.deepEqual([cosmetics.owned, banners.owned], [cosmetics.total, banners.total]);
    assert.equal(granted, given.body.granted.cosmetics + given.body.granted.banners);

    // The 1.8 client sees every cosmetic of its build and every banner at a new revision; a later build's (1.8.2's
    // Aerial Assault One) is kept from it.
    const full = await athena(backend.port, player);
    const lockerIds18 = new Set(inBuild("3724489", () => Object.keys(athenaCosmetics())));
    for (const id of lockerIds) assert.equal(Boolean(full.items[id]), lockerIds18.has(id), id);
    const accountItems = Object.values((await account()).items).map((item) => item.templateId.toLowerCase());
    for (const id of bannerRows) assert.ok(accountItems.includes(id.toLowerCase()), id);
    assert.ok(await revision() > beforeRvn);
    assert.deepEqual((await admin("grant-all")).body.granted, { cosmetics: 0, banners: 0 });

    // Equipped, and a win that earns the umbrellas the full locker gave.
    assert.equal((await command(backend.port, player, "EquipBattleRoyaleCustomization", "athena",
      { slotName: "Glider", itemToSlot: "AthenaGlider:glider_prismatic" })).status, 200);
    assert.equal((await command(backend.port, player, "SetBattleRoyaleBanner", "athena",
      { homebaseBannerIconId: icon.split(":")[1], homebaseBannerColorId: "DefaultColor1" })).status, 200);
    const dedicated = await dedicatedServerToken(backend.port);
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated, { playlistId: 2, results: [
      { accountId: player.accountId, place: 1, kills: 1, secondsAlive: 600 }] });

    const removed = await admin("remove-granted");
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.removed, { cosmetics: given.body.granted.cosmetics - 2, banners: given.body.granted.banners });
    assert.equal(removed.body.locker.granted, 0);
    const after = await athena(backend.port, player);
    assert.deepEqual(Object.keys(after.items).filter((id) => !id.startsWith("Quest:") && after.items[id].templateId === id).sort(),
      [...starters, "AthenaGlider:solo_umbrella", "AthenaGlider:founderumbrella"].sort());
    assert.equal(after.stats.attributes.favorite_glider, "AthenaGlider:defaultglider");
    assert.equal(after.stats.attributes.banner_icon, "StandardBanner1");
    assert.ok(!Object.values((await account()).items).some((item) => item.templateId === icon));
    assert.deepEqual((await admin("remove-granted")).body.removed, { cosmetics: 0, banners: 0 });
  } finally {
    backend.close();
  }
});

test("what giveAllCosmetics gave stays once the panel gives the full locker", () => withStore((dataDir) => inBuild("3790078", () => {
  const locker = (settings) => openSession(createProfileStore(dataDir, settings), "blanketlocker");
  let session = locker({ giveAllCosmetics: true });
  const total = Object.keys(session.profile("athena").profile.items).length;
  const held = Object.values(session.profile("profile0").profile.items).filter((item) => /^HomebaseBanner/.test(item.templateId)).length;
  assert.deepEqual(grantFullLocker(session), { cosmetics: 0, banners: bannerIds().length - held });
  session.commit();
  for (const profileId of ["athena", "profile0"]) createProfileStore(dataDir).save(session.profile(profileId).profile);

  session = locker({});
  assert.equal(Object.keys(session.profile("athena").profile.items).length, total);
  assert.equal(removeFullLocker(session).cosmetics, total - 6);
})));

test("the admin panel sets an account's Battle Royale season level, with its chase rewards (Core-Backend #106)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "SeasonLevel");
    const setLevel = (level) => post(backend.port, `/admin/api/accounts/${player.accountId}/battle-royale-level`, undefined, { level });
    // No athena profile yet: nothing to set.
    assert.equal((await setLevel(20)).status, 400);

    const revision = async () => (await command(backend.port, player, "QueryProfile", "athena")).body.profileRevision;
    const beforeRvn = await revision();
    const set = await setLevel(30);
    assert.equal(set.status, 200);
    assert.deepEqual(set.body.battleRoyale, { level: 30, xp: 0, maxLevel: set.body.battleRoyale.maxLevel });
    const after = await athena(backend.port, player);
    assert.ok((await revision()) > beforeRvn);
    assert.equal(after.stats.attributes.level, 30);
    assert.equal(after.stats.attributes.accountLevel, 30);
    assert.equal(after.stats.attributes.xp, 0);
    // Level 25's chase reward, the Mako glider.
    assert.ok(Object.values(after.items).some((item) => /glider_warthog/i.test(item.templateId)));

    for (const bad of [0, set.body.battleRoyale.maxLevel + 1, 2.5, "x"]) assert.equal((await setLevel(bad)).status, 400);
    assert.equal((await setLevel(5)).body.battleRoyale.level, 5);
  } finally {
    backend.close();
  }
});

async function stompClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stomp`, ["v10.stomp", "v11.stomp", "v12.stomp"]);
  ws.binaryType = "arraybuffer";
  const frames = [];
  const waiters = [];
  const parse = createFrameParser((frame) => {
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else frames.push(frame);
  });
  ws.addEventListener("message", (event) => parse(Buffer.from(typeof event.data === "string" ? event.data : new Uint8Array(event.data))));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    ws,
    send: (command, headers, body) => ws.send(encodeFrame(command, headers, body)),
    next: () => (frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve) => waiters.push(resolve)))
  };
}

// Core-Backend #108: single cosmetics from the panel, of one build with Battle Royale, and only that build's.
test("the admin panel gives single cosmetics of the chosen build, and refuses what that build hasn't", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "OneCosmetic");
    const list = (query = "") => get(backend.port, `/admin/api/accounts/${player.accountId}/cosmetics${query}`);
    const give = (body) => post(backend.port, `/admin/api/accounts/${player.accountId}/cosmetics/grant`, undefined, body);

    // The builds with Battle Royale, the newest the default (no build a player last played is recorded).
    let listed = await list();
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.builds, [{ build: "3724489", version: "1.8" }, { build: "3729133", version: "1.8.1" }, { build: "3741772", version: "1.8.2" }, { build: "3757339", version: "1.9" }, { build: "3775276", version: "1.9.1" }, { build: "3790078", version: "1.10" }]);
    assert.deepEqual([listed.body.build, listed.body.version, listed.body.hasProfile], ["3790078", "1.10", false]);
    for (const bad of ["3700114", "3532353", "nope"]) {
      assert.equal((await list(`?build=${bad}`)).status, 400, bad);
      assert.equal((await give({ build: bad, templateIds: ["AthenaPickaxe:halloweenscythe"] })).status, 400, bad);
    }

    // Every locker cosmetic of the build, of every type, with its name, type and rarity; never the Recruit outfits or the
    // unused umbrellas.
    listed = await list("?build=3724489");
    const lockerIds = inBuild("3724489", () => Object.keys(athenaCosmetics()))
      .filter((id) => !/cid_00\d_athena_commando_\w_default|duo_umbrella|squad_umbrella/i.test(id));
    assert.deepEqual([listed.body.build, listed.body.total, listed.body.matches], ["3724489", lockerIds.length, lockerIds.length]);
    assert.deepEqual(listed.body.items.map((item) => item.templateId).sort(), [...lockerIds].sort());
    const byId = (body, templateId) => body.items.find((item) => item.templateId === templateId);
    assert.deepEqual(byId(listed.body, "AthenaPickaxe:halloweenscythe"),
      { templateId: "AthenaPickaxe:halloweenscythe", name: "Reaper", type: "Harvesting Tool", rarity: "Rare", rarityCode: "r", owned: false });
    assert.deepEqual(byId(listed.body, "AthenaCharacter:cid_029_athena_commando_f_halloween"),
      { templateId: "AthenaCharacter:cid_029_athena_commando_f_halloween", name: "Ghoul Trooper", type: "Outfit", rarity: "Epic", rarityCode: "vr", owned: false });
    for (const type of ["Outfit", "Harvesting Tool", "Glider", "Emote", "Loading Screen", "Battle Bus"]) assert.ok(listed.body.types.includes(type), type);
    const emotes = (await list("?build=3724489&type=Emote")).body.items;
    assert.ok(emotes.length && emotes.every((item) => item.type === "Emote"));
    assert.deepEqual((await list("?build=3724489&search=reaper")).body.items.map((item) => item.templateId), ["AthenaPickaxe:halloweenscythe"]);

    // Only from the panel's own page.
    const rebound = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: `/admin/api/accounts/${player.accountId}/cosmetics/grant`,
      headers: { Host: "attacker.example", "Content-Type": "application/json" } }, JSON.stringify({ templateIds: ["AthenaPickaxe:halloweenscythe"] }));
    assert.equal(rebound.status, 403);

    // A template the build hasn't, or one that's never a locker item, refuses the whole grant.
    const revision = async () => (await command(backend.port, player, "QueryProfile", "athena")).body.profileRevision;
    const beforeRvn = await revision();
    for (const templateIds of [["AthenaPickaxe:halloweenscythe", "AthenaCharacter:cid_999_athena_commando_f_notreal"],
      ["AthenaCharacter:cid_001_athena_commando_f_default"], ["AthenaGlider:duo_umbrella"], ["Hero:hid_commando_007_r_t01"], [], "x"]) {
      assert.equal((await give({ build: "3724489", templateIds })).status, 400, JSON.stringify(templateIds));
    }
    assert.match((await give({ build: "3729133", templateIds: ["AthenaCharacter:cid_999_athena_commando_f_notreal"] })).body.errorMessage, /^1\.8\.1 has no locker cosmetic/);
    assert.ok(!(await athena(backend.port, player)).items["AthenaPickaxe:halloweenscythe"]);
    assert.equal(await revision(), beforeRvn);

    // The player is online: the grant reaches their client as an athena notification at a new revision.
    const client = await stompClient(backend.port);
    try {
      client.send("CONNECT", { "accept-version": "1.2", login: player.accountId, passcode: player.token });
      await client.next();
      client.send("SUBSCRIBE", { id: "mcp-0-nil", destination: `/topic/fn/profile/${player.accountId}/fortnite`, receipt: "r" });
      await client.next();

      // Any spelling of the build's ids; each once.
      const given = await give({ build: "3724489", templateIds: ["athenapickaxe:HalloweenScythe", "AthenaGlider:glider_prismatic", "AthenaPickaxe:halloweenscythe"] });
      assert.equal(given.status, 200);
      assert.deepEqual(given.body.cosmeticGrant, { build: "3724489", version: "1.8", granted: ["AthenaPickaxe:halloweenscythe", "AthenaGlider:glider_prismatic"], alreadyOwned: [] });
      const notification = JSON.parse((await client.next()).body);
      assert.equal(notification.type, "profile/athena/update");
      assert.equal(notification.revision, beforeRvn + 1);
      assert.deepEqual(notification.changes.filter((change) => change.changeType === "itemAdded").map((change) => change.item.templateId).sort(),
        ["AthenaGlider:glider_prismatic", "AthenaPickaxe:halloweenscythe"]);
    } finally {
      client.ws.close();
    }
    const items = (await athena(backend.port, player)).items;
    assert.ok(items["AthenaPickaxe:halloweenscythe"] && items["AthenaGlider:glider_prismatic"]);
    assert.equal(await revision(), beforeRvn + 1);
    listed = await list("?build=3729133");
    assert.equal(listed.body.hasProfile, true);
    assert.equal(byId(listed.body, "AthenaGlider:glider_prismatic").owned, true);
    assert.equal(byId(listed.body, "AthenaCharacter:cid_029_athena_commando_f_halloween").owned, false);

    // An owned cosmetic is left as it is, and the answer says so; a grant of only owned ones changes nothing.
    const again = await give({ build: "3741772", templateIds: ["AthenaGlider:glider_prismatic", "AthenaCharacter:cid_029_athena_commando_f_halloween"] });
    assert.deepEqual(again.body.cosmeticGrant, { build: "3741772", version: "1.8.2", granted: ["AthenaCharacter:cid_029_athena_commando_f_halloween"],
      alreadyOwned: ["AthenaGlider:glider_prismatic"] });
    const rvn = await revision();
    const owned = await give({ build: "3724489", templateIds: ["AthenaGlider:glider_prismatic"] });
    assert.deepEqual([owned.body.cosmeticGrant.granted, owned.body.cosmeticGrant.alreadyOwned], [[], ["AthenaGlider:glider_prismatic"]]);
    assert.equal(await revision(), rvn);

    // They're the player's for good: the full locker's Remove granted keeps them.
    await post(backend.port, `/admin/api/accounts/${player.accountId}/locker/grant-all`, undefined, {});
    await post(backend.port, `/admin/api/accounts/${player.accountId}/locker/remove-granted`, undefined, {});
    const kept = (await athena(backend.port, player)).items;
    assert.ok(kept["AthenaPickaxe:halloweenscythe"] && kept["AthenaGlider:glider_prismatic"] && kept["AthenaCharacter:cid_029_athena_commando_f_halloween"]);
  } finally {
    backend.close();
  }
});
