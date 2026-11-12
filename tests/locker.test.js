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

// Core-Backend #84, #157: a win in solo, duo or squad gives The Umbrella and, to a founder (an account that owns Save the
// World, as every test account does with defaultFoundersAccess on), the Founder's Umbrella too, never the Duo or Squad Umbrella.
test("a win in a main playlist gives 1.8 founders The Umbrella and the Founder's Umbrella, and only a win does", async () => {
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
    assert.ok(items["AthenaGlider:founderumbrella"] && items["AthenaGlider:solo_umbrella"]);
    assert.ok(!items["AthenaGlider:squad_umbrella"] && !items["AthenaGlider:duo_umbrella"]);
    assert.ok(!(await athena(backend.port, second)).items["AthenaGlider:founderumbrella"]);
    assert.equal((await command(backend.port, winner, "EquipBattleRoyaleCustomization", "athena",
      { slotName: "Glider", itemToSlot: "AthenaGlider:founderumbrella" })).status, 200);

    // A recorded win from before (1.7.2's recordwin, in the stats), in duos too, gives both umbrellas when the athena
    // profile next loads.
    const veteran = await userLogin(backend.port, "Veteran172");
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordwin", dedicated, { playlistId: 10, accountIds: [veteran.accountId] });
    const veteranItems = (await athena(backend.port, veteran)).items;
    assert.ok(veteranItems["AthenaGlider:founderumbrella"] && veteranItems["AthenaGlider:solo_umbrella"]);
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
    assert.deepEqual(umbrellas.body.winners, [{ accountId: limited.accountId, umbrellaType: "founder_glider" },
      { accountId: veteran.accountId, umbrellaType: "founder_umbrella" }]);
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
  // Every cosmetic but the 8 random Recruit outfits (#77), the Duo and Squad Umbrellas (#84) and the GUN SHOW consumable
  // emote (#161).
  const { items: given } = session.profile("athena").profile;
  assert.equal(Object.keys(given).length, Object.keys(athenaCosmetics()).length - 11);
  assert.ok(!given["AthenaConsumableEmote:eid_gunshow"]);
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
  const session = openSession(createProfileStore(dataDir, { wonSeasons: () => [1] }), accountId);
  const { profile } = session.profile("athena");
  const held = Object.keys(profile.items).sort();
  assert.deepEqual(held, ["AthenaBattleBus:bbid_defaultbus", "AthenaDance:eid_dancemoves", "AthenaGlider:defaultglider",
    "AthenaGlider:founderglider", "AthenaGlider:glider_warthog", "AthenaGlider:solo_umbrella",
    "AthenaLoadingScreen:lsid_defaultbg", "AthenaPickaxe:defaultpickaxe"]);
  // Slots holding a removed item go back to their default; the others stay.
  const { attributes } = profile.stats;
  assert.deepEqual([attributes.favorite_glider, attributes.favorite_pickaxe, attributes.favorite_character, attributes.favorite_dance,
    attributes.favorite_victorypose], ["AthenaGlider:defaultglider", "AthenaPickaxe:defaultpickaxe", "", "AthenaDance:eid_dancemoves", ""]);
  // Once: the next load changes nothing.
  const rvn = profile.rvn;
  assert.equal(openSession(createProfileStore(dataDir, { wonSeasons: () => [1] }), accountId).profile("athena").profile.rvn, rvn);
})));

