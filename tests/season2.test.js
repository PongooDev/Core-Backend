import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { battlePassOfferId, tierOfferId } from "../src/battlepass/season2.js";
import { athenaCosmetics, athenaDisplayAssets, athenaSeason } from "../src/gamedata/athena.js";
import { storefronts } from "../src/store/catalog.js";
import { itemShopOffers, seasonEnd, seasonStart, shopDay, weeklyStoreEnd } from "../src/store/itemshop.js";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #145: 1.11 (CL-3807424) is Season 2, with its own season level, a Battle Pass, the winter lobby, six
// emote slots and the item shop's display assets.
const v111 = "3807424";
const v110 = "3790078";
const agents = {
  [v111]: "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3807424",
  [v110]: "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3790078"
};

function as(build, port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agents[build], Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}
const command = (port, { accountId, token }, name, profileId, body = {}, build = v111) =>
  as(build, port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`, token, body);
const updateOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);
const profileOf = async (port, player, profileId, build = v111) =>
  updateOf((await command(port, player, "QueryProfile", profileId, {}, build)).body, profileId).profileChanges[0].profile;
const vbucks = (profile) => Object.values(profile.items).filter((item) => /^currency:mtx/i.test(item.templateId)).reduce((sum, item) => sum + item.quantity, 0);
const holds = (profile, templateId) => Object.values(profile.items).some((item) => item.templateId.toLowerCase() === templateId.toLowerCase());
const admin = (port, urlPath, body) => (body === undefined ? get(port, `/admin/api${urlPath}`) : post(port, `/admin/api${urlPath}`, undefined, body));

async function withPlayer(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-season2-test-"));
  const backend = await startBackend({ dataDir });
  try {
    const player = await userLogin(backend.port, "season2");
    await run(backend, player, dataDir);
  } finally {
    await backend.close();
  }
}

test("1.11's game data has Season 2's Battle Pass, its emoticons and its shop display assets", () => inBuild(v111, () => {
  const season = athenaSeason();
  assert.equal(season.seasonNumber, 2);
  assert.equal(season.numSeasonLevels, 100);
  assert.equal(season.numBookLevels, 70);
  assert.equal(season.storefront, "BRSeason2");
  assert.ok(season.bookLevels.every(({ xpToNextLevel }) => xpToNextLevel === 10));
  const paid = (tier) => season.bookPaidRewards.find(({ level }) => level === tier).rewards.map(({ templateId }) => templateId);
  const free = (tier) => season.bookFreeRewards.find(({ level }) => level === tier).rewards.map(({ templateId }) => templateId);
  // Blue Squire at tier 1 with the boosts and the challenges' trigger, Black Knight at 70; the free pass's first reward is
  // the LOL emoticon at tier 2.
  assert.deepEqual(paid(1), ["Token:athenaseasonxpboost", "Token:athenaseasonfriendxpboost", "AthenaCharacter:cid_032_athena_commando_m_medieval",
    "Quest:athena_battlepass_questtrigger"]);
  assert.deepEqual(paid(70), ["AthenaCharacter:cid_035_athena_commando_m_medieval"]);
  assert.deepEqual(free(2), ["AthenaDance:emoji_lol"]);
  assert.equal(season.seasonRewards.find(({ level }) => level === 5).rewards[0].quantity, 5);
  assert.equal(athenaCosmetics()["AthenaDance:emoji_lol"].class, "AthenaEmojiItemDefinition");

  const asset = (templateId) => athenaDisplayAssets()[templateId]?.split(".").pop();
  assert.equal(asset("AthenaPickaxe:pickaxe_id_011_medieval"), "DA_Featured_Pickaxe_ID_11_Medieval");
  assert.equal(asset("AthenaPickaxe:pickaxe_id_019_heart"), "DA_Featured_Pickaxe_ID_19_Heart");
  assert.equal(asset("AthenaPickaxe:pickaxe_id_020_keg"), "DA_Featured_Pickaxe_ID_20_Keg");
  assert.equal(asset("AthenaCharacter:cid_050_athena_commando_m_holidaynutcracker"), "DA_Featured_SMaleHID050");
  assert.equal(asset("AthenaCharacter:cid_024_athena_commando_f"), "DA_Featured_SFemaleHID024");
  // DA_Featured_PickaxeCliffhanger is SkiIcePickaxe's, "Cliffhanger" (by its type and display name).
  assert.equal(asset("AthenaPickaxe:skiicepickaxe"), "DA_Featured_PickaxeCliffhanger");
}));

test("1.10 has no Battle Pass, and keeps its display assets", () => inBuild(v110, () => {
  assert.equal(athenaSeason(), undefined);
  assert.equal(athenaDisplayAssets()["AthenaPickaxe:pickaxe_id_011_medieval"], undefined);
}));

test("1.11's item shop gives its daily offers their display assets; 1.10's daily tiles keep the locker icon", () => {
  const config = { mode: "custom", custom: { featured: [], daily: [["AthenaCharacter:cid_024_athena_commando_f", 1200]] } };
  const daily = (build) => inBuild(build, () => itemShopOffers(new Date(), config).BRDailyStorefront[0].displayAssetPath);
  assert.equal(daily(v111), "/Game/Catalog/DisplayAssets/DA_Featured_SFemaleHID024.DA_Featured_SFemaleHID024");
  assert.equal(daily(v110), "");
});

// Core-Backend #150: 1.11 replays Season 2's own shop, 14 December 2017 to 21 February 2018, in a 70-day cycle; 1.10
// keeps Season 1's.
test("1.11's item shop replays Season 2's, from 14 December 2017 in a 70-day cycle; 1.10 keeps Season 1's", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season2.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  history.forEach(({ date }, n) => assert.equal(date, new Date(Date.UTC(2017, 11, 14 + n)).toISOString().slice(0, 10)));
  inBuild(v111, () => {
    const cosmetics = athenaCosmetics();
    for (const { featured, daily } of history) for (const [templateId, price] of [...featured, ...daily]) assert.ok(cosmetics[templateId] && price > 0, templateId);
  });

  // Season 2 started on its real first day (the anchor's own tests are below).
  const s2 = { mode: "fnbr", seasonStarts: { 2: "2017-12-14" } };
  const day = (iso, build) => inBuild(build, () => shopDay(new Date(iso), s2).date);
  assert.equal(day("2017-12-14T00:00:00Z", v111), "2017-12-14");
  assert.equal(day("2018-02-21T23:59:59Z", v111), "2018-02-21");
  assert.equal(day("2018-02-22T00:00:00Z", v111), "2017-12-14");
  assert.equal(day("2026-11-02T12:00:00Z", v111), "2018-01-08");
  assert.equal(day("2026-11-02T12:00:00Z", v110), "2017-11-04");

  // Christmas Eve 2017: Crackshot and Candy Axe featured, at their 2017 prices.
  const offers = (iso, build) => inBuild(build, () => itemShopOffers(new Date(iso), s2));
  const christmas = offers("2017-12-24T12:00:00Z", v111);
  assert.deepEqual(christmas.BRWeeklyStorefront.map(({ templateId, price }) => [templateId, price]),
    [["AthenaCharacter:cid_050_athena_commando_m_holidaynutcracker", 2000], ["AthenaPickaxe:pickaxe_id_015_holidaycandycane", 1500]]);
  assert.equal(christmas.BRDailyStorefront.length, 4);
  assert.ok(!offers("2017-12-24T12:00:00Z", v110).BRWeeklyStorefront.some(({ templateId }) => templateId.includes("holidaynutcracker")));
  // Brite Bomber was 1,200 in Season 2 (fnbr.co shows today's 1,800).
  assert.deepEqual(offers("2017-12-15T12:00:00Z", v111).BRDailyStorefront.find(({ title }) => title === "Brite Bomber")?.price, 1200);

  // The featured pair changes on 17, 24 and 31 December, and the countdowns agree with the build's season.
  const weekly = (iso, build) => inBuild(build, () => weeklyStoreEnd(new Date(iso), s2).toISOString());
  assert.equal(weekly("2017-12-17T12:00:00Z", v111), "2017-12-24T00:00:00.000Z");
  assert.equal(weekly("2017-12-24T12:00:00Z", v111), "2017-12-31T00:00:00.000Z");
  assert.equal(inBuild(v111, () => seasonEnd(new Date("2017-12-24T12:00:00Z"), s2).toISOString()), "2018-02-22T00:00:00.000Z");
  for (let n = 0; n < 140; n++) {
    const now = new Date(Date.UTC(2026, 0, 1 + n, 12));
    inBuild(v111, () => assert.ok(weeklyStoreEnd(now, s2) > now && weeklyStoreEnd(now, s2) <= seasonEnd(now, s2), String(n)));
  }
});

// Core-Backend #150 (follow-up): Season 2 starts on its first shop, 14 December 2017's, the day the backend first serves
// it, kept in the settings; an admin can set or reset each season's start. Season 1 keeps its clock.
test("Season 2 starts on 14 December's shop the day it is first served, keeps that start, and an admin can move it", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-season2-start-"));
  const dayMs = 86400000;
  const today = () => new Date(Math.floor(Date.now() / dayMs) * dayMs).toISOString().slice(0, 10);
  const settingsOf = () => JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")).events.seasonStarts;
  let backend = await startBackend({ dataDir });
  try {
    const player = await userLogin(backend.port, "seasonstart");
    // The admin panel shows Season 2 as starting today, without starting it.
    const overview = await admin(backend.port, "/events/overview");
    assert.deepEqual([overview.body.calendar.seasons[2].start, overview.body.calendar.seasons[2].started, overview.body.calendar.seasons[2].shopDay], [today(), false, "2017-12-14"]);
    assert.equal(overview.body.calendar.seasons[1].shopDay, inBuild(v110, () => shopDay(new Date(), { mode: "fnbr" })).date);
    assert.equal((await admin(backend.port, "/battlepass/overview?season=2")).body.seasonEnd, new Date(Date.parse(`${today()}T00:00:00Z`) + 70 * dayMs).toISOString());
    assert.equal(settingsOf()[2], null);

    // 1.11's first calendar starts it: day 1 is today, 14 December's shop, and the countdown is the full 70 days.
    const calendar = await as(v111, backend.port, "GET", "/fortnite/api/calendar/v1/timeline", player.token);
    const state = calendar.body.channels["client-events"].states[0].state;
    assert.equal(settingsOf()[2], today());
    assert.equal(state.seasonEnd, new Date(Date.parse(`${today()}T00:00:00Z`) + 70 * dayMs).toISOString());
    inBuild(v111, () => {
      const offers = itemShopOffers(new Date());
      assert.deepEqual(offers.BRWeeklyStorefront.map(({ templateId }) => templateId), ["AthenaGlider:glider_prismatic", "AthenaCharacter:cid_020_athena_commando_m"]);
      assert.equal(shopDay(new Date(Date.now() + 10 * dayMs)).date, "2017-12-24");
      assert.equal(shopDay(new Date(Date.now() + 70 * dayMs)).date, "2017-12-14");
      // The Event Store's weekly rotation and the Battle Pass countdown run on the same clock.
      assert.equal(state.weeklyStoreEnd, weeklyStoreEnd(new Date()).toISOString());
      assert.equal(weeklyStoreEnd(new Date()).toISOString(), new Date(Date.parse(`${today()}T00:00:00Z`) + dayMs).toISOString());
    });
    // Season 1 keeps its clock and has no start recorded.
    assert.equal(settingsOf()[1], null);
    assert.equal(inBuild(v110, () => shopDay(new Date("2026-11-02T12:00:00Z")).date), "2017-11-04");

    // It persists across a restart.
    await backend.close();
    backend = await startBackend({ dataDir });
    assert.equal(inBuild(v111, () => seasonStart()), Date.parse(`${today()}T00:00:00Z`));

    // An admin sets each season's start, next to the custom season end, which still overrides the countdown.
    assert.equal((await admin(backend.port, "/events/config", { seasonStarts: { 1: "2026-10-01", 2: "2026-10-01" } })).status, 200);
    assert.deepEqual(settingsOf(), { 1: "2026-10-01", 2: "2026-10-01" });
    assert.equal(inBuild(v111, () => shopDay(new Date("2026-10-11T12:00:00Z")).date), "2017-12-24");
    assert.equal(inBuild(v110, () => shopDay(new Date("2026-10-11T12:00:00Z")).date), "2017-11-09");
    assert.equal(inBuild(v111, () => seasonEnd(new Date("2026-10-11T12:00:00Z")).toISOString()), "2026-12-10T00:00:00.000Z");
    await admin(backend.port, "/events/config", { customSeasonEnd: "2029-01-01T00:00:00Z" });
    assert.equal(inBuild(v111, () => seasonEnd(new Date()).toISOString()), "2029-01-01T00:00:00.000Z");
    await admin(backend.port, "/events/config", { customSeasonEnd: null });

    // Resetting Season 2 starts it again the next day it is served; resetting Season 1 gives back its clock.
    await admin(backend.port, "/events/config", { seasonStarts: { 1: null, 2: null } });
    assert.deepEqual(settingsOf(), { 1: null, 2: null });
    assert.equal(inBuild(v110, () => shopDay(new Date("2026-11-02T12:00:00Z")).date), "2017-11-04");
    assert.equal(inBuild(v111, () => shopDay(new Date()).date), "2017-12-14");
    assert.equal(settingsOf()[2], today());
  } finally {
    await backend.close();
  }
});

test("1.11's catalog sells the Battle Pass, the bundle and tiers in BRSeason2; an owned pass leaves it", () => {
  const front = (build, athena) => inBuild(build, () => storefronts(undefined, new Date(), { athena }).find(({ name }) => name === "BRSeason2"));
  const season = front(v111);
  const [pass, bundle, tier] = season.catalogEntries;
  assert.equal(pass.title, "Battle Pass");
  assert.equal(pass.offerId, "C3BA14F04F4D56FC1D490F8011B56553");
  assert.equal(pass.devName, "BR.Season2.BattlePass.01");
  assert.equal(pass.prices[0].finalPrice, 950);
  // Core-Backend #156: Epic's purchase screen, its texts and the struck-through 1,800.
  assert.equal(pass.shortDescription, "Season 2");
  assert.ok(pass.description.startsWith("Season 2: Dec 14 - Feb 20\r\n\r\nInstantly get these items valued at over 2000 V-Bucks.\r\n  • Blue Squire Outfit"));
  assert.ok(pass.description.includes("  • Extra Battle Pass Daily Challenge\r\n"));
  assert.ok(pass.description.endsWith("  • 13 2D Emotes\r\n  • and more!"));
  assert.deepEqual([pass.prices[0].regularPrice, pass.prices[0].saleType], [1800, "PercentOff"]);
  assert.equal(bundle.title, "Battle Bundle");
  assert.equal(bundle.shortDescription, "Battle pass + 25 tiers!");
  assert.ok(bundle.description.includes("  • Royale Knight Outfit"));
  assert.deepEqual([bundle.prices[0].regularPrice, bundle.prices[0].saleType], [2800, "NotOnSale"]);
  assert.deepEqual([tier.title, tier.description], ["Battle Pass Level", "Get great rewards now!"]);
  assert.equal(pass.displayAssetPath, "/Game/Catalog/DisplayAssets/DA_BR_Season2_BattlePass.DA_BR_Season2_BattlePass");
  assert.deepEqual(pass.itemGrants, []);
  assert.equal(bundle.prices[0].finalPrice, 2800);
  assert.equal(tier.offerId, tierOfferId);
  assert.equal(tier.prices[0].finalPrice, 150);
  const owned = front(v111, { stats: { attributes: { book_purchased: true } } });
  assert.deepEqual(owned.catalogEntries.map(({ offerId }) => offerId), [tierOfferId]);
  assert.equal(front(v110), undefined);
});

test("1.11's calendar names Season 2 and turns the winter lobby on; 1.10's doesn't", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-season2-calendar-"));
  const backend = await startBackend({ dataDir });
  try {
    const player = await userLogin(backend.port, "calendar2");
    const calendar = async (build) => (await as(build, backend.port, "GET", "/fortnite/api/calendar/v1/timeline", player.token)).body.channels["client-events"].states[0];
    const winter = await calendar(v111);
    assert.equal(winter.state.seasonNumber, 2);
    assert.equal(winter.state.seasonTemplateId, "AthenaSeason:athenaseason2");
    const now = new Date(Date.parse((await as(v111, backend.port, "GET", "/fortnite/api/calendar/v1/timeline", player.token)).body.currentTime));
    assert.equal(winter.state.seasonEnd, seasonEnd(now, null, 2).toISOString());
    assert.ok(winter.state.activeEventFlags.includes("EventFlag.LobbyWinterDecor"));
    assert.ok(winter.activeEvents.some(({ eventType }) => eventType === "EventFlag.LobbyWinterDecor"));
    const autumn = await calendar(v110);
    assert.equal(autumn.state.seasonNumber, undefined);
    assert.ok(!autumn.state.activeEventFlags.includes("EventFlag.LobbyWinterDecor"));
  } finally {
    await backend.close();
  }
});

test("Season 2 starts at level 1 and keeps Season 1's level in past_seasons; 1.10 still shows Season 1's", () => withPlayer(async (backend, player) => {
  await profileOf(backend.port, player, "athena", v110);
  assert.equal((await admin(backend.port, `/accounts/${player.accountId}/battle-royale-level`, { level: 23 })).status, 200);
  assert.equal((await profileOf(backend.port, player, "athena", v110)).stats.attributes.level, 23);

  const seasonTwo = (await profileOf(backend.port, player, "athena")).stats.attributes;
  assert.equal(seasonTwo.season_num, 2);
  assert.equal(seasonTwo.level, 1);
  assert.equal(seasonTwo.xp, 0);
  assert.equal(seasonTwo.book_level, 1);
  assert.equal(seasonTwo.book_xp, 0);
  assert.equal(seasonTwo.book_purchased, false);
  assert.equal(seasonTwo.accountLevel, 24);
  assert.equal(seasonTwo.past_seasons.length, 1);
  assert.equal(seasonTwo.past_seasons[0].seasonNumber, 1);
  assert.equal(seasonTwo.past_seasons[0].seasonLevel, 23);
  assert.equal(seasonTwo.past_seasons[0].purchasedVIP, false);

  // The admin panel sets the level of the season the profile is in, with Season 2's 100 levels and their Battle Stars.
  const set = await admin(backend.port, `/accounts/${player.accountId}/battle-royale-level`, { level: 12 });
  assert.equal(set.status, 200);
  assert.equal(set.body.battleRoyale.season, 2);
  assert.equal(set.body.battleRoyale.maxLevel, 100);
  const levelled = (await profileOf(backend.port, player, "athena")).stats.attributes;
  assert.equal(levelled.level, 12);
  // Levels 2 to 12: a Battle Star each, but 5 at level 5 and 10 at level 10 (SeasonXpScheduleFree), 24 in all: tier 3 and 4 stars.
  assert.equal(levelled.book_level, 3);
  assert.equal(levelled.book_xp, 4);

  const seasonOne = (await profileOf(backend.port, player, "athena", v110)).stats.attributes;
  assert.equal(seasonOne.level, 23);
  // 1.10 compares season_num with its calendar's SeasonNumber, which it isn't sent: Season 1's profile has none (#152).
  assert.equal(seasonOne.season_num, undefined);
  assert.equal((await profileOf(backend.port, player, "athena")).stats.attributes.level, 12);
}));

// Core-Backend #152: 1.10's level getters give level 1 and no XP when the profile's season_num isn't its calendar's
// SeasonNumber (none), so Season 1's profile holds no season_num, past_seasons or Battle Pass stats.
const seasonOneOnly = (attributes) => ["season_num", "past_seasons", "book_level", "book_xp", "book_purchased",
  "season_match_boost", "season_friend_match_boost"].filter((name) => Object.hasOwn(attributes, name));
const report = (backend, token, build, accountId, place) => as(build, backend.port, "POST", "/fortnite/api/game/v2/battleroyale/recordresults", token,
  { playlistId: 2, matchId: `season-${build}-${Math.random().toString(16).slice(2, 10)}`, countWins: true,
    results: [{ accountId, place, kills: 5, secondsAlive: 1200 }] });

test("switching between 1.10 and 1.11 keeps each season's own level, and each match's XP goes to its build's season", () => withPlayer(async (backend, player) => {
  const dedicated = await dedicatedServerToken(backend.port);
  const levelOf = async (build) => (await profileOf(backend.port, player, "athena", build)).stats.attributes;
  await levelOf(v110);
  for (let match = 0; match < 3; match++) await report(backend, dedicated, v110, player.accountId, 1);
  const seasonOne = await levelOf(v110);
  assert.ok(seasonOne.level > 1);
  assert.deepEqual(seasonOneOnly(seasonOne), []);

  let seasonTwo = await levelOf(v111);
  assert.equal(seasonTwo.level, 1);
  await report(backend, dedicated, v111, player.accountId, 1);
  seasonTwo = await levelOf(v111);
  assert.ok(seasonTwo.level > 1);
  assert.equal(seasonTwo.past_seasons[0].seasonLevel, seasonOne.level);

  for (let round = 0; round < 3; round++) {
    const one = await levelOf(v110);
    assert.equal(one.level, seasonOne.level);
    assert.equal(one.xp, seasonOne.xp);
    assert.equal(one.accountLevel, seasonOne.level);
    assert.deepEqual(seasonOneOnly(one), []);
    const two = await levelOf(v111);
    assert.equal(two.season_num, 2);
    assert.equal(two.level, seasonTwo.level);
    assert.equal(two.xp, seasonTwo.xp);
    assert.equal(two.accountLevel, seasonTwo.level + seasonOne.level);
  }

  // A 1.10 match reported while the profile is in Season 2 (1.11's lobby opened it last) counts in Season 1, and the
  // other way round.
  await report(backend, dedicated, v110, player.accountId, 1);
  const moreOne = await levelOf(v110);
  assert.ok(moreOne.level * 1000 + moreOne.xp > seasonOne.level * 1000 + seasonOne.xp);
  await report(backend, dedicated, v111, player.accountId, 1);
  const moreTwo = await levelOf(v111);
  assert.ok(moreTwo.level * 1000 + moreTwo.xp > seasonTwo.level * 1000 + seasonTwo.xp);
  assert.equal(moreTwo.past_seasons[0].seasonLevel, moreOne.level);
  assert.equal((await levelOf(v110)).level, moreOne.level);
}));

test("a Season 1 profile switched back before #152 loses season_num and the Battle Pass stats, and keeps its level", () => withPlayer(async (backend, player, dataDir) => {
  await profileOf(backend.port, player, "athena", v110);
  await admin(backend.port, `/accounts/${player.accountId}/battle-royale-level`, { level: 17 });
  await profileOf(backend.port, player, "athena");
  await admin(backend.port, `/accounts/${player.accountId}/battle-royale-level`, { level: 6 });
  const { book_level: tier, book_xp: stars } = (await profileOf(backend.port, player, "athena")).stats.attributes;
  // What the switch back to Season 1 left before #152.
  const file = path.join(dataDir, "accounts", player.accountId, "profiles", "athena.json");
  await profileOf(backend.port, player, "athena", v110);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.assign(saved.stats.attributes, { season_num: 1, past_seasons: [], book_level: tier, book_xp: stars, book_purchased: false,
    season_match_boost: 0, season_friend_match_boost: 0 });
  fs.writeFileSync(file, JSON.stringify(saved));

  const repaired = (await profileOf(backend.port, player, "athena", v110)).stats.attributes;
  assert.equal(repaired.level, 17);
  assert.deepEqual(seasonOneOnly(repaired), []);
  const seasonTwo = (await profileOf(backend.port, player, "athena")).stats.attributes;
  assert.equal(seasonTwo.level, 6);
  assert.equal(seasonTwo.book_level, tier);
  assert.equal(seasonTwo.book_xp, stars);
  assert.equal(seasonTwo.past_seasons[0].seasonLevel, 17);
}));

test("buying the Battle Pass and tiers in 1.11 gives the pass's rewards for every tier reached", () => withPlayer(async (backend, player) => {
  assert.equal((await admin(backend.port, `/accounts/${player.accountId}/currency`, { key: "vbucks", quantity: 5000 })).status, 200);
  await profileOf(backend.port, player, "athena");
  const buy = (offerId, purchaseQuantity = 1, price) => command(backend.port, player, "PurchaseCatalogEntry", "profile0",
    { offerId, purchaseQuantity, currency: "MtxCurrency", currencySubType: "", expectedPrice: price });

  const bought = await buy(battlePassOfferId, 1, 950);
  assert.equal(bought.status, 200, JSON.stringify(bought.body));
  const athena = await profileOf(backend.port, player, "athena");
  assert.equal(athena.stats.attributes.book_purchased, true);
  assert.equal(athena.stats.attributes.season_match_boost, 50);
  assert.equal(athena.stats.attributes.season_friend_match_boost, 10);
  assert.ok(holds(athena, "AthenaCharacter:cid_032_athena_commando_m_medieval"));
  assert.equal(vbucks(await profileOf(backend.port, player, "profile0")), 4050);
  assert.equal((await buy(battlePassOfferId, 1, 950)).status, 400);

  // Three tiers: tier 2's boost, tier 3's banner, tier 4's 100 V-Bucks.
  const tiers = await buy(tierOfferId, 3, 450);
  assert.equal(tiers.status, 200, JSON.stringify(tiers.body));
  const after = await profileOf(backend.port, player, "athena");
  assert.equal(after.stats.attributes.book_level, 4);
  assert.equal(after.stats.attributes.season_match_boost, 60);
  assert.ok(holds(await profileOf(backend.port, player, "profile0"), "HomebaseBannerIcon:brseason02bush"));
  assert.equal(vbucks(await profileOf(backend.port, player, "profile0")), 4050 - 450 + 100);
  // No more tiers than the pass has.
  assert.equal((await buy(tierOfferId, 67, 150 * 67)).status, 400);
}));

test("1.11 equips an emote in each of its six slots, and it stays; 1.10 sees the first", () => withPlayer(async (backend, player) => {
  const athena = await profileOf(backend.port, player, "athena");
  assert.deepEqual(athena.stats.attributes.favorite_dance, ["", "", "", "", "", ""]);
  const dance = Object.keys(athena.items).find((itemId) => athena.items[itemId].templateId.toLowerCase() === "athenadance:eid_dancemoves");
  const equip = await command(backend.port, player, "EquipBattleRoyaleCustomization", "athena", { slotName: "Dance", itemToSlot: dance, indexWithinSlot: 3 });
  assert.equal(equip.status, 200, JSON.stringify(equip.body));
  assert.deepEqual((await profileOf(backend.port, player, "athena")).stats.attributes.favorite_dance, ["", "", "", dance, "", ""]);
  await command(backend.port, player, "EquipBattleRoyaleCustomization", "athena", { slotName: "Dance", itemToSlot: dance, indexWithinSlot: 0 });
  // 1.10 has one emote slot, a string; its other slots come back with 1.11.
  assert.equal((await profileOf(backend.port, player, "athena", v110)).stats.attributes.favorite_dance, dance);
  assert.deepEqual((await profileOf(backend.port, player, "athena")).stats.attributes.favorite_dance, [dance, "", "", dance, "", ""]);
}));

test("the admin panel's Battle Pass tab shows Season 2's tiers and sets its prices", () => withPlayer(async (backend, player) => {
  const overview = await admin(backend.port, "/battlepass/overview?season=2");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.season, 2);
  assert.equal(overview.body.tiers.length, 70);
  assert.equal(overview.body.tiers[0].paid.find(({ templateId }) => templateId.startsWith("AthenaCharacter")).name, "Blue Squire");
  assert.deepEqual([overview.body.config.battlePassPrice, overview.body.config.bundlePrice, overview.body.config.tierPrice], [950, 2800, 150]);
  assert.equal((await admin(backend.port, "/battlepass/overview")).body.season, 1);
  assert.equal(overview.body.seasonEnd, seasonEnd(new Date(), null, 2).toISOString());
  assert.equal((await admin(backend.port, "/battlepass/overview")).body.seasonEnd, seasonEnd(new Date(), null, 1).toISOString());

  assert.equal((await admin(backend.port, "/battlepass/config", { season2: { battlePassPrice: 500, bundlePrice: -5 } })).status, 200);
  assert.equal((await admin(backend.port, "/battlepass/overview?season=2")).body.config.battlePassPrice, 500);
  assert.equal((await admin(backend.port, "/battlepass/overview?season=2")).body.config.bundlePrice, 2800);
  // Season 1's Season Shop settings are untouched.
  assert.equal((await admin(backend.port, "/battlepass/overview")).body.milestones.length, 4);
  const catalog = (await as(v111, backend.port, "GET", "/fortnite/api/storefront/v2/catalog", player.token)).body;
  assert.equal(catalog.storefronts.find(({ name }) => name === "BRSeason2").catalogEntries[0].prices[0].finalPrice, 500);
}));
