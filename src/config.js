import fs from "node:fs";

const defaults = {
  port: 5595,
  dataDir: "data"
};

export function loadConfig(file = "config.json") {
  if (!fs.existsSync(file)) return { ...defaults };
  return { ...defaults, ...JSON.parse(fs.readFileSync(file, "utf8")) };
}
