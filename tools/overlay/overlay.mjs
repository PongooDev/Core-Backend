// Maintainer tool: writes a build's game data overlay, gamedata/<changelist>/, the files where that build's data differs
// from Cert's, each as the merge patch that turns Cert's file into the build's (src/gamedata/patch.js). Both builds are
// extracted with the same extractor first, so only the builds' own differences end up in the overlay:
//
//   dotnet run -c Release --project tools/extractor -- "<Cert build folder>" <aes key> <cert output folder>
//   dotnet run -c Release --project tools/extractor -- "<other build folder>" <aes key> <other output folder>
//   node tools/overlay/overlay.mjs <cert output folder> <other output folder> <changelist>
//
// theaters.json isn't extracted (tools/theaters) and is the same for every build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch, createPatch, sameValue } from "../../src/gamedata/patch.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [certDir, buildDir, changelist] = process.argv.slice(2);
if (!certDir || !buildDir || !/^\d+$/.test(changelist ?? "")) {
  console.error("usage: node tools/overlay/overlay.mjs <cert extraction folder> <build extraction folder> <changelist>");
  process.exit(1);
}

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const out = path.join(root, "gamedata", changelist);
const written = [];
for (const name of fs.readdirSync(buildDir).filter((file) => file.endsWith(".json")).sort()) {
  const certFile = path.join(certDir, name);
  if (!fs.existsSync(certFile)) throw new Error(`${name} is missing from ${certDir}`);
  const cert = read(certFile);
  const build = read(path.join(buildDir, name));
  const committed = path.join(root, "gamedata", name);
  if (fs.existsSync(committed) && !sameValue(read(committed), cert)) {
    console.warn(`gamedata/${name} isn't what the extractor makes from Cert now; the overlay is made against the fresh extraction`);
  }
  const patch = createPatch(cert, build);
  if (patch === undefined) continue;
  if (!sameValue(applyPatch(cert, patch), build)) throw new Error(`${name}: the difference can't be written as a merge patch (null values?)`);
  written.push(name);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, name), JSON.stringify(patch, null, 2) + "\n");
}
// Files that no longer differ.
for (const name of fs.existsSync(out) ? fs.readdirSync(out) : []) {
  if (!written.includes(name)) fs.rmSync(path.join(out, name));
}
if (fs.existsSync(out) && !fs.readdirSync(out).length) fs.rmdirSync(out);
console.log(written.length ? `gamedata/${changelist}: ${written.join(", ")}` : `${changelist} has Cert's data; no overlay`);
