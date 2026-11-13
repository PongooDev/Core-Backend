import { test } from "node:test";
import assert from "node:assert/strict";
import { certUserAgent, clientToken, post, send, startBackend, userLogin } from "./helpers.js";
import { inBuild } from "../src/builds/context.js";
import { lockerCosmeticId } from "../src/profiles/athena.js";
import { findRealMoneyOffer, isOffered } from "../src/store/currency.js";

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
      ["MtxQuantity=1000,MtxBonus=0", "MtxQuantity=2800,MtxBonus=300", "MtxQuantity=7500,MtxBonus=1500", "MtxQuantity=13500,MtxBonus=3500", "MtxQuantity=600,MtxBonus=100"]);
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
    assert.deepEqual(Object.values(priced).map((offer) => [offer.price, offer.currencyCode]), [[999, "USD"], [2499, "USD"], [5999, "USD"], [9999, "USD"], [499, "USD"]]);
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
      // The Battle Royale Starter Pack is Season 3's, from 3.1 (#248).
      const prices = build.startsWith("Release-3.2") ? [999, 2499, 5999, 9999, 499] : [999, 2499, 5999, 9999];
      assert.equal(store.catalogEntries.length, prices.length, build);
      const ids = store.catalogEntries.map((offer) => offer.appStoreId[1]);
      const query = `/catalog/api/shared/bulk/offers?${ids.map((id) => `id=${id}`).join("&")}&returnItemDetails=false&locale=en-US`;
      const answer = await as(backend.port, query, client, userAgent);
      assert.equal(answer.status, 200, build);
      assert.deepEqual(Object.keys(answer.body), ids, build);
      assert.deepEqual(Object.values(answer.body).map((offer) => [offer.id, offer.namespace, offer.price, offer.currencyCode]),
        ids.map((id, index) => [id, "fn", prices[index], "USD"]), build);
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

// Core-Backend #346: from 6.02 the pak's [EpicPurchaseFlow] has ProdAltDomains, and the flow sets its cookie on each
// after the page's own, swapping the URL's domain (GetUrlDomain, 6.20 0x1FD08B0) for the other one; with Prod's triple
// slash that domain is empty, so the next cookie was never set, the flow never went on, and 6.20's Store stayed black
// with a spinner. The section clears them, on every build with the Store tab, after Prod as the launcher writes it.
const urlDomain = (url) => {
  // FGenericPlatformHttp::GetUrlDomain: after "://", up to the first "/", ":" or "?".
  const rest = url.includes("://") ? url.slice(url.indexOf("://") + 3) : url;
  return rest.slice(0, rest.search(/[/:?]|$/));
};
test("the game config clears the purchase flow's other domains, so 6.20's flow goes on past the page's cookie (#346)", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "AltDomains");
    for (const build of ["Release-1.8-CL-3724489", "Release-3.1-CL-3915963", "Release-5.41-CL-4363240", "Release-6.02-CL-4461277",
      "Release-6.10-CL-4480234", "Release-6.20-CL-4497486", "Release-6.21-CL-4526925"]) {
      const userAgent = `game=Fortnite, engine=UE4, build=++Fortnite+${build}`;
      const body = (await as(backend.port, "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, userAgent)).body;
      const section = /\[EpicPurchaseFlow\]\r\n((?:[^[\r\n][^\r\n]*\r\n)*)/.exec(body)?.[1].split("\r\n").filter(Boolean);
      assert.deepEqual(section, [`Prod=http:///127.0.0.1:${backend.port}/purchase`, "!ProdAltDomains=ClearArray"], build);
      // The page's domain as the flow takes it is empty, which is why no other domain may follow.
      assert.equal(urlDomain(section[0].slice("Prod=".length)), "", build);
    }
    assert.equal(urlDomain("https://launcher-website-prod07.ol.epicgames.com/purchase"), "launcher-website-prod07.ol.epicgames.com");
  } finally {
    backend.close();
  }
});

