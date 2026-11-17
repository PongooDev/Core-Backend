import http from "node:http";
import tls from "node:tls";
import { createApp, createContext } from "./app.js";
import { isLoopback } from "./network.js";
import { enableProxy } from "./proxy.js";
import { isImageHost } from "./services/content/imagehosts.js";
import { customShowdownImages } from "./tournaments/showdown.js";
import { enableStomp } from "./stomp/service.js";
import { enableTls } from "./tls/service.js";
import { enableXmpp } from "./xmpp/service.js";

export async function createServer(config) {
  const context = createContext(config);
  const server = http.createServer(createApp(config, context));
  // Picture hosts (Core-Backend #260; the tournaments' too, #336) are tunnelled to the real site; every other CONNECT is
  // the backend's own.
  await enableProxy(server, (target) => isImageHost(target, context.settings?.get?.() ?? {}, config, customShowdownImages(context.tournaments)));
  enableXmpp(server, context.xmpp);
  enableStomp(server, context.stomp, context.matchmaker);
  // https on the same port (Core-Backend #377): after enableXmpp, so a TLS connection's decrypted stream is told apart
  // the same way.
  if (context.tls) enableTls(server, context.tls);
  // After enableXmpp and enableTls, which take over "connection" to tell TLS, XMPP and HTTP apart: this one runs first.
  guardConnections(server, context.network);
  server.network = context.network;
  server.vivox = context.vivox;
  server.tls = context.tls;
  return server;
}

// Only this PC gets in unless remote access is on (network.js), whatever the backend listens on. When it is turned off,
// other machines' open connections (HTTP keep-alive, XMPP, STOMP) are closed too. The HTTPS proxy's tunnels come back
// through "connection" as TLS sockets; their TCP connection was already let in.
function guardConnections(server, network) {
  const open = new Set();
  server.prependListener("connection", (socket) => {
    if (socket instanceof tls.TLSSocket) return;
    if (!network.allows(socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    if (!isLoopback(socket.remoteAddress)) {
      open.add(socket);
      socket.once("close", () => open.delete(socket));
    }
  });
  network.onChange((settings) => {
    if (settings.remoteAccess) return;
    for (const socket of open) socket.destroy();
    open.clear();
  });
}
