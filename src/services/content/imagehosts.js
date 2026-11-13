import net from "node:net";
import { isLoopback, isPrivate } from "../../network.js";
import { storedImageName } from "./images.js";

// The picture hosts the game's -httpproxy may reach through this backend (Core-Backend #260). A client started with
// -httpproxy=<backend> (Core-Launcher's default for every build) sends all of its HTTP here, not only Epic's: libcurl's
// bUseHttpProxy covers every FHttpModule request, the CMS cache's image downloads (CMSURLCache's web image path,
// 0x31A890 on 4.1) among them. proxy.js answers each CONNECT itself, with a certificate of its own for the host, so a
// tile picture on cdn2.unrealengine.com reached the backend's routes and got their 404, and every mode select tile kept
// the blueprint's default picture. These hosts are tunnelled to the real site instead (proxy.js), and nothing else is:
// the backend is no open proxy. They are Epic's image CDN, which serves Epic's own tile and news pictures, and the hosts
// of the pictures the admin panel set (the mode select tiles' and the lobby news'), each on its URL's own port. Epic's
// API hosts (epicgames.com, epicgames.net) stay the backend's, and nothing on this PC or its network is reached this way.
export const epicImageHosts = ["cdn2.unrealengine.com"];

const epicApiHost = /(^|\.)epicgames\.(com|net)$/;

// "host:port" of an http(s) picture URL the proxy may tunnel to, or null (an upload, an Epic API host, a local address).
export function imageHostOf(value) {
  const text = String(value ?? "").trim();
  if (!text || storedImageName(text)) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || epicApiHost.test(hostname)) return null;
  if (net.isIP(hostname) && (isLoopback(hostname) || isPrivate(hostname) || hostname === "0.0.0.0" || hostname === "::" || hostname === "::1")) {
    return null;
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${net.isIPv6(hostname) ? `[${hostname}]` : hostname}:${port}`;
}

// Every "host:port" the proxy tunnels for the current settings: Epic's image CDN on 443 and the admin's picture hosts.
// extra: other pictures the admin set outside the settings (the tournaments' pictures, Core-Backend #336).
export function imageHosts(settings = {}, config = {}, extra = []) {
  const custom = [
    ...Object.values(settings.playlistImages ?? config.playlistImages ?? {}),
    (settings.battleRoyaleNews ?? config.battleRoyaleNews)?.image,
    ...extra
  ];
  return new Set([...epicImageHosts.map((host) => `${host}:443`), ...custom.map(imageHostOf).filter(Boolean)]);
}

// Whether a CONNECT target ("host:port") or an absolute-form request's host and port is a picture host to tunnel to.
export function isImageHost(target, settings = {}, config = {}, extra = []) {
  const text = String(target ?? "").trim().toLowerCase();
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d{1,5})$/.exec(text);
  if (!match) return false;
  return imageHosts(settings, config, extra).has(`${match[1].replace(/\.$/, "")}:${Number(match[2])}`);
}
