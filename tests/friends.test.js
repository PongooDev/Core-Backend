import { test } from "node:test";
import assert from "node:assert/strict";
import { del, get, post, startBackend, userLogin } from "./helpers.js";
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
    assert.deepEqual((await get(backend.port, `${friendsUrl(one.accountId)}?includePending=true`, one.token)).body,
      [{ accountId: two.accountId, status: "PENDING", direction: "OUTBOUND" }]);
    assert.deepEqual((await get(backend.port, `${friendsUrl(two.accountId)}?includePending=true`, two.token)).body,
      [{ accountId: one.accountId, status: "PENDING", direction: "INBOUND" }]);
    assert.deepEqual((await get(backend.port, friendsUrl(two.accountId), two.token)).body, []);
    assert.deepEqual(await notification(two.client, "Friend"), { accountId: one.accountId, status: "PENDING", direction: "INBOUND" });
    assert.deepEqual(await notification(one.client, "Friend"), { accountId: two.accountId, status: "PENDING", direction: "OUTBOUND" });
    await two.client.nothing((stanza) => stanza.name === "presence");

    // A second request changes nothing; the other side asking back accepts.
    assert.equal((await post(backend.port, friendsUrl(one.accountId, two.accountId), one.token)).status, 204);
    assert.equal((await post(backend.port, friendsUrl(two.accountId, one.accountId), two.token)).status, 204);
    assert.deepEqual(await notification(one.client, "Friend"), { accountId: two.accountId, status: "ACCEPTED", direction: "OUTBOUND" });
    assert.deepEqual(await notification(two.client, "Friend"), { accountId: one.accountId, status: "ACCEPTED", direction: "INBOUND" });
    assert.deepEqual((await get(backend.port, friendsUrl(one.accountId), one.token)).body,
      [{ accountId: two.accountId, status: "ACCEPTED", direction: "OUTBOUND" }]);

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

    const many = await get(backend.port, `/account/api/public/account?accountId=${one.accountId}&accountId=${two.accountId}&accountId=${"0".repeat(32)}`, one.token);
    assert.deepEqual(many.body.map((account) => account.displayName), ["LookupOne", "LookupTwo"]);
  } finally {
    backend.close();
  }
});
