import { test } from "node:test";
import assert from "node:assert/strict";
import { del, get, post, put, startBackend, userLogin } from "./helpers.js";
import { login } from "./xmpp-client.js";

const friendsUrl = (id, other = "") => `/friends/api/public/friends/${id}${other ? `/${other}` : ""}`;
const apiObjects = "com.epicgames.friends.core.apiobjects";

// Two players, each logged in over HTTP and connected to XMPP with their presence sent.
async function players(port) {
  const result = [];
  for (const name of ["FriendOne", "FriendTwo"]) {
    const account = await userLogin(port, name);
    const xmpp = await login(port, account.accountId, account.token);
    xmpp.client.send(`<presence><status>{"Status":"${name} online"}</status></presence>`);
    result.push({ ...account, ...xmpp });
  }
  return result;
}

// The next friends notification: a message from xmpp-admin whose body is {type, payload, timestamp}.
async function notification(client, type) {
  const message = await client.next((stanza) => stanza.name === "message" && stanza.attrs.from.startsWith("xmpp-admin@"));
  assert.equal(message.attrs.type, undefined, "not type=chat, which the client's messages module skips");
  const body = JSON.parse(message.child("body").text());
  assert.equal(body.type, `${apiObjects}.${type}`);
  assert.ok(Date.parse(body.timestamp));
  return body.payload;
}

test("a friend request, its acceptance and a removal reach both players, with presence following", async () => {
  const backend = await startBackend();
  try {
    const [one, two] = await players(backend.port);

    assert.equal((await post(backend.port, friendsUrl(one.accountId, two.accountId), one.token)).status, 204);
    // Each friend as Epic's service had it, with when the request was made (the client reads created, #398).
    const pending = (await get(backend.port, `${friendsUrl(one.accountId)}?includePending=true`, one.token)).body;
    const created = pending[0]?.created;
    assert.ok(Date.parse(created) && new Date(created).toISOString() === created, "created is ISO 8601");
    assert.deepEqual(pending, [{ accountId: two.accountId, status: "PENDING", direction: "OUTBOUND", created, favorite: false }]);
    assert.deepEqual((await get(backend.port, `${friendsUrl(two.accountId)}?includePending=true`, two.token)).body,
      [{ accountId: one.accountId, status: "PENDING", direction: "INBOUND", created, favorite: false }]);
    assert.deepEqual((await get(backend.port, friendsUrl(two.accountId), two.token)).body, []);
    assert.deepEqual(await notification(two.client, "Friend"), { accountId: one.accountId, status: "PENDING", direction: "INBOUND", created, favorite: false });
    assert.deepEqual(await notification(one.client, "Friend"), { accountId: two.accountId, status: "PENDING", direction: "OUTBOUND", created, favorite: false });
    await two.client.nothing((stanza) => stanza.name === "presence");

    // A second request changes nothing; the other side asking back accepts.
    assert.equal((await post(backend.port, friendsUrl(one.accountId, two.accountId), one.token)).status, 204);
    assert.equal((await post(backend.port, friendsUrl(two.accountId, one.accountId), two.token)).status, 204);
    assert.deepEqual(await notification(one.client, "Friend"), { accountId: two.accountId, status: "ACCEPTED", direction: "OUTBOUND", created, favorite: false });
    assert.deepEqual(await notification(two.client, "Friend"), { accountId: one.accountId, status: "ACCEPTED", direction: "INBOUND", created, favorite: false });
    assert.deepEqual((await get(backend.port, friendsUrl(one.accountId), one.token)).body,
      [{ accountId: two.accountId, status: "ACCEPTED", direction: "OUTBOUND", created, favorite: false }]);

    // Friends see each other's presence from then on.
    const seen = await two.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([seen.attrs.from, seen.child("status").text()], [one.jid, `{"Status":"FriendOne online"}`]);
    assert.equal((await one.client.next((stanza) => stanza.name === "presence")).attrs.from, two.jid);

    assert.equal((await del(backend.port, friendsUrl(two.accountId, one.accountId), two.token)).status, 204);
    assert.deepEqual(await notification(one.client, "FriendRemoval"), { accountId: two.accountId, reason: "DELETED" });
    assert.deepEqual(await notification(two.client, "FriendRemoval"), { accountId: one.accountId, reason: "DELETED" });
    assert.equal((await one.client.next((stanza) => stanza.name === "presence")).attrs.type, "unavailable");
    assert.deepEqual((await get(backend.port, `${friendsUrl(one.accountId)}?includePending=true`, one.token)).body, []);
    assert.equal((await del(backend.port, friendsUrl(two.accountId, one.accountId), two.token)).status, 404);

    one.client.close();
    two.client.close();
  } finally {
    backend.close();
  }
});

