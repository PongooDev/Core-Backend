import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { readJson, writeJson } from "./json-file.js";
import { log } from "./log.js";

// Who may connect, and which address of this machine each player is told to use ("Play with friends" in the README).
//
// remoteAccess (default false): off, the backend listens on 127.0.0.1 only and drops any other connection, so nothing
// outside this PC can reach it. On, it listens on every interface (or on listenAddress), so friends can connect.
// publicAddress: the address friends on the internet reach this machine at (its public IP, or a host name such as a
// dynamic DNS name), handed out in place of the gameservers' loopback or private addresses and as the XMPP address.
//
// Precedence: the command line, then what the admin panel saved (data/network.json, kept with the accounts so it
// survives the launcher's updates), then config.json, then the defaults.
export const networkKeys = ["remoteAccess", "listenAddress", "publicAddress"];
const panelKeys = ["remoteAccess", "publicAddress"];
const defaults = { remoteAccess: false, listenAddress: "", publicAddress: "" };
const resolveEveryMs = 5 * 60 * 1000;

// The client's session reader (sub_37F5010) parses serverAddress as an IP and only maps 0:0:0:0:0:0:0:1 itself
// ("Failed to parse ip address %s" otherwise). Node reports IPv4 peers on a dual-stack socket as ::ffff:a.b.c.d, and
// the Cert server's update body (sub_380D1E0) writes its address as the IPv4 number ("%u", 2130706433 for 127.0.0.1).
export function normalizeAddress(address) {
  const text = String(address ?? "").trim();
  if (text === "::1" || text === "0:0:0:0:0:0:0:1") return "127.0.0.1";
  if (/^\d+$/.test(text) && Number(text) <= 0xffffffff) {
    const ip = Number(text);
    return [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join(".");
  }
  return text.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
}

export const isLoopback = (address) => /^127\./.test(normalizeAddress(address));

// Addresses that only mean something on the host's own network or VPN: private (RFC 1918), link-local, carrier-grade
// NAT (100.64.0.0/10, also Tailscale's), the gaming VPNs' ranges (Hamachi 25.0.0.0/8, Radmin VPN 26.0.0.0/8, which
// players never come from otherwise) and IPv6 unique-local and link-local.
export function isPrivate(address) {
  const text = normalizeAddress(address).toLowerCase();
  if (net.isIPv4(text)) {
    const [a, b] = text.split(".").map(Number);
    return a === 10 || a === 25 || a === 26 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return net.isIPv6(text) && /^(f[cd]|fe[89ab])/.test(text);
}

// Gameservers on other PCs (Core-Backend #125): the admin panel's Trusted Hosting IPs (settings allowedHostingIps) are
// the other machines whose gameservers may log in to the server accounts, take DedicatedServer client tokens and
// register sessions. This PC always may; another machine only when its IP is listed (and remote access is on, or
// nothing outside this PC connects at all). The IP is always the connection's own (socket.remoteAddress): headers such
// as X-Forwarded-For are the client's to write, and the backend is never behind a proxy that would set them.
export const defaultHostingIps = ["127.0.0.1", "::1"];
export const maxHostingIps = 64;

// An entry of the list as it is kept: an IP address, IPv4-mapped IPv6 as IPv4 and IPv6 in its compressed form, or null
// for anything else (a host name, a range, "0.0.0.0").
export function hostingIp(value) {
  if (typeof value !== "string") return null;
  let text = value.trim().toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
  const version = net.isIP(text);
  if (!version) return null;
  if (version === 6) text = new URL(`http://[${text}]`).hostname.slice(1, -1);
  return text === "0.0.0.0" || text === "::" ? null : text;
}

// The list kept from a saved or sent one: its IP addresses, each once, up to maxHostingIps; undefined when it isn't a list.
export function hostingIps(list) {
  if (!Array.isArray(list)) return undefined;
  return [...new Set(list.map(hostingIp).filter(Boolean))].slice(0, maxHostingIps);
}

// Whether a connection from this address may host: this PC's own (loopback), or a listed IP.
export function allowsHosting(remoteAddress, list = defaultHostingIps) {
  if (isLoopback(remoteAddress)) return true;
  const address = hostingIp(normalizeAddress(remoteAddress));
  return address !== null && (hostingIps(list) ?? []).includes(address);
}

// A viewer on this PC, or on its network (LAN or VPN): it reached the backend directly, on an address it can use.
const isNearby = (address) => isLoopback(address) || isPrivate(address);

// An address friends could be given: an IP, or a host name (resolved here, as the client wants an IP).
export function validPublicAddress(value) {
  const text = String(value ?? "").trim();
  if (text === "") return true;
  if (net.isIP(text)) return !isLoopback(text) && text !== "0.0.0.0";
  return text.length <= 253 && /^(?=.*[a-z])[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(text);
}

export function validateNetwork(values, source) {
  if (values.remoteAccess !== undefined && typeof values.remoteAccess !== "boolean") throw new Error(`${source}: remoteAccess must be true or false`);
  if (values.listenAddress !== undefined && values.listenAddress !== "" && !net.isIP(String(values.listenAddress))) {
    throw new Error(`${source}: listenAddress must be an IP address of this PC, or empty for every interface`);
  }
  if (values.publicAddress !== undefined && !validPublicAddress(values.publicAddress)) {
    throw new Error(`${source}: publicAddress must be an IP address or a host name`);
  }
}

// The IPv4 address in a Host header ("1.2.3.4:5595"), which is the address a client using the redirect typed in.
function hostHeaderAddress(req) {
  const host = String(req?.headers?.host ?? "").replace(/:\d+$/, "");
  return net.isIPv4(host) && !isLoopback(host) && host !== "0.0.0.0" ? host : null;
}

// This PC's addresses on its networks, for the admin panel ("friends on your network use ...").
export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."))
    .map((entry) => entry.address);
}

export function createNetwork(config = {}) {
  const file = config.dataDir ? path.join(config.dataDir, "network.json") : null;
  const fixed = new Set(config.fromCommandLine ?? []);
  const settings = { ...defaults };
  for (const key of networkKeys) if (config[key] !== undefined) settings[key] = config[key];

  let saved = {};
  if (file && fs.existsSync(file)) {
    try {
      saved = readJson(file);
      validateNetwork(saved, file);
    } catch (error) {
      log("Network", `Ignoring ${file}: ${error.message}`);
      saved = {};
    }
  }
  for (const key of panelKeys) if (saved[key] !== undefined && !fixed.has(key)) settings[key] = saved[key];
  settings.publicAddress = String(settings.publicAddress ?? "").trim();
  settings.listenAddress = String(settings.listenAddress ?? "").trim();

  const listeners = new Set();
  let resolved = { name: "", address: null, error: null };
  let timer = null;

  async function resolve() {
    const name = settings.publicAddress;
    if (!name || net.isIP(name)) {
      resolved = { name, address: name || null, error: null };
      return;
    }
    try {
      const { address } = await dns.lookup(name, { family: 4 });
      if (settings.publicAddress === name) resolved = { name, address, error: null };
    } catch (error) {
      if (settings.publicAddress === name) {
        resolved = { name, address: resolved.name === name ? resolved.address : null, error: error.code ?? error.message };
        log("Network", `Couldn't look up publicAddress ${name}: ${resolved.error}`);
      }
    }
  }

  function schedule() {
    clearInterval(timer);
    timer = null;
    resolved = { name: settings.publicAddress, address: net.isIP(settings.publicAddress) ? settings.publicAddress : null, error: null };
    if (settings.publicAddress && !net.isIP(settings.publicAddress)) {
      resolve();
      timer = setInterval(resolve, resolveEveryMs);
      timer.unref();
    }
  }
  schedule();

  const network = {
    // Where the backend listens now ({ host, port }; host "" for every interface), set by listen.js.
    listening: null,

    settings: () => ({ ...settings }),
    fixed: () => [...fixed],

    // The host to listen on: undefined listens on every interface, as Node does with no host (dual-stack where it can).
    bindAddress: () => (settings.remoteAccess ? settings.listenAddress || undefined : "127.0.0.1"),

    // Whether a connection from this address is let in.
    allows: (remoteAddress) => settings.remoteAccess || isLoopback(remoteAddress),

    // publicAddress as an IP, once a host name has been looked up.
    publicIp: () => resolved.address,
    resolution: () => ({ ...resolved }),

    // Which address of this machine the requester should use: the one it reached the backend on when it is on this PC or
    // its network; for a player on the internet, publicAddress, else the IP it typed (the Host header the redirect
    // sends), else the local address.
    reachableAddress(req) {
      const local = normalizeAddress(req?.socket?.localAddress);
      if (isNearby(req?.socket?.remoteAddress)) return local;
      return resolved.address ?? hostHeaderAddress(req) ?? local;
    },

    // The address a gameserver's session is handed out with. A server registered from this PC (loopback) or this network
    // (a private address) can't be reached by those addresses from the internet; a server elsewhere keeps its own.
    serverAddressFor(serverAddress, req) {
      const socket = req?.socket;
      if (!socket || isLoopback(socket.remoteAddress)) return serverAddress;
      const loopbackServer = isLoopback(serverAddress);
      if (!loopbackServer && !isPrivate(serverAddress)) return serverAddress;
      if (!isNearby(socket.remoteAddress)) {
        const outside = resolved.address ?? hostHeaderAddress(req);
        if (outside) return outside;
      }
      return loopbackServer ? normalizeAddress(socket.localAddress) : serverAddress;
    },

    // Saves the admin panel's changes (remoteAccess, publicAddress) to data/network.json and applies them.
    update(changes) {
      const next = {};
      for (const key of panelKeys) {
        if (changes?.[key] === undefined) continue;
        if (fixed.has(key)) throw new Error(`${key} is set on the backend's command line`);
        next[key] = key === "publicAddress" ? String(changes[key]).trim() : changes[key];
      }
      validateNetwork(next, "network settings");
      const before = { ...settings };
      Object.assign(settings, next);
      if (file) {
        const stored = {};
        for (const key of panelKeys) if (!fixed.has(key)) stored[key] = settings[key];
        writeJson(file, stored);
      }
      if (before.publicAddress !== settings.publicAddress) schedule();
      if (before.remoteAccess !== settings.remoteAccess || before.publicAddress !== settings.publicAddress) {
        log("Network", `Remote access ${settings.remoteAccess ? "on" : "off"}${settings.publicAddress ? `, public address ${settings.publicAddress}` : ""}`);
        for (const listener of [...listeners]) listener(network.settings(), before);
      }
      return network.settings();
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      clearInterval(timer);
      timer = null;
    }
  };
  return network;
}
