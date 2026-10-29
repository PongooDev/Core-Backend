import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { athenaCosmetics, athenaDisplayAssets } from "../src/gamedata/athena.js";
import { seasonEnd, weeklyStoreEnd } from "../src/store/itemshop.js";
import { seasonShopOffers } from "../src/store/seasonshop.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Battle Royale's Season Shop, from 1.8.2 (store/seasonshop.js).
const agents = {
  "1.8.2": "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3741772",
  "1.8.1": "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3729133",
  "1.8": "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489"
};

function as(build, port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agents[build], Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}
const command = (port, { accountId, token }, name, profileId, body = {}, build = "1.8.2") =>
  as(build, port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`, token, body);
const updateOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);
const athena = async (port, player) => updateOf((await command(port, player, "QueryProfile", "athena")).body, "athena").profileChanges[0].profile;
const vbucks = (profile) => Object.values(profile.items).filter((item) => /^currency:mtx/i.test(item.templateId)).reduce((sum, item) => sum + item.quantity, 0);
const setVbucks = (port, accountId, quantity) => post(port, `/admin/api/accounts/${accountId}/currency`, undefined, { key: "vbucks", quantity });
const setLevel = (port, accountId, level) => post(port, `/admin/api/accounts/${accountId}/battle-royale-level`, undefined, { level });

// Season One's items, levels and prices, in level order (Core-Backend #112): Aerial Assault One and Aerial Assault
// Trooper in the two small tiles, Renegade Raider and Raider's Revenge in the large ones.
const seasonOne = [
  ["AthenaGlider:glider_id_001", 5, 500],
  ["AthenaCharacter:cid_017_athena_commando_m", 15, 1200],
  ["AthenaCharacter:cid_028_athena_commando_f", 20, 1200],
  ["AthenaPickaxe:pickaxe_lockjaw", 35, 1500]
];
// Those the build's game data has (1.8.2's own data adds Aerial Assault One, the glider new in 1.8.2).
const inData = (changelist) => inBuild(changelist, () => seasonOne.filter(([templateId]) => athenaCosmetics()[templateId]));

test("1.8.2's Season Shop sells Season One's items at their levels and prices; earlier builds have none", () => {
  const offers = inBuild("3741772", () => seasonShopOffers());
  assert.deepEqual(offers.map(({ templateId, seasonLevel, price }) => [templateId, seasonLevel, price]), inData("3741772"));
  // The outfits and the pickaxe are in every 1.8 build's data.
  assert.ok(offers.length >= 3);
  for (const offer of offers) {
    assert.equal(offer.currencyType, "MtxCurrency");
    assert.equal(offer.athena, true);
    assert.match(offer.offerId, /^core_season_/);
  }
  for (const changelist of ["3532353", "3700114", "3724489", "3729133"]) assert.deepEqual(inBuild(changelist, () => seasonShopOffers()), []);
});

test("the season countdown runs to the end of the shop's 45-day cycle, Season 1's last day", () => {
  const end = (iso) => seasonEnd(new Date(iso)).toISOString();
  assert.equal(end("2017-10-30T00:00:00Z"), "2017-12-14T00:00:00.000Z");
  assert.equal(end("2017-12-13T23:59:59Z"), "2017-12-14T00:00:00.000Z");
  assert.equal(end("2017-12-14T00:00:00Z"), "2018-01-28T00:00:00.000Z");
  // 2026-10-28 is the cycle's day 0.
  assert.equal(end("2026-10-28T12:00:00Z"), "2026-12-12T00:00:00.000Z");
  assert.equal(seasonEnd(new Date("2026-10-28T12:00:00Z"), { mode: "fnbr", rotationHour: 6 }).toISOString(), "2026-12-12T06:00:00.000Z");
  for (let n = 0; n < 90; n++) {
    const now = new Date(Date.UTC(2026, 0, 1 + n, 12));
    assert.ok(seasonEnd(now) >= weeklyStoreEnd(now) && seasonEnd(now) > now, String(n));
  }
});

test("1.8.2's catalog has BRSeasonStorefront with each offer's season level, and its calendar the season's end", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Season182");
    const catalog = (await as("1.8.2", backend.port, "GET", "/fortnite/api/storefront/v2/catalog", token)).body;
    const season = catalog.storefronts.find((storefront) => storefront.name === "BRSeasonStorefront").catalogEntries;
    assert.deepEqual(season.map((entry) => [entry.itemGrants[0].templateId, Number(entry.metaInfo[0].value),
      entry.prices[0].finalPrice]), inData("3741772"));
    for (const entry of season) {
      // The client's lock: metaInfo season_level against the athena profile's level.
      assert.deepEqual(entry.metaInfo, [{ key: "season_level", value: String(entry.metaInfo[0].value) }]);
      assert.deepEqual(entry.prices.map(({ currencyType, regularPrice }) => [currencyType, regularPrice]), [["MtxCurrency", entry.prices[0].finalPrice]]);
      // No requirements (an owned item shows as owned, where a failed requirement would hide it) and no title.
      assert.deepEqual([entry.requirements, entry.title, entry.shortDescription], [[], "", ""]);
    }
    // Every tile shows its Season Shop art, 1.8.2's display assets: DA_Featured_GliderMiG is Aerial Assault One's (its
    // tile, T-Featured-Glider-001, is that glider), not Raptor's.
    const da = (name) => `/Game/Catalog/DisplayAssets/${name}.${name}`;
    assert.deepEqual(season.map((entry) => [entry.itemGrants[0].templateId, entry.displayAssetPath]), [
      ["AthenaGlider:glider_id_001", da("DA_Featured_GliderMiG")],
      ["AthenaCharacter:cid_017_athena_commando_m", da("DA_Featured_SMaleHID017")],
      ["AthenaCharacter:cid_028_athena_commando_f", da("DA_Featured_SFemaleHID028")],
      ["AthenaPickaxe:pickaxe_lockjaw", da("DA_Featured_PickaxeLockjaw")]]);
    assert.equal(inBuild("3741772", () => athenaDisplayAssets()["AthenaGlider:glider_mig"]), undefined);
    // The item shop's offers carry no season level.
    for (const name of ["BRWeeklyStorefront", "BRDailyStorefront", "CardPackStore"]) {
      for (const entry of catalog.storefronts.find((storefront) => storefront.name === name).catalogEntries) assert.deepEqual(entry.metaInfo, [], entry.offerId);
    }

    // 1.8 and 1.8.1's Season Shop tab reads a placeholder storefront and shows "SEASON STORE COMING SOON": no season
    // storefront, and no season end in their calendar.
    for (const build of ["1.8", "1.8.1"]) {
      const theirs = (await as(build, backend.port, "GET", "/fortnite/api/storefront/v2/catalog", token)).body;
      assert.ok(!theirs.storefronts.some((storefront) => storefront.name === "BRSeasonStorefront"), build);
      const timeline = (await as(build, backend.port, "GET", "/fortnite/api/calendar/v1/timeline", token)).body;
      assert.equal(timeline.channels["client-events"].states[0].state.seasonEnd, undefined, build);
    }

    const timeline = (await as("1.8.2", backend.port, "GET", "/fortnite/api/calendar/v1/timeline", token)).body;
    const events = timeline.channels["client-events"];
    assert.equal(events.states[0].state.seasonEnd, seasonEnd(new Date(timeline.currentTime)).toISOString());
    assert.equal(events.states[0].state.weeklyStoreEnd, weeklyStoreEnd(new Date(timeline.currentTime)).toISOString());
    assert.ok(Date.parse(events.cacheExpire) <= Date.parse(events.states[0].state.seasonEnd));
  } finally {
    backend.close();
  }
});

test("a Season Shop item can't be bought below its season level; at it, it takes the V-Bucks and is owned", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "SeasonShopper");
    await athena(backend.port, player);
    const offer = inBuild("3741772", () => seasonShopOffers()).find(({ templateId }) => templateId === "AthenaCharacter:cid_028_athena_commando_f");
    assert.deepEqual([offer.seasonLevel, offer.price], [20, 1200]);
    const buy = (build = "1.8.2") => command(backend.port, player, "PurchaseCatalogEntry", "profile0",
      { offerId: offer.offerId, purchaseQuantity: 1, currency: "MtxCurrency", currencySubType: "", expectedPrice: offer.price }, build);
    await setVbucks(backend.port, player.accountId, 2000);

    // Level 19: refused, nothing taken.
    assert.equal((await setLevel(backend.port, player.accountId, 19)).status, 200);
    const locked = await buy();
    assert.equal(locked.body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed");
    assert.match(locked.body.errorMessage, /season level 20/);
    assert.equal(vbucks((await command(backend.port, player, "QueryProfile", "profile0")).body.profileChanges[0].profile), 2000);
    assert.ok(!(await athena(backend.port, player)).items[offer.templateId]);
    // 1.8.1 has no Season Shop to buy it from.
    await setLevel(backend.port, player.accountId, 20);
    assert.equal((await buy("1.8.1")).body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.catalog_out_of_date");

    // Level 20: bought, into the locker.
    const bought = await buy();
    assert.equal(bought.status, 200);
    assert.equal(vbucks(updateOf(bought.body, "profile0").profileChanges[0].profile), 800);
    assert.ok(updateOf(bought.body, "athena").profileChanges.some((change) => change.changeType === "itemAdded" && change.item.templateId === offer.templateId));
    assert.ok((await athena(backend.port, player)).items[offer.templateId]);

    // Owned: never sold again.
    const again = await buy();
    assert.equal(again.body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed");
    assert.match(again.body.errorMessage, /already own/);
    assert.equal(vbucks((await command(backend.port, player, "QueryProfile", "profile0")).body.profileChanges[0].profile), 800);
  } finally {
    backend.close();
  }
});