// Core-Backend #244: the purchase flow's browser (CEF) goes straight to the page's address, so the page is at the address
// the game reached the backend at (its Host header), not this PC's own view of itself: a name, a VPN address, a
// forwarded or tunnelled port of another number.
test("the purchase flow's page is at the backend address the game used, on 1.8 to 3.3", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "RemoteBuyer");
    const prod = async (userAgent, host) => /\[EpicPurchaseFlow\]\r\nProd=(.*)\r\n/
      .exec((await as(backend.port, "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, userAgent, host ? { Host: host } : {})).body)?.[1];
    for (const build of ["Release-1.8-CL-3724489", "Release-2.5-CL-3889387", "Release-3.2-CL-3935073", "Release-3.3-CL-3942182"]) {
      const userAgent = `game=Fortnite, engine=UE4, build=++Fortnite+${build}`;
      assert.equal(await prod(userAgent), `http:///127.0.0.1:${backend.port}/purchase`, build);
      assert.equal(await prod(userAgent, "play.example.com:40123"), "http:///play.example.com:40123/purchase", build);
      assert.equal(await prod(userAgent, "26.14.3.9:5595"), "http:///26.14.3.9:5595/purchase", build);
      assert.equal(await prod(userAgent, "[::1]:5595"), "http:///[::1]:5595/purchase", build);
      // An Epic host (the -httpproxy carried the request as is), or a Host that is no host and port, keeps the backend's own.
      assert.equal(await prod(userAgent, "fortnite-public-service-prod11.ol.epicgames.com"), `http:///127.0.0.1:${backend.port}/purchase`, build);
      assert.equal(await prod(userAgent, "a b;c=d"), `http:///127.0.0.1:${backend.port}/purchase`, build);
    }

    // The page, and its Complete purchase, answer for that address.
    const player = await userLogin(backend.port, "RemotePageBuyer");
    const appStoreId = currencyOf(await catalog(backend.port, player.token)).catalogEntries[0].appStoreId[1];
    const page = await as(backend.port, `/purchase?showNavigation=true&namespace=fn&offers=${appStoreId}&analyticsSessionId=x`, undefined, agent31,
      { Host: "play.example.com:40123" });
    assert.equal(page.status, 200);
    const done = await complete(backend.port, purchaseIdOf(page.body), { Host: "play.example.com:40123", Origin: "http://play.example.com:40123" });
    assert.equal(done.status, 200);
    assert.equal(done.body.receipt.TransactionState, "Purchased");
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

// Core-Backend #248: the Battle Royale Starter Pack, a Season 3 real-money offer (store/currency.js).
const agent30 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.0-CL-3901517";
const agent351 = "Fortnite/4.20.0-4000805+++Fortnite+Release-3.5 Windows/10.0.17134.1.256.64bit";
const starterOf = (body) => currencyOf(body)?.catalogEntries.find((offer) => offer.offerId === "core_starter_br_s3");
const query = (port, accountId, token, profileId, userAgent) => send({ host: "127.0.0.1", port, method: "POST",
  path: `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=${profileId}&rvn=-1`,
  headers: { "User-Agent": userAgent, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": 2 } }, "{}")
  .then((response) => response.body.profileChanges[0].profile);
const owned = (profile, prefix) => Object.values(profile.items).filter((item) => item.templateId.toLowerCase().startsWith(prefix.toLowerCase()));
const open = (port, id, userAgent) => as(port, `/purchase?showNavigation=true&namespace=fn&offers=${id}&analyticsSessionId=x`, undefined, userAgent);

test("the Starter Pack is in the Store tab on Season 3 builds only", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StarterShopper");
    for (const [build, userAgent] of [["3.1", agent31], ["3.1.1", "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.1-CL-3917250"],
      ["3.2", "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.2-CL-3935073"], ["3.3", "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.3-CL-3942182"],
      ["3.5.1", agent351]]) {
      const offer = starterOf(await catalog(backend.port, player.token, userAgent));
      assert.ok(offer, build);
      assert.equal(offer.title, "Battle Royale Starter Pack", build);
      assert.equal(offer.prices[0].currencyType, "RealMoney", build);
      assert.ok(offer.appStoreId[1].startsWith(`core_starter_br_s3.${player.accountId}.`), build);
      assert.deepEqual(offer.metaInfo.map(({ key, value }) => `${key}=${value}`), ["MtxQuantity=600", "MtxBonus=100"], build);
    }
    // Not before Season 3 (1.8, 2.5), nor on 3.0, whose paks lack the Rogue Agent.
    for (const build of ["Release-1.8-CL-3724489", "Release-2.5-CL-3889387"]) {
      assert.equal(starterOf(await catalog(backend.port, player.token, `game=Fortnite, engine=UE4, build=++Fortnite+${build}`)), undefined, build);
    }
    assert.equal(starterOf(await catalog(backend.port, player.token, agent30)), undefined);

    // The catalog service prices it, $4.99.
    const id = starterOf(await catalog(backend.port, player.token, agent31)).appStoreId[1];
    const priced = (await as(backend.port, `/catalog/api/shared/bulk/offers?id=${id}&returnItemDetails=false`, await clientToken(backend.port))).body;
    assert.deepEqual([priced[id].price, priced[id].currencyCode, priced[id].title], [499, "USD", "Battle Royale Starter Pack"]);

    // The packs' admin setting turns it off too.
    await post(backend.port, "/admin/api/settings", undefined, { vbuckPacks: false });
    assert.equal(starterOf(await catalog(backend.port, player.token, agent31)), undefined);
  } finally {
    backend.close();
  }
});

test("buying the Starter Pack gives the Rogue Agent, the Catalyst and 600 V-Bucks once, and it can't be bought twice", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StarterBuyer");
    const id = starterOf(await catalog(backend.port, player.token, agent31)).appStoreId[1];
    const page = await open(backend.port, id, agent31);
    assert.equal(page.status, 200);
    assert.match(page.body, /Battle Royale Starter Pack/);
    const second = purchaseIdOf((await open(backend.port, id, agent31)).body);

    const done = await complete(backend.port, purchaseIdOf(page.body));
    assert.equal(done.status, 200);
    assert.equal(done.body.receipt.TransactionState, "Purchased");
    const athena = await query(backend.port, player.accountId, player.token, "athena", agent31);
    assert.equal(owned(athena, "AthenaCharacter:CID_090_Athena_Commando_M_Tactical").length, 1);
    assert.equal(owned(athena, "AthenaBackpack:BID_030_TacticalRogue").length, 1);
    const profile = await profile0(backend.port, player);
    assert.equal(vbucks(profile, "Currency:MtxPurchased"), 500);
    assert.equal(vbucks(profile, "Currency:MtxPurchaseBonus"), 100);
    assert.deepEqual(profile.stats.attributes.in_app_purchases.fulfillmentCounts, { core_starter_br_s3: 1 });

    // Gone from the Store tab; its page and a second Complete purchase (opened before) are refused, and nothing more is given.
    assert.equal(starterOf(await catalog(backend.port, player.token, agent31)), undefined);
    assert.equal((await open(backend.port, id, agent31)).status, 409);
    assert.equal((await complete(backend.port, second)).status, 409);
    assert.equal(vbucks(await profile0(backend.port, player), "Currency:MtxPurchased"), 500);

    // Another account still has it.
    const other = await userLogin(backend.port, "StarterOther");
    assert.ok(starterOf(await catalog(backend.port, other.token, agent31)));
  } finally {
    backend.close();
  }
});

test("the Starter Pack works on 3.5.1, whose V-Bucks are common_core's", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Starter351");
    const id = starterOf(await catalog(backend.port, player.token, agent351)).appStoreId[1];
    const done = await complete(backend.port, purchaseIdOf((await open(backend.port, id, agent351)).body));
    assert.equal(done.status, 200);
    const core = await query(backend.port, player.accountId, player.token, "common_core", agent351);
    assert.equal(vbucks(core, "Currency:MtxPurchased"), 500);
    assert.equal(vbucks(core, "Currency:MtxPurchaseBonus"), 100);
    assert.deepEqual(core.stats.attributes.in_app_purchases.fulfillmentCounts, { core_starter_br_s3: 1 });
    const athena = await query(backend.port, player.accountId, player.token, "athena", agent351);
    assert.equal(owned(athena, "AthenaCharacter:CID_090_Athena_Commando_M_Tactical").length, 1);
    assert.equal(owned(athena, "AthenaBackpack:BID_030_TacticalRogue").length, 1);
    assert.equal(starterOf(await catalog(backend.port, player.token, agent351)), undefined);
    assert.equal((await open(backend.port, id, agent351)).status, 409);
  } finally {
    backend.close();
  }
});

