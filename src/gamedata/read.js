import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "gamedata");

export function readGameData(name, fallback) {
  const file = path.join(dir, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

// Game data keys keep the pak's casing; the client compares ids case-insensitively.
export function caseInsensitive(record) {
  return new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), { id: key, ...value }]));
}
