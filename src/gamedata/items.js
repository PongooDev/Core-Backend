import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "gamedata", "items.json");
const items = new Map(
  Object.entries(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {})
    .map(([templateId, item]) => [templateId.toLowerCase(), item])
);

export function getItem(templateId) {
  return items.get(templateId.toLowerCase());
}
