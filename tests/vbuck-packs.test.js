import { test } from "node:test";
import assert from "node:assert/strict";
import { certUserAgent, clientToken, post, send, startBackend, userLogin } from "./helpers.js";

// The Store tab's V-Bucks packs (Core-Backend #223, store/currency.js, services/fortnite/purchase.js).
const agent31 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.1-CL-3915963";
const as = (port, path, token, userAgent = agent31, extra = {}) =>
  send({ host: "127.0.0.1", port, path, headers: { "User-Agent": userAgent, ...(token ? { Authorization: `bearer ${token}` } : {}), ...extra } });
const catalog = async (port, token, userAgent) => (await as(port, "/fortnite/api/storefront/v2/catalog", token, userAgent)).body;
const currencyOf = (body) => body.storefronts.find((storefront) => storefront.name === "CurrencyStorefront");
const vbucks = (profile, templateId) => Object.values(profile.items).filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase())
  .reduce((sum, item) => sum + item.quantity, 0);
const profile0 = async (port, { accountId, token }) => (await post(port, `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, token, {}))
  .body.profileChanges[0].profile;

function complete(port, purchaseId, headers = {}) {
  const body = `purchaseId=${encodeURIComponent(purchaseId)}`;
  return send({ host: "127.0.0.1", port, method: "POST", path: "/purchase/complete",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body), Origin: `http://127.0.0.1:${port}`, ...headers } }, body);
}
const purchaseIdOf = (html) => /name="purchaseId" value="([^"]+)"/.exec(html)?.[1];

test("the Store tab sells four V-Bucks packs from 1.8, each priced by the catalog service", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "PackBuyer");
    const other = await userLogin(backend.port, "OtherBuyer");
    const store = currencyOf(await catalog(backend.port, player.token));
    assert.deepEqual(store.catalogEntries.map((offer) => offer.metaInfo.map(({ key, value }) => `${key}=${value}`).join(",")),
      ["MtxQuantity=1000,MtxBonus=0", "MtxQuantity=2800,MtxBonus=300", "MtxQuantity=7500,MtxBonus=1500", "MtxQuantity=13500,MtxBonus=3500"]);
    const [first] = store.catalogEntries;
    assert.equal(first.prices[0].currencyType, "RealMoney");
    assert.equal(first.displayAssetPath, "/Game/Catalog/DisplayAssets/DA_MtxPack1000.DA_MtxPack1000");
    assert.equal(first.appStoreId.length, 8);
    assert.ok(first.appStoreId[1].startsWith(`core_mtx_1000.${player.accountId}.`));
    assert.deepEqual(first.itemGrants, []);

    // Not before 1.8, whose lobby has no Store tab.
    assert.equal(currencyOf(await catalog(backend.port, player.token, certUserAgent)), undefined);

    // The catalog service prices the app store ids this backend signed, and no made-up or tampered ones.
    const ids = store.catalogEntries.map((offer) => offer.appStoreId[1]);
    const query = `/catalog/api/shared/bulk/offers?${ids.map((id) => `id=${id}`).join("&")}&returnItemDetails=false&locale=en-US`;
    const priced = (await as(backend.port, query, player.token)).body;
    assert.deepEqual(Object.values(priced).map((offer) => [offer.price, offer.currencyCode]), [[999, "USD"], [2499, "USD"], [5999, "USD"], [9999, "USD"]]);
    assert.equal(priced[ids[1]].id, ids[1]);
    const forged = [ids[0].replace(/.$/, (c) => (c === "A" ? "B" : "A")), ids[0].replace(player.accountId, other.accountId), "core_mtx_1000"];
    assert.deepEqual((await as(backend.port, `/catalog/api/shared/bulk/offers?${forged.map((id) => `id=${id}`).join("&")}`, player.token)).body, {});
    assert.equal((await as(backend.port, query)).status, 401);

    // The admin panel turns them off.
    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { vbuckPacks: false })).body.vbuckPacks, false);
    assert.equal(currencyOf(await catalog(backend.port, player.token)), undefined);
    assert.equal((await send({ host: "127.0.0.1", port: backend.port, path: "/admin/api/shop" })).body.vbuckPacks, false);
  } finally {
    backend.close();
  }
});

