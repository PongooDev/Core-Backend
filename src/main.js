import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { log } from "./log.js";

const config = loadConfig();

createApp(config).listen(config.port, (error) => {
  if (error) {
    log("Core", error.code === "EADDRINUSE" ? `Port ${config.port} is already in use` : error.message);
    process.exit(1);
  }
  log("Core", `Listening on port ${config.port}`);
});
