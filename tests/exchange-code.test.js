import { test } from "node:test";
import assert from "node:assert/strict";
import { clientToken, get, requestToken, send, startBackend, userLogin } from "./helpers.js";
import { redactUrl } from "../src/log.js";
import { purchaseQuery } from "../src/services/fortnite/purchase.js";

// Core-Backend #248: the purchase flow's cookie is always Secure, which CEF won't set for an http:// page, so the flow
// signs its page in with an exchange code (FOnlineIdentityMcp::GenerateAuthRedirectUrl) and opens
// <Protocol>://<RedirectUrl>/exchange?exchangeCode=<code>&redirectUrl=<its page>.
const agent351 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.5-CL-4000805";
const as = (port, path, extra = {}) => send({ host: "127.0.0.1", port, path, headers: { "User-Agent": agent351, ...extra } });
const exchange = (port, token) => get(port, "/account/api/oauth/exchange", token);

async function starterPackId(port, token) {
  const catalog = (await send({ host: "127.0.0.1", port, path: "/fortnite/api/storefront/v2/catalog",
    headers: { "User-Agent": agent351, Authorization: `bearer ${token}` } })).body;
  return catalog.storefronts.find((storefront) => storefront.name === "CurrencyStorefront").catalogEntries[0].appStoreId[1];
}

test("an account's token gets a five-minute exchange code, in Epic's shape; a client token gets none", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ExchangeUser");
    const answer = await exchange(backend.port, player.token);
    assert.equal(answer.status, 200);
    assert.equal(answer.headers["cache-control"], "no-store");
    assert.match(answer.body.code, /^[0-9a-f]{32}$/);
    assert.equal(answer.body.expiresInSeconds, 300);
    assert.equal(answer.body.creatingClientId, "ec684b8c687f479fadea3cb2ad83f5c6");
    assert.notEqual((await exchange(backend.port, player.token)).body.code, answer.body.code);

    assert.equal((await exchange(backend.port)).status, 401);
    assert.equal((await exchange(backend.port, "nope")).status, 401);
    assert.equal((await exchange(backend.port, await clientToken(backend.port))).status, 403);
  } finally {
    backend.close();
  }
});

test("the exchange_code grant logs the code's account in, once", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ExchangeGrant");
    const { code } = (await exchange(backend.port, player.token)).body;
    const login = await requestToken(backend.port, { grant_type: "exchange_code", exchange_code: code });
    assert.equal(login.status, 200);
    assert.equal(login.body.account_id, player.accountId);
    assert.ok(login.body.refresh_token);
    assert.equal((await get(backend.port, "/account/api/oauth/verify", login.body.access_token)).body.account_id, player.accountId);

    const again = await requestToken(backend.port, { grant_type: "exchange_code", exchange_code: code });
    assert.equal(again.status, 400);
    assert.equal(again.body.errorCode, "errors.com.epicgames.account.oauth.exchange_code_not_found");
    assert.equal((await requestToken(backend.port, { grant_type: "exchange_code", exchange_code: "0".repeat(32) })).status, 400);
    assert.equal((await requestToken(backend.port, { grant_type: "exchange_code" })).status, 400);
  } finally {
    backend.close();
  }
});

test("an exchange code expires after five minutes", async (t) => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ExchangeLate");
    const { code } = (await exchange(backend.port, player.token)).body;
    const now = Date.now();
    t.mock.method(Date, "now", () => now + 301_000);
    assert.equal((await requestToken(backend.port, { grant_type: "exchange_code", exchange_code: code })).status, 400);
  } finally {
    backend.close();
  }
});