// Core-Backend #239: the client's catalog service asks with the game's client_credentials token, which names no account
// (FOnlineCatalogServiceMcp queues its requests per client). Answered with {}, the packs had no price and the Store tab
// listed none, on every build from 1.8.
test("the catalog service prices the packs for the game's client token, on every build from 1.8 to 3.2", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ClientPriced");
    const client = await clientToken(backend.port);
    for (const build of ["Release-1.8-CL-3724489", "Release-2.5-CL-3889387", "Release-3.0-CL-3901517", "Release-3.2-CL-3935073"]) {
      const userAgent = `game=Fortnite, engine=UE4, build=++Fortnite+${build}`;
      const store = currencyOf(await catalog(backend.port, player.token, userAgent));
      assert.equal(store.catalogEntries.length, 4, build);
      const ids = store.catalogEntries.map((offer) => offer.appStoreId[1]);
      const query = `/catalog/api/shared/bulk/offers?${ids.map((id) => `id=${id}`).join("&")}&returnItemDetails=false&locale=en-US`;
      const answer = await as(backend.port, query, client, userAgent);
      assert.equal(answer.status, 200, build);
      assert.deepEqual(Object.keys(answer.body), ids, build);
      assert.deepEqual(Object.values(answer.body).map((offer) => [offer.id, offer.namespace, offer.price, offer.currencyCode]),
        ids.map((id, index) => [id, "fn", [999, 2499, 5999, 9999][index], "USD"]), build);
    }
  } finally {
    backend.close();
  }
});

test("the game config points the purchase flow at this backend, from 1.8, while the packs are on", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "ConfigReader");
    const game = async (userAgent) => (await as(backend.port, "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, userAgent)).body;
    assert.match(await game(agent31), new RegExp(`\\[EpicPurchaseFlow\\]\\r\\nProd=http:///127\\.0\\.0\\.1:${backend.port}/purchase\\r\\n`));
    assert.doesNotMatch(await game(certUserAgent), /EpicPurchaseFlow/);
    await post(backend.port, "/admin/api/settings", undefined, { vbuckPacks: false });
    assert.doesNotMatch(await game(agent31), /EpicPurchaseFlow/);
  } finally {
    backend.close();
  }
});

test("Complete purchase gives the pack's V-Bucks once, to the account it was offered to, from the page only", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "PackBuyer");
    const other = await userLogin(backend.port, "OtherBuyer");
    const appStoreId = currencyOf(await catalog(backend.port, player.token)).catalogEntries[1].appStoreId[1];
    const open = (id, extra) => as(backend.port, `/purchase?showNavigation=true&namespace=fn&offers=${id}&analyticsSessionId=x`, undefined, agent31, extra);

    const page = await open(appStoreId);
    assert.equal(page.status, 200);
    assert.match(page.body, /2,500 \(\+300 Bonus\) V-Bucks/);
    assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);

    // A forged or tampered offer, or another account's cookie, gets no page.
    assert.equal((await open(appStoreId.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).status, 400);
    assert.equal((await open(appStoreId.replace(player.accountId, other.accountId))).status, 400);
    assert.equal((await open(appStoreId, { Cookie: `EPIC_BEARER_TOKEN=${other.token}` })).status, 403);
    assert.equal((await open(appStoreId, { Cookie: `EPIC_BEARER_TOKEN=${player.token}` })).status, 200);

    // Another site can't complete it, nor can a made-up purchase id.
    const purchaseId = purchaseIdOf(page.body);
    assert.equal((await complete(backend.port, purchaseId, { Origin: "http://evil.example" })).status, 403);
    assert.equal((await complete(backend.port, purchaseIdOf((await open(appStoreId)).body), { "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await complete(backend.port, "made-up")).status, 400);

    const done = await complete(backend.port, purchaseIdOf((await open(appStoreId)).body));
    assert.equal(done.status, 200);
    assert.equal(done.body.receipt.TransactionState, "Purchased");
    assert.equal(done.body.receipt.Offers[0].OfferId, appStoreId);
    let profile = await profile0(backend.port, player);
    assert.equal(vbucks(profile, "Currency:MtxPurchased"), 2500);
    assert.equal(vbucks(profile, "Currency:MtxPurchaseBonus"), 300);
    assert.deepEqual(profile.stats.attributes.in_app_purchases.fulfillmentCounts, { core_mtx_2800: 1 });
    assert.equal(vbucks(await profile0(backend.port, other), "Currency:MtxPurchased"), 0);

    // Each page buys once.
    const again = purchaseIdOf((await open(appStoreId)).body);
    assert.equal((await complete(backend.port, again)).status, 200);
    assert.equal((await complete(backend.port, again)).status, 400);
    profile = await profile0(backend.port, player);
    assert.equal(vbucks(profile, "Currency:MtxPurchased"), 5000);

    // The client's receipt check has nothing left to give.
    const verified = await post(backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/client/VerifyRealMoneyPurchase?profileId=profile0&rvn=-1`,
      player.token, { appStore: "EpicPurchasingService", receiptId: done.body.receipt.TransactionId, receiptInfo: "" });
    assert.equal(verified.status, 200);

    // Off, no page and no purchase.
    const last = purchaseIdOf((await open(appStoreId)).body);
    await post(backend.port, "/admin/api/settings", undefined, { vbuckPacks: false });
    assert.equal((await open(appStoreId)).status, 403);
    assert.equal((await complete(backend.port, last)).status, 403);
  } finally {
    backend.close();
  }
});
