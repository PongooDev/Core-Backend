import { test } from "node:test";
import assert from "node:assert/strict";
import { clientToken, send, startBackend, userLogin } from "./helpers.js";
import { keychainPlaceholder } from "../src/services/fortnite/storefront.js";

// Core-Backend #242: on 3.3 the Save the World Event Store flickered once a second, its catalog refetched (304) on every
// store widget timer tick. The price engine's 404 failed the catalog refresh (next one 30 seconds on), and the 304 answers
// never gave the catalog helper a new expiration to wait for.
const builds = ["Release-3.0-CL-3901517", "Release-3.2-CL-3935073", "Release-3.3-CL-3942182"];
const agentOf = (build) => `game=Fortnite, engine=UE4, build=++Fortnite+${build}`;
const ask = (port, method, path, token, userAgent, { headers = {}, body } = {}) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return send({ host: "127.0.0.1", port, method, path, headers: { "User-Agent": userAgent, Authorization: `bearer ${token}`,
    ...(text === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }), ...headers } }, text);
};

test("the catalog is always answered in full, never a 304 the catalog helper would keep a past refresh time on", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "CatalogRefresh");
    for (const build of builds) {
      const first = await ask(backend.port, "GET", "/fortnite/api/storefront/v2/catalog?rvn=5193&leanResponse=true", token, agentOf(build));
      assert.equal(first.status, 200, build);
      assert.equal(first.headers.etag, undefined, build);
      // An ETag the client kept from another backend, or from before this change.
      const again = await ask(backend.port, "GET", "/fortnite/api/storefront/v2/catalog?rvn=5194&leanResponse=true", token, agentOf(build),
        { headers: { "If-None-Match": 'W/"b782-0NvrsRrJs04p+CvImvv1rKVZ6fk"' } });
      assert.equal(again.status, 200, build);
      assert.deepEqual(again.body, first.body, build);
    }
  } finally {
    backend.close();
  }
});

test("the price engine answers the client token with no promotions, so the price check succeeds", async () => {
  const backend = await startBackend();
  try {
    const client = await clientToken(backend.port);
    for (const build of builds) {
      const body = { accountId: "", calculateTax: false, lineOffers: [{ offerId: "core_mtx_1000.x.y", quantity: 1 }], country: "US" };
      const answer = await ask(backend.port, "POST", "/priceengine/api/shared/offers/price", client, agentOf(build), { body });
      assert.equal(answer.status, 200, build);
      assert.deepEqual(answer.body, { lineOffers: [] }, build);
    }
  } finally {
    backend.close();
  }
});

test("the catalog expires in the future, no later than any store countdown the calendar sends", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "CatalogExpiry");
    for (const build of builds) {
      const now = Date.now();
      const catalog = (await ask(backend.port, "GET", "/fortnite/api/storefront/v2/catalog", token, agentOf(build))).body;
      const calendar = (await ask(backend.port, "GET", "/fortnite/api/calendar/v1/timeline", token, agentOf(build))).body;
      const { state } = calendar.channels["client-events"].states[0];
      const expiration = Date.parse(catalog.expiration);
      assert.ok(expiration > now, build);
      assert.ok(expiration - now <= catalog.dailyPurchaseHrs * 60 * 60 * 1000, build);
      for (const name of ["weeklyStoreEnd", "stwWeeklyStoreEnd", "stwEventStoreEnd"]) {
        if (state[name]) assert.ok(expiration <= Date.parse(state[name]), `${build} ${name}`);
      }
      assert.ok(state.stwWeeklyStoreEnd && state.stwEventStoreEnd, build);
    }
  } finally {
    backend.close();
  }
});

test("5.21 downloads its asset keychain at login: one dummy GUID:key entry, since an empty array fails the login", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Keychain");
    const res = await ask(backend.port, "GET", "/fortnite/api/storefront/v2/keychain?numKeysDownloaded=0&rvn=1277", token,
      agentOf("Release-5.21-CL-4288479"));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [keychainPlaceholder]);
    // FMcpKeychainHelper rejects an empty array; OnNewDataEncryptionKeyAdded wants "<32 hex GUID>:<base64 32-byte key>".
    const [guid, key, ...rest] = keychainPlaceholder.split(":");
    assert.equal(rest.length, 0);
    assert.match(guid, /^[0-9A-F]{32}$/);
    assert.notEqual(guid, "0".repeat(32));
    assert.equal(Buffer.from(key, "base64").length, 32);
  } finally {
    backend.close();
  }
});
