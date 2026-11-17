import tls from "node:tls";
import { log } from "../log.js";
import { loadCertificates, thumbprint } from "./certificates.js";

// The backend's local https (Core-Backend #377, certificates.js): the certificate set, made the first time something
// needs it (main.js at start-up, a TLS connection, the launcher asking for the root), and kept for the process. Null
// when it couldn't be made or read: the backend then goes on with plain http only.
export function createLocalTls(dataDir) {
  let loading = null;
  let state = null;
  return {
    ready() {
      loading ??= loadCertificates(dataDir).then((set) => {
        state = { ...set, rootThumbprint: thumbprint(set.rootCert) };
        return state;
      }, (error) => {
        log("Core", `Couldn't make the local https certificate (${error.message}): serving plain http only`);
        return null;
      });
      return loading;
    },
    get current() {
      return state;
    }
  };
}

// Serves https on the HTTP port, beside plain http and XMPP: a TLS connection's first byte is a handshake record's
// (0x16, the ClientHello), which neither an HTTP request nor an XMPP stream ('<') starts with. Its decrypted stream goes
// on to the same listeners as a plain connection, so every route answers over both, and XMPP's sniff (xmpp/service.js)
// still runs inside it. Call after enableXmpp. The HTTPS proxy's tunnels (proxy.js) come back as TLS sockets already and
// go straight on. A plain connection that sends nothing in 30 s is closed, as XMPP's sniff does.
export function enableTls(server, localTls) {
  const listeners = server.listeners("connection");
  server.removeAllListeners("connection");
  const handOn = (socket) => {
    for (const listener of listeners) listener.call(server, socket);
  };

  let tlsServer = null;
  const tlsServerReady = () => (tlsServer ??= localTls.ready().then((set) => {
    if (!set) return null;
    // A TLS server that never listens: it is handed the connections that start with a ClientHello.
    const secure = tls.createServer({ key: set.key, cert: set.cert, minVersion: "TLSv1.2", handshakeTimeout: 30_000 }, handOn);
    secure.on("tlsClientError", (error, socket) => socket.destroy());
    return secure;
  }));

  server.on("connection", (socket) => {
    if (socket instanceof tls.TLSSocket) return handOn(socket);
    const idle = setTimeout(() => socket.destroy(), 30_000);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => clearTimeout(idle));
    socket.once("data", (chunk) => {
      clearTimeout(idle);
      socket.pause();
      socket.unshift(chunk);
      if (chunk[0] !== 0x16) {
        handOn(socket);
        process.nextTick(() => socket.resume());
        return;
      }
      tlsServerReady().then((secure) => {
        if (!secure || socket.destroyed) return socket.destroy();
        secure.emit("connection", socket);
      });
    });
  });
}

// The start-up log line: whether https is on and what the root is.
export function tlsStatusLine(set, port) {
  if (!set) return "Local https is off (no certificate): plain http only, so buying V-Bucks on 7.00 and later won't open";
  return `Local https on port ${port} too, for https://127.0.0.1:${port} (root ${set.rootThumbprint.slice(0, 8)}..., ${set.created ? "made now" : "kept"}): `
    + "trust it in the launcher's Settings to buy V-Bucks on 7.00 and later";
}
