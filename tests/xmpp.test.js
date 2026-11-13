import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { createStreamParser } from "../src/xmpp/xml.js";
import { createXmppService } from "../src/xmpp/service.js";
import { certUserAgent, post, send, startBackend, userLogin } from "./helpers.js";
import { domain, login } from "./xmpp-client.js";

// The service on its own server, with made-up tokens and a friends list.
async function startXmpp(contacts = {}) {
  const sessions = Object.fromEntries(["alice", "bob", "carol"].map((id) => [`token-${id}`, { accountId: id }]));
  const xmpp = createXmppService({ tokens: { find: (token) => sessions[token] ?? null }, contactsOf: (id) => contacts[id] ?? [],
    publicRooms: ["Global", "GlobalBattleRoyale", "Founders"], quiet: true });
  const server = net.createServer((socket) => xmpp.handle(socket));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const clients = [];
  return {
    xmpp,
    async login(id, resource) {
      const session = await login(server.address().port, id, `token-${id}`, resource);
      clients.push(session.client);
      return session;
    },
    close() {
      for (const client of clients) client.close();
      server.close();
    }
  };
}

test("the stream parser handles split reads, entities, CDATA and a stream restart", () => {
  const events = [];
  const parser = createStreamParser({
    onStreamStart: (attrs) => events.push(["start", attrs.to]),
    onStanza: (stanza) => events.push(["stanza", stanza.toString()]),
    onStreamEnd: () => events.push(["end"])
  });
  const text = `<?xml version='1.0'?><stream:stream to='a.b' xmlns='jabber:client'> <message to="x@a.b" type='chat'>` +
    `<body>{&quot;a&quot;:&lt;1&gt; &amp; é}</body></message>\n<presence/><iq id="1"><![CDATA[<raw>]]></iq>` +
    `<stream:stream to="c.d"></stream:stream>`;
  // One byte at a time, so every tag, entity and UTF-8 character arrives split.
  for (const byte of Buffer.from(text)) parser.write(Buffer.from([byte]));
  assert.deepEqual(events, [
    ["start", "a.b"],
    ["stanza", `<message to="x@a.b" type="chat"><body>{"a":&lt;1&gt; &amp; é}</body></message>`],
    ["stanza", "<presence/>"],
    ["stanza", `<iq id="1">&lt;raw&gt;</iq>`],
    ["start", "c.d"],
    ["end"]
  ]);

  // Prefixes resolve from the element, its ancestors or the stream header; the stream's own elements keep theirs.
  const stanzas = [];
  const prefixed = createStreamParser({ onStreamStart() {}, onStanza: (stanza) => stanzas.push(stanza), onStreamEnd() {} });
  prefixed.write(`<stream:stream xmlns:stream="http://etherx.jabber.org/streams" xmlns:d="urn:xmpp:delay">` +
    `<presence><d:delay stamp="1"/><muc:x xmlns:muc="http://jabber.org/protocol/muc"><muc:password>p</muc:password></muc:x>` +
    `</presence><stream:error><conflict xmlns="urn:ietf:params:xml:ns:xmpp-streams"/></stream:error>`);
  assert.deepEqual(stanzas[0].elements.map((child) => [child.name, child.attrs.xmlns]),
    [["delay", "urn:xmpp:delay"], ["x", "http://jabber.org/protocol/muc"]]);
  assert.equal(stanzas[0].child("x", "http://jabber.org/protocol/muc").child("password").text(), "p");
  assert.equal(stanzas[1].name, "stream:error");

  const small = createStreamParser({ onStreamStart() {}, onStanza() {}, onStreamEnd() {}, maxBuffer: 100 });
  small.write("<stream:stream><message>");
  assert.throws(() => small.write("<body>" + "x".repeat(200)), /too large/);
});