// Core-Backend #84: lockers given the Duo or Squad Umbrella (a duo or squad win before #84, or giveAllCosmetics) lose
// them, once; a glider slot holding one goes back to the default glider.
test("lockers lose the Duo and Squad Umbrellas, and a glider slot holding one gets the default glider", () => withStore((dataDir) => inBuild("3724489", () => {
  const accountId = "duowinner";
  const store = () => createProfileStore(dataDir, { wonSeasons: (id) => (id === accountId ? [1] : []) });
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
  assert.ok(items["AthenaGlider:solo_umbrella"] && !items["AthenaGlider:founderumbrella"]);
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
    // The full locker gives every build's cosmetics: the newest build's are all of them but the Winter Bus, which 3.5.1's paks
    // drop, Smooth Ride, which 3.6's drop, and Ride the Lightning, which 4.0's drop (1.8.2 adds Aerial Assault One,
    // 1.10 the Winter Bus, 1.11 Season 2's, 2.2 two emoticons, 2.4.2 Alpine Ace and its flags, 2.5 the Valentine's and Lunar New Year ones,
    // 3.0 Season 3's, 3.1 Rex, Burnout and the rest, 3.2 Power Chord and the rest, 3.3 none, 3.5.1 3.4's and 3.5's: Raven,
    // Rabbit Raider, Leviathan and the rest (not the locker's Random entries, CoreV2 #306), 3.6 Steelsight, Brite Gunner and the rest, 4.0
    // Season 4's, its sprays and loading screens, 4.1 the Snap emote, 4.2 the Hazard set, Venturion and the rest, 4.4 4.3's
    // and 4.4's: Jumpshot, Scoundrel, the World Cup outfits, Omen, Fate and the rest, 4.5 Vertex, Gumshoe, Criterion, Oblivion
    // and the rest; 4.5 drops 4.4's Pinwheel, which stays; 5.0 Season 5's: Drift, Huntress, Ragnarok, the toys and the rest;
    // 5.10 Reef Ranger, the Birthday's and the rest; 5.21 Beef Boss, Overtaker, Sushi Master, the P.A.N.D.A Team Leader and the rest;
    // 5.30 Musha and Hime, Ravage, Backbone and Chopper and the rest; 5.40 Wild Card, Field Surgeon, Hacivat, Stage Slayer and the rest;
    // 5.41 Valkyrie, Nite Nite, Grill Sergeant and the rest; 6.00 Season 6's: DJ Yonder, Calamity, Dire, the pets, the music
    // (not MusicPack_000_Default, the empty slot's) and the rest, and drops 5.41's Purple Bus and Birthday emoticon, which stay;
    // 6.01 Maximilian, Hay Man, Straw Ops and the rest, and drops the Birthday Bus, which stays; 6.02 Dark Bomber, Skull
    // Ranger, Plague, Scourge, Hollowhead and the rest).
    const lockerIds = [...new Set([...inBuild("4132537", () => Object.keys(athenaCosmetics())), ...inBuild("4166199", () => Object.keys(athenaCosmetics())),
      ...inBuild("4363240", () => Object.keys(athenaCosmetics())), ...inBuild("4402180", () => Object.keys(athenaCosmetics())),
      ...inBuild("4424678", () => Object.keys(athenaCosmetics())), ...inBuild("4461277", () => Object.keys(athenaCosmetics()))]),
      "AthenaBattleBus:bbid_winterbus", "AthenaDance:eid_smoothride",
      "AthenaSkyDiveContrail:trails_id_008_ridethelightning"]
      .filter((id) => !/cid_00\d_athena_commando_\w_default|duo_umbrella|squad_umbrella|eid_gunshow|emoji_placeholder|musicpack_000_default|^athena[a-z]+:[a-z]+_random$/i.test(id));
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
      [...starters, "AthenaGlider:founderumbrella", "AthenaGlider:solo_umbrella"].sort());
    assert.equal(after.stats.attributes.favorite_glider, "AthenaGlider:defaultglider");
    assert.equal(after.stats.attributes.banner_icon, "StandardBanner1");
    assert.ok(!Object.values((await account()).items).some((item) => item.templateId === icon));
    assert.deepEqual((await admin("remove-granted")).body.removed, { cosmetics: 0, banners: 0 });
  } finally {
    backend.close();
  }
});

test("what giveAllCosmetics gave stays once the panel gives the full locker", () => withStore((dataDir) => inBuild("4039451", () => {
  const locker = (settings) => openSession(createProfileStore(dataDir, settings), "blanketlocker");
  let session = locker({ giveAllCosmetics: true });
  const total = Object.keys(session.profile("athena").profile.items).length;
  const held = Object.values(session.profile("profile0").profile.items).filter((item) => /^HomebaseBanner/.test(item.templateId)).length;
  // giveAllCosmetics gave 4.0's; the full locker adds the 215 cosmetics it lacks, the Winter Bus (1.11 to 3.3), Smooth
  // Ride (to 3.5.2), Ride the Lightning (to 3.6), 4.1's Snap emote, 4.2's eighteen, 4.4's fifty-six, 4.5's thirty-three and
  // 5.0's hundred and four (its toys too), 5.10's twenty-five, 5.21's thirty, 5.30's forty-seven, 5.40's twenty-nine (not its Random bus), 5.41's seven,
  // 6.00's hundred and seven (not its default or Random music), 6.01's eleven, 6.02's twenty, and every banner, 5.0's
  // twenty-two Season 5 icons too, and 6.00's Season 6 ones (6.01 and 6.02 add none).
  assert.deepEqual(grantFullLocker(session), { cosmetics: 491, banners: inBuild("4461277", bannerIds).length - held });
  session.commit();
  for (const profileId of ["athena", "profile0"]) createProfileStore(dataDir).save(session.profile(profileId).profile);

  session = locker({});
  assert.equal(Object.keys(session.profile("athena").profile.items).length, total + 491);
  assert.equal(removeFullLocker(session).cosmetics, total + 491 - 6);
})));

