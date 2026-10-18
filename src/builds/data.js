import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const buildsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "builds");
const cache = new Map();

export function getBuildData(build) {
  if (!cache.has(build)) {
    const file = path.join(buildsDir, build, "build.json");
    cache.set(build, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
  }
  return cache.get(build);
}

function matches(pattern, value) {
  const [prefix, suffix] = pattern.split("*");
  if (suffix === undefined) return pattern === value;
  return value.length > prefix.length + suffix.length - 1 &&
    value.startsWith(prefix) &&
    value.endsWith(suffix) &&
    /^[a-z0-9_]+$/.test(value.slice(prefix.length, value.length - suffix.length));
}

export function buildHasProfile(build, profileId) {
  const data = getBuildData(build);
  return data ? data.profiles.some((pattern) => matches(pattern, profileId)) : true;
}
