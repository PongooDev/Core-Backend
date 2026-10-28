import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

    // 1. GET /admin/api/shop returns default fnbr mode
    const initial = await admin(backend, "/shop");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.mode, "fnbr");
    assert.ok(initial.body.currentShop.featured.length >= 2);
    assert.ok(initial.body.currentShop.daily.length >= 4);
    assert.ok(initial.body.availableCosmetics.length >= 35);
    assert.ok(initial.body.nextRotation);
    assert.ok(initial.body.weeklyStoreEnd);

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

    // 5. POST /admin/api/shop/randomize generates random shop
    const randRes = await admin(backend, "/shop/randomize", {});
    assert.equal(randRes.status, 200);
    assert.equal(randRes.body.mode, "random");
    assert.equal(randRes.body.currentShop.featured.length, 2);
    assert.ok(randRes.body.currentShop.daily.length >= 4);

    // 6. POST /admin/api/shop/reset restores default FNBR history
    const resetRes = await admin(backend, "/shop/reset", {});
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.mode, "fnbr");
    assert.deepEqual(resetRes.body.currentShop.featured.map((o) => o.templateId), initial.body.currentShop.featured.map((o) => o.templateId));
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

