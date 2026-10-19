import crypto from "node:crypto";
import { log } from "../log.js";
import { createRooms } from "./muc.js";
import { Element, createStreamParser, xml } from "./xml.js";

// The XMPP service (presence, chat, party messages and rooms). The Cert client's XmppJingle (libjingle) connects over
// plain TCP to the server in [OnlineSubsystemMcp.XMPP] ServerAddr/ServerPort, which overrides the built-in
// xmpp-service-prod.ol.epicgames.com:5222 (FortMcpConfig). Its login, from libjingle's XmppLoginTask:
//   stream (version 1.0) -> features -> SASL PLAIN (\0 accountId@domain \0 access token) -> stream restart ->
//   features with bind AND session -> bind (result's first child must be <bind><jid>full</jid></bind>) -> session.
// With bUseSSL=false it never asks for STARTTLS, so none is offered.

const ns = {
  client: "jabber:client",
  streams: "http://etherx.jabber.org/streams",
  streamErrors: "urn:ietf:params:xml:ns:xmpp-streams",
  stanzas: "urn:ietf:params:xml:ns:xmpp-stanzas",
  sasl: "urn:ietf:params:xml:ns:xmpp-sasl",
  bind: "urn:ietf:params:xml:ns:xmpp-bind",
  session: "urn:ietf:params:xml:ns:xmpp-session",
  ping: "urn:xmpp:ping",
  roster: "jabber:iq:roster",
  discoInfo: "http://jabber.org/protocol/disco#info",
  vcard: "vcard-temp"
};

const defaultDomain = "prod.ol.epicgames.com";

export function parseJid(text = "") {
  const slash = text.indexOf("/");
  const bare = slash === -1 ? text : text.slice(0, slash);
  const at = bare.indexOf("@");
  return {
    local: at === -1 ? "" : bare.slice(0, at),
    domain: (at === -1 ? bare : bare.slice(at + 1)).toLowerCase(),
    resource: slash === -1 ? "" : text.slice(slash + 1)
  };
}

const withAttrs = (stanza, attrs) => new Element(stanza.name, { ...stanza.attrs, ...attrs }, stanza.children);

// An error reply to a stanza: the same stanza back, addressed to its sender, with an <error> (RFC 6120 8.3).
function stanzaError(stanza, type, condition) {
  return new Element(stanza.name, { ...stanza.attrs, type: "error", from: stanza.attrs.to, to: undefined },
    [...stanza.children, xml("error", { type }, xml(condition, { xmlns: ns.stanzas }))]);
}

// Replies come from whatever the request was sent to (nothing, the domain or the user's bare JID): libjingle matches
// a response by id and by that address.
function reply(connection, iq, ...children) {
  connection.send(xml("iq", { type: "result", id: iq.attrs.id, from: iq.attrs.to, to: connection.jid }, ...children));
}

function replyError(connection, iq, type = "cancel", condition = "service-unavailable") {
  connection.send(withAttrs(stanzaError(iq, type, condition), { to: connection.jid }));
}

