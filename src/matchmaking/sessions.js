import crypto from "node:crypto";
import { log } from "../log.js";
import { createNetwork, normalizeAddress } from "../network.js";

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

// DISTANCE is the writer's name for EOnlineComparisonOp::Near (sub_3806070): it orders the results by how close the
// attribute is to the value and drops none. Every search for a session to join in progress sends two: the critical
// mission tile's FindCriticalMission (sub_646BB0) MMLVL_i and NEEDSSORT_i, the gather search's FindGatheringSession
// (sub_6473B0) the same pair, FindJIPSession (sub_6477A0) NEEDSSORT_i, each NEEDSSORT_i with the value INT32_MIN (so
// the session needing the fewest players comes first). A session without the attribute comes after those with it.
const distance = (session, { key, value }) => {
  const actual = session.attributes?.[key];
  return typeof actual === "number" && typeof value === "number" ? Math.abs(actual - value) : Infinity;
};

// A criterion type the search doesn't know matches nothing, so the search can never find a session: logged once a type.
const unknownTypes = new Set();
function matches(session, { type, key, value }) {
  if (type === "DISTANCE") return true;
  const test = compare[type];
  if (!test) {
    if (!unknownTypes.has(type)) {
      unknownTypes.add(type);
      log("Matchmaking", `Unknown matchmaking criterion type ${type} (key ${key}): no session matches it`);
    }
    return false;
  }
  return test(session.attributes?.[key], value);
}

// Address helpers live with the network settings; normalizeAddress and isLoopback are also used from here.
export { isLoopback, normalizeAddress } from "../network.js";

// "" (the Cert server's create body has no address unless -UseLocalIPs) and "0.0.0.0" (its -UseLocalIPs failure value)
// say nothing about where the server is.
const usable = (address) => address !== "" && address !== "0.0.0.0";

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

// Everyone who has been on the session: the players registered now and every account the connection key was fetched for
// (the client for itself and the server for each player joining), which stays after they unregister.
export const sessionMembers = (session) => [...new Set([...Object.keys(session.keys), ...players(session)])];
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
  // Called after every change a search can see (a session made, updated, filled, emptied or started).
  const watchers = new Set();
  const changed = () => {
    for (const watcher of [...watchers]) watcher();
  };

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
    // hostAccountId: the account the create request was made with, the gameserver's own (the Cert server's body leaves
    // ownerId empty).
    create(body, connectionAddress = "", hostAccountId = "") {
      const session = {
        id: crypto.randomBytes(16).toString("hex"),
        ownerId: "", ownerName: "", serverName: "", serverAddress: "", serverPort: 0,
        ...structuredClone(settingDefaults),
        openPublicPlayers: 0, openPrivatePlayers: 0, sortWeight: 0,
        publicPlayers: [], privatePlayers: [],
        started: false,
        keys: {},
        zoneDifficulty: "",
        hostAccountId: String(hostAccountId ?? "")
      };
      apply(session, body);
      if (!usable(session.serverAddress)) session.serverAddress = normalizeAddress(connectionAddress);
      countOpenSlots(session);
      touch(session);
      // A gameserver account runs one server, which hosts one session: one it made before is from a server that has
      // since exited (the launcher restarts a crashed one under the same account), and must not be matched any more.
      if (session.hostAccountId) {
        for (const [id, previous] of sessions) if (previous.hostAccountId === session.hostAccountId) sessions.delete(id);
      }
      sessions.set(session.id, session);
      changed();
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
      changed();
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
      changed();
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
      changed();
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
        changed();
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
      const criteria = Array.isArray(request?.criteria) ? request.criteria : [];
      const nearness = criteria.filter(({ type }) => type === "DISTANCE");
      const results = live().filter((session) => {
        if (request?.requireDedicated && !session.isDedicated) return false;
        if (request?.buildUniqueId !== undefined && String(request.buildUniqueId) !== session.buildUniqueId) return false;
        const current = currentPlayers(session);
        if (Number.isFinite(request?.maxCurrentPlayers) && current > request.maxCurrentPlayers) return false;
        if (Number.isFinite(request?.minCurrentPlayers) && current < request.minCurrentPlayers) return false;
        if (Number.isFinite(request?.openPlayersRequired) && session.openPublicPlayers < request.openPlayersRequired) return false;
        if (players(session).some((id) => excluded.has(id))) return false;
        return criteria.every((criterion) => matches(session, criterion));
      });
      // The DISTANCE criteria first, in the order sent; then the most recently heard from: a server that stopped
      // heartbeating may be gone (its session is only dropped after staleAfterMs), and the client joins the first one
      // that takes its reservation.
      const byNearness = (a, b) => {
        for (const criterion of nearness) {
          const [da, db] = [distance(a, criterion), distance(b, criterion)];
          if (da !== db) return da < db ? -1 : 1;
        }
        return 0;
      };
      results.sort((a, b) => byNearness(a, b) || b.sortWeight - a.sortWeight || b.lastUpdated.localeCompare(a.lastUpdated));
      return results.slice(0, Number.isFinite(request?.maxResults) ? request.maxResults : results.length);
    },

    // listener runs after each change a search can see; the returned function stops it.
    watch(listener) {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },

    // The live sessions a gameserver account created.
    hostedBy(accountId) {
      return accountId ? live().filter((session) => session.hostAccountId === accountId) : [];
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
// viewer: the request it goes to. A server on this machine registers as 127.0.0.1 (or a private address), which a
// client on another machine can't reach: it gets an address of this machine it can reach instead (network.js
// serverAddressFor: the address it reached the backend on, or for a player on the internet the configured
// publicAddress or the IP it typed), the server being here.
const defaultNetwork = createNetwork();
export function sessionJson(session, viewer, network = defaultNetwork) {
  const { keys, zoneDifficulty, hostAccountId, ...json } = session;
  json.serverAddress = network.serverAddressFor(json.serverAddress, viewer);
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