test("a rejected request is REJECTED, a blocked player can't send one, and unblocking lets them", async () => {
  const backend = await startBackend();
  try {
    const [one, two] = await players(backend.port);
    await post(backend.port, friendsUrl(one.accountId, two.accountId), one.token);
    await notification(one.client, "Friend");
    await notification(two.client, "Friend");
    await del(backend.port, friendsUrl(two.accountId, one.accountId), two.token);
    assert.deepEqual(await notification(one.client, "FriendRemoval"), { accountId: two.accountId, reason: "REJECTED" });
    assert.deepEqual(await notification(two.client, "FriendRemoval"), { accountId: one.accountId, reason: "REJECTED" });
    await one.client.nothing((stanza) => stanza.name === "presence");

    const blockUrl = `/friends/api/public/blocklist/${two.accountId}/${one.accountId}`;
    assert.equal((await post(backend.port, blockUrl, two.token)).status, 204);
    assert.deepEqual(await notification(two.client, "BlockListEntryAdded"), { accountId: one.accountId });
    assert.deepEqual((await get(backend.port, `/friends/api/public/blocklist/${two.accountId}`, two.token)).body, { blockedUsers: [one.accountId] });
    const refused = await post(backend.port, friendsUrl(one.accountId, two.accountId), one.token);
    assert.equal(refused.status, 403);

    assert.equal((await del(backend.port, blockUrl, two.token)).status, 204);
    assert.deepEqual(await notification(two.client, "BlockListEntryRemoved"), { accountId: one.accountId });
    assert.equal((await post(backend.port, friendsUrl(one.accountId, two.accountId), one.token)).status, 204);

    // Nobody can befriend themselves or someone who doesn't exist.
    assert.equal((await post(backend.port, friendsUrl(one.accountId, one.accountId), one.token)).status, 400);
    assert.equal((await post(backend.port, friendsUrl(one.accountId, "0".repeat(32)), one.token)).status, 404);
    one.client.close();
    two.client.close();
  } finally {
    backend.close();
  }
});

test("players are found by display name, and several at once by id", async () => {
  const backend = await startBackend();
  try {
    const one = await userLogin(backend.port, "LookupOne");
    const two = await userLogin(backend.port, "LookupTwo");
    const byName = await get(backend.port, "/account/api/public/account/displayName/lookuptwo", one.token);
    assert.deepEqual([byName.body.id, byName.body.displayName], [two.accountId, "LookupTwo"]);
    assert.equal((await get(backend.port, "/account/api/public/account/displayName/Nobody", one.token)).status, 404);
    const persona = await get(backend.port, "/persona/api/public/account/lookup?q=lookuptwo", one.token);
    assert.deepEqual([persona.body.id, persona.body.displayName], [two.accountId, "LookupTwo"]);
    assert.equal((await get(backend.port, "/persona/api/public/account/lookup?q=Nobody", one.token)).status, 404);

    const many = await get(backend.port, `/account/api/public/account?accountId=${one.accountId}&accountId=${two.accountId}&accountId=${"0".repeat(32)}`, one.token);
    assert.deepEqual(many.body.map((account) => account.displayName), ["LookupOne", "LookupTwo"]);
  } finally {
    backend.close();
  }
});

test("the friends settings Epic's client reads and writes are served and kept", async () => {
  const backend = await startBackend();
  let reloaded;
  try {
    const one = await userLogin(backend.port, "SettingsOne");
    const two = await userLogin(backend.port, "SettingsTwo");
    const url = (id) => `/friends/api/v1/${id}/settings`;

    // An account that never changed them accepts invites from anyone, as Epic's service answered.
    assert.deepEqual((await get(backend.port, url(one.accountId), one.token)).body, { acceptInvites: "public" });

    // The client's Social Privacy value comes back as sent, from the PUT and from the next GET.
    const saved = await put(backend.port, url(one.accountId), one.token, { acceptInvites: "friends" });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, { acceptInvites: "friends" });
    assert.deepEqual((await get(backend.port, url(one.accountId), one.token)).body, { acceptInvites: "friends" });

    // Only the account itself may read or change them.
    assert.equal((await get(backend.port, url(one.accountId), two.token)).status, 403);
    const refused = await put(backend.port, url(one.accountId), two.token, { acceptInvites: "public" });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.errorCode, "errors.com.epicgames.common.missing_permission");

    // The field is required and has to be a string: a validation failure, as Epic's service answered.
    assert.equal((await put(backend.port, url(one.accountId), one.token, {})).status, 400);
    const wrong = await put(backend.port, url(one.accountId), one.token, { acceptInvites: 42 });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.errorCode, "errors.com.epicgames.validation.validation_failed");

    // A backend started on the same data reads what was saved.
    reloaded = await startBackend({ dataDir: backend.dataDir });
    const again = await userLogin(reloaded.port, "SettingsOne");
    assert.deepEqual((await get(reloaded.port, url(again.accountId), again.token)).body, { acceptInvites: "friends" });
  } finally {
    reloaded?.close();
    backend.close();
  }
});
