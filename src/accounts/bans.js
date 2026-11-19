import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";
import { log } from "../log.js";
import { hostingIp, isLoopback, isPrivate, normalizeAddress } from "../network.js";

// Ban types beyond the account ban (Core-Backend #390). 🟡 All of this is Core's own: Epic's account service banned
// accounts (errors.com.epicgames.account.account_not_active, and common_core's ban_status for the game's own notice,
// services/mcp/commands/SetBansViewed.js), but how it matched machines and addresses isn't in any client.
//
// - Account ban: account.banned = {reason, at} as it always was (accounts/store.js setBan), now with an optional until
//   (an ISO time). A ban without until never ends, so every ban saved before #390 stays permanent.
// - IP ban: an address (as hostingIp writes it) whose player logins and token requests are refused.
// - Hardware ban: a machine. Core's launcher sends X-Core-Hardware-Id on its login (Core-Launcher, BackendAuthClient):
//   the SHA-256 of a launcher prefix and the PC's MachineGuid, never the value itself. The backend keeps only an HMAC of
//   that with this backend's own random salt (data/bans.json), so the stored hash means nothing on another backend. An
//   account keeps the hash it last logged in with (account.hardware), which the game's own logins (they send no header)
//   and token refreshes are checked by.
//
// Every ban but a permanent one ends by itself: whether a ban still runs is decided each time it is checked (a login, a
// token refresh or exchange, the client's minute token check, the admin panel's list), with no timer. Ended IP and
// hardware bans are dropped from bans.json then; an ended account ban is cleared from the account (accounts.setBan).

export const hardwareHeader = "x-core-hardware-id";
export const banTypes = ["account", "ip", "hardware"];
// The longest timed ban the panel takes: ten years, in hours.
export const maxBanHours = 10 * 365 * 24;

// Whether a ban (an account's banned, or an IP or hardware entry) is in force at now: it exists and has no until, or an
// until still ahead. An until that isn't a time counts as permanent, so a hand-edited file never unbans by accident.
export function isActiveBan(ban, now = Date.now()) {
  if (!ban || typeof ban !== "object") return false;
  if (ban.until === undefined || ban.until === null) return true;
  const end = Date.parse(ban.until);
  return Number.isNaN(end) || end > now;
}

// The until of a ban hours from now, or null (permanent) for no hours; undefined when hours isn't a whole number of
// hours from 1 to maxBanHours.
export function banUntil(hours, now = Date.now()) {
  if (hours === undefined || hours === null || hours === "") return null;
  const value = Number(hours);
  if (!Number.isInteger(value) || value < 1 || value > maxBanHours) return undefined;
  return new Date(now + value * 3600 * 1000).toISOString();
}

// "until 2026-11-20 14:00 UTC" for a timed ban, "" for a permanent one.
export function untilText(ban) {
  if (!ban?.until) return "";
  const end = new Date(ban.until);
  if (Number.isNaN(end.getTime())) return "";
  return ` until ${end.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// The launcher's value: 64 hex digits (a SHA-256). Anything else is no hardware id at all.
export const hardwareIdValue = (value) => (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : null);

// This PC's own addresses (every interface's), which an IP ban would lock the host itself out with.
function ownAddresses() {
  const addresses = new Set();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const address = hostingIp(normalizeAddress(entry.address));
      if (address) addresses.add(address);
    }
  }
  return addresses;
}

// Whether an address may be IP banned: {address} as it is kept, with a warning for a private (LAN or VPN) address, or
// {problem}. Loopback (127.0.0.1, ::1) and this PC's own addresses are never banned: they are the host's own launcher,
// gameservers and admin panel.
export function checkBanAddress(value) {
  const text = normalizeAddress(String(value ?? "").trim());
  const address = hostingIp(text);
  if (!address) return { problem: "Enter an IP address (IPv4 or IPv6)." };
  if (isLoopback(address) || address === "::1") return { problem: `${address} is this PC itself (loopback) and can't be banned.` };
  if (ownAddresses().has(address)) return { problem: `${address} is one of this PC's own addresses and can't be banned.` };
  const warning = isPrivate(address)
    ? `${address} is a private address (your LAN or a VPN such as Hamachi, Radmin or Tailscale). Everyone who reaches this backend through that network from the same machine or router may share it.`
    : null;
  return { address, warning, ipv6: net.isIPv6(address) };
}

