import { loadConfig } from "./config.js";
import { describeHost, listen } from "./listen.js";
import { log } from "./log.js";
import { startQosPingServer } from "./matchmaking/qos.js";
import { createServer } from "./server.js";
import { tlsStatusLine } from "./tls/service.js";
import { defaultSipPort } from "./vivox/service.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  log("Core", error.message);
  process.exit(2);
}

const server = await createServer(config);
const { network } = server;

let port;
try {
  port = await listen(server, network, config.port);
} catch (error) {
  log("Core", error.code === "EADDRINUSE" ? `Port ${config.port} is already in use` : error.message);
  process.exit(1);
}

log("Core", `Listening on port ${port}`);
// The local https certificate (tls/service.js, Core-Backend #377): made on the first start, kept after.
log("Core", tlsStatusLine(await server.tls.ready(), port));
// The answer to the game's QoS region pings (matchmaking/qos.js, Core-Backend #123), where the backend listens.
const qosPing = config.qosPingPort ? await startQosPingServer(network, config.qosPingPort) : null;
network.qosPing = { port: qosPing?.port ?? null };
if (qosPing?.port) log("Core", `Answering the game's region pings on UDP port ${qosPing.port} (admin panel: Matchmaking, Auto Region)`);
// Fortnite's own Vivox voice chat (5.10 and later) against Core's emulator (vivox/service.js): its SIP server, UDP and
// TCP config vivoxSipPort (5060; 0 for none), where the backend listens.
const vivoxPort = config.vivoxSipPort ?? defaultSipPort;
const vivoxSip = vivoxPort ? await server.vivox.start(vivoxPort) : null;
if (vivoxSip?.port) log("Core", `Vivox voice chat for 5.10 and later: SIP on UDP and TCP port ${vivoxSip.port} (admin panel: Settings, Gameplay, Voice chat (Vivox))`);
log("Core", `Admin panel: http://127.0.0.1:${port}/admin`);
const { remoteAccess, publicAddress } = network.settings();
log("Core", remoteAccess
  ? `Remote access is on: listening on ${describeHost(network.bindAddress())}, friends can connect${publicAddress ? ` (public address ${publicAddress})` : ""}`
  : "Remote access is off: only this PC can connect (turn it on in the admin panel to play with friends)");

// Every write is a temp file plus rename, so a hard kill is safe too; this just closes sockets politely.
function shutdown(signal) {
  log("Core", `${signal} received, shutting down`);
  qosPing?.close();
  server.vivox?.close();
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 2000).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(signal, () => shutdown(signal));