// contactsOf(accountId): the accounts that see this account's presence and whose presence it sees (its friends).
export function createXmppService({ tokens, contactsOf = () => [], quiet = false }) {
  const say = quiet ? () => {} : (message) => log("XMPP", message);
  const online = new Map(); // accountId -> Map(resource -> connection)
  const connections = new Set();
  const rooms = createRooms({ reply, replyError, stanzaError });

  const resourcesOf = (accountId) => [...(online.get(accountId)?.values() ?? [])];

  // Who sees a connection's presence: its contacts' available resources and its own other resources.
  function audience(connection) {
    const contacts = contactsOf(connection.accountId).flatMap(resourcesOf);
    return [...contacts, ...resourcesOf(connection.accountId).filter((other) => other !== connection)]
      .filter((other) => other.available);
  }

  function broadcastPresence(connection, presence) {
    for (const other of audience(connection)) other.send(withAttrs(presence, { from: connection.jid, to: other.jid }));
  }

  // Messages and iqs for a user: one resource, or every resource for a bare JID.
  function deliver(target, stanza) {
    const recipients = target.resource ? [online.get(target.local)?.get(target.resource)].filter(Boolean) : resourcesOf(target.local);
    for (const recipient of recipients) recipient.send(withAttrs(stanza, { to: stanza.attrs.to ?? recipient.jid }));
    return recipients.length > 0;
  }

  function serverIq(connection, iq) {
    const query = iq.elements[0];
    const { type } = iq.attrs;
    const xmlns = query?.attrs.xmlns;
    if (xmlns === ns.ping && type === "get") return reply(connection, iq);
    if (xmlns === ns.session && type === "set") return reply(connection, iq);
    if (xmlns === ns.roster && type === "get") {
      return reply(connection, iq, xml("query", { xmlns: ns.roster },
        contactsOf(connection.accountId).map((id) => xml("item", { jid: `${id}@${connection.domain}`, subscription: "both" }))));
    }
    if (xmlns === ns.discoInfo && type === "get") {
      return reply(connection, iq, xml("query", { xmlns: ns.discoInfo },
        xml("identity", { category: "server", type: "im", name: "Core" }),
        [ns.ping, ns.discoInfo, ns.vcard].map((feature) => xml("feature", { var: feature }))));
    }
    if (xmlns === ns.vcard && type === "get") return reply(connection, iq, xml("vCard", { xmlns: ns.vcard }));
    say(`Unhandled iq ${type} ${query?.name ?? "(empty)"} ${xmlns ?? ""} from ${connection.accountId}`);
    replyError(connection, iq);
  }

  function onIq(connection, iq) {
    const { type, to } = iq.attrs;
    const target = to ? parseJid(to) : null;
    const routed = target?.local && target.domain === connection.domain && to !== connection.bare;
    if (type === "result" || type === "error") {
      if (routed) deliver(target, withAttrs(iq, { from: connection.jid }));
      return;
    }
    if (type !== "get" && type !== "set") return replyError(connection, iq, "modify", "bad-request");
    if (!target || to === connection.bare || (!target.local && target.domain === connection.domain)) return serverIq(connection, iq);
    if (target.domain === connection.mucDomain) return rooms.iq(connection, iq, target);
    if (routed && target.resource && deliver(target, withAttrs(iq, { from: connection.jid }))) return;
    replyError(connection, iq);
  }

  function onPresence(connection, presence) {
    const { to, type } = presence.attrs;
    if (to) {
      const target = parseJid(to);
      if (target.domain === connection.mucDomain && target.local) return rooms.presence(connection, presence, target);
      // Directed presence to a user. Subscriptions aren't kept: contacts are the friends list.
      if (!type || type === "unavailable") {
        if (target.local && target.domain === connection.domain) deliver(target, withAttrs(presence, { from: connection.jid }));
      }
      return;
    }
    if (type === "unavailable") {
      connection.available = false;
      broadcastPresence(connection, presence);
      return;
    }
    if (type) return;

    const first = !connection.available;
    connection.available = true;
    connection.presence = presence;
    broadcastPresence(connection, presence);
    // A newly available resource gets the current presence of everyone who can see it.
    if (first) {
      for (const other of audience(connection)) connection.send(withAttrs(other.presence, { from: other.jid, to: connection.jid }));
    }
  }

  function onMessage(connection, message) {
    if (!message.attrs.to || message.attrs.type === "error") return;
    const target = parseJid(message.attrs.to);
    if (target.domain === connection.mucDomain && target.local) return rooms.message(connection, message, target);
    if (!target.local || target.domain !== connection.domain) return;
    deliver(target, withAttrs(message, { from: connection.jid }));
  }

  function authenticate(connection, auth) {
    if (auth.name !== "auth" || auth.attrs.xmlns !== ns.sasl) return connection.close("not-authorized");
    if (auth.attrs.mechanism !== "PLAIN") {
      return connection.send(xml("failure", { xmlns: ns.sasl }, xml("invalid-mechanism")));
    }
    // libjingle sends the bare JID as the authentication identity; a plain account id works too.
    const [authzid, authcid = "", password = ""] = Buffer.from(auth.text(), "base64").toString("utf8").split("\0");
    const accountId = (authcid || authzid).split("@")[0];
    const session = tokens.find(password);
    if (!session || !accountId || session.accountId !== accountId) {
      say(`Login refused for ${accountId || "(no account)"}: ${session ? "token belongs to another account" : "unknown or expired token"}`);
      connection.send(xml("failure", { xmlns: ns.sasl }, xml("not-authorized")));
      return connection.close();
    }
    connection.accountId = accountId;
    connection.send(xml("success", { xmlns: ns.sasl }));
  }

  function bind(connection, iq) {
    const request = iq.child("bind", ns.bind);
    if (iq.name !== "iq" || iq.attrs.type !== "set" || !request) {
      if (iq.name === "iq") return replyError(connection, iq, "auth", "not-authorized");
      return;
    }
    const resource = request.child("resource")?.text().trim() || crypto.randomUUID();
    let resources = online.get(connection.accountId);
    if (!resources) online.set(connection.accountId, (resources = new Map()));
    // The newest login with a resource wins, as on Epic's servers.
    resources.get(resource)?.close("conflict");
    resources.set(resource, connection);

    connection.resource = resource;
    connection.bare = `${connection.accountId}@${connection.domain}`;
    connection.jid = `${connection.bare}/${resource}`;
    say(`${connection.accountId} connected (${resource})`);
    reply(connection, iq, xml("bind", { xmlns: ns.bind }, xml("jid", {}, connection.jid)));
  }

  function onStanza(connection, stanza) {
    if (!connection.accountId) return authenticate(connection, stanza);
    if (!connection.jid) return bind(connection, stanza);
    if (stanza.name === "iq") return onIq(connection, stanza);
    if (stanza.name === "presence") return onPresence(connection, stanza);
    if (stanza.name === "message") return onMessage(connection, stanza);
  }

  function handle(socket) {
    const connection = {
      socket, accountId: null, resource: null, jid: null, bare: null, domain: defaultDomain, mucDomain: `muc.${defaultDomain}`,
      available: false, presence: null, rooms: new Set(), closed: false,
      send(stanza) {
        if (!this.closed && socket.writable) socket.write(String(stanza));
      },
      // Ends the stream, with a stream error when given one (conflict, not-well-formed...).
      close(condition) {
        if (this.closed) return;
        if (condition) this.send(`<stream:error><${condition} xmlns="${ns.streamErrors}"/></stream:error>`);
        this.send("</stream:stream>");
        this.closed = true;
        socket.end();
        setTimeout(() => socket.destroy(), 1000).unref();
      }
    };
    connections.add(connection);

    const parser = createStreamParser({
      onStreamStart(attrs) {
        if (attrs.to) {
          connection.domain = attrs.to.toLowerCase();
          connection.mucDomain = `muc.${connection.domain}`;
        }
        connection.send(`<?xml version="1.0"?><stream:stream xmlns="${ns.client}" xmlns:stream="${ns.streams}" ` +
          `id="${crypto.randomBytes(8).toString("hex")}" from="${connection.domain}" version="1.0" xml:lang="en">`);
        connection.send(connection.accountId
          ? xml("stream:features", {}, xml("bind", { xmlns: ns.bind }), xml("session", { xmlns: ns.session }))
          : xml("stream:features", {}, xml("mechanisms", { xmlns: ns.sasl }, xml("mechanism", {}, "PLAIN"))));
      },
      onStanza: (stanza) => onStanza(connection, stanza),
      onStreamEnd: () => connection.close()
    });

    socket.setNoDelay(true);
    socket.on("data", (chunk) => {
      try {
        parser.write(chunk);
      } catch (error) {
        say(`Closing a stream from ${connection.accountId ?? socket.remoteAddress}: ${error.message}`);
        connection.close("not-well-formed");
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      connection.closed = true;
      connections.delete(connection);
      if (!connection.jid) return;
      if (connection.available) {
        connection.available = false;
        broadcastPresence(connection, xml("presence", { type: "unavailable" }));
      }
      rooms.leaveAll(connection);
      const resources = online.get(connection.accountId);
      if (resources?.get(connection.resource) === connection) {
        resources.delete(connection.resource);
        if (!resources.size) online.delete(connection.accountId);
      }
      say(`${connection.accountId} disconnected (${connection.resource})`);
    });
  }

  return {
    handle,
    isOnline: (accountId) => online.has(accountId),
    closeAll() {
      for (const connection of connections) connection.close("system-shutdown");
    }
  };
}

// Serves XMPP on the HTTP port: a stream's first byte is '<', which no HTTP request starts with. The launcher and
// the client's ini override then only need the one port.
export function enableXmpp(server, xmpp) {
  const httpListeners = server.listeners("connection");
  server.removeAllListeners("connection");
  server.on("connection", (socket) => {
    const idle = setTimeout(() => socket.destroy(), 30_000);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => clearTimeout(idle));
    socket.once("data", (chunk) => {
      clearTimeout(idle);
      socket.pause();
      socket.unshift(chunk);
      if (chunk[0] === 0x3c) xmpp.handle(socket);
      else for (const listener of httpListeners) listener.call(server, socket);
      process.nextTick(() => socket.resume());
    });
  });

  const closeAllConnections = server.closeAllConnections.bind(server);
  server.closeAllConnections = () => {
    xmpp.closeAll();
    closeAllConnections();
  };
}
