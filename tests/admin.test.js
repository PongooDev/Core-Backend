import { test } from "node:test";
import assert from "node:assert/strict";
import { get, openTunnel, post, send, startBackend, userLogin } from "./helpers.js";

test("the admin panel lists accounts and skips the tutorial", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");

    const page = await get(backend.port, "/admin");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /^text\/html/);

    const [account] = (await get(backend.port, "/admin/api/accounts")).body;
    assert.deepEqual({ id: account.id, name: account.displayName, done: account.tutorialCompleted }, { id: accountId, name: "CoreTest", done: false });

    const skipped = await post(backend.port, `/admin/api/accounts/${accountId}/skip-tutorial`, undefined, {});
    assert.equal(skipped.status, 200);
    assert.equal(skipped.body.tutorialCompleted, true);
    assert.ok(skipped.body.items.some((item) => item.templateId === "Hero:hid_constructor_rushbase_uc_t01"));
    assert.deepEqual(skipped.body.worldItems.map((item) => item.templateId), ["Weapon:wid_shotgun_standard_uc_ore_t01"]);

    const query = await post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, token, {});
    const quests = Object.values(query.body.profileChanges[0].profile.items).filter((item) => item.templateId === "Quest:homebaseonboarding");
    assert.equal(quests[0].attributes.quest_state, "Claimed");

    assert.equal((await get(backend.port, "/admin/api/accounts/00000000000000000000000000000000")).status, 404);
  } finally {
    backend.close();
  }
});

test("admin writes need JSON and a local Host, so other sites can't trigger them", async () => {
  const backend = await startBackend();
  try {
    const { accountId } = await userLogin(backend.port, "CoreTest");
    const path = `/admin/api/accounts/${accountId}/skip-tutorial`;

    const form = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path, headers: { "Content-Type": "text/plain" } }, "{}");
    assert.equal(form.status, 415);

    const rebound = await send({ host: "127.0.0.1", port: backend.port, path: "/admin/api/accounts", headers: { Host: "attacker.example" } });
    assert.equal(rebound.status, 403);

    const [account] = (await get(backend.port, "/admin/api/accounts")).body;
    assert.equal(account.tutorialCompleted, false);
  } finally {
    backend.close();
  }
});

test("the client's DevSkipTutorial admin command skips the tutorial for its own account", async () => {
  const backend = await startBackend();
  try {
    const me = await userLogin(backend.port, "CoreTest");
    const other = await userLogin(backend.port, "Other");
    const path = (accountId) => `/fortnite/api/admin/account/${accountId}/profile0/command/DevSkipTutorial?rvn=-1`;

    assert.equal((await post(backend.port, path(other.accountId), me.token, {})).status, 403);
    assert.equal((await post(backend.port, path(me.accountId), undefined, {})).status, 401);

    const host = "fortnite-public-service-prod11.ol.epicgames.com";
    const tunnel = await openTunnel(backend.port, host);
    const response = await send({
      createConnection: () => tunnel,
      method: "POST",
      path: path(me.accountId),
      headers: { Host: host, Authorization: `bearer ${me.token}`, "Content-Type": "application/json" }
    }, "{}");
    assert.equal(response.status, 200);
    assert.equal(response.body.profileId, "profile0");
    const items = Object.values(response.body.profileChanges[0].profile.items);
    assert.ok(items.some((item) => item.templateId === "Quest:homebaseonboardingafteroutpost" && item.attributes.quest_state === "Claimed"));
  } finally {
    backend.close();
  }
});
