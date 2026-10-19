import { Element, xml } from "./xml.js";

// Multi-user chat (XEP-0045) rooms on muc.<domain>: what the client's XmppMultiUserChatJingle uses for party and
// chat rooms. Rooms are made by the first join and go away when the last occupant leaves. They are non-anonymous
// (every occupant sees the others' real JIDs) and have no passwords, bans or history.

const ns = {
  muc: "http://jabber.org/protocol/muc",
  user: "http://jabber.org/protocol/muc#user",
  owner: "http://jabber.org/protocol/muc#owner",
  data: "jabber:x:data",
  discoInfo: "http://jabber.org/protocol/disco#info",
  discoItems: "http://jabber.org/protocol/disco#items"
};

export function createRooms({ reply, replyError, stanzaError }) {
  const rooms = new Map();
  const key = (target) => `${target.local.toLowerCase()}@${target.domain.toLowerCase()}`;

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

  function leave(room, occupant) {
    room.occupants.delete(occupant.nick);
    for (const other of [...room.occupants.values(), occupant]) {
      other.connection.send(occupantPresence(room, occupant, other.connection.jid, other === occupant ? [110] : [], "unavailable"));
    }
    if (!room.occupants.size) rooms.delete(room.key);
  }

  function join(connection, presence, target) {
    let room = rooms.get(key(target));
    const created = !room;
    if (created) {
      room = { key: key(target), jid: `${target.local}@${target.domain}`, occupants: new Map() };
      rooms.set(room.key, room);
    }

    const existing = room.occupants.get(target.resource);
    if (existing && existing.connection !== connection) {
      if (created) rooms.delete(room.key);
      return connection.send(stanzaError(presence, "cancel", "conflict"));
    }
    if (existing) {
      // Already in: this is a presence change, which everyone sees.
      existing.presence = presence;
      for (const other of room.occupants.values()) {
        other.connection.send(occupantPresence(room, existing, other.connection.jid, other === existing ? [110] : []));
      }
      return;
    }

    // A second nick from the same connection replaces the first and keeps its affiliation.
    const previous = occupantOf(room, connection);
    if (previous) {
      leave(room, previous);
      rooms.set(room.key, room);
    }

    const occupant = {
      connection, nick: target.resource, presence,
      affiliation: previous?.affiliation ?? (created ? "owner" : "none"),
      role: previous?.role ?? (created ? "moderator" : "participant")
    };
    for (const other of room.occupants.values()) {
      connection.send(occupantPresence(room, other, connection.jid));
      other.connection.send(occupantPresence(room, occupant, other.connection.jid));
    }
    room.occupants.set(occupant.nick, occupant);
    connection.rooms.add(room.key);
    connection.send(occupantPresence(room, occupant, connection.jid, created ? [110, 201] : [110]));
  }

  return {
    presence(connection, presence, target) {
      const type = presence.attrs.type;
      if (type === "error") return;
      if (!target.resource) return connection.send(stanzaError(presence, "modify", "jid-malformed"));
      if (type === "unavailable") {
        const room = rooms.get(key(target));
        const occupant = room && occupantOf(room, connection);
        if (occupant) {
          leave(room, occupant);
          connection.rooms.delete(room.key);
        }
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
      for (const roomKey of connection.rooms) {
        const room = rooms.get(roomKey);
        const occupant = room && occupantOf(room, connection);
        if (occupant) leave(room, occupant);
      }
      connection.rooms.clear();
    },

    get count() {
      return rooms.size;
    }
  };
}
