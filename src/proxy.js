import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import selfsigned from "selfsigned";

// isImageHost(target): whether a CONNECT target or an absolute-form request's "host:port" is a picture host that is
// tunnelled or forwarded to the real site (services/content/imagehosts.js, Core-Backend #260). Every other host is the
// backend's own, as before.
export async function enableProxy(server, isImageHost = () => false) {
  const base = await selfsigned.generate([{ name: "commonName", value: "Core-Backend" }], { algorithm: "sha256" });
  const keyPair = { privateKey: base.private, publicKey: base.public };
  const contexts = new Map();

  function contextFor(host) {
    if (!contexts.has(host)) {
      const pems = selfsigned.generate([{ name: "commonName", value: host }], { algorithm: "sha256", keyPair });
      contexts.set(host, pems.then(({ cert }) => tls.createSecureContext({ key: keyPair.privateKey, cert })));
    }
    return contexts.get(host);
  }

  server.on("connect", async (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    if (isImageHost(req.url)) {
      tunnel(req.url, socket, head);
      return;
    }
    const secureContext = await contextFor(req.url.replace(/:\d+$/, ""));

    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) socket.unshift(head);

    const tlsSocket = new tls.TLSSocket(socket, { isServer: true, secureContext });
    // What its requests came through (network.js viaHttpProxy): the host the game asked to reach, not this backend.
    tlsSocket.httpProxyTunnel = req.url;
    tlsSocket.on("error", () => socket.destroy());
    server.emit("connection", tlsSocket);
  });
}

// A CONNECT to a picture host: a plain TCP tunnel to the real site, so the game gets its own picture and certificate.
function tunnel(target, socket, head) {
  const separator = target.lastIndexOf(":");
  const host = target.slice(0, separator).replace(/^\[(.*)\]$/, "$1");
  const upstream = net.connect({ host, port: Number(target.slice(separator + 1)) });
  upstream.setTimeout(30_000, () => upstream.destroy());
  upstream.once("connect", () => {
    upstream.setTimeout(0);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => {
    if (!socket.destroyed && socket.bytesWritten === 0) socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    else socket.destroy();
  });
  socket.on("close", () => upstream.destroy());
}

const forwardedHeaders = ["accept", "accept-encoding", "user-agent", "if-none-match", "if-modified-since", "range"];
const returnedHeaders = ["content-type", "content-length", "content-encoding", "etag", "last-modified", "cache-control", "expires",
  "accept-ranges", "content-range"];

// An absolute-form GET or HEAD for a plain http:// picture on a picture host (isImageHost): fetched from the real site and
// passed back. Anything else goes on to originForm and the backend's routes.
export function forwardImageRequests(isImageHost = () => false) {
  return (req, res, next) => {
    if (!req.url.startsWith("http://") || (req.method !== "GET" && req.method !== "HEAD")) return next();
    let url;
    try {
      url = new URL(req.url);
    } catch {
      return next();
    }
    const port = url.port || "80";
    if (!isImageHost(`${url.hostname}:${port}`)) return next();
    const headers = Object.fromEntries(forwardedHeaders.filter((name) => req.headers[name] !== undefined).map((name) => [name, req.headers[name]]));
    const upstream = http.request({ host: url.hostname.replace(/^\[(.*)\]$/, "$1"), port: Number(port), method: req.method, path: url.pathname + url.search,
      headers: { ...headers, host: url.host }, timeout: 30_000 }, (response) => {
      res.status(response.statusCode ?? 502);
      for (const name of returnedHeaders) if (response.headers[name] !== undefined) res.setHeader(name, response.headers[name]);
      response.pipe(res);
    });
    upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
    upstream.on("error", () => (res.headersSent ? res.destroy() : res.status(502).end()));
    res.on("close", () => upstream.destroy());
    upstream.end();
  };
}

export function originForm(req, res, next) {
  if (!req.url.startsWith("/")) {
    // A request the -httpproxy carried as is (network.js viaHttpProxy): its Host is the name the game asked for.
    req.viaHttpProxy = true;
    const url = new URL(req.url);
    req.url = url.pathname + url.search;
    req.originalUrl = req.url;
  }
  next();
}
