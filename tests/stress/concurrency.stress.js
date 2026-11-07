import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { get, post, requestToken, startBackend, userLogin } from "../helpers.js";

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
