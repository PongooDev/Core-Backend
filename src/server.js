import http from "node:http";
import { createApp, createContext } from "./app.js";
import { enableProxy } from "./proxy.js";
import { enableStomp } from "./stomp/service.js";
import { enableXmpp } from "./xmpp/service.js";

export async function createServer(config) {
  const context = createContext(config);
  const server = http.createServer(createApp(config, context));
  await enableProxy(server);
  enableXmpp(server, context.xmpp);
  enableStomp(server, context.stomp);
  return server;
}
