import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { athenaCosmetics } from "../src/gamedata/athena.js";
import { itemShopOffers, nextRotation, shopDay, weeklyStoreEnd } from "../src/store/itemshop.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Battle Royale's item shop (Core-Backend #69).
const agents = { "1.8": "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489",
  cert: "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3532353" };

function as(build, port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agents[build], Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}
const command = (port, { accountId, token }, name, profileId, body = {}) =>
  as("1.8", port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`, token, body);
const updateOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);
const athena = async (port, player) => updateOf((await command(port, player, "QueryProfile", "athena")).body, "athena").profileChanges[0].profile;
const vbucks = (profile) => Object.values(profile.items).filter((item) => /^currency:mtx/i.test(item.templateId)).reduce((sum, item) => sum + item.quantity, 0);
const setVbucks = (port, accountId, quantity) => post(port, `/admin/api/accounts/${accountId}/currency`, undefined, { key: "vbucks", quantity });

test("the item shop replays Season 1's shop in a 45-day cycle from 30 October 2017, changing at UTC midnight", () => {
  const day = (iso) => shopDay(new Date(iso)).date;
  assert.equal(day("2017-10-30T00:00:00Z"), "2017-10-30");
  assert.equal(day("2017-11-01T23:59:59Z"), "2017-11-01");
  assert.equal(day("2017-12-13T12:00:00Z"), "2017-12-13");
  // Then round again: 45 days later is day 0.
  assert.equal(day("2017-12-14T00:00:00Z"), "2017-10-30");
  assert.equal(day("2026-10-28T12:00:00Z"), "2017-10-30");
  assert.equal(day("2026-10-29T00:00:00Z"), "2017-10-31");
  assert.equal(nextRotation(new Date("2026-10-28T12:34:56Z")).toISOString(), "2026-10-29T00:00:00.000Z");
  assert.equal(nextRotation(new Date("2026-10-28T00:00:00Z")).toISOString(), "2026-10-29T00:00:00.000Z");

  // 1.8 sells the recorded day at that day's prices: Halloween's featured troopers on 30 October, Ghoul Trooper for
  // 1,500 V-Bucks and Skull Trooper for 1,200 (1,500 only from 2018), wherever he is on sale.
  const halloween = inBuild("3724489", () => itemShopOffers(new Date("2017-10-30T10:00:00Z")));
  assert.deepEqual(halloween.BRWeeklyStorefront.map(({ templateId, price }) => [templateId, price]), [
    ["AthenaCharacter:cid_029_athena_commando_f_halloween", 1500], ["AthenaCharacter:cid_030_athena_commando_m_halloween", 1200]]);
  const skullTrooper = inBuild("3724489", () => itemShopOffers(new Date("2017-11-27T10:00:00Z"))).BRDailyStorefront
    .find(({ templateId }) => templateId === "AthenaCharacter:cid_030_athena_commando_m_halloween");
  assert.equal(skullTrooper.price, 1200);
  assert.deepEqual(halloween.BRDailyStorefront.map(({ title, price }) => [title, price]),
    [["First strike Specialist", 1200], ["Recon Expert", 1200], ["Petunia", 500], ["Scout", 800]]);
  // Every day has its featured and daily items, all of them 1.8 cosmetics; earlier builds have no item shop.
  for (let n = 0; n < 45; n++) {
    const offers = inBuild("3724489", () => itemShopOffers(new Date(Date.UTC(2017, 9, 30 + n, 6))));
    assert.ok(offers.BRWeeklyStorefront.length >= 2 && offers.BRDailyStorefront.length >= 4, String(n));
    for (const offer of [...offers.BRWeeklyStorefront, ...offers.BRDailyStorefront]) assert.ok(athenaCosmetics()[offer.templateId], offer.templateId);
  }
  for (const changelist of ["3532353", "3700114"]) {
    assert.deepEqual(inBuild(changelist, () => itemShopOffers()), { BRWeeklyStorefront: [], BRDailyStorefront: [] });
  }
});

test("1.8's catalog has the day's Battle Royale storefronts, good until the next UTC midnight; Cert's has none", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Catalog18");
    const catalog = (await as("1.8", backend.port, "GET", "/fortnite/api/storefront/v2/catalog", token)).body;
    const now = new Date();
    assert.equal(catalog.expiration, nextRotation(now).toISOString());
    const { BRWeeklyStorefront, BRDailyStorefront } = inBuild("3724489", () => itemShopOffers(now));
    const front = (name) => catalog.storefronts.find((storefront) => storefront.name === name).catalogEntries;
    assert.deepEqual(front("BRWeeklyStorefront").map((entry) => entry.offerId), BRWeeklyStorefront.map((offer) => offer.offerId));
    assert.deepEqual(front("BRDailyStorefront").map((entry) => entry.offerId), BRDailyStorefront.map((offer) => offer.offerId));
    const [offer] = front("BRDailyStorefront");
    assert.deepEqual(offer.itemGrants, [{ templateId: BRDailyStorefront[0].templateId, quantity: 1 }]);
    assert.deepEqual(offer.prices.map(({ currencyType, finalPrice }) => [currencyType, finalPrice]), [["MtxCurrency", BRDailyStorefront[0].price]]);
    // No requirements: the client would leave out an offer failing them, where an owned one shows as owned.
    assert.deepEqual(offer.requirements, []);

    const cert = (await as("cert", backend.port, "GET", "/fortnite/api/storefront/v2/catalog", token)).body;
    assert.deepEqual(cert.storefronts.map((storefront) => storefront.name), ["CardPackStore", "CardPackStorePromo"]);
  } finally {
    backend.close();
  }
});

test("the weekly countdown runs to when the featured items next change, from the 1.8 event calendar", async () => {
  // The featured pair changes on the recorded days' Sundays (5, 12, 19, 26 November, 3 and 10 December 2017), and from
  // the cycle's last day (13 December) back to its first (Halloween's troopers).
  const end = (iso) => weeklyStoreEnd(new Date(iso)).toISOString();
  assert.equal(end("2017-10-30T10:00:00Z"), "2017-11-05T00:00:00.000Z");
  assert.equal(end("2017-11-04T23:59:59Z"), "2017-11-05T00:00:00.000Z");
  assert.equal(end("2017-11-05T00:00:00Z"), "2017-11-12T00:00:00.000Z");
  assert.equal(end("2017-12-10T00:00:00Z"), "2017-12-14T00:00:00.000Z");
  // 2026-10-28 is the cycle's day 0 (30 October), so its first week runs to 3 November 2026.
  assert.equal(end("2026-10-28T12:00:00Z"), "2026-11-03T00:00:00.000Z");
  for (let n = 0; n < 90; n++) {
    const now = new Date(Date.UTC(2026, 0, 1 + n, 12));
    const ends = weeklyStoreEnd(now);
    assert.ok(ends > now && ends.getTime() % 86400000 === 0, String(n));
    const featured = (date) => shopDay(date).featured.map(([templateId]) => templateId).join();
    assert.notEqual(featured(ends), featured(now), String(n));
    assert.equal(featured(new Date(ends.getTime() - 1)), featured(now), String(n));
  }

  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Weekly18");
    const now = Date.now();
    const timeline = (await as("1.8", backend.port, "GET", "/fortnite/api/calendar/v1/timeline", token)).body;
    const events = timeline.channels["client-events"];
    const { weeklyStoreEnd: sent } = events.states[0].state;
    assert.equal(sent, weeklyStoreEnd(new Date(timeline.currentTime)).toISOString());
    assert.ok(Date.parse(sent) > now);
    // Asked again by then at the latest, for the next week's end.
    assert.ok(Date.parse(events.cacheExpire) <= Date.parse(sent));
    assert.ok(Date.parse(events.cacheExpire) <= Date.parse(timeline.currentTime) + 3600000);

    const cert = (await as("cert", backend.port, "GET", "/fortnite/api/calendar/v1/timeline", token)).body;
    assert.deepEqual(cert.channels["client-events"].states[0].state, {});
  } finally {
    backend.close();
  }
});

test("buying from the item shop takes profile0's V-Bucks and puts the cosmetic in the locker; an owned one is never charged", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Shopper18");
    await athena(backend.port, player);
    const [offer] = inBuild("3724489", () => itemShopOffers()).BRDailyStorefront;
    const buy = (offerId = offer.offerId, expectedPrice = offer.price) =>
      command(backend.port, player, "PurchaseCatalogEntry", "profile0", { offerId, purchaseQuantity: 1, currency: "MtxCurrency", currencySubType: "", expectedPrice });

    // Too few V-Bucks: nothing happens.
    await setVbucks(backend.port, player.accountId, offer.price - 1);
    assert.equal((await buy()).body.errorCode, "errors.com.epicgames.currency.mtx.insufficient");
    assert.ok(!(await athena(backend.port, player)).items[offer.templateId]);

    await setVbucks(backend.port, player.accountId, offer.price + 100);
    const bought = await buy();
    assert.equal(bought.status, 200);
    assert.equal(vbucks(updateOf(bought.body, "profile0").profileChanges[0].profile), 100);
    const locker = updateOf(bought.body, "athena");
    assert.ok(locker.profileChanges.some((change) => change.changeType === "itemAdded" && change.item.templateId === offer.templateId));
    const { lootResult } = bought.body.notifications.find((notification) => notification.type === "CatalogPurchase");
    assert.deepEqual(lootResult.items, [{ itemType: offer.templateId, itemGuid: offer.templateId, itemProfile: "athena", quantity: 1 }]);
    const item = (await athena(backend.port, player)).items[offer.templateId];
    assert.deepEqual(item.attributes, { level: 1, item_seen: 0, favorite: 0 });
    assert.equal((await command(backend.port, player, "EquipBattleRoyaleCustomization", "athena",
      { slotName: offer.templateId.split(":")[0].slice("Athena".length), itemToSlot: offer.templateId })).status, 200);

    // Again: already owned, refused before any V-Bucks are taken.
    await setVbucks(backend.port, player.accountId, 5000);
    assert.equal((await buy()).body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed");
    assert.equal(vbucks((await command(backend.port, player, "QueryProfile", "profile0")).body.profileChanges[0].profile), 5000);

    // What isn't on sale today can't be bought.
    const today = inBuild("3724489", () => itemShopOffers());
    const onSale = new Set([...today.BRWeeklyStorefront, ...today.BRDailyStorefront].map(({ templateId }) => templateId));
    const other = ["AthenaCharacter:cid_029_athena_commando_f_halloween", "AthenaPickaxe:pickaxe_flamingo"].find((templateId) => !onSale.has(templateId));
    assert.equal((await buy(`core_br_${other.split(":")[1]}`, 1500)).body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.catalog_out_of_date");
  } finally {
    backend.close();
  }
});

