import fs from "node:fs";
import path from "node:path";

const isPretty = process.env.NODE_ENV === "development" || process.env.CORE_PRETTY_JSON === "true";

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, isPretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
  fs.renameSync(temp, file);
}
