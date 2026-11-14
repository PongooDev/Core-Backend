import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { sentToHost } from "../src/network.js";
import { grant } from "../src/profiles/progress.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { purchaseCatalogEntry } from "../src/services/mcp/commands/PurchaseCatalogEntry.js";
import { refundMtxPurchase } from "../src/services/mcp/commands/RefundMtxPurchase.js";
import { createSettingsStore } from "../src/settings/store.js";
import { createCreatorPayoutStore, payCreator } from "../src/store/creatorpayouts.js";
import { affiliateCheck, affiliateRuntimeOptions, approvedCreatorsPage, configureCreators, creatorList, creatorPayout, sanitizeCreators,
  withLegacyNames } from "../src/store/creators.js";
import { configureItemShop } from "../src/store/itemshop.js";
import { purchaseHistoryOf } from "../src/store/refunds.js";
import { get, post, request, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #349: Support-A-Creator managed from the admin panel. Creators are accounts with codes of their own; a
// supporter's item shop purchase pays the creator a share of the V-Bucks spent; enabled creators get Twitch Prime Packs.
const v602 = "4461277";
const v610 = "4480234";
const v620 = "4497486";
const v621 = "4526925";
const v36 = "4019403";
const v30 = "3901517";
const agentOf = (build, version) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-${version}-CL-${build}`;

const creatorsOf = (...entries) => ({ creators: entries.map(([accountId, code, enabled = true], index) => ({ id: `c${index}`, accountId, code, enabled })) });

test("creator codes: kept once in any case, one per account; the hotfix per build; the service's check and the approved list", () => {
  const kept = sanitizeCreators([
    { accountId: "a1", code: " Ninja " }, { accountId: "a2", code: "NINJA" }, { accountId: "a1", code: "Other" },
    { accountId: "a3", code: "x" }, { accountId: "a4", code: "bad=code" }, { accountId: "a5", code: "Core Creator", enabled: false }, "junk", null
  ]);
  assert.deepEqual(kept.map(({ accountId, code, enabled }) => [accountId, code, enabled]), [["a1", "Ninja", true], ["a5", "Core Creator", false]]);
  assert.ok(kept.every(({ id, added }) => id && !Number.isNaN(Date.parse(added))));
  assert.equal(sanitizeCreators("Ninja"), undefined);

  // The old list (settings creatorNames, config.json) becomes the creators without an account, beside the accounts' ones.
  const merged = withLegacyNames(kept, ["Pongo", "ninja", "Pongo"]);
  assert.deepEqual(merged.map(({ accountId, code }) => [accountId, code]), [["a1", "Ninja"], ["a5", "Core Creator"], [null, "Pongo"]]);
  assert.deepEqual(creatorList({ creatorNames: ["Old Name"] }).map(({ accountId, code, enabled }) => [accountId, code, enabled]), [[null, "Old Name", true]]);

  const settings = creatorsOf(["a1", "Ninja"], ["a2", "Sleepy", false]);
  // 6.02 and 6.10 read the hotfixed array; 6.20 and 6.21 ask the affiliate service, the array off. Only enabled codes.
  for (const build of [v602, v610]) {
    assert.deepEqual(affiliateRuntimeOptions(build, settings, { creatorsUrl: "http://play.example:5595/affiliate/creators" }),
      ["bDisableAffiliateFeature=false", "bUseHotfixedAffiliateNamesArray=true", "!AffiliateNames=ClearArray", "+AffiliateNames=Ninja",
        "ListOfCreatorsURL=http://play.example:5595/affiliate/creators"], build);
  }
  for (const build of [v620, v621]) {
    assert.deepEqual(affiliateRuntimeOptions(build, settings), ["bDisableAffiliateFeature=false", "bUseHotfixedAffiliateNamesArray=false",
      "!AffiliateNames=ClearArray", "+AffiliateNames=Ninja"], build);
  }
  assert.deepEqual(affiliateRuntimeOptions(v620, creatorsOf(["a2", "Sleepy", false])), [], "nothing while no code is enabled");
  assert.equal(affiliateCheck("NINJA", settings).status, "ACTIVE");
  assert.equal(affiliateCheck("NINJA", settings).slug, "Ninja");
  assert.equal(affiliateCheck("sleepy", settings), null, "a disabled code is the service's 404");
  const page = approvedCreatorsPage(creatorsOf(["a1", "Ninja"], ["a2", "<b>Sleepy</b>"], ["a3", "Off Code", false]));
  assert.match(page, /<li>Ninja<\/li>/);
  assert.doesNotMatch(page, /Off Code/);
  assert.match(approvedCreatorsPage({ creators: [] }), /No creators yet/);
});

test("the payout is the panel's percentage of what was spent, rounded down: 100% by default", () => {
  assert.equal(creatorPayout(2000, {}), 2000);
  assert.equal(creatorPayout(800, { creatorPayoutPercent: 5 }), 40);
  assert.equal(creatorPayout(1500, { creatorPayoutPercent: 5 }), 75);
  assert.equal(creatorPayout(10, { creatorPayoutPercent: 5 }), 0);
  assert.equal(creatorPayout(1200, { creatorPayoutPercent: 0 }), 0);
  const store = createSettingsStore(null);
  assert.deepEqual([store.get().creators, store.get().creatorPayoutPercent, store.get().creatorTwitchPrimePacks], [[], 100, true]);
  store.update({ creatorPayoutPercent: 101 });
  assert.equal(store.get().creatorPayoutPercent, 100, "out of range is ignored");
  store.update({ creatorPayoutPercent: 5, creatorTwitchPrimePacks: false });
  assert.deepEqual([store.get().creatorPayoutPercent, store.get().creatorTwitchPrimePacks], [5, false]);
});

test("a settings file of before #349 keeps its creator names as creators without an account", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-creators-"));
  try {
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ creatorNames: ["Ninja", "Core Creator"] }));
    const store = createSettingsStore(dataDir);
    assert.deepEqual(store.get().creators.map(({ accountId, code, enabled }) => [accountId, code, enabled]), [[null, "Ninja", true], [null, "Core Creator", true]]);
    assert.equal(store.get().creatorNames, undefined);
    assert.equal(store.get().creatorPayoutPercent, 100);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// Season 3's replay day 65 (index 64) is 27 April 2018, Steelsight's first day in the shop (tests/refunds.test.js).
const steelsight = "core_br_cid_111_athena_commando_f_robo";
function withShop(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-creator-pay-"));
  const start = new Date(Date.now() - 64 * 86400000).toISOString().slice(0, 10);
  configureItemShop({ mode: "fnbr", rotationHour: 0, seasonStarts: { 3: start } });
  try {
    return fn(dataDir);
  } finally {
    configureItemShop(null);
    configureCreators(undefined);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
const vbucks = (session) => Object.values(session.profile("profile0").profile.items)
  .filter(({ templateId }) => templateId.toLowerCase().startsWith("currency:mtx")).reduce((sum, item) => sum + item.quantity, 0);

test("an item shop purchase with a creator's code pays the creator; their own code pays nothing; a return takes it back", () => withShop((dataDir) => inBuild(v36, () => {
  const profiles = createProfileStore(dataDir);
  const payouts = createCreatorPayoutStore(dataDir);
  let settings = creatorsOf(["creatorA", "CreatorA"], ["creatorB", "Sleepy", false]);
  configureCreators(() => settings);
  const sessions = new Map();
  const sessionOf = (accountId) => {
    if (!sessions.has(accountId)) sessions.set(accountId, openSession(profiles, accountId));
    return sessions.get(accountId);
  };
  const commit = () => {
    for (const session of sessions.values()) session.commit();
    sessions.clear();
  };
  const context = { creatorPayouts: payouts };
  const buy = (accountId, offerId = steelsight) => {
    const session = sessionOf(accountId);
    purchaseCatalogEntry({ req: { body: { offerId, currency: "MtxCurrency", expectedPrice: 1500 } }, session, notifications: [], sessionFor: sessionOf, context });
    commit();
  };
  const support = (accountId, code) => {
    sessionOf(accountId).profile("profile0").setStat("mtx_affiliate", code);
    commit();
  };
  for (const accountId of ["buyer", "creatorA", "creatorB"]) grant(sessionOf(accountId), "Currency:mtxgiveaway", 5000);
  commit();
  const balance = (accountId) => {
    const value = vbucks(sessionOf(accountId));
    sessions.clear();
    return value;
  };

  // No code: nobody is paid.
  buy("buyer");
  assert.equal(balance("creatorA"), 5000);
  assert.deepEqual(payouts.totals("creatorA"), { vbucks: 0, purchases: 0, spent: 0, reversed: 0 });

  const purchases = (accountId) => {
    const list = purchaseHistoryOf(sessionOf(accountId).profile("profile0").profile.stats.attributes).purchases;
    sessions.clear();
    return list;
  };
  const refund = (accountId, purchaseId) => {
    refundMtxPurchase({ req: { body: { purchaseId } }, session: sessionOf(accountId), sessionFor: sessionOf, context });
    commit();
  };
  // Steelsight is owned now: returned (3.6), it can be bought again. A purchase without a code takes nothing back.
  refund("buyer", purchases("buyer")[0].purchaseId);
  assert.equal(balance("creatorA"), 5000);

  // The code set (any case): the creator gets the 1,500 spent, recorded.
  support("buyer", "creatora");
  buy("buyer");
  assert.equal(balance("creatorA"), 6500);
  assert.equal(balance("buyer"), 5000 - 1500);
  assert.deepEqual(payouts.totals("creatorA"), { vbucks: 1500, purchases: 1, spent: 1500, reversed: 0 });
  const [payout] = payouts.recent("creatorA");
  assert.deepEqual([payout.buyerAccountId, payout.code, payout.offerId, payout.spent, payout.vbucks], ["buyer", "CreatorA", steelsight, 1500, 1500]);
  const entry = purchases("buyer").at(-1);
  assert.deepEqual(entry.coreCreatorPayout, { payoutId: payout.id, creatorAccountId: "creatorA", code: "CreatorA", vbucks: 1500, spent: 1500 });

  // Returned, the payout comes back from the creator.
  refund("buyer", entry.purchaseId);
  assert.equal(balance("creatorA"), 5000);
  assert.deepEqual(payouts.totals("creatorA"), { vbucks: 0, purchases: 0, spent: 0, reversed: 1 });
  assert.equal(payouts.recent("creatorA")[0].takenBack, 1500);

  // 5%: 75 of 1,500.
  settings = { ...settings, creatorPayoutPercent: 5 };
  buy("buyer");
  assert.equal(balance("creatorA"), 5075);

  // A creator buying with their own code is paid nothing.
  support("creatorA", "CreatorA");
  buy("creatorA");
  assert.equal(balance("creatorA"), 5075 - 1500);
  assert.equal(payouts.totals("creatorA").purchases, 1);

  // A disabled code pays nobody.
  support("creatorA", "Sleepy");
  const before = balance("creatorB");
  assert.equal(payCreator({ session: openSession(profiles, "creatorA"), sessionFor: sessionOf, payouts, offerId: steelsight, spent: 1500 }), null);
  sessions.clear();
  assert.equal(balance("creatorB"), before);

  // The payouts are kept on disk.
  assert.equal(createCreatorPayoutStore(dataDir).totals("creatorA").vbucks, 75);
})));

test("the admin panel's creators: accounts with codes, checked; on and off; paid totals; nothing a client can set", async () => {
  const backend = await startBackend();
  try {
    const creator = await userLogin(backend.port, "StreamerOne");
    const other = await userLogin(backend.port, "StreamerTwo");
    const empty = await get(backend.port, "/admin/api/creators");
    assert.deepEqual([empty.body.creators, empty.body.payoutPercent, empty.body.epicPayoutPercent, empty.body.twitchPrimePacks], [[], 100, 5, true]);

    const invalid = async (body, pattern) => {
      const answer = await post(backend.port, "/admin/api/creators", undefined, body);
      assert.equal(answer.status, 400, JSON.stringify(body));
      assert.match(answer.body.errorMessage, pattern);
    };
    await invalid({ account: "StreamerOne", code: "x" }, /3 to 32/);
    await invalid({ account: "StreamerOne", code: "bad=code" }, /3 to 32/);
    await invalid({ account: "Nobody", code: "Fine" }, /No player account/);
    await invalid({ code: "Fine" }, /Pick the account/);
    await invalid({ account: "StreamerOne", code: "Fine", enabled: "yes" }, /enabled/);

    const added = await post(backend.port, "/admin/api/creators", undefined, { account: "streamerone", code: "StreamOne" });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    const [entry] = added.body.creators;
    assert.deepEqual([entry.accountId, entry.displayName, entry.code, entry.enabled], [creator.accountId, "StreamerOne", "StreamOne", true]);
    assert.deepEqual(entry.totals, { vbucks: 0, purchases: 0, spent: 0, reversed: 0 });
    await invalid({ account: other.accountId, code: "STREAMONE" }, /already a creator code/);
    await invalid({ account: creator.accountId, code: "Another" }, /already a creator/);
    const second = await post(backend.port, "/admin/api/creators", undefined, { account: other.accountId, code: "StreamTwo", enabled: false });
    assert.equal(second.status, 200);
    const secondId = second.body.creators[1].id;
    assert.equal(second.body.creators[1].enabled, false);

    // Changes: the code (unique, any case), the switch; removal.
    const clash = await post(backend.port, `/admin/api/creators/${secondId}`, undefined, { code: "streamone" });
    assert.equal(clash.status, 400);
    const renamed = await post(backend.port, `/admin/api/creators/${secondId}`, undefined, { code: "Stream Two", enabled: true });
    assert.equal(renamed.status, 200);
    assert.deepEqual([renamed.body.creators[1].code, renamed.body.creators[1].enabled], ["Stream Two", true]);
    const sameCase = await post(backend.port, `/admin/api/creators/${secondId}`, undefined, { code: "STREAM TWO" });
    assert.equal(sameCase.status, 200, "its own code in another case");
    assert.equal((await post(backend.port, "/admin/api/creators/nope", undefined, { enabled: false })).status, 404);
    assert.deepEqual((await get(backend.port, "/admin/api/shop?season=6")).body.creatorNames, ["StreamOne", "STREAM TWO"]);
    const removed = await request(backend.port, "DELETE", `/admin/api/creators/${secondId}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.creators.map(({ code }) => code), ["StreamOne"]);

    // The payout's share and the packs' switch, checked; the list never through /admin/api/settings.
    for (const bad of [-1, 101, 2.5, "50"]) assert.equal((await post(backend.port, "/admin/api/settings", undefined, { creatorPayoutPercent: bad })).status, 400, String(bad));
    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { creatorTwitchPrimePacks: "no" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { creators: [{ accountId: other.accountId, code: "Sneaky" }] })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { creatorPayoutPercent: 5, creatorTwitchPrimePacks: false })).status, 200);
    const view = (await get(backend.port, "/admin/api/creators")).body;
    assert.deepEqual([view.payoutPercent, view.twitchPrimePacks], [5, false]);

    // A player can only pick an enabled code; nothing the game sends makes anyone a creator.
    const agent = agentOf(v620, "6.20");
    const mcp = (player, command, profileId, body = {}) => {
      const text = JSON.stringify(body);
      return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${command}?profileId=${profileId}&rvn=-1`,
        headers: { "User-Agent": agent, Authorization: `bearer ${player.token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
    };
    assert.equal((await mcp(other, "SetAffiliateName", "common_core", { affiliateName: "STREAM TWO" })).status, 400, "a removed code");
    assert.equal((await mcp(other, "SetAffiliateName", "common_core", { affiliateName: "streamone" })).status, 200);
    assert.deepEqual((await get(backend.port, "/admin/api/creators")).body.creators.map(({ code }) => code), ["StreamOne"]);
  } finally {
    backend.close();
  }
});