export function createBanStore(dataDir) {
  const file = path.join(dataDir, "bans.json");
  const saved = fs.existsSync(file) ? readJson(file) : {};
  const state = {
    // This backend's salt for hardware hashes, made once.
    salt: typeof saved.salt === "string" && saved.salt.length >= 32 ? saved.salt : crypto.randomBytes(32).toString("hex"),
    bans: Array.isArray(saved.bans) ? saved.bans.filter((ban) => ban && banTypes.includes(ban.type) && ban.type !== "account" && typeof ban.value === "string") : []
  };
  const save = () => writeJson(file, state);
  if (saved.salt !== state.salt) save();

  // Drops the IP and hardware bans that have ended, logging each.
  function prune(now = Date.now()) {
    const ended = state.bans.filter((ban) => !isActiveBan(ban, now));
    if (!ended.length) return;
    state.bans = state.bans.filter((ban) => isActiveBan(ban, now));
    for (const ban of ended) log("Core", `${describe(ban)} ended (it ran until ${ban.until})`);
    save();
  }

  const describe = (ban) => (ban.type === "ip" ? `IP ban of ${ban.value}` : `Hardware ban of ${ban.value.slice(0, 12)}…`)
    + (ban.displayName ? ` (${ban.displayName})` : "");

  return {
    // The salted hash kept for a launcher's hardware id, or null when the request sent none (or something else).
    hardwareHash(value) {
      const id = hardwareIdValue(value);
      return id ? crypto.createHmac("sha256", state.salt).update(id).digest("hex") : null;
    },

    // {type: "ip" | "hardware", value, reason, until, accountId, displayName}: the new ban. A second ban of the same
    // address or machine replaces the first.
    add({ type, value, reason = "", until = null, accountId = null, displayName = null }) {
      prune();
      state.bans = state.bans.filter((ban) => !(ban.type === type && ban.value === value));
      const ban = { id: crypto.randomUUID(), type, value, reason, at: new Date().toISOString(), until, accountId, displayName };
      state.bans.push(ban);
      save();
      return { ...ban };
    },

    remove(id) {
      const ban = state.bans.find((entry) => entry.id === id);
      if (!ban) return null;
      state.bans = state.bans.filter((entry) => entry !== ban);
      save();
      return { ...ban };
    },

    // The IP and hardware bans in force.
    list(now = Date.now()) {
      prune(now);
      return state.bans.map((ban) => ({ ...ban }));
    },

    // The ban in force on an address or hardware hash, or null.
    find(type, value, now = Date.now()) {
      if (!value) return null;
      prune(now);
      const ban = state.bans.find((entry) => entry.type === type && entry.value === value);
      return ban ? { ...ban } : null;
    },

    describe
  };
}

// The ban that refuses a player's login or token, or null: the account's own, its address's, then its machine's.
// hardwareHash is the request's (the launcher's header) or else the one the account last logged in with. An account ban
// that has ended is cleared from the account here.
export function playerBan({ accounts, bans, account, address, hardwareHash, now = Date.now() }) {
  if (account?.banned) {
    if (isActiveBan(account.banned, now)) return { kind: "account", ban: account.banned };
    log("Core", `${account.displayName}'s temporary ban ended (it ran until ${account.banned.until})`);
    accounts.setBan(account, null);
  }
  if (!bans) return null;
  const ip = address ? hostingIp(normalizeAddress(address)) : null;
  const ipBan = ip && bans.find("ip", ip, now);
  if (ipBan) return { kind: "ip", ban: ipBan };
  const machine = hardwareHash ?? account?.hardware?.hash ?? null;
  const hardwareBan = machine && bans.find("hardware", machine, now);
  if (hardwareBan) return { kind: "hardware", ban: hardwareBan };
  return null;
}

// The message a refused login gets. The game shows its own text for a refused login ("Unable to login to Fortnite
// servers", builds/allowed.js), so this is what Core's launcher shows, with a timed ban's end.
export function banMessage({ kind, ban }) {
  const what = kind === "ip" ? "This IP address is banned" : kind === "hardware" ? "This PC is banned" : "This account is banned";
  return `${what}${untilText(ban)}${ban.reason ? `: ${ban.reason}` : ""}`;
}
