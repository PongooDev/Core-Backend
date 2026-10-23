import fs from "node:fs";
import { parseArgs } from "node:util";
import { validateNetwork } from "./network.js";

const defaults = {
  port: 5595,
  dataDir: "data"
};

// Precedence: command line, then the config file, then the defaults. A launcher can pass everything on the command line.
// The network settings (remoteAccess, listenAddress, publicAddress) can also be changed in the admin panel, which saves
// them in the data folder: network.js. fromCommandLine lists the ones given here, which the panel can't change.
export function loadConfig(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      data: { type: "string" },
      config: { type: "string", default: "config.json" },
      "remote-access": { type: "boolean" },
      "local-only": { type: "boolean" },
      listen: { type: "string" },
      "public-address": { type: "string" }
    }
  });

  const config = { ...defaults };
  if (fs.existsSync(values.config)) Object.assign(config, JSON.parse(fs.readFileSync(values.config, "utf8")));
  else if (values.config !== "config.json") throw new Error(`Config file ${values.config} not found`);
  validateNetwork(config, values.config);

  if (values.port !== undefined) config.port = Number(values.port);
  if (values.data !== undefined) config.dataDir = values.data;
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error(`Invalid port ${config.port}`);

  const fromCommandLine = [];
  if (values["remote-access"] && values["local-only"]) throw new Error("--remote-access and --local-only can't both be given");
  if (values["remote-access"] || values["local-only"]) {
    config.remoteAccess = Boolean(values["remote-access"]);
    fromCommandLine.push("remoteAccess");
  }
  if (values.listen !== undefined) {
    config.listenAddress = values.listen;
    fromCommandLine.push("listenAddress");
  }
  if (values["public-address"] !== undefined) {
    config.publicAddress = values["public-address"];
    fromCommandLine.push("publicAddress");
  }
  validateNetwork(config, "command line");
  if (fromCommandLine.length > 0) config.fromCommandLine = fromCommandLine;
  return config;
}
