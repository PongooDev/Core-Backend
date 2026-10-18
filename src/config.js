import fs from "node:fs";
import { parseArgs } from "node:util";

const defaults = {
  port: 5595,
  dataDir: "data"
};

// Precedence: command line, then the config file, then the defaults. A launcher can pass everything on the command line.
export function loadConfig(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      data: { type: "string" },
      config: { type: "string", default: "config.json" }
    }
  });

  const config = { ...defaults };
  if (fs.existsSync(values.config)) Object.assign(config, JSON.parse(fs.readFileSync(values.config, "utf8")));
  else if (values.config !== "config.json") throw new Error(`Config file ${values.config} not found`);

  if (values.port !== undefined) config.port = Number(values.port);
  if (values.data !== undefined) config.dataDir = values.data;
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error(`Invalid port ${config.port}`);
  return config;
}
