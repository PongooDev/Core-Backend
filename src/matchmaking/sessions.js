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

const sessionFields = ["ownerId", "ownerName", "serverName", "serverAddress", "serverPort", "openPublicPlayers",
  "openPrivatePlayers", "sortWeight", ...Object.keys(settingDefaults)];

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

function apply(session, body) {
  for (const field of sessionFields) {
    if (body?.[field] !== undefined) session[field] = body[field];
  }
  session.buildUniqueId = String(session.buildUniqueId);
  for (const list of ["publicPlayers", "privatePlayers"]) {
    if (Array.isArray(body?.[list])) session[list] = body[list].map(String);
  }
}

const players = (session) => [...session.publicPlayers, ...session.privatePlayers];
const currentPlayers = (session) => Math.max(players(session).length,
  session.maxPublicPlayers + session.maxPrivatePlayers - session.openPublicPlayers - session.openPrivatePlayers);

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
    create(body) {
      const session = {
        id: crypto.randomBytes(16).toString("hex"),
        ownerId: "", ownerName: "", serverName: "", serverAddress: "", serverPort: 0,
        ...structuredClone(settingDefaults),
        openPublicPlayers: 0, openPrivatePlayers: 0, sortWeight: 0,
        publicPlayers: [], privatePlayers: [],
        started: false,
        keys: {}
      };
      apply(session, body);
      if (body?.openPublicPlayers === undefined) session.openPublicPlayers = session.maxPublicPlayers;
      if (body?.openPrivatePlayers === undefined) session.openPrivatePlayers = session.maxPrivatePlayers;
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
      touch(session);
      return session;
    },

    heartbeat(id) {
      const session = this.get(id);
      if (session) touch(session);
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
export function sessionJson(session) {
  const { keys, ...json } = session;
  return json;
}