test("the Cert client's XMPP login works on the backend's HTTP port, and HTTP still does", async () => {
  const backend = await startBackend();
  try {
    const { accountId, token } = await userLogin(backend.port, "XmppPlayer");
    const { client, result, jid } = await login(backend.port, accountId, token);
    assert.equal(result.name, "success");
    assert.equal(jid, `${accountId}@${domain}/V2:Fortnite:WIN::test`);

    // libjingle pings the server; replies come from what the ping was sent to.
    client.send(`<iq type="get" id="ping_1" to="${domain}"><ping xmlns="urn:xmpp:ping"/></iq>`);
    const pong = await client.next((stanza) => stanza.attrs?.id === "ping_1");
    assert.deepEqual([pong.attrs.type, pong.attrs.from, pong.attrs.to], ["result", domain, jid]);
    client.send(`<iq type="get" id="ping_2"><ping xmlns="urn:xmpp:ping"/></iq>`);
    assert.equal((await client.next((stanza) => stanza.attrs?.id === "ping_2")).attrs.from, undefined);
    // The Cert client's own ping, as it really sends it: with a namespace prefix.
    client.send(`<iq type="get" id="ping_3" to="${domain}"><ping:ping xmlns:ping="urn:xmpp:ping"/></iq>`);
    assert.equal((await client.next((stanza) => stanza.attrs?.id === "ping_3")).attrs.type, "result");
    client.send(`<iq type="get" id="unknown_1"><query xmlns="urn:example:unknown"/></iq>`);
    const unknown = await client.next((stanza) => stanza.attrs?.id === "unknown_1");
    assert.equal(unknown.attrs.type, "error");
    assert.ok(unknown.child("error").child("service-unavailable"));

    // Keep-alive HTTP on the same port, with a body, two requests on one connection.
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    for (let i = 0; i < 2; i++) {
      const response = await send({ host: "127.0.0.1", port: backend.port, agent, method: "POST", path: "/account/api/oauth/token",
        headers: { "User-Agent": certUserAgent, "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `basic ${Buffer.from("ec684b8c687f479fadea3cb2ad83f5c6:secret").toString("base64")}` } },
      "grant_type=client_credentials");
      assert.equal(response.status, 200);
    }
    agent.destroy();
    client.close();
  } finally {
    backend.close();
  }
});

test("an unknown token or someone else's token is refused", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "XmppOne");
    const other = await userLogin(backend.port, "XmppTwo");
    for (const token of ["0123456789abcdef0123456789abcdef", other.token]) {
      const { client, result } = await login(backend.port, player.accountId, token);
      assert.equal(result.name, "failure");
      assert.ok(result.child("not-authorized"));
      await client.closed;
    }
  } finally {
    backend.close();
  }
});

test("chat and party messages reach every resource of the account they're sent to", async () => {
  const xmpp = await startXmpp();
  try {
    const alice = await xmpp.login("alice");
    const bob = await xmpp.login("bob");
    const bobElsewhere = await xmpp.login("bob", "V2:Fortnite:WIN::other");
    alice.client.send(`<message to="bob@${domain}" type="chat" id="m1"><body>{"type":"com.epicgames.party.invitation"}</body></message>`);
    for (const client of [bob.client, bobElsewhere.client]) {
      const message = await client.next((stanza) => stanza.name === "message");
      assert.deepEqual([message.attrs.from, message.attrs.to, message.child("body").text()],
        [alice.jid, `bob@${domain}`, `{"type":"com.epicgames.party.invitation"}`]);
    }

    // To one resource: only that one.
    alice.client.send(`<message to="${bobElsewhere.jid}" type="chat"><body>just you</body></message>`);
    assert.equal((await bobElsewhere.client.next((stanza) => stanza.name === "message")).child("body").text(), "just you");
    await bob.client.nothing((stanza) => stanza.name === "message");

    // To someone offline: dropped, no error back.
    alice.client.send(`<message to="carol@${domain}" type="chat"><body>hi</body></message>`);
    await alice.client.nothing((stanza) => stanza.name === "message");
  } finally {
    xmpp.close();
  }
});

