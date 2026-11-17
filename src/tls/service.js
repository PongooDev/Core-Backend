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
// A browser that doesn't trust the certificate drops the connection: during the handshake (with an alert, or by closing
// it), or once the handshake is done, before it asks for anything (Core-Backend #377). Either way the game only says
// "PageLoadFail", so the backend's log says it, at most once a minute: which way it went, and the fix.
const refusalLogMs = 60_000;
let lastRefusal = 0;

export function reportRefusal(reason, now = Date.now()) {
  if (now - lastRefusal < refusalLogMs) return false;
  lastRefusal = now;
  log("Core", `An https connection to this backend was dropped before it asked for a page (${reason}). That is what the `
    + "game's purchase browser does when it doesn't trust this backend's certificate: in the launcher, open Settings → "
    + "Backend → Local https and press the trust button (it must say \"Trusted\"), then try the purchase again");
  return true;
}

// A finished handshake whose socket closes without one byte from the client: the refusal after the handshake.
function watchRefusal(socket) {
  let asked = false;
  socket.once("data", () => {
    asked = true;
  });
  socket.once("close", () => {
    if (!asked) reportRefusal("closed after the handshake without a request");
  });
}

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
    const secure = tls.createServer({ key: set.key, cert: set.cert, minVersion: "TLSv1.2", handshakeTimeout: 30_000 }, (socket) => {
      watchRefusal(socket);
      handOn(socket);
    });
    secure.on("tlsClientError", (error, socket) => {
      reportRefusal(error.code ?? error.message);
      socket.destroy();
    });
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
        // The HTTP server's sockets allow half-open connections, so a client's FIN during the handshake never reached the
        // TLS server: a browser that refused the certificate left the connection open until the 30 s handshake timeout.
        // A TLS server's own sockets don't, and neither does this one now.
        socket.allowHalfOpen = false;
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
