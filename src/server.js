import http from "node:http";
import { createApp } from "./app.js";
import { enableProxy } from "./proxy.js";

export async function createServer(config) {
  const server = http.createServer(createApp(config));
  await enableProxy(server);
  return server;
}
