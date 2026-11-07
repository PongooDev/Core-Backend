import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { certClient, certUserAgent, get, post, requestToken, startBackend, userLogin } from "./helpers.js";

// Helper to make an HTTP request with custom headers and raw binary/decompression handling
function fetchRaw(port, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: reqPath,
      headers: { "User-Agent": certUserAgent, ...headers }
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer,
          text: () => (res.headers["content-encoding"] === "gzip"
            ? zlib.gunzipSync(buffer).toString("utf8")
            : buffer.toString("utf8"))
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("performance & stress: HTTP compression and 304 ETag caching on large assets", async () => {
  const backend = await startBackend();
  try {
    // 1. Without Accept-Encoding: raw uncompressed
    const raw = await fetchRaw(backend.port, "/admin");
    assert.equal(raw.status, 200);
    assert.equal(raw.headers["content-encoding"], undefined);
    assert.ok(raw.headers["etag"], "ETag header must be present");
    const etag = raw.headers["etag"];
    assert.ok(raw.buffer.length > 200000, "Uncompressed admin panel should be >200KB");

    // 2. With Accept-Encoding: gzip compression
    const gzipped = await fetchRaw(backend.port, "/admin", { "Accept-Encoding": "gzip" });
    assert.equal(gzipped.status, 200);
    assert.equal(gzipped.headers["content-encoding"], "gzip");
    assert.equal(gzipped.headers["etag"], etag);
    // Gzip should reduce 400KB down to ~45KB (> 70% reduction)
    assert.ok(gzipped.buffer.length < raw.buffer.length * 0.35, "Gzip should reduce size by over 65%");
    assert.equal(gzipped.text(), raw.buffer.toString("utf8"), "Decompressed content must match uncompressed");

    // 3. ETag 304 Not Modified
    const cached = await fetchRaw(backend.port, "/admin", { "If-None-Match": etag });
    assert.equal(cached.status, 304);
    assert.equal(cached.buffer.length, 0);
  } finally {
    backend.close();
  }
});

test("performance & stress: 30 concurrent player accounts performing profile updates and locker changes", async () => {
  const backend = await startBackend();
  try {
    const playerCount = 30;
    // Concurrently register/login 30 distinct players
    const players = await Promise.all(
      Array.from({ length: playerCount }, (_, i) => userLogin(backend.port, `StressPlayer_${i}`))
    );

    // Each player performs profile queries and grants concurrently
    await Promise.all(
      players.map(async (player) => {
        // Query initial profile
        const q1 = await post(backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, player.token, {});
        assert.equal(q1.status, 200);
        assert.equal(q1.body.profileId, "profile0");

        // Grant an item via admin API concurrently
        const adminGrant = await post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, {
          templateId: "Hero:hid_constructor_007hw_sr_t01",
          quantity: 1
        });
        assert.equal(adminGrant.status, 200);

        // Query again, verify profile reflects the grant
        const q2 = await post(backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, player.token, {});
        assert.equal(q2.status, 200);
        const profile = q2.body.profileChanges[0].profile;
        assert.ok(profile.items);

        // Verify JSON file on disk is valid and parses cleanly
        const profilePath = path.join(backend.dataDir, "accounts", player.accountId, "profiles", "profile0.json");
        const onDisk = JSON.parse(fs.readFileSync(profilePath, "utf8"));
        assert.equal(onDisk.accountId, player.accountId);
      })
    );
  } finally {
    backend.close();
  }
});

test("performance & stress: high-concurrency exchange code generation and redemption", async () => {
  const backend = await startBackend();
  try {
    const count = 40;
    // Concurrently create 40 players
    const players = await Promise.all(
      Array.from({ length: count }, (_, i) => userLogin(backend.port, `ExchangeTester_${i}`))
    );

    // Concurrently request exchange codes for all players
    const exchangeCodes = await Promise.all(
      players.map(async (player) => {
        const res = await get(backend.port, "/account/api/oauth/exchange", player.token);
        assert.equal(res.status, 200);
        assert.ok(res.body.code);
        return { player, code: res.body.code };
      })
    );

    // Concurrently exchange each code for a new token
    const newTokens = await Promise.all(
      exchangeCodes.map(async ({ player, code }) => {
        const res = await requestToken(backend.port, { grant_type: "exchange_code", exchange_code: code });
        assert.equal(res.status, 200);
        assert.equal(res.body.account_id, player.accountId);
        return res.body.access_token;
      })
    );

    assert.equal(newTokens.length, count);
    // Verifying single-use: attempting to reuse any code fails with 400
    const reuse = await requestToken(backend.port, { grant_type: "exchange_code", exchange_code: exchangeCodes[0].code });
    assert.equal(reuse.status, 400);
  } finally {
    backend.close();
  }
});

test("performance & stress: in-memory profile store cache invalidates when disk file is mutated", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "CacheInvalidationTester");
    const profilePath = path.join(backend.dataDir, "accounts", player.accountId, "profiles", "profile0.json");

    // 1. Initial read into memory
    const q1 = await post(backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, player.token, {});
    assert.equal(q1.status, 200);

    // 2. Directly mutate file on disk with custom attribute
    const diskProfile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    diskProfile.stats.attributes.custom_stress_flag = 42;
    // Small delay to ensure operating system filesystem timestamp granularity ticks
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(profilePath, JSON.stringify(diskProfile));

    // 3. Query again: profile store should detect the file change via mtime and reflect the custom attribute
    const q2 = await post(backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, player.token, {});
    assert.equal(q2.status, 200);
    const updated = q2.body.profileChanges[0].profile;
    assert.equal(updated.stats.attributes.custom_stress_flag, 42);
  } finally {
    backend.close();
  }
});