// Core-Backend #161: the full locker gave Cert's EID_GunShow, a consumable emote no one was given, which 1.11's emote
// wheel showed as "GUN SHOW (x1)", and 1.11's Emoji_Placeholder. Neither is a locker item: the full locker leaves them
// out, a locker that holds one loses it, and Remove granted takes it.
test("the full locker leaves out the GUN SHOW consumable emote and the placeholder emoticon, and lockers lose them", () => withStore((dataDir) => inBuild("3807424", () => {
  const unreleased = ["AthenaConsumableEmote:eid_gunshow", "AthenaDance:emoji_placeholder"];
  for (const id of unreleased) assert.ok(athenaCosmetics()[id], id);
  // Every other 1.11 and 2.1 cosmetic is a cosmetic of a locker type with a name.
  for (const build of ["3807424", "3825894"]) {
    for (const [id, cosmetic] of inBuild(build, () => Object.entries(athenaCosmetics()))) {
      if (unreleased.includes(id) || !cosmetic.class) continue;
      assert.ok(cosmetic.class !== "AthenaConsumableEmoteItemDefinition" && !/placeholder/i.test(cosmetic.name), id);
    }
  }

  const locker = () => openSession(createProfileStore(dataDir), "gunshow");
  let session = locker();
  grantFullLocker(session);
  let { items } = session.profile("athena").profile;
  for (const id of unreleased) assert.ok(!items[id], id);
  assert.ok(items["AthenaDance:eid_flex"], "1.11's own Gun Show emote stays");
  assert.equal(grantCosmetic(session, "AthenaConsumableEmote:eid_gunshow"), null);

  // An account the full locker gave them before: equipped, and in the panel's list to take back.
  const tracker = session.profile("athena");
  for (const id of unreleased) tracker.addItem(id, { templateId: id, attributes: { level: 1, item_seen: 1, favorite: 0 }, quantity: 1 });
  tracker.setStat("favorite_consumableemote", "AthenaConsumableEmote:eid_gunshow");
  tracker.profile.coreGrantedCosmetics.push(...unreleased);
  const held = Object.keys(tracker.profile.items).length;
  assert.equal(removeFullLocker(session).cosmetics, held - 6);
  ({ items } = session.profile("athena").profile);
  for (const id of unreleased) assert.ok(!items[id], id);
  assert.equal(session.profile("athena").profile.stats.attributes.favorite_consumableemote, "");
  session.commit();

  // Held without the panel's list (giveAllCosmetics, or given by id): gone the next time the profile loads.
  session = locker();
  session.profile("athena").addItem(unreleased[0], { templateId: unreleased[0], attributes: { level: 1, item_seen: 1, favorite: 0 }, quantity: 1 });
  session.commit();
  createProfileStore(dataDir).save(session.profile("athena").profile);
  assert.ok(!locker().profile("athena").profile.items[unreleased[0]]);
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
    assert.deepEqual(set.body.battleRoyale, { level: 30, xp: 0, maxLevel: set.body.battleRoyale.maxLevel, season: 1,
      battlePasses: [{ season: 2, tier: 1, purchased: false, paid: 0 }, { season: 3, tier: 1, purchased: false, paid: 0 },
        { season: 4, tier: 1, purchased: false, paid: 0 }, { season: 5, tier: 1, purchased: false, paid: 0 },
        { season: 6, tier: 1, purchased: false, paid: 0 }] });
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
    assert.deepEqual(listed.body.builds, [{ build: "3724489", version: "1.8" }, { build: "3729133", version: "1.8.1" }, { build: "3741772", version: "1.8.2" }, { build: "3757339", version: "1.9" }, { build: "3775276", version: "1.9.1" }, { build: "3790078", version: "1.10" }, { build: "3807424", version: "1.11" }, { build: "3825894", version: "2.1" }, { build: "3841827", version: "2.2" }, { build: "3847564", version: "2.3" }, { build: "3858292", version: "2.4" }, { build: "3870737", version: "2.4.2" }, { build: "3889387", version: "2.5" }, { build: "3901517", version: "3.0" }, { build: "3915963", version: "3.1" }, { build: "3917250", version: "3.1.1" }, { build: "3935073", version: "3.2" }, { build: "3942182", version: "3.3" }, { build: "4000805", version: "3.5.1" }, { build: "4008490", version: "3.5.2" }, { build: "4019403", version: "3.6" }, { build: "4039451", version: "4.0" }, { build: "4053532", version: "4.1" }, { build: "4072250", version: "4.2" }, { build: "4117433", version: "4.4.0" }, { build: "4127312", version: "4.4.1" }, { build: "4132537", version: "4.4.2" }, { build: "4159770", version: "4.5.0" }, { build: "4166199", version: "4.5" }, { build: "4204761", version: "5.0.0" }, { build: "4214610", version: "5.0" }, { build: "4225813", version: "5.10.0" }, { build: "4240749", version: "5.10" }, { build: "4288479", version: "5.21" }, { build: "4305896", version: "5.30" }, { build: "4352937", version: "5.40" }, { build: "4363240", version: "5.41" }, { build: "4395664", version: "6.00.0" }, { build: "4402180", version: "6.00" }, { build: "4417689", version: "6.01.0" }, { build: "4424678", version: "6.01" }, { build: "4442095", version: "6.02.0" }, { build: "4461277", version: "6.02" }]);
    assert.deepEqual([listed.body.build, listed.body.version, listed.body.hasProfile], ["4461277", "6.02", false]);
    for (const bad of ["3700114", "3532353", "nope"]) {
      assert.equal((await list(`?build=${bad}`)).status, 400, bad);
      assert.equal((await give({ build: bad, templateIds: ["AthenaPickaxe:halloweenscythe"] })).status, 400, bad);
    }

    // Every locker cosmetic of the build, of every type, with its name, type and rarity; never the Recruit outfits or the
    // unused umbrellas.
    listed = await list("?build=3724489");
    const lockerIds = inBuild("3724489", () => Object.keys(athenaCosmetics()))
      .filter((id) => !/cid_00\d_athena_commando_\w_default|duo_umbrella|squad_umbrella|eid_gunshow|emoji_placeholder|musicpack_000_default|^athena[a-z]+:[a-z]+_random$/i.test(id));
    assert.deepEqual([listed.body.build, listed.body.total, listed.body.matches], ["3724489", lockerIds.length, lockerIds.length]);
    assert.deepEqual(listed.body.items.map((item) => item.templateId).sort(), [...lockerIds].sort());
    const byId = (body, templateId) => body.items.find((item) => item.templateId === templateId);
    assert.deepEqual(byId(listed.body, "AthenaPickaxe:halloweenscythe"),
      { templateId: "AthenaPickaxe:halloweenscythe", name: "Reaper", type: "Harvesting Tool", rarity: "Rare", rarityCode: "r", owned: false, hasStyles: false });
    assert.deepEqual(byId(listed.body, "AthenaCharacter:cid_029_athena_commando_f_halloween"),
      { templateId: "AthenaCharacter:cid_029_athena_commando_f_halloween", name: "Ghoul Trooper", type: "Outfit", rarity: "Epic", rarityCode: "vr", owned: false, hasStyles: false });
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

// Core-Backend #84: 1.8's locker. An account without Save the World starts with the Glider only and wins The Umbrella;
// one that owns it (a founder's pack) also starts with the Founder's Glider and wins the Founder's Umbrella too (#157).
test("1.8 gives the Founder's Glider and Umbrella only to accounts that own Save the World", async () => {
  const backend = await startBackend({ defaultFoundersAccess: false });
  try {
    const player = await userLogin(backend.port, "NoStw18");
    const founder = await userLogin(backend.port, "Stw18");
    assert.equal((await post(backend.port, `/admin/api/accounts/${founder.accountId}/founders`, undefined, { edition: 1 })).status, 200);
    const playerItems = (await athena(backend.port, player)).items;
    assert.ok(playerItems["AthenaGlider:defaultglider"] && !playerItems["AthenaGlider:founderglider"]);
    const founderItems = (await athena(backend.port, founder)).items;
    assert.ok(founderItems["AthenaGlider:defaultglider"] && founderItems["AthenaGlider:founderglider"]);

    const dedicated = await dedicatedServerToken(backend.port);
    await post(backend.port, "/fortnite/api/game/v2/battleroyale/recordresults", dedicated, { playlistId: 2, results: [
      { accountId: player.accountId, place: 1, kills: 1, secondsAlive: 600 },
      { accountId: founder.accountId, place: 1, kills: 1, secondsAlive: 600 }] });
    const won = (await athena(backend.port, player)).items;
    assert.ok(won["AthenaGlider:solo_umbrella"] && !won["AthenaGlider:founderumbrella"] && !won["AthenaGlider:founderglider"]);
    const founderWon = (await athena(backend.port, founder)).items;
    assert.ok(founderWon["AthenaGlider:founderumbrella"] && founderWon["AthenaGlider:solo_umbrella"]);
  } finally {
    backend.close();
  }
});