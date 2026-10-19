import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { createStreamParser } from "../src/xmpp/xml.js";
import { createXmppService } from "../src/xmpp/service.js";
import { certUserAgent, send, startBackend, userLogin } from "./helpers.js";

const domain = "prod.ol.epicgames.com";
const ns = { sasl: "urn:ietf:params:xml:ns:xmpp-sasl", bind: "urn:ietf:params:xml:ns:xmpp-bind", session: "urn:ietf:params:xml:ns:xmpp-session" };

// A client that talks like the Cert client's libjingle XmppEngine.
async function connect(port) {
  const socket = net.connect(port, "127.0.0.1");
  await once(socket, "connect");
  const received = [];
  const waiters = [];
  const push = (item) => {
    const index = waiters.findIndex((waiter) => waiter.match(item));
    if (index === -1) received.push(item);
    else waiters.splice(index, 1)[0].resolve(item);
  };
  const parser = createStreamParser({
    onStreamStart: (attrs) => push({ name: "stream:stream", attrs }),
    onStanza: push,
    onStreamEnd: () => push({ name: "/stream:stream" })
  });
  socket.on("data", (chunk) => parser.write(chunk));
  socket.on("error", () => {}); // a reset when the server closes the stream ends the test client, nothing more
  const closed = once(socket, "close");

  return {
    socket,
    closed,
    send: (text) => socket.write(text),
    next(match = () => true) {
      const index = received.findIndex(match);
      if (index !== -1) return Promise.resolve(received.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no matching stanza")), 5000);
        waiters.push({ match, resolve: (item) => { clearTimeout(timer); resolve(item); } });
      });
    },
    // Nothing (matching) arrives within a short wait.
    async nothing(match = () => true) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(received.filter(match).length, 0, `unexpected ${received.filter(match).map(String).join(", ")}`);
    },
    close() {
      socket.destroy();
    }
  };
}

const openStream = (client) => client.send(`<?xml version="1.0"?><stream:stream to="${domain}" xml:lang="*" version="1.0" ` +
  `xmlns:stream="http://etherx.jabber.org/streams" xmlns="jabber:client">`);

async function login(port, accountId, token, resource = "V2:Fortnite:WIN::test") {
  const client = await connect(port);
  openStream(client);
  const header = await client.next();
  assert.equal(header.name, "stream:stream");
  assert.equal(header.attrs.xmlns, "jabber:client");
  assert.equal(header.attrs.version, "1.0");
  assert.ok(header.attrs.id);
  const features = await client.next();
  assert.equal(features.name, "stream:features");
  assert.equal(features.child("starttls"), undefined);
  assert.deepEqual(features.child("mechanisms", ns.sasl).elements.map((mechanism) => mechanism.text()), ["PLAIN"]);

  const credentials = Buffer.from(`\0${accountId}@${domain}\0${token}`).toString("base64");
  client.send(`<auth xmlns="${ns.sasl}" mechanism="PLAIN" xmlns:ga="http://www.google.com/talk/protocol/auth" ga:client-uses-full-bind-result="true">${credentials}</auth>`);
  const result = await client.next();
  if (result.name !== "success") return { client, result };

  openStream(client);
  assert.equal((await client.next()).name, "stream:stream");
  const bound = await client.next();
  assert.ok(bound.child("bind", ns.bind) && bound.child("session", ns.session), "bind and session are both offered");
  client.send(`<iq type="set" id="bind_1"><bind xmlns="${ns.bind}"><resource>${resource}</resource></bind></iq>`);
  const bind = await client.next((stanza) => stanza.attrs?.id === "bind_1");
  assert.equal(bind.attrs.type, "result");
  assert.equal(bind.elements[0].name, "bind");
  const jid = bind.elements[0].child("jid").text();
  client.send(`<iq type="set" id="session_1"><session xmlns="${ns.session}"/></iq>`);
  assert.equal((await client.next((stanza) => stanza.attrs?.id === "session_1")).attrs.type, "result");
  return { client, result, jid };
}

// The service on its own server, with made-up tokens and a friends list.
async function startXmpp(contacts = {}) {
  const sessions = Object.fromEntries(["alice", "bob", "carol"].map((id) => [`token-${id}`, { accountId: id }]));
  const xmpp = createXmppService({ tokens: { find: (token) => sessions[token] ?? null }, contactsOf: (id) => contacts[id] ?? [],
    publicRooms: ["Global"], quiet: true });
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