// Core-Backend #267: the Wingman Starter Pack, Season 4's, offered on a Season 4 build whose paks have Wingman and the
// Bogey Bag. 4.0's and 4.1's don't (they end at CID_126 and BID_049), so neither starter pack is in their Store tab.
const agent40 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.0-CL-4039451";
const agent41 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.1-CL-4053532";
test("#267: the Wingman Starter Pack is Season 4's, offered only where the build has Wingman and the Bogey Bag", async () => {
  const wingman = findRealMoneyOffer("core_starter_br_s4");
  assert.deepEqual([wingman.title, wingman.season, wingman.price, wingman.oncePerAccount], ["Wingman Starter Pack", 4, 499, true]);
  assert.deepEqual(wingman.cosmetics, ["AthenaCharacter:CID_139_Athena_Commando_M_FighterPilot", "AthenaBackpack:BID_056_FighterPilot"]);
  assert.deepEqual(wingman.grants, [{ templateId: "Currency:MtxPurchased", quantity: 500 }, { templateId: "Currency:MtxPurchaseBonus", quantity: 100 }]);
  for (const build of ["4039451", "4053532"]) {
    assert.equal(inBuild(build, () => lockerCosmeticId(wingman.cosmetics[0])), undefined, build);
    assert.equal(inBuild(build, () => isOffered(wingman, undefined)), false, build);
  }
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "WingmanShopper");
    for (const userAgent of [agent40, agent41, agent31]) {
      const offers = currencyOf(await catalog(backend.port, player.token, userAgent))?.catalogEntries ?? [];
      assert.ok(!offers.some((offer) => offer.offerId === "core_starter_br_s4"), userAgent);
      assert.equal(offers.some((offer) => offer.offerId === "core_starter_br_s3"), userAgent === agent31, userAgent);
    }
  } finally {
    backend.close();
  }
});