test("presence goes to contacts, who get each other's current presence and an unavailable one on disconnect", async () => {
  const xmpp = await startXmpp({ alice: ["bob"], bob: ["alice"] });
  try {
    const alice = await xmpp.login("alice");
    alice.client.send(`<presence><status>{"Status":"In the frontend"}</status></presence>`);
    const carol = await xmpp.login("carol");
    carol.client.send("<presence/>");

    const bob = await xmpp.login("bob");
    bob.client.send(`<presence><status>{"Status":"Playing"}</status></presence>`);
    const toAlice = await alice.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([toAlice.attrs.from, toAlice.child("status").text()], [bob.jid, `{"Status":"Playing"}`]);
    const toBob = await bob.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([toBob.attrs.from, toBob.child("status").text()], [alice.jid, `{"Status":"In the frontend"}`]);
    await carol.client.nothing((stanza) => stanza.name === "presence");

    bob.client.close();
    const gone = await alice.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([gone.attrs.from, gone.attrs.type], [bob.jid, "unavailable"]);
    assert.equal(xmpp.xmpp.isOnline("bob"), false);
  } finally {
    xmpp.close();
  }
});

test("a second login with the same resource replaces the first", async () => {
  const xmpp = await startXmpp();
  try {
    const first = await xmpp.login("alice");
    const second = await xmpp.login("alice");
    const error = await first.client.next((stanza) => stanza.name === "stream:error");
    assert.ok(error.child("conflict"));
    await first.client.closed;
    second.client.send(`<iq type="get" id="ping_1"><ping xmlns="urn:xmpp:ping"/></iq>`);
    assert.equal((await second.client.next((stanza) => stanza.attrs?.id === "ping_1")).attrs.type, "result");
    assert.equal(xmpp.xmpp.isOnline("alice"), true);
  } finally {
    xmpp.close();
  }
});

