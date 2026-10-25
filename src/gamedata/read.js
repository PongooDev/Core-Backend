import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentBuild } from "../builds/context.js";
import { certBuild } from "../builds/detect.js";
import { applyPatch } from "./patch.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "gamedata");

// Game data is Cert's (gamedata/<name>.json, extracted from CL-3532353). A build whose data differs has its own folder,
// gamedata/<changelist>/, holding only the files that differ, each as the merge patch that turns Cert's file into
// that build's (src/gamedata/patch.js, made by tools/overlay). Any other build gets Cert's data.
export const dataBuilds = [certBuild, ...(fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
  .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name) && entry.name !== certBuild).map((entry) => entry.name)];

export const dataBuild = (changelist) => (dataBuilds.includes(changelist) ? changelist : certBuild);

// The data build of the request being served (Cert outside a request).
export const activeBuild = () => dataBuild(currentBuild());

function readFile(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

// Names read as Cert's data whatever the build (tests check no build has an overlay for one of them).
export const certOnlyReads = new Set();

// Cert's data, for what is the same in every build.
export function readGameData(name, fallback) {
  certOnlyReads.add(name);
  return readFile(path.join(dir, `${name}.json`), fallback);
}

export function overlay(build, name) {
  return build === certBuild ? undefined : readFile(path.join(dir, build, `${name}.json`), undefined);
}

// A build's data: Cert's with the build's overlay applied, freshly read like readGameData.
export function buildGameData(build, name, fallback) {
  const base = readFile(path.join(dir, `${name}.json`), fallback);
  const patch = overlay(build, name);
  return patch === undefined ? base : applyPatch(base, patch);
}

// What a module makes from game data, made once for each build on first use there: make(read) gets read(name, fallback)
// for the requesting build's data. Anything that can differ between builds goes through this (or the gamedata/*.js
// lookups built on it), never through module-level constants.
export function perBuild(make) {
  const made = new Map();
  return () => {
    const build = activeBuild();
    if (!made.has(build)) made.set(build, make((name, fallback) => buildGameData(build, name, fallback)));
    return made.get(build);
  };
}

// Game data keys keep the pak's casing; the client compares ids case-insensitively.
export function caseInsensitive(record) {
  return new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), { id: key, ...value }]));
}