test("6.20 end to end: the hotfix, the code check, SetAffiliateName and a shop purchase paying the creator, who sees it", async () => {
  const backend = await startBackend();
  try {
    const creator = await userLogin(backend.port, "Payee620");
    const buyer = await userLogin(backend.port, "Buyer620");
    const agent = agentOf(v620, "6.20");
    const call = (player, method, route, body) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      return send({ host: "127.0.0.1", port: backend.port, method, path: route,
        headers: { "User-Agent": agent, Authorization: `bearer ${player.token}`, ...(text ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } : {}) } }, text);
    };
    const mcp = (player, command, profileId, body = {}) => call(player, "POST", `/fortnite/api/game/v2/profile/${player.accountId}/client/${command}?profileId=${profileId}&rvn=-1`, body);
    const profileOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId).profileChanges[0].profile;
    const balance = async (player) => Object.values(profileOf((await mcp(player, "QueryProfile", "common_core")).body, "common_core").items)
      .filter(({ templateId }) => templateId.toLowerCase().startsWith("currency:mtx")).reduce((sum, item) => sum + item.quantity, 0);
    const runtimeOptions = async () => String((await call(buyer, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini")).body);

    assert.doesNotMatch(await runtimeOptions(), /Affiliate/, "off while there is no creator");
    const added = await post(backend.port, "/admin/api/creators", undefined, { account: creator.accountId, code: "PayMe" });
    assert.equal(added.status, 200);
    const file = await runtimeOptions();
    assert.match(file, /bDisableAffiliateFeature=false\r\nbUseHotfixedAffiliateNamesArray=false\r\n!AffiliateNames=ClearArray\r\n\+AffiliateNames=PayMe\r\n/);
    assert.match(file, new RegExp(`ListOfCreatorsURL=http://127\\.0\\.0\\.1:${backend.port}/affiliate/creators\\r\\n`));
    const page = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/affiliate/creators" });
    assert.equal(page.status, 200);
    assert.match(String(page.body), /<li>PayMe<\/li>/);
    assert.equal((await call(buyer, "GET", "/affiliate/api/public/affiliates/slug/payme")).body.status, "ACTIVE");

    assert.equal((await mcp(buyer, "SetAffiliateName", "common_core", { affiliateName: "payme" })).status, 200);
    assert.equal(profileOf((await mcp(buyer, "QueryProfile", "common_core")).body, "common_core").stats.attributes.mtx_affiliate, "PayMe");
    await mcp(buyer, "QueryProfile", "athena");
    assert.equal((await post(backend.port, `/admin/api/accounts/${buyer.accountId}/currency`, undefined, { key: "vbucks", quantity: 10000 })).status, 200);

    const before = await balance(creator);
    const { storefronts } = (await call(buyer, "GET", "/fortnite/api/storefront/v2/catalog")).body;
    const offer = storefronts.filter(({ name }) => name === "BRDailyStorefront" || name === "BRWeeklyStorefront").flatMap(({ catalogEntries }) => catalogEntries)
      .find((entry) => entry.prices?.[0]?.currencyType === "MtxCurrency" && entry.prices[0].finalPrice > 0);
    assert.ok(offer, "the 6.20 item shop has an offer");
    const price = offer.prices[0].finalPrice;
    const bought = await mcp(buyer, "PurchaseCatalogEntry", "common_core", { offerId: offer.offerId, purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: price });
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    assert.equal(await balance(creator), before + price, "the creator gets what was spent");
    assert.equal(await balance(buyer), 10000 - price);
    const view = (await get(backend.port, "/admin/api/creators")).body.creators[0];
    assert.deepEqual([view.totals.vbucks, view.totals.purchases], [price, 1]);
    assert.equal(view.recent[0].buyerName, "Buyer620");

    // Disabled, the code is refused and the check is a 404; the hotfix goes.
    await post(backend.port, `/admin/api/creators/${view.id}`, undefined, { enabled: false });
    assert.equal((await call(buyer, "GET", "/affiliate/api/public/affiliates/slug/payme")).status, 404);
    assert.equal((await mcp(buyer, "SetAffiliateName", "common_core", { affiliateName: "PayMe" })).status, 400);
    assert.doesNotMatch(await runtimeOptions(), /Affiliate/);
  } finally {
    backend.close();
  }
});

