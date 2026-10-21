import crypto from "node:crypto";

// Every key the client's session parser requires (OnlineSessionJsonMcp, sub_37F59F0): a session missing one is dropped
// with "Unable to read session settings!". buildUniqueId is read as a string.
const settingDefaults = {
  maxPublicPlayers: 0,
  maxPrivatePlayers: 0,
  shouldAdvertise: true,
  allowJoinInProgress: true,
  isDedicated: true,
  usesStats: false,
  allowInvites: false,
  usesPresence: false,
  allowJoinViaPresence: false,
  allowJoinViaPresenceFriendsOnly: false,
  buildUniqueId: "0",
  attributes: {}
};

// openPublicPlayers and openPrivatePlayers aren't taken from the body: they follow the player lists (countOpenSlots).
const sessionFields = ["ownerId", "ownerName", "serverName", "serverAddress", "serverPort", "sortWeight", ...Object.keys(settingDefaults)];

// A session the server stops heartbeating is gone; the client must never be sent to a dead server.
const staleAfterMs = 5 * 60 * 1000;

const compare = {
  EQUAL: (actual, value) => actual === value,
  NOT_EQUAL: (actual, value) => actual !== value,
  GREATER_THAN: (actual, value) => actual > value,
  GREATER_THAN_OR_EQUAL: (actual, value) => actual >= value,
  LESS_THAN: (actual, value) => actual < value,
  LESS_THAN_OR_EQUAL: (actual, value) => actual <= value,
  IN: (actual, value) => Array.isArray(value) && value.includes(actual),
  NOT_IN: (actual, value) => Array.isArray(value) && !value.includes(actual)
};

// The client's session reader (sub_37F5010) parses serverAddress as an IP and only maps 0:0:0:0:0:0:0:1 itself
// ("Failed to parse ip address %s" otherwise). Node reports IPv4 peers on a dual-stack socket as ::ffff:a.b.c.d.
export function normalizeAddress(address) {
  const text = String(address ?? "").trim();
  if (text === "::1" || text === "0:0:0:0:0:0:0:1") return "127.0.0.1";
  return text.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
}

// "" (the Cert server's create body has no address unless -UseLocalIPs) and "0.0.0.0" (its -UseLocalIPs failure value)
// say nothing about where the server is.
const usable = (address) => address !== "" && address !== "0.0.0.0";
export const isLoopback = (address) => /^127\./.test(normalizeAddress(address));

function apply(session, body) {
  for (const field of sessionFields) {
    if (body?.[field] === undefined) continue;
    if (field === "serverAddress") {
      const address = normalizeAddress(body.serverAddress);
      if (usable(address)) session.serverAddress = address;
    } else {
      session[field] = body[field];
    }
  }
  session.buildUniqueId = String(session.buildUniqueId);
}

// Players come and go only through /{id}/players (RegisterPlayers adds, UnregisterPlayers removes).
const players = (session) => [...session.publicPlayers, ...session.privatePlayers];
const currentPlayers = (session) => players(session).length;

// The open slots follow the lists: each list's maximum less the players in it. The server checks the counts it gets back
// against its own ("OSS: Open slots count mismatch").
function countOpenSlots(session) {
  session.openPublicPlayers = Math.max(0, session.maxPublicPlayers - session.publicPlayers.length);
  session.openPrivatePlayers = Math.max(0, session.maxPrivatePlayers - session.privatePlayers.length);
}

