import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { createServer } from "./server.js";

const config = loadConfig();
const server = await createServer(config);

server.on("error", (error) => {
  log("Core", error.code === "EADDRINUSE" ? `Port ${config.port} is already in use` : error.message);
  process.exit(1);
});

server.listen(config.port, () => log("Core", `Listening on port ${config.port}`));
