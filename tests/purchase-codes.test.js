import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { del, get, post, send, startBackend, userLogin } from "./helpers.js";

// Purchases that need a promo code (Core-Backend #248, store/purchasecodes.js, services/fortnite/purchase.js).
const agent31 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.1-CL-3915963";
const agent351 = "Fortnite/4.20.0-4000805+++Fortnite+Release-3.5 Windows/10.0.17134.1.256.64bit";
const as = (port, requestPath, token, userAgent = agent31) =>
  send({ host: "127.0.0.1", port, path: requestPath, headers: { "User-Agent": userAgent, ...(token ? { Authorization: `bearer ${token}` } : {}) } });
const offerOf = async (port, { token }, offerId, userAgent = agent31) => (await as(port, "/fortnite/api/storefront/v2/catalog", token, userAgent)).body
  .storefronts.find((storefront) => storefront.name === "CurrencyStorefront").catalogEntries.find((offer) => offer.offerId === offerId).appStoreId[1];
const open = (port, id, userAgent = agent31) => as(port, `/purchase?showNavigation=true&namespace=fn&offers=${id}&analyticsSessionId=x`, undefined, userAgent);
const purchaseIdOf = (html) => /name="purchaseId" value="([^"]+)"/.exec(html)?.[1];
const redeem = (port, purchaseId, code) => {
  const body = `purchaseId=${encodeURIComponent(purchaseId)}${code === undefined ? "" : `&code=${encodeURIComponent(code)}`}`;
  return send({ host: "127.0.0.1", port, method: "POST", path: "/purchase/complete",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body), Origin: `http://127.0.0.1:${port}` } }, body);
};
const vbucks = (profile) => Object.values(profile.items).filter((item) => item.templateId.toLowerCase().startsWith("currency:mtxpurchase"))
  .reduce((sum, item) => sum + item.quantity, 0);
const profileOf = (port, { accountId, token }, profileId, userAgent = agent31) => send({ host: "127.0.0.1", port, method: "POST",
  path: `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=${profileId}&rvn=-1`,
  headers: { "User-Agent": userAgent, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": 2 } }, "{}")
  .then((response) => response.body.profileChanges[0].profile);
const makeCode = async (backend, body = {}) => (await post(backend.port, "/admin/api/purchase-codes", undefined, body)).body;
const codeMode = (backend) => post(backend.port, "/admin/api/settings", undefined, { purchaseMode: "code" });

test("free mode is the default and its page keeps the Complete purchase button", async () => {
  const backend = await startBackend();
  try {
    assert.equal((await get(backend.port, "/admin/api/settings")).body.purchaseMode, "free");
    const player = await userLogin(backend.port, "FreeBuyer");
    const id = await offerOf(backend.port, player, "core_mtx_1000");
    const page = await open(backend.port, id);
    assert.match(page.body, /Complete purchase/);
    assert.doesNotMatch(page.body, /name="code"/);
    // A code sent anyway changes nothing: the offer is free.
    const done = await redeem(backend.port, purchaseIdOf(page.body), "SOMETHING");
    assert.equal(done.status, 200);
    assert.equal(vbucks(await profileOf(backend.port, player, "profile0")), 1000);
  } finally {
    backend.close();
  }
});

test("code mode hides the free button, asks for a code, and a page without one grants nothing", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "CodeAsker");
    const id = await offerOf(backend.port, player, "core_mtx_1000");
    const freePage = purchaseIdOf((await open(backend.port, id)).body);
    assert.equal((await codeMode(backend)).body.purchaseMode, "code");
    const page = await open(backend.port, id);
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.body, /Complete purchase/);
    assert.match(page.body, /name="code"/);
    assert.match(page.body, /Redeem code/);

    // No code, including from a page opened before the switch: nothing.
    assert.equal((await redeem(backend.port, purchaseIdOf(page.body))).status, 400);
    assert.equal((await redeem(backend.port, purchaseIdOf(page.body), "  ")).status, 400);
    assert.equal((await redeem(backend.port, freePage)).status, 400);
    assert.equal(vbucks(await profileOf(backend.port, player, "profile0")), 0);
  } finally {
    backend.close();
  }
});