// Game sessions the gameservers register (OnlineSubsystemMcp's /api/matchmaking/session API), kept in memory:
// a server re-registers after a backend restart.
export function createSessionStore() {
  const sessions = new Map();

  function live() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - Date.parse(session.lastUpdated) > staleAfterMs) sessions.delete(id);
    }
    return [...sessions.values()];
  }

  const touch = (session) => { session.lastUpdated = new Date().toISOString(); };

  return {
    // connectionAddress: where the create request came from, the server's address when its body names none.
    create(body, connectionAddress = "") {
      const session = {
        id: crypto.randomBytes(16).toString("hex"),
        ownerId: "", ownerName: "", serverName: "", serverAddress: "", serverPort: 0,
        ...structuredClone(settingDefaults),
        openPublicPlayers: 0, openPrivatePlayers: 0, sortWeight: 0,
        publicPlayers: [], privatePlayers: [],
        started: false,
        keys: {},
        zoneDifficulty: ""
      };
      apply(session, body);
      if (!usable(session.serverAddress)) session.serverAddress = normalizeAddress(connectionAddress);
      countOpenSlots(session);
      touch(session);
      sessions.set(session.id, session);
      return session;
    },

    get(id) {
      live();
      return sessions.get(id);
    },

    update(id, body) {
      const session = this.get(id);
      if (!session) return undefined;
      apply(session, body);
      countOpenSlots(session);
      touch(session);
      return session;
    },

    // RegisterPlayers {publicPlayers, privatePlayers}: the players joining, by whether they were invited.
    addPlayers(id, body) {
      const session = this.get(id);
      if (!session) return undefined;
      for (const list of ["publicPlayers", "privatePlayers"]) {
        for (const accountId of Array.isArray(body?.[list]) ? body[list].map(String) : []) {
          if (!players(session).includes(accountId)) session[list].push(accountId);
        }
      }
      countOpenSlots(session);
      touch(session);
      return session;
    },

    // UnregisterPlayers: a JSON array of the players leaving.
    removePlayers(id, accountIds) {
      const session = this.get(id);
      if (!session) return undefined;
      const leaving = new Set((Array.isArray(accountIds) ? accountIds : []).map(String));
      session.publicPlayers = session.publicPlayers.filter((accountId) => !leaving.has(accountId));
      session.privatePlayers = session.privatePlayers.filter((accountId) => !leaving.has(accountId));
      countOpenSlots(session);
      touch(session);
      return session;
    },

    list() {
      return live();
    },

    heartbeat(id) {
      const session = this.get(id);
      if (session) touch(session);
      return session;
    },

    // Core's: the difficulty row the session's zone is played at, world/validate's reply and then each ModifyMission.
    setZoneDifficulty(id, rowName) {
      const session = this.get(id);
      if (session) session.zoneDifficulty = rowName;
      return session;
    },

    setStarted(id, started) {
      const session = this.get(id);
      if (session) {
        session.started = started;
        touch(session);
      }
      return session;
    },

    remove(id) {
      return sessions.delete(id);
    },

    // matchMakingRequest: {criteria: [{type, key, value}], requireDedicated, maxCurrentPlayers, minCurrentPlayers,
    // openPlayersRequired, excludePlayers, buildUniqueId, maxResults}. Criteria keys are attribute keys like REGION_s.
    search(request) {
      const excluded = new Set((request?.excludePlayers ?? []).map(String));
      const results = live().filter((session) => {
        if (request?.requireDedicated && !session.isDedicated) return false;
        if (request?.buildUniqueId !== undefined && String(request.buildUniqueId) !== session.buildUniqueId) return false;
        const current = currentPlayers(session);
        if (Number.isFinite(request?.maxCurrentPlayers) && current > request.maxCurrentPlayers) return false;
        if (Number.isFinite(request?.minCurrentPlayers) && current < request.minCurrentPlayers) return false;
        if (Number.isFinite(request?.openPlayersRequired) && session.openPublicPlayers < request.openPlayersRequired) return false;
        if (players(session).some((id) => excluded.has(id))) return false;
        return (request?.criteria ?? []).every(({ type, key, value }) => compare[type]?.(session.attributes?.[key], value) ?? false);
      });
      results.sort((a, b) => b.sortWeight - a.sortWeight || a.lastUpdated.localeCompare(b.lastUpdated));
      return results.slice(0, Number.isFinite(request?.maxResults) ? request.maxResults : results.length);
    },

    findPlayer(accountId) {
      return live().filter((session) => players(session).includes(accountId));
    },

    // The AES key the client and server encrypt their connection with (FAESHandlerComponent wants 32 bytes).
    key(id, accountId) {
      const session = this.get(id);
      if (!session) return undefined;
      session.keys[accountId] ??= crypto.randomBytes(32).toString("base64");
      return session.keys[accountId];
    }
  };
}

// What the client parses (OnlineSessionJsonMcp): the settings, the session info and the open slot counts.
// viewer: the request it goes to. A server on this machine registers as 127.0.0.1, which a client on another machine
// can't reach; it gets the address it reached the backend on instead (as the XMPP hotfix does), the server being here.
export function sessionJson(session, viewer) {
  const { keys, zoneDifficulty, ...json } = session;
  const socket = viewer?.socket;
  if (socket && isLoopback(json.serverAddress) && !isLoopback(socket.remoteAddress)) {
    json.serverAddress = normalizeAddress(socket.localAddress);
  }
  return json;
}

// The launcher's view (Launcher-Plan "Game sessions"): who runs each session, who is in it and what it hosts.
export function sessionSummary(session) {
  return {
    id: session.id,
    ownerId: session.ownerId,
    ownerName: session.ownerName,
    serverName: session.serverName,
    serverAddress: session.serverAddress,
    serverPort: session.serverPort,
    gameMode: session.attributes?.GAMEMODE_s ?? "",
    region: session.attributes?.REGION_s ?? "",
    beaconPort: session.attributes?.BEACONPORT_i ?? 0,
    publicPlayers: [...session.publicPlayers],
    privatePlayers: [...session.privatePlayers],
    currentPlayers: currentPlayers(session),
    maxPlayers: session.maxPublicPlayers + session.maxPrivatePlayers,
    started: session.started,
    lastUpdated: session.lastUpdated
  };
}
