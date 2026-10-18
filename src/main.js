import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { createServer } from "./server.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  log("Core", error.message);
  process.exit(2);
}

const server = await createServer(config);

server.on("error", (error) => {
  log("Core", error.code === "EADDRINUSE" ? `Port ${config.port} is already in use` : error.message);
  process.exit(1);
});

server.listen(config.port, () => {
  const { port } = server.address();
  log("Core", `Listening on port ${port}`);
  log("Core", `Admin panel: http://127.0.0.1:${port}/admin`);
});

// Every write is a temp file plus rename, so a hard kill is safe too; this just closes sockets politely.
function shutdown(signal) {
  log("Core", `${signal} received, shutting down`);
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 2000).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(signal, () => shutdown(signal));