test("the purchase flow's /exchange signs the page in and goes on to this backend's /purchase only", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ExchangeBuyer");
    const other = await userLogin(backend.port, "ExchangeOther");
    const offers = await starterPackId(backend.port, player.token);
    const pageUrl = `http:///127.0.0.1:${backend.port}/purchase?showNavigation=true&namespace=fn&offers=${encodeURIComponent(offers)}&analyticsSessionId=x`;
    const sso = (code, redirectUrl = pageUrl) => as(backend.port, `/exchange?exchangeCode=${code}&redirectUrl=${encodeURIComponent(redirectUrl)}`);

    const { code } = (await exchange(backend.port, player.token)).body;
    const signed = await sso(code);
    assert.equal(signed.status, 302);
    assert.equal(signed.headers.location, `/purchase?showNavigation=true&namespace=fn&offers=${encodeURIComponent(offers)}&analyticsSessionId=x`);
    const [cookie] = signed.headers["set-cookie"];
    assert.match(cookie, /^EPIC_BEARER_TOKEN=[0-9a-f]{32}; Path=\/purchase; Max-Age=900; HttpOnly; SameSite=Lax$/);
    const token = /^EPIC_BEARER_TOKEN=([0-9a-f]+)/.exec(cookie)[1];
    assert.notEqual(token, player.token);

    // The page opens as that account.
    const page = await as(backend.port, signed.headers.location, { Cookie: `EPIC_BEARER_TOKEN=${token}` });
    assert.equal(page.status, 200);
    assert.match(page.body, /ExchangeBuyer/);
    // Another account's code signs in as that account, which isn't this offer's.
    const otherSigned = await sso((await exchange(backend.port, other.token)).body.code);
    const otherToken = /^EPIC_BEARER_TOKEN=([0-9a-f]+)/.exec(otherSigned.headers["set-cookie"][0])[1];
    assert.equal((await as(backend.port, otherSigned.headers.location, { Cookie: `EPIC_BEARER_TOKEN=${otherToken}` })).status, 403);

    // A used, made-up or missing code signs nothing in.
    for (const bad of [code, "0".repeat(32), ""]) {
      const refused = await sso(bad);
      assert.equal(refused.status, 400, bad);
      assert.equal(refused.headers["set-cookie"], undefined, bad);
      assert.equal(refused.headers.location, undefined, bad);
    }
    // No redirect anywhere but /purchase: another page of any host, or a non-http URL, is refused (and uses the code up).
    for (const target of ["http://evil.example/steal", "javascript:alert(1)", "//evil.example/purchase", `http:///127.0.0.1:${backend.port}/admin`]) {
      const refused = await sso((await exchange(backend.port, player.token)).body.code, target);
      assert.equal(refused.status, 400, target);
      assert.equal(refused.headers.location, undefined, target);
    }
    // Another host's /purchase goes to this backend's own.
    const elsewhere = await sso((await exchange(backend.port, player.token)).body.code, "https://evil.example/purchase?offers=x");
    assert.equal(elsewhere.headers.location, "/purchase?offers=x");

  } finally {
    backend.close();
  }
});

test("the purchase flow's /exchange marks its cookie Secure behind an https proxy", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ExchangeHttps");
    const { code } = (await exchange(backend.port, player.token)).body;
    const signed = await as(backend.port, `/exchange?exchangeCode=${code}&redirectUrl=${encodeURIComponent("https:///play.example.com/purchase?offers=y")}`,
      { "X-Forwarded-Proto": "https", Host: "play.example.com" });
    assert.equal(signed.status, 302);
    assert.match(signed.headers["set-cookie"][0], /; Secure$/);
  } finally {
    backend.close();
  }
});

test("exchange codes stay out of the log", () => {
  assert.equal(redactUrl("/exchange?exchangeCode=abc123&redirectUrl=http%3A%2F%2F"), "/exchange?exchangeCode=<redacted>&redirectUrl=http%3A%2F%2F");
  assert.equal(redactUrl("/purchase?offers=a"), "/purchase?offers=a");
  assert.equal(purchaseQuery("http:///127.0.0.1:5595/purchase?offers=a").get("offers"), "a");
  assert.equal(purchaseQuery("http://127.0.0.1:5595/other"), null);
});