test("a valid code grants the offer once and a single-use code can't be used again", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "CodeBuyer");
    const other = await userLogin(backend.port, "LateBuyer");
    await codeMode(backend);
    const made = await makeCode(backend, { offerId: "core_mtx_2800" });
    assert.match(made.code, /^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){3}$/);
    assert.deepEqual([made.maxUses, made.multiplePerAccount, made.status, made.hint], [1, false, "active", made.code.slice(-4)]);
    // The code is not kept as text.
    assert.doesNotMatch(fs.readFileSync(path.join(backend.dataDir, "purchasecodes.json"), "utf8"), new RegExp(made.code));
    assert.equal(JSON.stringify((await get(backend.port, "/admin/api/purchase-codes")).body).includes(made.code), false);

    const id = await offerOf(backend.port, player, "core_mtx_2800");
    const page = purchaseIdOf((await open(backend.port, id)).body);
    // A wrong code leaves the page to try again.
    assert.equal((await redeem(backend.port, page, "NOT-A-CODE")).status, 400);
    const done = await redeem(backend.port, page, made.code.toLowerCase());
    assert.equal(done.status, 200);
    assert.equal(done.body.receipt.TransactionState, "Purchased");
    const profile = await profileOf(backend.port, player, "profile0");
    assert.equal(vbucks(profile), 2800);
    assert.deepEqual(profile.stats.attributes.in_app_purchases.fulfillmentCounts, { core_mtx_2800: 1 });
    // The page is used up, and so is the code, for the same account and for another.
    assert.equal((await redeem(backend.port, page, made.code)).status, 400);
    const again = await redeem(backend.port, purchaseIdOf((await open(backend.port, id)).body), made.code);
    assert.equal(again.status, 400);
    assert.match(again.body.errorMessage, /used/i);
    const lateId = await offerOf(backend.port, other, "core_mtx_2800");
    assert.equal((await redeem(backend.port, purchaseIdOf((await open(backend.port, lateId)).body), made.code)).status, 400);
    assert.equal(vbucks(await profileOf(backend.port, other, "profile0")), 0);
    assert.equal(vbucks(await profileOf(backend.port, player, "profile0")), 2800);

    const listed = (await get(backend.port, "/admin/api/purchase-codes")).body;
    assert.deepEqual([listed.length, listed[0].usedCount, listed[0].status, listed[0].uses[0].accountId], [1, 1, "used_up", player.accountId]);
  } finally {
    backend.close();
  }
});

test("two requests can't both use a single-use code", async () => {
  const backend = await startBackend();
  try {
    const first = await userLogin(backend.port, "RaceOne");
    const second = await userLogin(backend.port, "RaceTwo");
    await codeMode(backend);
    const made = await makeCode(backend, { code: "race-code-1", offerId: "any" });
    const pages = await Promise.all([first, second].map(async (player) => purchaseIdOf((await open(backend.port, await offerOf(backend.port, player, "core_mtx_1000"))).body)));
    const answers = await Promise.all(pages.map((page) => redeem(backend.port, page, "RACE-CODE-1")));
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 400]);
    assert.equal(made.code, "RACE-CODE-1");
    const total = vbucks(await profileOf(backend.port, first, "profile0")) + vbucks(await profileOf(backend.port, second, "profile0"));
    assert.equal(total, 1000);
  } finally {
    backend.close();
  }
});

test("wrong-offer, expired and revoked codes are refused with a message and grant nothing", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "BadCodes");
    await codeMode(backend);
    const id = await offerOf(backend.port, player, "core_mtx_1000");
    const attempt = async (code) => redeem(backend.port, purchaseIdOf((await open(backend.port, id)).body), code);

    const starter = await makeCode(backend, { offerId: "core_starter_br_s3" });
    const wrong = await attempt(starter.code);
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.errorMessage, /isn't for this offer/);

    const expired = await makeCode(backend, { code: "OLD-CODE", expiresAt: "2020-01-01T00:00:00Z" });
    assert.equal(expired.status, "expired");
    assert.match((await attempt("OLD-CODE")).body.errorMessage, /expired/);

    const revoked = await makeCode(backend, { code: "GONE-CODE" });
    assert.equal((await post(backend.port, `/admin/api/purchase-codes/${revoked.id}/revoke`, undefined, {})).body.status, "revoked");
    assert.match((await attempt("GONE-CODE")).body.errorMessage, /revoked/);
    assert.equal((await post(backend.port, "/admin/api/purchase-codes/nope/revoke", undefined, {})).status, 404);
    assert.equal(vbucks(await profileOf(backend.port, player, "profile0")), 0);

    const reactivated = (await post(backend.port, `/admin/api/purchase-codes/${revoked.id}/reactivate`, undefined, {})).body;
    assert.equal(reactivated.status, "active");
    assert.equal(reactivated.revokedAt, null);
    assert.equal((await post(backend.port, "/admin/api/purchase-codes/nope/reactivate", undefined, {})).status, 404);

    assert.equal((await attempt("GONE-CODE")).status, 200);
    assert.equal(vbucks(await profileOf(backend.port, player, "profile0")), 1000);

    assert.equal((await del(backend.port, `/admin/api/purchase-codes/${revoked.id}`)).status, 200);
    assert.equal((await del(backend.port, `/admin/api/purchase-codes/${revoked.id}`)).status, 404);
    assert.equal((await post(backend.port, `/admin/api/purchase-codes/${revoked.id}/revoke`, undefined, {})).status, 404);
    assert.equal((await post(backend.port, `/admin/api/purchase-codes/${revoked.id}/reactivate`, undefined, {})).status, 404);
  } finally {
    backend.close();
  }
});