// Core-Backend #294: the Wingman Starter Pack bought on 4.4.1 (and 4.4.2) gives the Wingman and the Bogey Bag as well as the V-Bucks.
for (const [build, cl] of [["4.4.1", "4127312"], ["4.4.2", "4132537"]]) {
  test(`#294: buying the Wingman Starter Pack on ${build} puts the Wingman and the Bogey Bag in the locker`, async () => {
    const userAgent = `game=Fortnite, engine=UE4, build=++Fortnite+Release-${build}-CL-${cl}`;
    const backend = await startBackend();
    try {
      const player = await userLogin(backend.port, `Wingman${cl}`);
      const offer = currencyOf(await catalog(backend.port, player.token, userAgent))?.catalogEntries.find((o) => o.offerId === "core_starter_br_s4");
      assert.ok(offer, build);
      const done = await complete(backend.port, purchaseIdOf((await open(backend.port, offer.appStoreId[1], userAgent)).body));
      assert.equal(done.status, 200);
      const athena = await query(backend.port, player.accountId, player.token, "athena", userAgent);
      assert.equal(owned(athena, "AthenaCharacter:CID_139_Athena_Commando_M_FighterPilot").length, 1, build);
      assert.equal(owned(athena, "AthenaBackpack:BID_056_FighterPilot").length, 1, build);
      assert.equal(vbucks(await profile0(backend.port, player), "Currency:MtxPurchased"), 500);
    } finally {
      backend.close();
    }
  });
}

