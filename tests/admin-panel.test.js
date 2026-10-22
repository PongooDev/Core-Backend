import { test } from "node:test";
import assert from "node:assert/strict";
import { clientToken, get, post, requestToken, startBackend, userLogin } from "./helpers.js";

const admin = (backend, path, body) => (body === undefined ? get(backend.port, `/admin/api${path}`) : post(backend.port, `/admin/api${path}`, undefined, body));
const profileOf = async (backend, player) => (await post(backend.port,
  `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, player.token, {})).body.profileChanges[0].profile;
const total = (profile, prefix) => Object.values(profile.items).filter((item) => item.templateId.toLowerCase().startsWith(prefix.toLowerCase()))
  .reduce((sum, item) => sum + item.quantity, 0);

test("the panel searches accounts and edits balances, level, items, quests and storm shields", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "PanelPlayer");
    await userLogin(backend.port, "SomeoneElse");
    await profileOf(backend, player);

    const found = (await admin(backend, "/accounts?search=panel")).body;
    assert.deepEqual(found.map((account) => account.displayName), ["PanelPlayer"]);

    // V-Bucks over several stacks become exactly the amount asked for.
    await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: "Currency:mtxpurchased", quantity: 300 });
    let details = (await admin(backend, `/accounts/${player.accountId}/currency`, { key: "vbucks", quantity: 2500 })).body;
    assert.equal(details.currencies.find((currency) => currency.key === "vbucks").quantity, 2500);
    assert.equal(total(await profileOf(backend, player), "Currency:mtx"), 2500);
    details = (await admin(backend, `/accounts/${player.accountId}/currency`, { key: "skillPoints", quantity: 40 })).body;
    assert.equal(details.currencies.find((currency) => currency.key === "skillPoints").quantity, 40);
    assert.equal((await admin(backend, `/accounts/${player.accountId}/currency`, { key: "nope", quantity: 1 })).status, 400);

    details = (await admin(backend, `/accounts/${player.accountId}/level`, { level: 12 })).body;
    assert.deepEqual([details.level, details.xp, details.xpForLevel], [12, 0, 1000000]);
    assert.equal((await profileOf(backend, player)).stats.attributes.level, 12);
    assert.equal((await admin(backend, `/accounts/${player.accountId}/level`, { level: 9999 })).status, 400);

    // Items: give, level and count, remove.
    details = (await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: "Hero:hid_commando_007_r_t01", quantity: 1 })).body;
    const hero = details.items.find((item) => item.templateId === "Hero:hid_commando_007_r_t01");
    assert.deepEqual([hero.name, hero.category, hero.rarity], ["Support Specialist Hawk", "heroes", "r"]);
    assert.equal((await admin(backend, `/accounts/${player.accountId}/items/update`, { profileId: "profile0", itemId: hero.itemId, level: 20 })).status, 400, "past the hero's max level");
    details = (await admin(backend, `/accounts/${player.accountId}/items/update`, { profileId: "profile0", itemId: hero.itemId, level: 5 })).body;
    assert.equal(details.items.find((item) => item.itemId === hero.itemId).level, 5);
    details = (await admin(backend, `/accounts/${player.accountId}/items/remove`, { profileId: "profile0", itemId: hero.itemId })).body;
    assert.equal(details.items.some((item) => item.itemId === hero.itemId), false);

    // Quests: complete and claim through the panel.
    details = (await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: "Quest:outpostquest_t1_l2", quantity: 1 })).body;
    const quest = details.quests.find((entry) => entry.questId === "outpostquest_t1_l2");
    assert.equal(quest.state, "Active");
    details = (await admin(backend, `/accounts/${player.accountId}/quests`, { itemId: quest.itemId, action: "claim" })).body;
    assert.equal(details.quests.find((entry) => entry.itemId === quest.itemId).state, "Claimed");

    // Storm shields and today's quotas.
    details = (await admin(backend, `/accounts/${player.accountId}/storm-shield`, { templateId: "Outpost:outpostcore_pve_02", level: 4 })).body;
    assert.equal(details.stormShields.find((shield) => shield.templateId === "Outpost:outpostcore_pve_02").level, 4);
    assert.equal((await admin(backend, `/accounts/${player.accountId}/storm-shield`, { templateId: "Outpost:outpostcore_pve_02", level: 11 })).status, 400);
    details = (await admin(backend, `/accounts/${player.accountId}/mission-alerts/reset`, {})).body;
    assert.equal(details.missionAlerts.remaining, 3);
    details = (await admin(backend, `/accounts/${player.accountId}/rest-xp/refill`, {})).body;
    assert.equal(details.restXp.value, details.restXp.max);

    const catalog = (await admin(backend, "/catalog?search=hawk&category=heroes")).body;
    assert.ok(catalog.items.some((item) => item.templateId === "Hero:hid_commando_007_r_t01"));
    assert.ok(catalog.categories.some(([key]) => key === "vouchers"));
  } finally {
    backend.close();
  }
});

test("kick, ban, reset and delete control an account's access and progress", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Troublemaker");
    await profileOf(backend, player);
    await admin(backend, `/accounts/${player.accountId}/currency`, { key: "vbucks", quantity: 999 });

    await admin(backend, `/accounts/${player.accountId}/kick`, {});
    assert.equal((await get(backend.port, "/fortnite/api/game/v2/world/info", player.token)).status, 401, "kicked tokens stop working");

    const banned = (await admin(backend, `/accounts/${player.accountId}/ban`, { reason: "griefing" })).body;
    assert.equal(banned.banned.reason, "griefing");
    const refused = await requestToken(backend.port, { grant_type: "password", username: "Troublemaker", password: "x" });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.errorCode, "errors.com.epicgames.account.account_not_active");
    assert.match(refused.body.errorMessage, /griefing/);
    await admin(backend, `/accounts/${player.accountId}/unban`, {});
    const again = await userLogin(backend.port, "Troublemaker");
    assert.equal(again.accountId, player.accountId);

    // A reset starts the chosen profiles over.
    assert.equal((await admin(backend, `/accounts/${player.accountId}/reset`, { profiles: ["nope"] })).status, 400);
    await admin(backend, `/accounts/${player.accountId}/reset`, { profiles: ["profile0"] });
    const fresh = await userLogin(backend.port, "Troublemaker");
    assert.equal(total(await profileOf(backend, fresh), "Currency:mtx"), 0);

    assert.equal((await admin(backend, `/accounts/${player.accountId}/delete`, { confirm: "wrong" })).status, 400);
    assert.equal((await admin(backend, `/accounts/${player.accountId}/delete`, { confirm: "Troublemaker" })).status, 200);
    assert.equal((await admin(backend, `/accounts/${player.accountId}`)).status, 404);
    const reborn = await userLogin(backend.port, "Troublemaker");
    assert.notEqual(reborn.accountId, player.accountId);
  } finally {
    backend.close();
  }
});

test("the panel shows the server: overview, game sessions to end, logs and unanswered requests", async () => {
  const backend = await startBackend();
  try {
    const server = await clientToken(backend.port);
    const { body: session } = await post(backend.port, "/fortnite/api/matchmaking/session", server, {
      ownerName: "CoreServer1", serverName: "CoreServer1", serverPort: 7777, maxPublicPlayers: 4, buildUniqueId: "595160781",
      attributes: { GAMEMODE_s: "FORTEMPTY", REGION_s: "NA", BEACONPORT_i: 15000 }
    });
    await get(backend.port, "/fortnite/api/does-not-exist");

    const overview = (await admin(backend, "/overview")).body;
    assert.equal(overview.sessions.length, 1);
    assert.equal(typeof overview.version, "string");
    assert.ok(overview.uptimeSeconds >= 0);

    const sessions = (await admin(backend, "/sessions")).body;
    assert.deepEqual(sessions.map(({ id, gameMode }) => ({ id, gameMode })), [{ id: session.id, gameMode: "FORTEMPTY" }]);
    assert.equal((await admin(backend, `/sessions/${session.id}/end`, {})).status, 200);
    assert.deepEqual((await admin(backend, "/sessions")).body, []);

    const logs = (await admin(backend, "/logs")).body;
    assert.ok(logs.some((line) => line.category === "Matchmaking" && line.message.includes(session.id)));
    const after = logs[logs.length - 1].seq;
    assert.ok((await admin(backend, `/logs?after=${after}`)).body.every((line) => line.seq > after));

    const unknown = (await admin(backend, "/unknown")).body;
    assert.ok(unknown.some((entry) => entry.path === "/fortnite/api/does-not-exist"));

    const page = await get(backend.port, "/admin");
    assert.match(page.body, /Core Admin/);
  } finally {
    backend.close();
  }
});