test("party rooms: the first joiner owns the room, everyone sees who's in and gets the group chat", async () => {
  const xmpp = await startXmpp();
  const room = `Party-0123@muc.${domain}`;
  const status = (presence) => presence.child("x", "http://jabber.org/protocol/muc#user").elements
    .filter((element) => element.name === "status").map((element) => element.attrs.code);
  const itemOf = (presence) => presence.child("x", "http://jabber.org/protocol/muc#user").child("item").attrs;
  try {
    const alice = await xmpp.login("alice");
    alice.client.send(`<presence to="${room}/alice"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    const created = await alice.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([created.attrs.from, status(created), itemOf(created).affiliation, itemOf(created).role],
      [`${room}/alice`, ["110", "201"], "owner", "moderator"]);
    alice.client.send(`<iq type="set" id="config_1" to="${room}"><query xmlns="http://jabber.org/protocol/muc#owner">` +
      `<x xmlns="jabber:x:data" type="submit"/></query></iq>`);
    assert.equal((await alice.client.next((stanza) => stanza.attrs?.id === "config_1")).attrs.type, "result");

    const bob = await xmpp.login("bob");
    bob.client.send(`<presence to="${room}/bob"><x xmlns="http://jabber.org/protocol/muc"/><status>member</status></presence>`);
    const existing = await bob.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([existing.attrs.from, itemOf(existing).jid], [`${room}/alice`, alice.jid]);
    const joined = await bob.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([joined.attrs.from, status(joined), itemOf(joined).affiliation], [`${room}/bob`, ["110"], "none"]);
    const seen = await alice.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([seen.attrs.from, seen.child("status").text(), status(seen)], [`${room}/bob`, "member", []]);

    // A third account can't take a nick that's in use.
    const carol = await xmpp.login("carol");
    carol.client.send(`<presence to="${room}/bob"/>`);
    const conflict = await carol.client.next((stanza) => stanza.name === "presence");
    assert.equal(conflict.attrs.type, "error");
    assert.ok(conflict.child("error").child("conflict"));
    carol.client.send(`<message to="${room}" type="groupchat"><body>not in</body></message>`);
    assert.equal((await carol.client.next((stanza) => stanza.name === "message")).attrs.type, "error");

    bob.client.send(`<message to="${room}" type="groupchat"><body>ready?</body></message>`);
    for (const client of [alice.client, bob.client]) {
      const chat = await client.next((stanza) => stanza.name === "message");
      assert.deepEqual([chat.attrs.from, chat.child("body").text()], [`${room}/bob`, "ready?"]);
    }

    bob.client.send(`<presence to="${room}/bob" type="unavailable"/>`);
    const left = await alice.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([left.attrs.from, left.attrs.type], [`${room}/bob`, "unavailable"]);
    const selfLeft = await bob.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([selfLeft.attrs.type, status(selfLeft)], ["unavailable", ["110"]]);

    // The last one out (here by disconnecting) ends the room.
    alice.client.close();
    await alice.client.closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    carol.client.send(`<presence to="${room}/carol"/>`);
    const fresh = await carol.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual(status(fresh), ["110", "201"]);
  } finally {
    xmpp.close();
  }
});

test("the general chat room belongs to the server: the first joiner isn't told it's new or made its owner", async () => {
  const xmpp = await startXmpp();
  const room = `Global@muc.${domain}`;
  const muc = (presence) => presence.child("x", "http://jabber.org/protocol/muc#user");
  try {
    const alice = await xmpp.login("alice");
    alice.client.send(`<presence to="${room}/alice"><muc:x xmlns:muc="http://jabber.org/protocol/muc"/></presence>`);
    const joined = await alice.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual(muc(joined).elements.filter((element) => element.name === "status").map((element) => element.attrs.code), ["110"]);
    assert.deepEqual([muc(joined).child("item").attrs.affiliation, muc(joined).child("item").attrs.role], ["none", "participant"]);
    assert.equal(xmpp.xmpp.roomOccupants("global"), 1);

    alice.client.send(`<iq type="set" id="config_1" to="${room}"><query xmlns="http://jabber.org/protocol/muc#owner"/></iq>`);
    assert.equal((await alice.client.next((stanza) => stanza.attrs?.id === "config_1")).attrs.type, "error");
  } finally {
    xmpp.close();
  }
});

// CoreV2 #48: a player joins a party from a zone's reward screen and is out of it back in the lobby. In Cert the party
// lives in the clients (FOnlinePartySystemMcp): the backend only relays the handshake and hosts the party's room. The
// member's own client leaves on its return (CleanupPartyForMainMenu: no ClientStayWithParty since it joined, Backend-
// Evidence "Parties"), so the backend must keep the membership as the clients made it and send nothing on its own.
test("a party joined in a zone stays as the clients made it: the backend sends nothing when they go back to the lobby", async () => {
  const xmpp = await startXmpp(); // not friends: met in the zone
  const partyId = "869297DB4C1C62D1CF55289810277FD4";
  const room = `party-${partyId.toLowerCase()}@muc.${domain}`;
  const party = (type, payload = {}) => `<body>${JSON.stringify({ type, payload: { partyId, ...payload } })}</body>`;
  const typeOf = (message) => JSON.parse(message.child("body").text()).type;
  try {
    const leader = await xmpp.login("alice");
    const member = await xmpp.login("bob");
    leader.client.send(`<presence to="${room}/alice"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    await leader.client.next((stanza) => stanza.name === "presence");

    // The handshake from the leader's log (16:22:08-16:22:14), each message to the other account's bare JID.
    const steps = [
      [leader, member, "com.epicgames.party.invitation"],
      [member, leader, "com.epicgames.party.queryjoinability"],
      [leader, member, "com.epicgames.party.queryjoinability.response"],
      [member, leader, "com.epicgames.party.joinrequest"],
      [leader, member, "com.epicgames.party.joinrequest.approved"],
      [member, leader, "com.epicgames.party.joinacknowledged"],
      [leader, member, "com.epicgames.party.joinacknowledged.response"],
      [leader, member, "com.epicgames.party.memberjoined"],
      [member, leader, "com.epicgames.party.memberdata"]
    ];
    for (const [from, to, type] of steps) {
      from.client.send(`<message to="${to.jid.split("/")[0]}" type="chat">${party(type)}</message>`);
      const message = await to.client.next((stanza) => stanza.name === "message");
      assert.deepEqual([message.attrs.from, typeOf(message)], [from.jid, type]);
    }
    member.client.send(`<presence to="${room}/bob"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    assert.equal((await member.client.next((stanza) => stanza.name === "presence")).attrs.from, `${room}/alice`);
    assert.equal((await member.client.next((stanza) => stanza.name === "presence")).attrs.from, `${room}/bob`);
    await leader.client.next((stanza) => stanza.name === "presence" && stanza.attrs.from === `${room}/bob`);
    assert.equal(xmpp.xmpp.roomOccupants(`party-${partyId.toLowerCase()}`), 2);

    // Both go back to the lobby: a map change, not a new XMPP stream, then party data again. Nothing else arrives and
    // both are still in the room.
    for (const [from, to] of [[leader, member], [member, leader]]) {
      from.client.send(`<message to="${to.jid.split("/")[0]}" type="chat">${party("com.epicgames.party.memberdata")}</message>`);
      assert.equal(typeOf(await to.client.next((stanza) => stanza.name === "message")), "com.epicgames.party.memberdata");
    }
    await leader.client.nothing((stanza) => stanza.name === "presence" || stanza.name === "message");
    await member.client.nothing((stanza) => stanza.name === "presence" || stanza.name === "message");
    assert.equal(xmpp.xmpp.roomOccupants(`party-${partyId.toLowerCase()}`), 2);
  } finally {
    xmpp.close();
  }
});

test("a general chat room can be left and joined again, and each join gets its own presence back", async () => {
  const xmpp = await startXmpp();
  const status = (presence) => presence.child("x", "http://jabber.org/protocol/muc#user").elements
    .filter((element) => element.name === "status").map((element) => element.attrs.code);
  try {
    const alice = await xmpp.login("alice");
    for (const room of [`GlobalBattleRoyale@muc.${domain}`, `Global@muc.${domain}`, `GlobalBattleRoyale@muc.${domain}`]) {
      // As the client does it: the room name in lower case, the nick its account id.
      const jid = `${room.toLowerCase()}/alice`;
      alice.client.send(`<presence to="${jid}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
      const joined = await alice.client.next((stanza) => stanza.name === "presence");
      assert.deepEqual([joined.attrs.from, joined.attrs.type, status(joined)], [jid, undefined, ["110"]]);
      alice.client.send(`<presence to="${jid}" type="unavailable"/>`);
      const left = await alice.client.next((stanza) => stanza.name === "presence");
      assert.deepEqual([left.attrs.from, left.attrs.type, status(left)], [jid, "unavailable", ["110"]]);
    }
    assert.equal(xmpp.xmpp.roomOccupants("global") + xmpp.xmpp.roomOccupants("globalbattleroyale"), 0);
  } finally {
    xmpp.close();
  }
});

// Core-Backend #198: from Battle Royale's lobby to Save the World, the client leaves GlobalBattleRoyale and asks for
// Save the World's rooms in the same frame, and only joins the answer's room once the leave has completed. An answer
// that beat the leave left Global on "Joining general chat".
test("switching sub game, the rooms are only recommended once the old global room is left", async () => {
  const backend = await startBackend();
  try {
    const { accountId, token } = await userLogin(backend.port, "ChatSwitch");
    const { client } = await login(backend.port, accountId, token);
    const ask = (subGame) => post(backend.port, `/fortnite/api/game/v2/chat/${accountId}/recommendGeneralChatRooms/${subGame}/pc`, token, {});

    // Not in a global room yet: answered at once.
    let started = Date.now();
    const athena = await ask("Athena");
    assert.deepEqual(athena.body.globalChatRooms.map((room) => room.roomName), ["GlobalBattleRoyale"]);
    assert.ok(Date.now() - started < 500);
    const brRoom = `globalbattleroyale@muc.${domain}/${accountId}`;
    client.send(`<presence to="${brRoom}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    assert.equal((await client.next((stanza) => stanza.name === "presence")).attrs.from, brRoom);

    // The request arrives before the leave: no answer until the leave, and a moment after it.
    let answered = 0;
    const campaign = ask("Campaign").then((response) => { answered = Date.now(); return response; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(answered, 0);
    client.send(`<presence to="${brRoom}" type="unavailable"/>`);
    const left = await client.next((stanza) => stanza.name === "presence");
    const leftAt = Date.now();
    assert.equal(left.attrs.type, "unavailable");
    const response = await campaign;
    assert.ok(answered - leftAt >= 500, `answered ${answered - leftAt} ms after the leave`);
    assert.deepEqual(response.body.globalChatRooms.map((room) => room.roomName), ["Global"]);

    // The recommended room then joins.
    const stwRoom = `global@muc.${domain}/${accountId}`;
    client.send(`<presence to="${stwRoom}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    const joined = await client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([joined.attrs.from, joined.attrs.type], [stwRoom, undefined]);

    // A client that never leaves still gets its answer, after the wait runs out.
    started = Date.now();
    assert.equal((await ask("Athena")).status, 200);
    assert.ok(Date.now() - started >= 2500);
    client.close();
  } finally {
    backend.close();
  }
});

// Core-Backend #225: 3.1, Battle Royale's lobby to Save the World. The leave reached the backend before the request,
// so it answered at once, before the client had handled its leave, and Global stayed on "Joining general chat".
test("switching sub game, a leave that arrives before the request still holds the answer a moment", async () => {
  const backend = await startBackend();
  try {
    const { accountId, token } = await userLogin(backend.port, "ChatLeaveFirst");
    const { client } = await login(backend.port, accountId, token);
    const ask = (subGame) => post(backend.port, `/fortnite/api/game/v2/chat/${accountId}/recommendGeneralChatRooms/${subGame}/pc`, token, {});

    const brRoom = `globalbattleroyale@muc.${domain}/${accountId}`;
    client.send(`<presence to="${brRoom}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    assert.equal((await client.next((stanza) => stanza.name === "presence")).attrs.from, brRoom);

    // A presence change in the lobby keeps the room.
    client.send(`<presence to="${brRoom}"><show>away</show><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    const update = await client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([update.attrs.from, update.attrs.type], [brRoom, undefined]);

    // The leave first, then the request.
    client.send(`<presence to="${brRoom}" type="unavailable"/>`);
    const left = await client.next((stanza) => stanza.name === "presence");
    const leftAt = Date.now();
    assert.equal(left.attrs.type, "unavailable");
    const response = await ask("Campaign");
    const answered = Date.now();
    assert.ok(answered - leftAt >= 900, `answered ${answered - leftAt} ms after the leave`);
    assert.ok(answered - leftAt < 2500, `answered ${answered - leftAt} ms after the leave`);
    assert.deepEqual(response.body.globalChatRooms.map((room) => room.roomName), ["Global"]);

    // Long after a leave, and not in a global room: answered at once.
    const stwRoom = `global@muc.${domain}/${accountId}`;
    client.send(`<presence to="${stwRoom}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    assert.equal((await client.next((stanza) => stanza.name === "presence")).attrs.from, stwRoom);
    client.send(`<presence to="${stwRoom}" type="unavailable"/>`);
    await client.next((stanza) => stanza.name === "presence");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const started = Date.now();
    assert.equal((await ask("Athena")).status, 200);
    assert.ok(Date.now() - started < 500);
    client.close();
  } finally {
    backend.close();
  }
});

// A stream the client reconnected on before the old one was seen to drop: the same account takes its nick over instead
// of being refused as a nick conflict. (Core-Backend #235 blamed this for Global's "Currently unavailable"; #238 below.)
test("a public room moves an account's nick to its new connection instead of refusing it", async () => {
  const xmpp = await startXmpp();
  const room = `globalbattleroyale@muc.${domain}`;
  try {
    const first = await xmpp.login("alice", "one");
    first.client.send(`<presence to="${room}/alice"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    assert.equal((await first.client.next((stanza) => stanza.name === "presence")).attrs.from, `${room}/alice`);

    const second = await xmpp.login("alice", "two");
    second.client.send(`<presence to="${room}/alice"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    const joined = await second.client.next((stanza) => stanza.name === "presence");
    assert.deepEqual([joined.attrs.from, joined.attrs.type], [`${room}/alice`, undefined]);
    assert.equal(xmpp.xmpp.roomOccupants("globalbattleroyale"), 1);

    // The new connection leaves cleanly.
    second.client.send(`<presence to="${room}/alice" type="unavailable"/>`);
    assert.equal((await second.client.next((stanza) => stanza.name === "presence")).attrs.type, "unavailable");
    assert.equal(xmpp.xmpp.roomOccupants("globalbattleroyale"), 0);

    // Another account still can't take the nick.
    const third = await xmpp.login("alice", "three");
    third.client.send(`<presence to="${room}/alice"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
    await third.client.next((stanza) => stanza.name === "presence");
    const bob = await xmpp.login("bob");
    bob.client.send(`<presence to="${room}/alice"/>`);
    assert.equal((await bob.client.next((stanza) => stanza.name === "presence")).attrs.type, "error");
  } finally {
    xmpp.close();
  }
});

// Core-Backend #238: 3.2, Battle Royale's lobby, Save the World and back. The client keeps one stream. Entering a sub
// game (UFortOnlineAccount 0xD45940 -> 0xD4C450) it leaves its global room (0xD4E380: an ExitRoom, 0x2604C90, presence
// unavailable to the room), asks for the sub game's rooms (0xD5AA30) and joins the answer's room (0xD4DBA0 ->
// JoinPublicRoom 0x260D630), whose self-presence is the join. For Athena it asks only while bIsAthenaGlobalChatEnabled
// is set, which 3.2's DefaultGame.ini has false; otherwise the Global tab is "Currently unavailable." (0x734810). The
// login asks once as sub game "[NoMode]" (0xC4B520): Battle Royale's lobby had that room until the first switch.
// Replayed with the setting as the client has it once the system hotfix is merged.
test("3.2 keeps global chat through Battle Royale, Save the World and back to Battle Royale", async () => {
  const backend = await startBackend();
  const status = (presence) => presence.child("x", "http://jabber.org/protocol/muc#user").elements
    .filter((element) => element.name === "status").map((element) => element.attrs.code);
  try {
    const { accountId, token } = await userLogin(backend.port, "ChatRoundTrip");
    const hotfix = (await send({ host: "127.0.0.1", port: backend.port, path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.2-CL-3935073", Authorization: `bearer ${token}` } }))
      .body.toString("utf8").split("\r\n");
    const section = hotfix.indexOf("[/Script/FortniteGame.FortOnlineAccount]");
    const athenaGlobalChat = section !== -1 && hotfix[section + 1] === "bIsAthenaGlobalChatEnabled=true";

    const { client } = await login(backend.port, accountId, token);
    let tab; // the Global tab: its room, or what it shows instead
    async function enter(subGame) {
      if (tab?.jid) {
        client.send(`<presence to="${tab.jid}" type="unavailable"/>`);
        const left = await client.next((stanza) => stanza.name === "presence");
        assert.deepEqual([left.attrs.from, left.attrs.type, status(left)], [tab.jid, "unavailable", ["110"]]);
      }
      if (subGame === "Athena" && !athenaGlobalChat) {
        tab = "Currently unavailable.";
        return;
      }
      const answer = await post(backend.port, `/fortnite/api/game/v2/chat/${accountId}/recommendGeneralChatRooms/${subGame}/pc`, token, {});
      const name = answer.body.globalChatRooms[0].roomName;
      const jid = `${name.toLowerCase()}@muc.${domain}/${accountId}`;
      client.send(`<presence to="${jid}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
      const joined = await client.next((stanza) => stanza.name === "presence");
      assert.deepEqual([joined.attrs.from, joined.attrs.type, status(joined)], [jid, undefined, ["110"]]);
      tab = { name, jid };
    }

    await enter("[NoMode]");
    assert.equal(tab.name, "Global");
    for (const subGame of ["Athena", "Campaign", "Athena"]) {
      await enter(subGame);
      assert.equal(tab.name, subGame === "Athena" ? "GlobalBattleRoyale" : "Global", `${subGame}: the Global tab shows ${tab}`);
    }
    client.close();
  } finally {
    backend.close();
  }
});

// Core-Backend #344: 6.20's Founders tab, in Battle Royale's lobby. 6.20 moved general chat to UFortChatManager, which
// keeps bIsAthenaGlobalChatEnabled itself (+0x1F3). 6.x starts in Battle Royale, so the first sub game entered is Athena,
// and UFortChatManager::AttemptJoinRecommendedChatRooms (0x10D2C80) then asks for rooms only with that setting, or with
// Token:founderchatunlock (0x11661B0) while the Founders room isn't joined; otherwise it disables the Global tab and asks
// for nothing. HandleQueryRecommendedChatRoomsComplete (0x10DD170) joins the first room of each list (UFortChatRoomJoinHelper,
// 0x10D3330 -> USocialChatManager::JoinChatRoomPublic, 0x3DEC70). A message is a groupchat to the room's bare JID
// (FXmppMultiUserChatStrophe's SendChat, 0x2C2F2A0), and the room hands it to everyone in it, the sender too.
// Replayed for two players without the token, with the setting as the client has it once the system hotfix is merged.
test("6.20: both general chat tabs join their rooms in Battle Royale's lobby, and a message reaches everyone in them", async () => {
  const backend = await startBackend();
  try {
    const hotfix = (await send({ host: "127.0.0.1", port: backend.port, path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-6.20-CL-4497486",
        Authorization: `bearer ${(await userLogin(backend.port, "ChatHotfix620")).token}` } })).body.toString("utf8").split("\r\n");
    const section = hotfix.indexOf("[/Script/FortniteGame.FortChatManager]");
    const athenaGeneralChat = section !== -1 && hotfix[section + 1] === "bIsAthenaGlobalChatEnabled=true";
    const hasFounderToken = false;

    const players = [];
    for (const name of ["Founder620A", "Founder620B"]) {
      const { accountId, token } = await userLogin(backend.port, name);
      const { client } = await login(backend.port, accountId, token);
      players.push({ accountId, token, client, tabs: {} });
    }
    for (const player of players) {
      assert.ok(athenaGeneralChat || hasFounderToken, "entering Battle Royale, 6.20 asks for no rooms: the Founders tab never joins");
      const answer = await post(backend.port, `/fortnite/api/game/v2/chat/${player.accountId}/recommendGeneralChatRooms/Athena/pc`,
        player.token, {});
      assert.equal(answer.body.bIsFounderChatDisabled, false);
      assert.equal(answer.body.bNeedsPaidAccessForFounderChat, false);
      for (const [tab, rooms] of [["Global", answer.body.globalChatRooms], ["Founders", answer.body.founderChatRooms]]) {
        const jid = `${rooms[0].roomName}@muc.${domain}`;
        player.client.send(`<presence to="${jid}/${player.accountId}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
        const self = await player.client.next((stanza) => stanza.name === "presence" && stanza.attrs.from === `${jid}/${player.accountId}`);
        assert.equal(self.attrs.type, undefined, `${tab}: joined`);
        player.tabs[tab] = jid;
      }
    }
    assert.equal(players[0].tabs.Global, `GlobalBattleRoyale@muc.${domain}`);
    assert.equal(players[0].tabs.Founders, `Founders@muc.${domain}`);

    for (const tab of ["Founders", "Global"]) {
      const [sender] = players;
      sender.client.send(`<message to="${sender.tabs[tab]}" type="groupchat" id="${tab}-1"><body>hello ${tab}</body></message>`);
      for (const player of players) {
        const message = await player.client.next((stanza) => stanza.name === "message" && stanza.attrs.id === `${tab}-1`);
        assert.equal(message.attrs.type, "groupchat");
        assert.equal(message.attrs.from, `${sender.tabs[tab]}/${sender.accountId}`, `${tab}: from the sender's nick`);
        assert.equal(message.child("body").text(), `hello ${tab}`);
        assert.equal(message.child("error"), undefined);
      }
    }
    for (const player of players) player.client.close();
  } finally {
    backend.close();
  }
});