test("#294: the Wingman Starter Pack's cosmetics survive an account that already has a Season 3 or Season 4 locker", async () => {
  const agent441 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.4.1-CL-4127312";
  const backend = await startBackend();
  try {
    for (const [name, first] of [["Wingman3Then4", agent351], ["Wingman4Then4", agent441]]) {
      const player = await userLogin(backend.port, name);
      await query(backend.port, player.accountId, player.token, "athena", first);
      const offer = currencyOf(await catalog(backend.port, player.token, agent441))?.catalogEntries.find((o) => o.offerId === "core_starter_br_s4");
      const done = await complete(backend.port, purchaseIdOf((await open(backend.port, offer.appStoreId[1], agent441)).body));
      assert.equal(done.status, 200);
      const athena = await query(backend.port, player.accountId, player.token, "athena", agent441);
      assert.equal(owned(athena, "AthenaCharacter:CID_139_Athena_Commando_M_FighterPilot").length, 1, name);
      assert.equal(owned(athena, "AthenaBackpack:BID_056_FighterPilot").length, 1, name);
    }
  } finally {
    backend.close();
  }
});


// Core-Backend #294: a Battle Royale client doesn't hear of the purchase's athena change (it never subscribes to STOMP
// there), so the next command on another profile brings athena along, as it does the V-Bucks.
test("#294: after a Starter Pack purchase the client's next profile command brings the new cosmetics along", async () => {
  const agent441 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.4.1-CL-4127312";
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "WingmanCatchUp");
    const run = (profileId, command) => send({ host: "127.0.0.1", port: backend.port, method: "POST",
      path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${command}?profileId=${profileId}&rvn=-1`,
      headers: { "User-Agent": agent441, Authorization: `bearer ${player.token}`, "Content-Type": "application/json", "Content-Length": 2 } }, "{}").then((r) => r.body);
    await run("athena", "QueryProfile");
    await run("common_core", "QueryProfile");
    const offer = currencyOf(await catalog(backend.port, player.token, agent441)).catalogEntries.find((o) => o.offerId === "core_starter_br_s4");
    await complete(backend.port, purchaseIdOf((await open(backend.port, offer.appStoreId[1], agent441)).body));
    const verify = await run("common_core", "VerifyRealMoneyPurchase");
    const athena = verify.multiUpdate?.find((update) => update.profileId === "athena");
    assert.ok(athena, "athena comes along");
    const items = Object.values(athena.profileChanges[0].profile.items);
    assert.ok(items.some((item) => item.templateId.toLowerCase() === "athenacharacter:cid_139_athena_commando_m_fighterpilot"));
    assert.ok(items.some((item) => item.templateId.toLowerCase() === "athenabackpack:bid_056_fighterpilot"));
    // Once: the next command doesn't send it again.
    assert.equal((await run("common_core", "QueryProfile")).multiUpdate?.some((update) => update.profileId === "athena") ?? false, false);
  } finally {
    backend.close();
  }
});

// Core-Backend #248: a bought Starter Pack left the Store tab only after a restart. The client keeps its catalog until the
// refresh is due and checks each offer's requirements against the profile whenever it lists the tab (ListMtxPackages,
// store/currency.js offerRequirements), so the pack carries DenyOnFulfillment of its own id, and the purchase's
// fulfillment count reaches the client in its VerifyRealMoneyPurchase response.
const fulfillmentCount = (profile, id) => profile?.stats?.attributes?.in_app_purchases?.fulfillmentCounts?.[id] ?? 0;
// The client's check (4.4.2 0x8465C0) of DenyOnFulfillment, the only requirement type these offers use.
const passes = (offer, profile) => offer.requirements.every(({ requirementType, requiredId, minQuantity }) => {
  assert.equal(requirementType, "DenyOnFulfillment");
  return fulfillmentCount(profile, requiredId) < minQuantity;
});
const agent441 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.4.1-CL-4127312";
for (const [build, userAgent, profileId, offerId] of [["3.1", agent31, "profile0", "core_starter_br_s3"],
  ["3.5.1", agent351, "common_core", "core_starter_br_s3"], ["4.4.1", agent441, "common_core", "core_starter_br_s4"]]) {
  test(`#248: on ${build} the bought Starter Pack leaves the Store tab's catalog the client already has`, async () => {
    const backend = await startBackend();
    try {
      const player = await userLogin(backend.port, `Gone${build.replaceAll(".", "")}`);
      const run = (command) => send({ host: "127.0.0.1", port: backend.port, method: "POST",
        path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${command}?profileId=${profileId}&rvn=${rvn}`,
        headers: { "User-Agent": userAgent, Authorization: `bearer ${player.token}`, "Content-Type": "application/json", "Content-Length": 2 } }, "{}").then((r) => r.body);
      let rvn = -1;
      const login = await run("QueryProfile");
      rvn = login.profileRevision;
      const held = login.profileChanges[0].profile;

      const store = currencyOf(await catalog(backend.port, player.token, userAgent));
      const offer = store.catalogEntries.find((o) => o.offerId === offerId);
      assert.deepEqual(offer.requirements, [{ requirementType: "DenyOnFulfillment", requiredId: offerId, minQuantity: 1 }]);
      // The V-Bucks packs can be bought again and again: no requirements.
      assert.ok(store.catalogEntries.filter((o) => o.offerId.startsWith("core_mtx_")).every((o) => o.requirements.length === 0));
      assert.equal(passes(offer, held), true);

      await complete(backend.port, purchaseIdOf((await open(backend.port, offer.appStoreId[1], userAgent)).body));
      // The client's check after the purchase flow, from the revision it holds: the profile comes back with the count.
      const verify = await run("VerifyRealMoneyPurchase");
      assert.equal(verify.profileId, profileId);
      const updated = verify.profileChanges[0].profile;
      assert.equal(verify.profileChanges[0].changeType, "fullProfileUpdate");
      assert.equal(fulfillmentCount(updated, offerId), 1);
      // The offer in the catalog the client already holds now fails its requirement, so the tab leaves it out.
      assert.equal(passes(offer, updated), false);
      assert.ok(store.catalogEntries.filter((o) => o.offerId.startsWith("core_mtx_")).every((o) => passes(o, updated)));
    } finally {
      backend.close();
    }
  });
}

// Core-Backend #323: the Ace Pack, Season 5's, offered on a Season 5 build whose paks have The Ace and the Swag Bag (5.30
// on; 5.0's to 5.21's have neither), in the Store tab's CurrencyStorefront with the V-Bucks packs.
const agent442 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.4.2-CL-4132537";
const agent521 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-5.21-CL-4288479";
const agent530 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-5.30-CL-4305896";
const agent540 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-5.40-CL-4352937";
const aceCosmetics = ["AthenaCharacter:CID_195_Athena_Commando_F_Bling", "AthenaBackpack:BID_101_BlingFemale"];
const aceOf = (body) => currencyOf(body)?.catalogEntries.find((offer) => offer.offerId === "core_starter_br_s5");
test("#323: the Ace Pack is Season 5's, in the Store tab from 5.30, the first build with The Ace and the Swag Bag", async () => {
  const ace = findRealMoneyOffer("core_starter_br_s5");
  assert.deepEqual([ace.title, ace.season, ace.price, ace.currencyCode, ace.oncePerAccount], ["The Ace Pack", 5, 499, "USD", true]);
  assert.deepEqual(ace.cosmetics, aceCosmetics);
  assert.deepEqual(ace.grants, [{ templateId: "Currency:MtxPurchased", quantity: 500 }, { templateId: "Currency:MtxPurchaseBonus", quantity: 100 }]);
  for (const build of ["4214610", "4240749", "4288479"]) {
    assert.equal(inBuild(build, () => lockerCosmeticId(aceCosmetics[0])), undefined, build);
    assert.equal(inBuild(build, () => lockerCosmeticId(aceCosmetics[1])), undefined, build);
    assert.equal(inBuild(build, () => isOffered(ace, undefined)), false, build);
  }
  for (const build of ["4305896", "4352937"]) assert.equal(inBuild(build, () => isOffered(ace, undefined)), true, build);

  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "AceShopper");
    for (const userAgent of [agent530, agent540]) {
      const offer = aceOf(await catalog(backend.port, player.token, userAgent));
      assert.ok(offer, userAgent);
      assert.equal(offer.title, "The Ace Pack");
      assert.equal(offer.prices[0].currencyType, "RealMoney");
      assert.ok(offer.appStoreId[1].startsWith(`core_starter_br_s5.${player.accountId}.`));
      assert.deepEqual(offer.metaInfo.map(({ key, value }) => `${key}=${value}`), ["MtxQuantity=600", "MtxBonus=100"]);
      assert.equal(offer.displayAssetPath, "/Game/Catalog/DisplayAssets/DA_Featured_CID_195_Athena_Commando_F_Bling.DA_Featured_CID_195_Athena_Commando_F_Bling");
      assert.deepEqual(offer.requirements, [{ requirementType: "DenyOnFulfillment", requiredId: "core_starter_br_s5", minQuantity: 1 }]);
      // The season's one starter pack: the earlier seasons' aren't sold beside it.
      const ids = currencyOf(await catalog(backend.port, player.token, userAgent)).catalogEntries.map((entry) => entry.offerId);
      assert.ok(!ids.includes("core_starter_br_s3") && !ids.includes("core_starter_br_s4"), userAgent);
    }
    // Not on 5.21, whose paks lack both cosmetics, nor in Season 4 (4.4.2 sells the Wingman's) or Season 3.
    assert.equal(aceOf(await catalog(backend.port, player.token, agent521)), undefined);
    assert.equal(aceOf(await catalog(backend.port, player.token, agent442)), undefined);
    assert.equal(aceOf(await catalog(backend.port, player.token, agent31)), undefined);

    // The catalog service prices it, $4.99.
    const id = aceOf(await catalog(backend.port, player.token, agent530)).appStoreId[1];
    const priced = (await as(backend.port, `/catalog/api/shared/bulk/offers?id=${id}&returnItemDetails=false`, await clientToken(backend.port), agent530)).body;
    assert.deepEqual([priced[id].price, priced[id].currencyCode, priced[id].title], [499, "USD", "The Ace Pack"]);

    // The packs' admin setting turns it off too.
    await post(backend.port, "/admin/api/settings", undefined, { vbuckPacks: false });
    assert.equal(aceOf(await catalog(backend.port, player.token, agent530)), undefined);
  } finally {
    backend.close();
  }
});

for (const [build, userAgent] of [["5.30", agent530], ["5.40", agent540]]) {
  test(`#323: buying the Ace Pack on ${build} gives The Ace, the Swag Bag and 600 V-Bucks once, and it can't be bought twice`, async () => {
    const backend = await startBackend();
    try {
      const player = await userLogin(backend.port, `AceBuyer${build.replace(".", "")}`);
      const id = aceOf(await catalog(backend.port, player.token, userAgent)).appStoreId[1];
      const page = await open(backend.port, id, userAgent);
      assert.equal(page.status, 200);
      assert.match(page.body, /The Ace Pack/);
      const second = purchaseIdOf((await open(backend.port, id, userAgent)).body);

      const done = await complete(backend.port, purchaseIdOf(page.body));
      assert.equal(done.status, 200);
      assert.equal(done.body.receipt.TransactionState, "Purchased");
      const athena = await query(backend.port, player.accountId, player.token, "athena", userAgent);
      for (const templateId of aceCosmetics) assert.equal(owned(athena, templateId).length, 1, templateId);
      const core = await query(backend.port, player.accountId, player.token, "common_core", userAgent);
      assert.equal(vbucks(core, "Currency:MtxPurchased"), 500);
      assert.equal(vbucks(core, "Currency:MtxPurchaseBonus"), 100);
      assert.deepEqual(core.stats.attributes.in_app_purchases.fulfillmentCounts, { core_starter_br_s5: 1 });

      // Gone from the Store tab; its page and a second Complete purchase (opened before) are refused, and nothing more is given.
      assert.equal(aceOf(await catalog(backend.port, player.token, userAgent)), undefined);
      assert.equal((await open(backend.port, id, userAgent)).status, 409);
      assert.equal((await complete(backend.port, second)).status, 409);
      assert.equal(vbucks(await query(backend.port, player.accountId, player.token, "common_core", userAgent), "Currency:MtxPurchased"), 500);

      // Another account still has it.
      const other = await userLogin(backend.port, `AceOther${build.replace(".", "")}`);
      assert.ok(aceOf(await catalog(backend.port, other.token, userAgent)));
    } finally {
      backend.close();
    }
  });
}
