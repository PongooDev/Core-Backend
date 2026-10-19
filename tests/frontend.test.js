import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

test("frontend requests answer in the shapes the Cert client parses", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");

    const catalog = await get(backend.port, "/fortnite/api/storefront/v2/catalog?rvn=1", token);
    assert.equal(catalog.status, 200);
    assert.equal(typeof catalog.body.refreshIntervalHrs, "number");
    assert.equal(typeof catalog.body.dailyPurchaseHrs, "number");
    assert.ok(Date.parse(catalog.body.expiration) > Date.now());
    assert.deepEqual(catalog.body.storefronts.map((storefront) => storefront.name), ["CardPackStore", "CardPackStorePromo"]);

    const chat = await post(backend.port, `/fortnite/api/game/v2/chat/${accountId}/recommendGeneralChatRooms/pc`, token, {});
    assert.deepEqual(chat.body, {
      elderChatRooms: [{ roomName: "Global", currentMembersCount: 0, maxMembersCount: 1000 }],
      founderChatRooms: [{ roomName: "Founders", currentMembersCount: 0, maxMembersCount: 1000 }],
      bIsElder: false,
      bHasFounderChat: true
    });

    assert.deepEqual((await get(backend.port, `/friends/api/public/friends/${accountId}?includePending=true`, token)).body, []);
    assert.deepEqual((await get(backend.port, `/friends/api/public/blocklist/${accountId}`, token)).body, { blockedUsers: [] });
    assert.deepEqual((await get(backend.port, `/friends/api/public/list/fortnite/${accountId}/recentPlayers`, token)).body, []);
    assert.deepEqual((await get(backend.port, `/fortnite/api/game/v2/friendcodes/${accountId}/epic`, token)).body, []);

    const analytics = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/datarouter/api/v1/public/data?SessionID=x&AppID=Fortnite.Fortnite",
      headers: { "Content-Type": "application/json" }
    }, JSON.stringify({ Events: [] }));
    assert.equal(analytics.status, 204);
  } finally {
    backend.close();
  }
});

test("GetMcpTimeForLogin returns the server time as the primary notification", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const path = (name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;

    const time = await post(backend.port, path("GetMcpTimeForLogin"), token, {});
    assert.equal(time.status, 200);
    const [notification] = time.body.notifications;
    assert.equal(notification.primary, true);
    assert.equal(typeof notification.type, "string");
    assert.ok(Math.abs(Date.parse(notification.mcpTime) - Date.now()) < 5000);

    const quests = await post(backend.port, path("ClientQuestLogin"), token, {});
    assert.equal(quests.status, 200);
    assert.equal(quests.body.notifications, undefined);
  } finally {
    backend.close();
  }
});