const pack1 = ["athenacharacter:cid_089_athena_commando_m_retrogrey", "athenacharacter:cid_085_athena_commando_m_twitch", "athenabackpack:bid_029_retrogrey",
  "athenaglider:glider_id_018_twitch", "athenapickaxe:pickaxe_id_039_tacticalblack"];
const pack2 = ["athenacharacter:cid_114_athena_commando_f_tacticalwoodland", "athenabackpack:bid_049_tacticalwoodland",
  "athenapickaxe:pickaxe_id_044_tacticalurbanhammer", "athenadance:eid_hiphop01"];

test("an enabled creator gets Twitch Prime Packs #1 and #2 as far as the build has them, kept when the code is disabled", async () => {
  const backend = await startBackend();
  try {
    const athena = async (player, build, version) => {
      const response = await send({ host: "127.0.0.1", port: backend.port, method: "POST",
        path: `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=athena&rvn=-1`,
        headers: { "User-Agent": agentOf(build, version), Authorization: `bearer ${player.token}`, "Content-Type": "application/json", "Content-Length": 2 } }, "{}");
      const update = [response.body, ...(response.body.multiUpdate ?? [])].find((entry) => entry.profileId === "athena");
      return Object.values(update.profileChanges[0].profile.items).map(({ templateId }) => templateId.toLowerCase());
    };
    const has = (items, ids) => ids.filter((id) => items.includes(id));
    const creator = await userLogin(backend.port, "PackCreator");
    const player = await userLogin(backend.port, "PackPlayer");
    assert.deepEqual(has(await athena(creator, v620, "6.20"), [...pack1, ...pack2]), [], "not a creator yet");

    const added = await post(backend.port, "/admin/api/creators", undefined, { account: creator.accountId, code: "PackCode", enabled: false });
    assert.deepEqual(has(await athena(creator, v620, "6.20"), [...pack1, ...pack2]), [], "a disabled code gives nothing");
    // With the packs' switch off, enabling gives nothing.
    await post(backend.port, "/admin/api/settings", undefined, { creatorTwitchPrimePacks: false });
    await post(backend.port, `/admin/api/creators/${added.body.creators[0].id}`, undefined, { enabled: true });
    assert.deepEqual(has(await athena(creator, v620, "6.20"), [...pack1, ...pack2]), []);
    await post(backend.port, "/admin/api/settings", undefined, { creatorTwitchPrimePacks: true });

    // 3.0 has four of them (Instigator comes with 3.5, Pack #2 with 4.0); 6.20 all nine.
    assert.deepEqual(has(await athena(creator, v30, "3.0"), [...pack1, ...pack2]).sort(), pack1.filter((id) => !id.includes("pickaxe")).sort());
    assert.deepEqual(has(await athena(creator, v620, "6.20"), [...pack1, ...pack2]).sort(), [...pack1, ...pack2].sort());
    assert.deepEqual(has(await athena(player, v620, "6.20"), [...pack1, ...pack2]), [], "other players get nothing");

    // Disabled, the creator keeps them.
    await post(backend.port, `/admin/api/creators/${added.body.creators[0].id}`, undefined, { enabled: false });
    assert.deepEqual(has(await athena(creator, v620, "6.20"), [...pack1, ...pack2]).sort(), [...pack1, ...pack2].sort());
    // The Season 3 option stays its own (Core-Backend #229), off by default.
    assert.equal((await get(backend.port, "/admin/api/settings")).body.twitchPrimePack, false);
  } finally {
    backend.close();
  }
});

