import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentBuild } from "../builds/context.js";
import { certBuild } from "../builds/detect.js";
import { applyPatch } from "./patch.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "gamedata");

// Game data is Cert's (gamedata/<name>.json, extracted from CL-3532353). A build whose data differs has its own folder,
// gamedata/<changelist>/, holding only the files that differ, each as the merge patch that turns Cert's file into
// that build's (src/gamedata/patch.js, made by tools/overlay). A build without a folder gets the data of the closest
// build before it that has one (a later build gets the newest earlier one's: game data only moves forward);
// a request without a changelist, or one older than Cert, gets Cert's.
export const dataBuilds = [certBuild, ...(fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
  .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name) && entry.name !== certBuild).map((entry) => entry.name)];

// Builds that play on a later build's data: 4.4.0 (CL-4117433) and 4.4.1 (CL-4127312), whose paks Core has no copy of,
// on 4.4.2's (CL-4132537, gamedata/4132537), the same season and the same week's hotfix line. Without this they would get
// 4.2's, the closest earlier build with data of its own. 4.5's CL-4159770 (4.5.0), whose paks Core has no copy of either,
// plays on CL-4166199's (gamedata/4166199), the later build of the same update; it would otherwise get 4.4.2's. 5.0's
// CL-4204761 (5.0.0, the launch build), whose paks Core has no copy of either, plays on CL-4214610's (gamedata/4214610),
// Season 5's; it would otherwise get 4.5's, a Season 4 build. 5.10's CL-4225813 (5.10.0, Update v5.10's build), whose paks
// Core has no copy of either, plays on CL-4240749's (gamedata/4240749, the later build of the same update, Content Update
// v5.10's); it would otherwise get 5.0's, without 5.10's cosmetics and Birthday challenges. 6.00's CL-4395664 (6.00.0, the
// earlier of Update v6.00's two builds), whose paks Core has no copy of either, plays on CL-4402180's (gamedata/4402180,
// Season 6's); it would otherwise get 5.41's, a Season 5 build. 6.01's CL-4417689 (6.01.0, the earlier of Update v6.01's two
// builds), whose paks Core has no copy of either, plays on CL-4424678's (gamedata/4424678); it would otherwise get 6.00's,
// without the Chiller, 6.01's cosmetics and the later stages of Season 6's staged challenges. 6.02's CL-4442095 (6.02.0, the
// earlier of Update v6.02's two builds), whose paks Core has no copy of either, plays on CL-4461277's (gamedata/4461277); it
// would otherwise get 6.01's, without the Quad Launcher, 6.02's cosmetics and the Skull Trooper Challenges. 6.10's CL-4464155
// (6.10.0) and CL-4476098 (6.10.1), the two earlier of Update v6.10's three builds, whose paks Core has no copy of either,
// play on CL-4480234's (gamedata/4480234); they would otherwise get 6.02's, without 6.10's cosmetics, weeks 4 to 7 of Season
// 6's challenges as Epic ran them and the Showdown (tournament) playlists' data.
export const laterData = { 4117433: "4132537", 4127312: "4132537", 4159770: "4166199", 4204761: "4214610", 4225813: "4240749",
  4395664: "4402180", 4417689: "4424678", 4442095: "4461277", 4464155: "4480234", 4476098: "4480234" };

export function dataBuild(changelist) {
  if (dataBuilds.includes(changelist)) return changelist;
  if (laterData[changelist] && dataBuilds.includes(laterData[changelist])) return laterData[changelist];
  const number = Number(changelist);
  const earlier = Number.isInteger(number) ? dataBuilds.filter((build) => Number(build) <= number) : [];
  return earlier.length ? earlier.reduce((closest, build) => (Number(build) > Number(closest) ? build : closest)) : certBuild;
}

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
