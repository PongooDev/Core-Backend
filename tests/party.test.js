import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, request, startBackend, userLogin } from "./helpers.js";
import { login } from "./xmpp-client.js";

const base = "/party/api/v1/Fortnite";
const type = (name) => `com.epicgames.social.party.notification.v0.${name}`;

async function player(port, name) {
  const account = await userLogin(port, name);
  const xmpp = await login(port, account.accountId, account.token);
  return { ...account, ...xmpp };
}

async function notification(client, name, match = () => true) {
  const message = await client.next((stanza) => {
    if (stanza.name !== "message" || !stanza.attrs.from.startsWith("xmpp-admin@")) return false;
    const body = JSON.parse(stanza.child("body").text());
    return body.type === type(name) && match(body);
  });
  return JSON.parse(message.child("body").text());
}

// What 8.30's client sends when it logs in (FOnlinePartySystemMcpV2 CreateParty).
const createBody = (jid, name) => ({
  config: { join_confirmation: false, joinability: "OPEN", max_size: 16 },
  join_info: { connection: { id: jid, meta: { "urn:epic:conn:platform_s": "WIN", "urn:epic:conn:type_s": "game" } },
    meta: { "urn:epic:member:dn_s": name } },
  meta: { "urn:epic:cfg:party-type-id_s": "default", "urn:epic:cfg:build-id_s": "1:1:5793395" }
});

test("8.30's login party: the summary, the party it creates with every field the client requires, and its updates", async () => {
  const backend = await startBackend();
  try {
    const one = await player(backend.port, "PartyOne");
    const summary = await get(backend.port, `${base}/user/${one.accountId}`, one.token);
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body, { current: [], pending: [], invites: [], pings: [] });

    const created = await post(backend.port, `${base}/parties`, one.token, createBody(one.jid, "PartyOne"));
    assert.equal(created.status, 200);
    const party = created.body;
    for (const key of ["id", "revision", "config", "members", "invites", "applicants", "meta", "created_at"]) assert.ok(key in party, key);
    for (const key of ["invite_ttl", "join_confirmation", "joinability", "max_size"]) assert.ok(key in party.config, key);
    assert.equal(party.members.length, 1);
    const [member] = party.members;
    assert.equal(member.account_id, one.accountId);
    assert.equal(member.role, "CAPTAIN");
    assert.equal(member.connections[0].id, one.jid);
    assert.equal(member.meta["urn:epic:member:dn_s"], "PartyOne");
    assert.equal(party.meta["urn:epic:cfg:build-id_s"], "1:1:5793395");
    assert.deepEqual((await get(backend.port, `${base}/user/${one.accountId}`, one.token)).body.current.map((entry) => entry.id), [party.id]);

    const patched = await request(backend.port, "PATCH", `${base}/parties/${party.id}/members/${one.accountId}/meta`, one.token,
      { delete: [], update: { "Default:Outfit_j": "{}" }, revision: 0 });
    assert.equal(patched.status, 204);
    const state = await notification(one.client, "MEMBER_STATE_UPDATED");
    assert.equal(state.party_id, party.id);
    assert.deepEqual(state.member_state_updated, { "Default:Outfit_j": "{}" });

    assert.equal((await request(backend.port, "PATCH", `${base}/parties/${party.id}`, one.token,
      { config: { joinability: "OPEN" }, meta: { delete: [], update: { "Default:PrivacySettings_j": "{}" } }, revision: 1 })).status, 204);
    const updated = await notification(one.client, "PARTY_UPDATED");
    assert.equal(updated.captain_id, one.accountId);
    assert.deepEqual(updated.party_state_updated, { "Default:PrivacySettings_j": "{}" });
    one.client.close();
  } finally {
    backend.close();
  }
});

test("a second player joins, the captain leaves and the other becomes captain, and the last one out ends the party", async () => {
  const backend = await startBackend();
  try {
    const one = await player(backend.port, "PartyCaptain");
    const two = await player(backend.port, "PartyGuest");
    const party = (await post(backend.port, `${base}/parties`, one.token, createBody(one.jid, "PartyCaptain"))).body;
    await post(backend.port, `${base}/parties`, two.token, createBody(two.jid, "PartyGuest"));

    assert.equal((await post(backend.port, `${base}/parties/${party.id}/invites/${two.accountId}`, one.token, {})).status, 204);
    const invite = await notification(two.client, "INITIAL_INVITE");
    assert.deepEqual([invite.inviter_id, invite.invitee_id, invite.party_id], [one.accountId, two.accountId, party.id]);

    // 8.30 joins through the inviter: the URL names the party member, the token the joiner (#416).
    const joined = await post(backend.port, `${base}/parties/${party.id}/members/${one.accountId}/join`, two.token,
      { connection: { id: two.jid, meta: {} }, meta: { "urn:epic:member:dn_s": "PartyGuest" } });
    assert.deepEqual(joined.body, { status: "JOINED", party_id: party.id });
    assert.equal((await notification(one.client, "MEMBER_JOINED")).account_id, two.accountId);
    assert.equal((await get(backend.port, `${base}/parties/${party.id}`, two.token)).body.members.length, 2);

    assert.equal((await request(backend.port, "DELETE", `${base}/parties/${party.id}/members/${one.accountId}`, one.token)).status, 204);
    // (The guest's own login party ended as it joined: it heard its own MEMBER_LEFT there first.)
    assert.equal((await notification(two.client, "MEMBER_LEFT", (body) => body.party_id === party.id)).account_id, one.accountId);
    assert.equal((await notification(two.client, "MEMBER_NEW_CAPTAIN")).account_id, two.accountId);
    assert.equal((await request(backend.port, "DELETE", `${base}/parties/${party.id}/members/${two.accountId}`, two.token)).status, 204);
    assert.equal((await get(backend.port, `${base}/parties/${party.id}`, two.token)).status, 404);
    one.client.close();
    two.client.close();
  } finally {
    backend.close();
  }
});
