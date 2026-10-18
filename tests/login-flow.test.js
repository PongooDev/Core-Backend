import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, startBackend, userLogin } from "./helpers.js";

test("post-login checks answer the way the Cert client parses them", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");

    const sso = await get(backend.port, "/account/api/epicdomains/ssodomains");
    assert.deepEqual(sso.body, []);

    const shared = await get(backend.port, "/eulatracking/api/shared/agreements/fn?locale=en-GB&withLocaleFallback=true", token);
    assert.equal(shared.status, 204);

    const signed = await get(backend.port, `/eulatracking/api/public/agreements/fn/account/${accountId}`, token);
    assert.equal(signed.status, 204);

    const play = await post(backend.port, `/fortnite/api/game/v2/tryPlayOnPlatform/account/${accountId}?platform=PC`, token);
    assert.equal(play.status, 200);
    assert.doesNotMatch(play.headers["content-type"], /^application\/json/);
    assert.equal(play.body, "true");

    const features = await get(backend.port, "/fortnite/api/game/v2/enabled_features", token);
    assert.equal(features.status, 200);
    assert.deepEqual(features.body, []);

    const world = await get(backend.port, "/fortnite/api/game/v2/world/info", token);
    assert.deepEqual(world.body, { theaters: [], missions: [], missionAlerts: [] });

    const receipts = await get(backend.port, `/fortnite/api/receipts/v1/account/${accountId}/receipts`, token);
    assert.deepEqual(receipts.body, []);

    const sessions = await get(backend.port, `/fortnite/api/matchmaking/session/findPlayer/${accountId}`, token);
    assert.equal(sessions.status, 200);
    assert.deepEqual(sessions.body, []);
  } finally {
    backend.close();
  }
});

test("tryPlayOnPlatform only answers for the token's own account", async () => {
  const backend = await startBackend();
  try {
    const me = await userLogin(backend.port, "CoreTest");
    const other = await userLogin(backend.port, "Other");
    const response = await post(backend.port, `/fortnite/api/game/v2/tryPlayOnPlatform/account/${other.accountId}?platform=PC`, me.token);
    assert.equal(response.status, 403);
  } finally {
    backend.close();
  }
});
