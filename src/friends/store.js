import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

// Friends and block lists, one file per account (accounts/<id>/friends.json):
//   {friends: {<accountId>: {status: "ACCEPTED" | "PENDING", direction: "INBOUND" | "OUTBOUND", created}}, blocked: [ids]}
// A friendship is always written to both accounts, each from its own side.
export function createFriendStore(dataDir) {
  const cache = new Map();
  const file = (id) => path.join(dataDir, "accounts", id, "friends.json");

  function load(id) {
    if (!cache.has(id)) {
      const saved = fs.existsSync(file(id)) ? readJson(file(id)) : {};
      cache.set(id, { friends: saved.friends ?? {}, blocked: saved.blocked ?? [] });
    }
    return cache.get(id);
  }

  const save = (...ids) => ids.forEach((id) => writeJson(file(id), load(id)));

  function link(a, b, status, created = new Date().toISOString()) {
    load(a).friends[b] = { status, direction: "OUTBOUND", created };
    load(b).friends[a] = { status, direction: "INBOUND", created };
  }

  function unlink(a, b) {
    const had = Boolean(load(a).friends[b] || load(b).friends[a]);
    delete load(a).friends[b];
    delete load(b).friends[a];
    return had;
  }

  return {
    // Copies, so a caller's "before" survives the change it is about to make.
    get(owner, other) {
      const entry = load(owner).friends[other];
      return entry && { ...entry };
    },

    list: (owner) => Object.entries(load(owner).friends).map(([accountId, entry]) => ({ accountId, ...entry })),

    // Accounts that see each other's presence.
    accepted: (owner) => Object.entries(load(owner).friends).filter(([, entry]) => entry.status === "ACCEPTED").map(([id]) => id),

    isBlocked: (owner, other) => load(owner).blocked.includes(other),

    blocked: (owner) => [...load(owner).blocked],

    // A request, or the answer to one: sending a request to someone who already asked you accepts theirs.
    // Returns "requested", "accepted" or null when nothing changed.
    request(from, to) {
      const existing = load(from).friends[to];
      if (existing?.status === "ACCEPTED" || existing?.direction === "OUTBOUND") return null;
      if (existing?.direction === "INBOUND") {
        load(from).friends[to].status = "ACCEPTED";
        load(to).friends[from].status = "ACCEPTED";
        save(from, to);
        return "accepted";
      }
      link(from, to, "PENDING");
      save(from, to);
      return "requested";
    },

    // Removing a friend, or rejecting or cancelling a request. Returns the entry as it was, or null.
    remove(owner, other) {
      const entry = load(owner).friends[other];
      if (!unlink(owner, other)) return null;
      save(owner, other);
      return entry ?? null;
    },

    // Blocking also ends any friendship or request between the two.
    block(owner, other) {
      const entry = load(owner).friends[other] ?? null;
      unlink(owner, other);
      if (!load(owner).blocked.includes(other)) load(owner).blocked.push(other);
      save(owner, other);
      return entry;
    },

    unblock(owner, other) {
      const blocked = load(owner).blocked;
      if (!blocked.includes(other)) return false;
      blocked.splice(blocked.indexOf(other), 1);
      save(owner);
      return true;
    }
  };
}
