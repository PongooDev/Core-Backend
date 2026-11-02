import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { tierOfferId } from "../src/battlepass/season2.js";
import { athenaCosmetics, athenaDisplayAssets, athenaSeason } from "../src/gamedata/athena.js";
import { storefronts } from "../src/store/catalog.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

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
    await run(backend, player);
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

test("1.11's catalog sells the Battle Pass, the bundle and tiers in BRSeason2; an owned pass leaves it", () => {
  const front = (build, athena) => inBuild(build, () => storefronts(undefined, new Date(), { athena }).find(({ name }) => name === "BRSeason2"));
  const season = front(v111);
  const [pass, bundle, tier] = season.catalogEntries;
  assert.equal(pass.title, "Battle Pass");
  assert.equal(pass.devName, "BR.Season2.BattlePass.01");
  assert.equal(pass.prices[0].finalPrice, 950);
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
    assert.ok(winter.state.seasonEnd);
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
  assert.equal(seasonOne.season_num, 1);
  assert.equal((await profileOf(backend.port, player, "athena")).stats.attributes.level, 12);
}));

test("buying the Battle Pass and tiers in 1.11 gives the pass's rewards for every tier reached", () => withPlayer(async (backend, player) => {
  assert.equal((await admin(backend.port, `/accounts/${player.accountId}/currency`, { key: "vbucks", quantity: 5000 })).status, 200);
  await profileOf(backend.port, player, "athena");
  const buy = (offerId, purchaseQuantity = 1, price) => command(backend.port, player, "PurchaseCatalogEntry", "profile0",
    { offerId, purchaseQuantity, currency: "MtxCurrency", currencySubType: "", expectedPrice: price });

  const bought = await buy("core_br_season2_battlepass", 1, 950);
  assert.equal(bought.status, 200, JSON.stringify(bought.body));
  const athena = await profileOf(backend.port, player, "athena");
  assert.equal(athena.stats.attributes.book_purchased, true);
  assert.equal(athena.stats.attributes.season_match_boost, 50);
  assert.equal(athena.stats.attributes.season_friend_match_boost, 10);
  assert.ok(holds(athena, "AthenaCharacter:cid_032_athena_commando_m_medieval"));
  assert.equal(vbucks(await profileOf(backend.port, player, "profile0")), 4050);
  assert.equal((await buy("core_br_season2_battlepass", 1, 950)).status, 400);

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

  assert.equal((await admin(backend.port, "/battlepass/config", { season2: { battlePassPrice: 500, bundlePrice: -5 } })).status, 200);
  assert.equal((await admin(backend.port, "/battlepass/overview?season=2")).body.config.battlePassPrice, 500);
  assert.equal((await admin(backend.port, "/battlepass/overview?season=2")).body.config.bundlePrice, 2800);
  // Season 1's Season Shop settings are untouched.
  assert.equal((await admin(backend.port, "/battlepass/overview")).body.milestones.length, 4);
  const catalog = (await as(v111, backend.port, "GET", "/fortnite/api/storefront/v2/catalog", player.token)).body;
  assert.equal(catalog.storefronts.find(({ name }) => name === "BRSeason2").catalogEntries[0].prices[0].finalPrice, 500);
}));