// Reporter of #349: "View Approved Creators" only opened the browser. With the launcher's defaults a client has the
// -httpproxy and CoreRedirect, so its cloudstorage request reaches the backend in the proxy's absolute form, to the
// launcher's backend address: that address is the one the player's browser can open, not the connection's own
// (127.0.0.1 behind a local tunnel agent, the local port behind a forwarded one).
test("the approved creators URL is the address the game sent its request to, through the -httpproxy too", async () => {
  assert.equal(sentToHost({ viaHttpProxy: true, headers: { host: "play.example.org:40123" }, socket: {} }), "play.example.org:40123");
  assert.equal(sentToHost({ headers: { host: "203.0.113.7:5600" }, socket: {} }), "203.0.113.7:5600");
  assert.equal(sentToHost({ viaHttpProxy: true, headers: { host: "fortnite-public-service-prod11.ol.epicgames.com" }, socket: {} }), null,
    "an Epic host: no CoreRedirect, so not this backend's address");
  assert.equal(sentToHost({ headers: { host: "play.example.org:443" }, socket: { httpProxyTunnel: "play.example.org:443" } }), null);
  assert.equal(sentToHost({ headers: { host: "bad host/x" }, socket: {} }), null);

  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ProxyViewer");
    await post(backend.port, "/admin/api/creators", undefined, { account: player.accountId, code: "ViewMe" });
    const optionsVia = async (path, host) => String((await send({ host: "127.0.0.1", port: backend.port, method: "GET", path,
      headers: { Host: host, "User-Agent": agentOf(v621, "6.21"), Authorization: `bearer ${player.token}` } })).body);
    // The launcher's address for a friend's backend through a tunnel, which the connection (from 127.0.0.1) doesn't show.
    const tunnelled = await optionsVia("http://play.example.org:40123/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini", "play.example.org:40123");
    assert.match(tunnelled, /\r\nListOfCreatorsURL=http:\/\/play\.example\.org:40123\/affiliate\/creators\r\n/);
    // Without CoreRedirect the host is Epic's: the connection's own address stands in.
    const epic = await optionsVia("http://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini",
      "fortnite-public-service-prod11.ol.epicgames.com");
    assert.match(epic, new RegExp(`\r\nListOfCreatorsURL=http://127\.0\.0\.1:${backend.port}/affiliate/creators\r\n`));
    // The page itself, as a browser asks for it.
    const page = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/affiliate/creators", headers: { Accept: "text/html" } });
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    assert.match(String(page.body), /<li>ViewMe<\/li>/);
  } finally {
    backend.close();
  }
});
