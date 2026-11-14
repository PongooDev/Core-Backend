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
// behindProxy (default false): the backend sits behind a reverse proxy (Caddy, nginx, a tunnel) on this PC or its
// network, which writes the connecting IP in X-Forwarded-For (clientAddress, Core-Backend #227).
//
// Precedence: the command line, then what the admin panel saved (data/network.json, kept with the accounts so it
// survives the launcher's updates), then config.json, then the defaults.
export const networkKeys = ["remoteAccess", "listenAddress", "publicAddress", "behindProxy"];
const panelKeys = ["remoteAccess", "publicAddress", "behindProxy"];
const defaults = { remoteAccess: false, listenAddress: "", publicAddress: "", behindProxy: false };
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
// nothing outside this PC connects at all). The IP is the connection's own (socket.remoteAddress), or with behindProxy on
// the one the proxy wrote (clientAddress): otherwise headers such as X-Forwarded-For are the client's to write.
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
  if (values.behindProxy !== undefined && typeof values.behindProxy !== "boolean") throw new Error(`${source}: behindProxy must be true or false`);
}

// IP ranges (Core-Backend #227): the admin panel's per-region hosting IPs and custom matchmaking servers. An entry is an
// IP address or a CIDR range ("203.0.113.0/24", "2001:db8::/32"), kept as hostingIp writes the address ("1.2.3.4",
// "1.2.3.0/24"; a whole-length prefix is the address alone); null for anything else.
export const maxIpRanges = 64;
export function ipRange(value) {
  if (typeof value !== "string") return null;
  const [address, prefix, extra] = value.trim().split("/");
  if (extra !== undefined) return null;
  const ip = hostingIp(address) ?? (prefix !== undefined && /^(0\.0\.0\.0|::)$/.test(address.trim()) ? address.trim() : null);
  if (ip === null) return null;
  if (prefix === undefined) return ip;
  const bits = net.isIPv4(ip) ? 32 : 128;
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > bits) return null;
  return Number(prefix) === bits ? ip : `${ip}/${Number(prefix)}`;
}

// The list kept from a saved or sent one: each range once, up to maxIpRanges; undefined when it isn't a list.
export function ipRanges(list) {
  if (!Array.isArray(list)) return undefined;
  return [...new Set(list.map(ipRange).filter(Boolean))].slice(0, maxIpRanges);
}

// The entries of a sent list that aren't IP addresses or ranges, for the admin panel's error.
export const invalidIpRanges = (list) => (Array.isArray(list) ? list.filter((entry) => ipRange(entry) === null) : []);

// Whether an address is in one of the ranges.
export function inIpRanges(address, list) {
  const ip = hostingIp(normalizeAddress(address));
  if (ip === null || !Array.isArray(list)) return false;
  const blocks = new net.BlockList();
  for (const entry of list) {
    const range = ipRange(entry);
    if (range === null) continue;
    const [base, prefix] = range.split("/");
    const type = net.isIPv4(base) ? "ipv4" : "ipv6";
    if (prefix === undefined) blocks.addAddress(base, type);
    else blocks.addSubnet(base, Number(prefix), type);
  }
  return blocks.check(ip, net.isIPv4(ip) ? "ipv4" : "ipv6");
}

// The IP a request came from (Core-Backend #227): the connection's own; with behindProxy on and the connection from the
// proxy (this PC or its network), the last address in X-Forwarded-For, the one the proxy itself added (those before it
// are the client's to write). With behindProxy off the header is never read, so nobody can claim another IP with it.
export function clientAddress(req, behindProxy = false) {
  const peer = normalizeAddress(req?.socket?.remoteAddress);
  if (!behindProxy || !(isLoopback(peer) || isPrivate(peer))) return peer;
  const header = req?.headers?.["x-forwarded-for"];
  const entries = (Array.isArray(header) ? header.join(",") : String(header ?? "")).split(",").map((entry) => entry.trim()).filter(Boolean);
  const last = entries.at(-1)?.replace(/^\[(.*)\](:\d+)?$/, "$1").replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1");
  return last && net.isIP(last) ? normalizeAddress(last) : peer;
}

// The address a route works with: the one app.js worked out for the request (clientAddress), else the connection's own.
export const requestAddress = (req) => req?.clientAddress ?? normalizeAddress(req?.socket?.remoteAddress);

// A request a TLS-terminating reverse proxy (Caddy, nginx, a Cloudflare tunnel and the like) forwarded from an https://
// backend address, as its X-Forwarded-Proto says (Core #197, Core-Launcher #9): { host, hostname } of the address the
// client used (X-Forwarded-Host, else Host), or null for any other request. The headers are the client's to write,
// but all they change is the addresses that client itself is handed back (wss:// and the proxy's host).
export function httpsProxied(req) {
  const first = (name) => String(req?.headers?.[name] ?? "").split(",")[0].trim();
  if (first("x-forwarded-proto").toLowerCase() !== "https") return null;
  const host = first("x-forwarded-host") || first("host");
  let hostname = "";
  try {
    hostname = new URL(`https://${host}`).hostname.replace(/^\[(.*)\]$/, "$1");
  } catch {
    return null;
  }
  return host && hostname ? { host, hostname } : null;
}

