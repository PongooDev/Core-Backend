import { Element, xml } from "./xml.js";

// Multi-user chat (XEP-0045) rooms on muc.<domain>: what the client's XmppMultiUserChatJingle uses for party and
// chat rooms. Rooms are made by the first join and go away when the last occupant leaves. They are non-anonymous
// (every occupant sees the others' real JIDs) and have no passwords, bans or history. Public rooms (isPublic) belong
// to the server: joining one never makes the joiner its owner or reports it as new (status 201).

const ns = {
  muc: "http://jabber.org/protocol/muc",
  user: "http://jabber.org/protocol/muc#user",
  owner: "http://jabber.org/protocol/muc#owner",
  data: "jabber:x:data",
  discoInfo: "http://jabber.org/protocol/disco#info",
  discoItems: "http://jabber.org/protocol/disco#items"
};

// onLeave(connection, room) runs after an occupant has left a room (by presence, a new nick or disconnecting).
// log(message) gets a line for each join and leave: room, nick, account and what came of it.
export function createRooms({ reply, replyError, stanzaError, isPublic = () => false, onLeave = () => {}, log = () => {} }) {
  const rooms = new Map();
  const key = (target) => `${target.local.toLowerCase()}@${target.domain.toLowerCase()}`;

  const note = (action, room, nick, connection, result) =>
    log(`MUC ${action} ${room.jid.slice(0, room.jid.indexOf("@"))} as ${nick} (${connection.accountId}): ${result}`);

  function occupantOf(room, connection) {
    for (const occupant of room.occupants.values()) if (occupant.connection === connection) return occupant;
    return undefined;
  }

  const item = (occupant, extra = {}) => xml("item", {
    affiliation: occupant.affiliation, role: occupant.role, jid: occupant.connection.jid, ...extra
  });

  // An occupant's presence as the room sends it: their own presence children (status, show...) without the join
  // element, the muc#user item, and any status codes (110: this is you, 201: the room was just made).
  function occupantPresence(room, occupant, to, codes = [], type) {
    const own = (occupant.presence?.elements ?? []).filter((child) => child.attrs.xmlns !== ns.muc);
    return xml("presence", { from: `${room.jid}/${occupant.nick}`, to, type },
      type === "unavailable" ? [] : own,
      xml("x", { xmlns: ns.user }, item(occupant, type === "unavailable" ? { role: "none" } : {}),
        codes.map((code) => xml("status", { code: String(code) }))));
  }

  function leave(room, occupant, why = "left") {
    note("leave", room, occupant.nick, occupant.connection, why);
    room.occupants.delete(occupant.nick);
    occupant.connection.rooms.delete(room.key);
    for (const other of [...room.occupants.values(), occupant]) {
      other.connection.send(occupantPresence(room, occupant, other.connection.jid, other === occupant ? [110] : [], "unavailable"));
    }
    if (!room.occupants.size) rooms.delete(room.key);
    onLeave(occupant.connection, room);
  }

  function join(connection, presence, target) {
    let room = rooms.get(key(target));
    const created = !room && !isPublic(target.local);
    if (!room) {
      room = { key: key(target), jid: `${target.local}@${target.domain}`, occupants: new Map() };
      rooms.set(room.key, room);
    }

    let existing = room.occupants.get(target.resource);
    let takenOver;
    // The same account on another connection (a stream it reconnected on before the old one was seen to drop) isn't a
    // nick conflict: the room moves its nick to the new connection, as XEP-0045 7.2.9 has a service do for one user.
    // (Core-Backend #235 took this for the cause of Global's "Currently unavailable"; that was the client's own Battle
    // Royale setting, #238 and services/fortnite/cloudstorage.js. The client keeps one stream across sub games.)
    if (existing && existing.connection !== connection && existing.connection.accountId
      && existing.connection.accountId === connection.accountId) {
      takenOver = existing;
      leave(room, existing, "taken over by a new connection");
      rooms.set(room.key, room);
      existing = undefined;
    }
    if (existing && existing.connection !== connection) {
      if (!room.occupants.size) rooms.delete(room.key);
      note("join", room, target.resource, connection, "refused, nick taken");
      return connection.send(stanzaError(presence, "cancel", "conflict"));
    }
    if (existing) {
      // Already in: this is a presence change, which everyone sees.
      note("join", room, existing.nick, connection, "already in, presence updated");
      existing.presence = presence;
      for (const other of room.occupants.values()) {
        other.connection.send(occupantPresence(room, existing, other.connection.jid, other === existing ? [110] : []));
      }
      return;
    }

    // A second nick from the same connection replaces the first and keeps its affiliation.
    const previous = occupantOf(room, connection);
    if (previous) {
      leave(room, previous, "new nick");
      rooms.set(room.key, room);
    }

    const occupant = {
      connection, nick: target.resource, presence,
      affiliation: (previous ?? takenOver)?.affiliation ?? (created ? "owner" : "none"),
      role: (previous ?? takenOver)?.role ?? (created ? "moderator" : "participant")
    };
    for (const other of room.occupants.values()) {
      connection.send(occupantPresence(room, other, connection.jid));
      other.connection.send(occupantPresence(room, occupant, other.connection.jid));
    }
    room.occupants.set(occupant.nick, occupant);
    connection.rooms.add(room.key);
    connection.send(occupantPresence(room, occupant, connection.jid, created ? [110, 201] : [110]));
    note("join", room, occupant.nick, connection, `joined (${room.occupants.size} in)`);
  }

  return {
    presence(connection, presence, target) {
      const type = presence.attrs.type;
      if (type === "error") return;
      if (!target.resource) return connection.send(stanzaError(presence, "modify", "jid-malformed"));
      if (type === "unavailable") {
        const room = rooms.get(key(target));
        const occupant = room && occupantOf(room, connection);
        if (occupant) leave(room, occupant);
        else log(`MUC leave ${target.local} as ${target.resource} (${connection.accountId}): not in it`);
        return;
      }
      if (type) return;
      join(connection, presence, target);
    },

    message(connection, message, target) {
      const room = rooms.get(key(target));
      const sender = room && occupantOf(room, connection);
      if (!sender) return connection.send(stanzaError(message, "cancel", "not-acceptable"));
      const from = `${room.jid}/${sender.nick}`;
      if (!target.resource) {
        if (message.attrs.type !== "groupchat") return connection.send(stanzaError(message, "modify", "bad-request"));
        for (const occupant of room.occupants.values()) {
          occupant.connection.send(new Element("message", { ...message.attrs, from, to: occupant.connection.jid }, message.children));
        }
        return;
      }
      const recipient = room.occupants.get(target.resource);
      if (!recipient) return connection.send(stanzaError(message, "cancel", "item-not-found"));
      recipient.connection.send(new Element("message", { ...message.attrs, from, to: recipient.connection.jid }, message.children));
    },

    iq(connection, iq, target) {
      const query = iq.elements[0];
      const get = iq.attrs.type === "get";
      if (!target.local) {
        if (get && query?.attrs.xmlns === ns.discoInfo) {
          return reply(connection, iq, xml("query", { xmlns: ns.discoInfo },
            xml("identity", { category: "conference", type: "text", name: "Chat rooms" }), xml("feature", { var: ns.muc })));
        }
        if (get && query?.attrs.xmlns === ns.discoItems) return reply(connection, iq, xml("query", { xmlns: ns.discoItems }));
        return replyError(connection, iq);
      }
      const room = rooms.get(key(target));
      if (target.resource || !query) return replyError(connection, iq);
      if (query.attrs.xmlns === ns.owner) {
        if (!room || occupantOf(room, connection)?.affiliation !== "owner") return replyError(connection, iq, "auth", "forbidden");
        // Rooms are open as soon as they exist; the owner's configuration form is accepted and not stored.
        if (get) return reply(connection, iq, xml("query", { xmlns: ns.owner }, xml("x", { xmlns: ns.data, type: "form" })));
        return reply(connection, iq);
      }
      if (get && query.attrs.xmlns === ns.discoInfo) {
        if (!room) return replyError(connection, iq, "cancel", "item-not-found");
        return reply(connection, iq, xml("query", { xmlns: ns.discoInfo },
          xml("identity", { category: "conference", type: "text", name: target.local }),
          ["http://jabber.org/protocol/muc", "muc_public", "muc_open", "muc_nonanonymous", "muc_unmoderated", "muc_temporary", "muc_unsecured"]
            .map((feature) => xml("feature", { var: feature }))));
      }
      return replyError(connection, iq);
    },

    leaveAll(connection) {
      for (const roomKey of [...connection.rooms]) {
        const room = rooms.get(roomKey);
        const occupant = room && occupantOf(room, connection);
        if (occupant) leave(room, occupant, "disconnected");
      }
      connection.rooms.clear();
    },

    // Whether a connection is in a room, by its name on any muc domain.
    isIn(connection, name) {
      return [...connection.rooms].some((roomKey) => roomKey.startsWith(`${name.toLowerCase()}@`));
    },

    // How many are in a room, by its name on any muc domain.
    occupants(name) {
      let count = 0;
      for (const room of rooms.values()) if (room.key.startsWith(`${name.toLowerCase()}@`)) count += room.occupants.size;
      return count;
    }
  };
}
