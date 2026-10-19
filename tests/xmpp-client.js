import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { createStreamParser } from "../src/xmpp/xml.js";

export const domain = "prod.ol.epicgames.com";
const ns = { sasl: "urn:ietf:params:xml:ns:xmpp-sasl", bind: "urn:ietf:params:xml:ns:xmpp-bind", session: "urn:ietf:params:xml:ns:xmpp-session" };

// A client that talks like the Cert client's libjingle XmppEngine.
export async function connect(port) {
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

export async function login(port, accountId, token, resource = "V2:Fortnite:WIN::test") {
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
