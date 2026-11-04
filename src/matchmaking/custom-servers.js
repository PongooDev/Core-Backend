import { inIpRanges, ipRange } from "../network.js";

// Custom matchmaking servers (Core-Backend #227): gameservers kept for custom matchmaking keys' matches (#186), so a
// custom matchmaking host can have dedicated servers of their own. A server whose IP is listed never takes a public
// match. An entry is { address, keys, accounts }: the server's IP or CIDR range (network.js ipRange), and the matches it
// takes: those of the keys listed, or opened by one of the accounts listed (the party that opened the key has one of
// them), or every custom match when it lists neither. A custom match one of the entries takes plays on such a server,
// and only on one unless the admin panel's customMatchFallback lets it play on a public server when none is free; a
// custom match no entry takes plays on the public servers, as before.
export const maxCustomServers = 64;
const maxKeys = 32;
const maxAccounts = 32;
// The keys the lobby sends (ticket.js: 4 to 16 characters).
const keyLength = { min: 4, max: 16 };

export const validCustomKey = (key) => typeof key === "string" && key.length >= keyLength.min && key.length <= keyLength.max;

// The list kept from a saved or sent one: the valid entries, up to maxCustomServers; undefined when it isn't a list.
export function customMatchServers(list) {
  if (!Array.isArray(list)) return undefined;
  const kept = [];
  for (const entry of list) {
    const address = ipRange(typeof entry === "string" ? entry : entry?.address);
    if (address === null) continue;
    const keys = [...new Set((Array.isArray(entry?.keys) ? entry.keys : []).filter(validCustomKey))].slice(0, maxKeys);
    const accounts = [...new Set((Array.isArray(entry?.accounts) ? entry.accounts : [])
      .filter((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id)))].slice(0, maxAccounts);
    kept.push({ address, keys, accounts });
    if (kept.length >= maxCustomServers) break;
  }
  return kept;
}

// What a sent entry gets wrong, for the admin panel's error, or null.
export function customServerProblem(entry) {
  const address = typeof entry === "string" ? entry : entry?.address;
  if (ipRange(address) === null) return `Not an IP address or CIDR range: ${String(address ?? "")}`;
  const badKey = (Array.isArray(entry?.keys) ? entry.keys : []).find((key) => !validCustomKey(key));
  if (badKey !== undefined) return `Custom matchmaking key ${String(badKey)} must be between ${keyLength.min} and ${keyLength.max} characters long`;
  return null;
}

// Whether an entry takes a custom match: its key, opened by a party with these players.
const takes = (entry, customKey, players) => (!entry.keys.length && !entry.accounts.length)
  || entry.keys.includes(customKey) || players.some((id) => entry.accounts.includes(id));

// The entries a server at this address is, [] for a public server.
export const reservationsOf = (address, list) => (Array.isArray(list) ? list.filter((entry) => inIpRanges(address, [entry.address])) : []);

// Whether a custom match has servers of its own: one of the entries takes it.
export const hasCustomServers = (customKey, players, list) => Boolean(customKey) && (Array.isArray(list) ? list : []).some((entry) => takes(entry, customKey, players));

// Whether a server at this address may host a match: a public match only on a public server; a custom match on a server
// kept for it, or on a public server when no entry takes it or (fallback) none of its own is free.
export function serverTakes(address, { customKey = null, players = [] } = {}, list = []) {
  const reserved = reservationsOf(address, list);
  if (!customKey) return reserved.length === 0;
  if (reserved.length) return reserved.some((entry) => takes(entry, customKey, players));
  return true;
}
