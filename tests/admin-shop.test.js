import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { eligibleCosmetics, generateRandomShop, itemShopOffers, nextRotation, weeklyStoreEnd } from "../src/store/itemshop.js";
import { isNonShopCosmetic, nonShopCosmeticIds } from "../src/profiles/athena.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

const admin = (backend, path, body) => (body === undefined
  ? get(backend.port, `/admin/api${path}`)
  : post(backend.port, `/admin/api${path}`, undefined, body));

const agents = { "1.8": "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489" };

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

test("admin shop API queries, customizes, randomizes, and resets the item shop", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-shop-test-"));
  const backend = await startBackend({ dataDir });

  try {
    const player = await userLogin(backend.port, "ShopTester");
    await setVbucks(backend.port, player.accountId, 10000);

    // 1. GET /admin/api/shop returns default fnbr mode and default timing
    const initial = await admin(backend, "/shop");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.mode, "fnbr");
    assert.equal(initial.body.rotationHour, 0);
    assert.equal(initial.body.weeklyDurationDays, 7);
    assert.ok(initial.body.currentShop.featured.length >= 2);
    assert.ok(initial.body.currentShop.daily.length >= 4);
    assert.ok(initial.body.availableCosmetics.length >= 35);
    assert.ok(initial.body.nextRotation);
    assert.ok(initial.body.weeklyStoreEnd);

    // Verify non-shop items (starters, chase rewards, victory/founder umbrellas, recruit defaults, preseason gliders) are excluded
    const nonShopIds = nonShopCosmeticIds().map((id) => id.toLowerCase());
    assert.ok(nonShopIds.includes("athenaglider:founderglider"));
    assert.ok(nonShopIds.includes("athenaglider:glider_warthog")); // Mako
    assert.ok(nonShopIds.includes("athenaglider:solo_umbrella"));
    assert.ok(nonShopIds.includes("athenaglider:preseasonglider"));
    assert.ok(nonShopIds.includes("athenaglider:umbrella_bronze"));
    assert.ok(nonShopIds.includes("athenacharacter:cid_001_athena_commando_f_default"));
    for (const item of initial.body.availableCosmetics) {
      assert.notEqual(item.rarity, "Handmade", `Handmade cosmetic ${item.templateId} must not be eligible`);
      assert.ok(!nonShopIds.includes(item.templateId.toLowerCase()), `Non-shop cosmetic ${item.templateId} must not be eligible`);
    }

    // 2. Set Custom Shop mode with specific items and custom prices
    const customConfig = {
      mode: "custom",
      custom: {
        featured: [
          ["AthenaCharacter:cid_029_athena_commando_f_halloween", 777],
          ["AthenaPickaxe:halloweenscythe", 444]
        ],
        daily: [
          ["AthenaGlider:glider_prismatic", 333],
          ["AthenaCharacter:cid_010_athena_commando_m", 222]
        ]
      }
    };
    const setRes = await admin(backend, "/shop", customConfig);
    assert.equal(setRes.status, 200);
    assert.equal(setRes.body.mode, "custom");
    assert.equal(setRes.body.currentShop.featured.length, 2);
    assert.equal(setRes.body.currentShop.featured[0].templateId, "AthenaCharacter:cid_029_athena_commando_f_halloween");
    assert.equal(setRes.body.currentShop.featured[0].price, 777);
    assert.equal(setRes.body.currentShop.featured[1].templateId, "AthenaPickaxe:halloweenscythe");
    assert.equal(setRes.body.currentShop.featured[1].price, 444);

    // 3. Client 1.8 queries catalog: receives the custom storefront offers
    const catalogRes = await as("1.8", backend.port, "GET", "/fortnite/api/storefront/v2/catalog", player.token);
    assert.equal(catalogRes.status, 200);
    const weeklyStorefront = catalogRes.body.storefronts.find((s) => s.name === "BRWeeklyStorefront");
    const dailyStorefront = catalogRes.body.storefronts.find((s) => s.name === "BRDailyStorefront");
    assert.ok(weeklyStorefront);
    assert.ok(dailyStorefront);
    assert.equal(weeklyStorefront.catalogEntries.length, 2);
    assert.equal(weeklyStorefront.catalogEntries[0].itemGrants[0].templateId, "AthenaCharacter:cid_029_athena_commando_f_halloween");
    assert.equal(weeklyStorefront.catalogEntries[0].prices[0].finalPrice, 777);

    // 4. Player purchases the custom item for 777 V-Bucks
    const offerId = weeklyStorefront.catalogEntries[0].offerId;
    const purchaseRes = await command(backend.port, player, "PurchaseCatalogEntry", "profile0", {
      offerId,
      purchaseQuantity: 1,
      expectedPrice: 777
    });
    assert.equal(purchaseRes.status, 200);
    const profile = await athena(backend.port, player);
    const owned = Object.values(profile.items).some((i) => i.templateId === "AthenaCharacter:cid_029_athena_commando_f_halloween");
    assert.ok(owned, "Player must own purchased custom cosmetic");

    // 5. Update general timing settings (rotation hour and weekly duration)
    const timingRes = await admin(backend, "/shop", { rotationHour: 15, weeklyDurationDays: 14 });
    assert.equal(timingRes.status, 200);
    assert.equal(timingRes.body.rotationHour, 15);
    assert.equal(timingRes.body.weeklyDurationDays, 14);

    // 6. POST /admin/api/shop/randomize generates deterministic random shop with seed
    const randRes = await admin(backend, "/shop/randomize", {});
    assert.equal(randRes.status, 200);
    assert.equal(randRes.body.mode, "random");
    assert.ok(randRes.body.random?.seed);
    assert.equal(randRes.body.currentShop.featured.length, 2);
    assert.equal(randRes.body.currentShop.daily.length, 6);

    // Deterministic random rotation: same date & seed produces exact same shop
    const seed = randRes.body.random.seed;
    const d1 = new Date("2026-10-28T12:00:00Z");
    const roll1 = inBuild("3724489", () => generateRandomShop(d1, { random: { seed } }));
    const roll2 = inBuild("3724489", () => generateRandomShop(d1, { random: { seed } }));
    assert.deepEqual(roll1, roll2);

    // Next day produces different daily items but identical weekly featured items
    const d2 = new Date("2026-10-29T12:00:00Z");
    const rollNextDay = inBuild("3724489", () => generateRandomShop(d2, { random: { seed } }));
    assert.deepEqual(rollNextDay.featured, roll1.featured);
    assert.notDeepEqual(rollNextDay.daily, roll1.daily);

    // Next week produces different featured items
    const d3 = new Date("2026-11-08T12:00:00Z");
    const rollNextWeek = inBuild("3724489", () => generateRandomShop(d3, { random: { seed } }));
    assert.notDeepEqual(rollNextWeek.featured, roll1.featured);

    // 7. POST /admin/api/shop/reset restores default FNBR history and timing defaults
    const resetRes = await admin(backend, "/shop/reset", {});
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.mode, "fnbr");
    assert.equal(resetRes.body.rotationHour, 0);
    assert.equal(resetRes.body.weeklyDurationDays, 7);
    assert.equal(resetRes.body.random, null);
    assert.ok(resetRes.body.custom?.featured);
    assert.deepEqual(resetRes.body.currentShop.featured.map((o) => o.templateId), initial.body.currentShop.featured.map((o) => o.templateId));
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


test("the weekly countdown ends when the random shop's featured pair changes, at the rotation hour", () => {
  const config = { mode: "random", rotationHour: 5, weeklyDurationDays: 7, random: { seed: "countdown" } };
  // Wednesday 28 October 2026, 03:00 UTC: still Tuesday's shop with a 05:00 rotation, the week runs Sunday 25 to Sunday 1.
  const now = new Date("2026-10-28T03:00:00Z");
  const end = weeklyStoreEnd(now, config);
  assert.equal(end.toISOString(), "2026-11-01T05:00:00.000Z");
  const featured = (at) => JSON.stringify(generateRandomShop(at, config).featured);
  assert.equal(featured(new Date(end.getTime() - 1)), featured(now));
  assert.notEqual(featured(end), featured(now));
  assert.equal(weeklyStoreEnd(new Date("2026-11-01T04:59:59Z"), config).toISOString(), end.toISOString());
});
