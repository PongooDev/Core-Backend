import http from "node:http";
import tls from "node:tls";
import { createApp, createContext } from "./app.js";
import { isLoopback } from "./network.js";
import { enableProxy } from "./proxy.js";
import { enableStomp } from "./stomp/service.js";
import { enableXmpp } from "./xmpp/service.js";

export async function createServer(config) {
  const context = createContext(config);
  const server = http.createServer(createApp(config, context));
  await enableProxy(server);
  enableXmpp(server, context.xmpp);
  enableStomp(server, context.stomp, context.matchmaker);
  // After enableXmpp, which takes over "connection" to tell XMPP streams from HTTP: this one runs before both.
  guardConnections(server, context.network);
  server.network = context.network;
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