test("a code has uses, an account's own limit, an offer or any, and a page for the code's page alone", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Repeater");
    const friend = await userLogin(backend.port, "Friend");
    await codeMode(backend);
    const id = await offerOf(backend.port, player, "core_mtx_1000");
    const friendId = await offerOf(backend.port, friend, "core_mtx_1000");
    const attempt = async (accountId, code) => redeem(backend.port, purchaseIdOf((await open(backend.port, accountId)).body), code);

    // Three uses, one per account: the same account can't take two.
    await makeCode(backend, { code: "THREE-USES", maxUses: 3 });
    assert.equal((await attempt(id, "THREE-USES")).status, 200);
    const twice = await attempt(id, "THREE-USES");
    assert.equal(twice.status, 400);
    assert.match(twice.body.errorMessage, /Your account/);
    assert.equal((await attempt(friendId, "THREE-USES")).status, 200);

    // Repeatable by an account.
    await makeCode(backend, { code: "AGAIN-AND-AGAIN", maxUses: 2, multiplePerAccount: true });
    assert.equal((await attempt(id, "AGAIN-AND-AGAIN")).status, 200);
    assert.equal((await attempt(id, "AGAIN-AND-AGAIN")).status, 200);
    assert.equal((await attempt(id, "AGAIN-AND-AGAIN")).status, 400);
    assert.equal(vbucks(await profileOf(backend.port, player, "profile0")), 3000);

    // Validation.
    for (const bad of [{ offerId: "core_mtx_5" }, { maxUses: 0 }, { maxUses: 1.5 }, { expiresAt: "tomorrow-ish" }, { code: "ab" }, { code: "has space" }, { count: 2, code: "ONE-ONLY" }]) {
      assert.equal((await post(backend.port, "/admin/api/purchase-codes", undefined, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await post(backend.port, "/admin/api/purchase-codes", undefined, { code: "three-uses" })).status, 400, "a code exists once");
    const batch = (await post(backend.port, "/admin/api/purchase-codes", undefined, { count: 3, offerId: "core_mtx_1000" })).body.codes;
    assert.equal(new Set(batch.map((code) => code.code)).size, 3);
  } finally {
    backend.close();
  }
});

test("a code is kept across a restart, and the Starter Pack's limit still holds", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StarterCoder");
    await codeMode(backend);
    const made = await makeCode(backend, { offerId: "core_starter_br_s3", maxUses: 5, multiplePerAccount: true });
    const id = await offerOf(backend.port, player, "core_starter_br_s3");
    assert.equal((await redeem(backend.port, purchaseIdOf((await open(backend.port, id)).body), made.code)).status, 200);
    // Bought once per account: the page is refused and the code isn't spent.
    assert.equal((await open(backend.port, id)).status, 409);
    const listed = (await get(backend.port, "/admin/api/purchase-codes")).body;
    assert.equal(listed[0].usedCount, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(backend.dataDir, "purchasecodes.json"), "utf8"));
    assert.equal(Object.keys(saved.codes).length, 1);
  } finally {
    backend.close();
  }
});

test("wrong codes are rate limited per account, and the lock-out holds even for a good code", async () => {
  const backend = await startBackend();
  try {
    const guesser = await userLogin(backend.port, "Guesser");
    const innocent = await userLogin(backend.port, "Innocent");
    await codeMode(backend);
    const made = await makeCode(backend, { offerId: "any" });
    const id = await offerOf(backend.port, guesser, "core_mtx_1000");
    const page = purchaseIdOf((await open(backend.port, id)).body);
    for (let tries = 1; tries <= 5; tries += 1) assert.equal((await redeem(backend.port, page, `GUESS-${tries}`)).status, 400, `try ${tries}`);
    const locked = await redeem(backend.port, page, made.code);
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers["retry-after"]) > 0);
    assert.equal(vbucks(await profileOf(backend.port, guesser, "profile0")), 0);
    // Another account (from the same address) isn't locked by it.
    const innocentId = await offerOf(backend.port, innocent, "core_mtx_1000");
    assert.equal((await redeem(backend.port, purchaseIdOf((await open(backend.port, innocentId)).body), made.code)).status, 200);
  } finally {
    backend.close();
  }
});

test("a code pays on 3.5.1, whose V-Bucks are common_core's", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Codes351");
    await codeMode(backend);
    const made = await makeCode(backend, { offerId: "any" });
    const id = await offerOf(backend.port, player, "core_mtx_7500", agent351);
    const page = await open(backend.port, id, agent351);
    assert.match(page.body, /name="code"/);
    assert.equal((await redeem(backend.port, purchaseIdOf(page.body), made.code)).status, 200);
    const core = await profileOf(backend.port, player, "common_core", agent351);
    assert.equal(vbucks(core), 7500);
    assert.deepEqual(core.stats.attributes.in_app_purchases.fulfillmentCounts, { core_mtx_7500: 1 });
  } finally {
    backend.close();
  }
});

test("the panel's settings and codes need the admin, and the mode is validated", async () => {
  const backend = await startBackend();
  try {
    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { purchaseMode: "nonsense" })).body.purchaseMode, "free");
    assert.equal((await get(backend.port, "/admin/api/shop")).body.purchaseMode, "free");
    await codeMode(backend);
    assert.equal((await get(backend.port, "/admin/api/shop")).body.purchaseMode, "code");
    assert.equal((await del(backend.port, "/admin/api/purchase-codes/none")).status, 404);
  } finally {
    backend.close();
  }
});