// The IPv4 address in a Host header ("1.2.3.4:5595"), which is the address a client using the redirect typed in.
function hostHeaderAddress(req) {
  const host = String(req?.headers?.host ?? "").replace(/:\d+$/, "");
  return net.isIPv4(host) && !isLoopback(host) && host !== "0.0.0.0" ? host : null;
}

// A request the game's -httpproxy carried (Core-Backend #261): in absolute form ("GET http://host/path", proxy.js
// originForm) or through one of its CONNECT tunnels (proxy.js). Its Host is the name the game asked for (an Epic host,
// or another backend's such as api.echofn.org), not an address of this backend: what the game reaches without HTTP
// (the matchmaking WebSocket, libwebsockets, which neither uses the proxy nor goes through CoreRedirect, and the
// purchase flow's browser) looks that name up itself, and "getaddrinfo failed" when the PC can't. Those are handed
// the address the connection came in on instead (network.directHost).
export const viaHttpProxy = (req) => req?.viaHttpProxy === true || Boolean(req?.socket?.httpProxyTunnel);

// The backend's address as the client wrote it for this request: its Host header ("1.2.3.4:5595", "[::1]:5595",
// "play.example.com:40123"), which CoreRedirect takes from the launcher's backend address, so it is one the client
// reaches this backend at, whatever the network between (a host name, a VPN, a forwarded or tunnelled port). Null
// without one, for one that isn't a plain host and port, for an Epic host, and for any request the -httpproxy carried
// (viaHttpProxy), whose Host is the name the game asked for.
export function requestHost(req) {
  if (viaHttpProxy(req)) return null;
  return plainHost(req);
}

// The host a plain-HTTP request was sent to, the -httpproxy's absolute-form requests too (Core-Backend #349): with the
// launcher's default options a client has both the -httpproxy and CoreRedirect, which rewrites every Epic URL to the
// launcher's backend address before the proxy carries it, so the absolute form's host is the address the player's PC
// reaches this backend at (a public address, a host name, a tunnel's port), where the connection's own socket gives
// 127.0.0.1 behind a local tunnel agent and the local port behind a forwarded one. For what opens in the player's own
// browser, which must reach this backend from their PC. Null for a CONNECT tunnel's request (an https:// host), an Epic
// host (no CoreRedirect), or one that isn't a plain host and port.
export function sentToHost(req) {
  if (req?.socket?.httpProxyTunnel) return null;
  return plainHost(req);
}

function plainHost(req) {
  const host = String(req?.headers?.host ?? "").trim();
  if (!host || !/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/.test(host)) return null;
  let hostname;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (hostname === "0.0.0.0" || /(^|\.)epicgames\.(com|net)\.?$/.test(hostname)) return null;
  return host;
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
  settings.behindProxy = settings.behindProxy === true;

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

    // The IP a request came from: through the reverse proxy when behindProxy is on (clientAddress).
    clientAddress: (req) => clientAddress(req, settings.behindProxy === true),

    // Whether a connection from this address is let in.
    allows: (remoteAddress) => settings.remoteAccess || isLoopback(remoteAddress),

    // publicAddress as an IP, once a host name has been looked up.
    publicIp: () => resolved.address,
    resolution: () => ({ ...resolved }),

    // Which address of this machine the requester should use: the one it reached the backend on when it is on this PC or
    // its network; for a player on the internet, publicAddress, else the IP it typed (the Host header the redirect
    // sends), else the local address. A request an https reverse proxy forwarded comes from the proxy (often this PC), so
    // its player is handed publicAddress, else the host name it used for the backend.
    reachableAddress(req) {
      const local = normalizeAddress(req?.socket?.localAddress);
      const proxied = httpsProxied(req);
      if (proxied && proxied.hostname.toLowerCase() !== "localhost" && !isLoopback(proxied.hostname)) {
        return resolved.address ?? normalizeAddress(proxied.hostname);
      }
      if (isNearby(req?.socket?.remoteAddress)) return local;
      return resolved.address ?? hostHeaderAddress(req) ?? local;
    },

    // reachableAddress and the port the connection came in on ("127.0.0.1:5595", "[2001:db8::1]:5595"): this backend as
    // the requester's PC reaches it directly, for a request the -httpproxy carried (viaHttpProxy, Core-Backend #261).
    directHost(req) {
      const address = network.reachableAddress(req);
      return `${net.isIPv6(address) ? `[${address}]` : address}:${req?.socket?.localPort}`;
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

    // Saves the admin panel's changes (remoteAccess, publicAddress, behindProxy) to data/network.json and applies them.
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
      if (before.behindProxy !== settings.behindProxy) {
        log("Network", settings.behindProxy ? "Behind a reverse proxy: a connection from this PC or its network is from the IP in its X-Forwarded-For"
          : "Not behind a reverse proxy: X-Forwarded-For is ignored");
      }
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
