import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { buildVersions, versionOf } from "../../builds/detect.js";
import { inBuild, onTheServer } from "../../builds/context.js";
import { log } from "../../log.js";
import { creativeEntitled, playerPlotType, playerPlotTypes, plotItem, plotsOf, settleCreativePlots } from "../../profiles/creative.js";
import { creativeProfileBuild } from "../../profiles/ids.js";
import { openSession } from "../../profiles/session.js";
import { maxTagline, maxTitle } from "../links/islands.js";
import { creativeChangelist, islandFileOf, islandFolder, islandInfoFile, islandPreviousFile, lockIdleMs, maxIslandBytes, readIslandInfo,
  saveIslandInfo, storeIsland } from "./dss.js";

// 🟡 Core's own: a player's Creative island as one portable file, to take it from one Core backend to another
// (Core-Launcher #21). Islands on the same backend are shared with island codes (services/links/islands.js); a file moves
// one to another server, where it becomes a new island of the importing account.
//
// An island is two things here: its CreativePlot item in the owner's creative profile (profiles/creative.js: the plot's
// template, islandIndex, islandName) and its save on the DSS (services/dss/dss.js: islands/personal/<owner>/<plot>.island,
// the level record the island's server uploads, with its X-Epic-Meta). The island's game settings travel inside the save:
// they are the island's AFortMinigameSettingsBuilding (an ABuildingSMActor, 7.00 to 7.40 SDKs), one of the actors its
// ULevelSaveRecord holds. The file (".coreisland", JSON):
//   {
//     "format": "core-island", "formatVersion": 1, "exportedAt": "<ISO date>",
//     "build": { "changelist": "4727874", "version": "7.20", "from": "save" | "account" | "type" },
//     "island": { "type": "CreativePlot:temperate_medium", "name": "", "title": "", "description": "", "meta": {...} },
//     "save": { "compression": "gzip" | "none", "size": <bytes>, "sha256": "<hex>", "data": "<base64>" }
//   }
// build is the game that wrote the save: the uploading server's changelist, which the DSS keeps from this change on
// ("save"); for a save older than that, the owner's last game build when the island's type has it ("account"), else the
// type's first build ("type"). title and description are the island's published title and tagline, or those it was
// imported with. meta is the save's DSS meta (only the keys below). Nothing names the owner or the plot: an import makes
// a new island of the importing account, so a file can never write over anyone's island.
//
// The build range: a save loads on its own build or a newer one. ULevelSaveRecord's data carries a SaveVersion (+0x30, an
// int16, in the 7.00 to 7.40 SDKs) and the record class grows from build to build (0x148 bytes on 7.00, 0x400 on 7.40), and
// Epic's islands were kept from update to update, so a newer build reads an older island; an older build isn't known to
// read a newer one, so an import is refused where the importing player's build is older than the island's.
export const islandFileFormat = "core-island";
export const islandFileVersion = 1;
export const islandFileExtension = ".coreisland";
const maxCompressedBytes = maxIslandBytes + 64 * 1024;
// The largest file an import reads: the save's base64 and the rest of the JSON.
export const maxIslandFileBytes = Math.ceil(maxCompressedBytes / 3) * 4 + 64 * 1024;
// The DSS meta a save keeps and a file carries (dss.js: the save's serialized-at and actor counts, a reset's last-reset
// and prev-reset). A checkpoint's own meta isn't the island's.
const metaKeys = ["serialized-at", "num-actors-base", "num-actors-new", "num-actors-delete", "last-reset", "prev-reset"];
const maxIslandName = 64;
const newestBuild = () => Object.keys(buildVersions).map(Number).filter((cl) => cl >= creativeProfileBuild).reduce((a, b) => Math.max(a, b), creativeProfileBuild);

export class IslandTransferError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.errorCode = `errors.com.epicgames.creative.${code}`;
  }
}
const refuse = (status, code, message) => new IslandTransferError(status, code, message);

const clean = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
// "7.20 (CL-4727874)", or "CL-4727874" for a changelist this backend doesn't know.
export const buildLabel = (changelist) => (versionOf(String(changelist)) ? `${versionOf(String(changelist))} (CL-${changelist})` : `CL-${changelist}`);
const typeName = (type, index) => `${type?.name ?? "Island"}${index ? ` ${index}` : ""}`;

const hasFile = (file) => fs.existsSync(file);

// What an island of the account is now: its save, whether a server holds it, its published link, whether it can take an
// import (free: it holds no island, never saved or reset by the admin, and no server is using it).
function islandState({ dataDir, islandLinks }, accountId, plotItemId, item) {
  const island = { owner: accountId, plotItemId };
  const info = readIslandInfo(dataDir, island);
  const saved = hasFile(islandFileOf(dataDir, island));
  const inUse = Boolean(info.lock?.pid) && Date.now() - Number(info.lock.at ?? 0) < lockIdleMs;
  const link = islandLinks?.ofIsland?.(accountId, plotItemId) ?? null;
  return { island, info, saved, inUse, link, free: !saved && !inUse, item };
}

// A free slot's history goes to the island imported into it, so nothing of it is left without a plot: its in-game backup
// (the checkpoint, which the island menu's Restore brings back), the admin's backups (admin/creative.js:
// <plot>.backups/<id>.island) and the version before its last save ("previous", whose meta and build the new record
// keeps: keptHistory). Its own record (an old checkout, nothing saved) goes.
const keptHistory = (dataDir, from, info) => (hasFile(islandPreviousFile(dataDir, from))
  ? { previousMeta: info.previousMeta ?? {}, previousBuild: info.previousBuild ?? null } : {});
function moveSlotHistory(dataDir, from, to) {
  const checkpoint = (island) => islandFileOf(dataDir, { ...island, checkpoint: true });
  const moves = [
    [checkpoint(from), checkpoint(to)],
    [`${checkpoint(from)}.json`, `${checkpoint(to)}.json`],
    [path.join(islandFolder(dataDir, from.owner), `${from.plotItemId}.backups`), path.join(islandFolder(dataDir, to.owner), `${to.plotItemId}.backups`)],
    [islandPreviousFile(dataDir, from), islandPreviousFile(dataDir, to)]
  ];
  for (const [source, target] of moves) if (hasFile(source)) fs.renameSync(source, target);
  fs.rmSync(islandInfoFile(dataDir, from), { force: true });
}

// The account's islands for the launcher: each plot with its save, and per island type how many it has and can take.
// `build` (a changelist) is the player's game: the types it has and which islands it can load.
export function listIslands(context, account, build = null) {
  const target = creativeChangelist(build);
  // Read as the player's build would (a profile's load fills in that build's defaults), without being their game.
  return onTheServer(() => inBuild(target ?? String(newestBuild()), () => islandsView(context, account, target)));
}

function islandsView(context, account, target) {
  const { profiles } = context;
  const profile = profiles.exists(account.id, "creative") ? profiles.load(account.id, "creative") : null;
  const plots = profile ? plotsOf(profile) : [];
  const islands = plots.map(([plotItemId, item]) => {
    const state = islandState(context, account.id, plotItemId, item);
    const type = playerPlotType(item.templateId);
    const source = state.saved ? sourceBuildOf(state.info, account, type) : null;
    return {
      plotItemId, templateId: item.templateId, islandIndex: item.attributes?.islandIndex ?? null,
      name: typeName(type, item.attributes?.islandIndex), islandName: item.attributes?.islandName ?? "",
      title: state.link?.title ?? state.info.imported?.title ?? "", published: state.link ? state.link.mnemonic : null,
      saved: state.saved, size: state.saved ? state.info.size ?? fs.statSync(islandFileOf(context.dataDir, state.island)).size : 0,
      updated: state.saved ? state.info.updated ?? null : null, inUse: state.inUse, free: state.free,
      build: source ? { changelist: source.changelist, version: versionOf(source.changelist), from: source.from } : null,
      imported: state.info.imported ? { at: state.info.imported.at ?? null } : null,
      loadsOnBuild: target && source ? Number(source.changelist) <= Number(target) : null
    };
  }).sort((a, b) => playerPlotTypes.indexOf(playerPlotType(a.templateId)) - playerPlotTypes.indexOf(playerPlotType(b.templateId)) || (a.islandIndex ?? 0) - (b.islandIndex ?? 0));
  const entitled = creativeEntitled(openSession(profiles, account.id, { setUp: false }));
  const slots = playerPlotTypes.filter((type) => !target || Number(target) >= type.firstBuild).map((type) => {
    const ofType = islands.filter((island) => island.templateId.toLowerCase() === type.templateId.toLowerCase());
    const missing = entitled ? Math.max(0, type.count - ofType.length) : 0;
    return { templateId: type.templateId, name: type.name, limit: type.count, islands: ofType.length, free: ofType.filter((island) => island.free).length + missing,
      firstBuild: String(type.firstBuild), firstVersion: versionOf(String(type.firstBuild)) };
  });
  return { accountId: account.id, displayName: account.displayName, build: target, buildVersion: target ? versionOf(target) : null,
    maxFileBytes: maxIslandFileBytes, islands, slots };
}

// The build that wrote a save (see the format above).
function sourceBuildOf(info, account, type) {
  const recorded = creativeChangelist(info.build);
  if (recorded) return { changelist: recorded, from: "save" };
  const first = type?.firstBuild ?? creativeProfileBuild;
  const last = creativeChangelist(account?.lastBuild);
  if (last && Number(last) >= first) return { changelist: last, from: "account" };
  return { changelist: String(first), from: "type" };
}

// An island of the account as a file: {fileName, contents (a Buffer of the JSON)}.
export function exportIsland(context, account, plotItemId) {
  const { profiles, dataDir } = context;
  const profile = profiles.exists(account.id, "creative") ? profiles.load(account.id, "creative") : null;
  const item = profile ? plotItem(profile, plotItemId) : null;
  if (!item) throw refuse(404, "island_not_found", `${clean(String(plotItemId ?? ""), 64)} isn't one of ${account.displayName}'s islands`);
  const type = playerPlotType(item.templateId);
  if (!type) throw refuse(400, "island_type_unsupported", `${item.templateId} islands can't be exported`);
  const state = islandState(context, account.id, plotItemId, item);
  const name = typeName(type, item.attributes?.islandIndex);
  if (!state.saved) throw refuse(404, "island_not_saved", `${name} has never been saved: build on it in game first, then export it`);
  const save = fs.readFileSync(islandFileOf(dataDir, state.island));
  const source = sourceBuildOf(state.info, account, type);
  const compressed = zlib.gzipSync(save, { level: 9 });
  const document = {
    format: islandFileFormat,
    formatVersion: islandFileVersion,
    exportedAt: new Date().toISOString(),
    build: { changelist: source.changelist, version: versionOf(source.changelist), from: source.from },
    island: {
      type: type.templateId,
      name: clean(item.attributes?.islandName, maxIslandName),
      title: clean(state.link?.title ?? state.info.imported?.title, maxTitle),
      description: clean(state.link?.tagline ?? state.info.imported?.description, maxTagline),
      meta: knownMeta(state.info.meta)
    },
    save: { compression: "gzip", size: save.length, sha256: crypto.createHash("sha256").update(save).digest("hex"), data: compressed.toString("base64") }
  };
  const title = document.island.title.replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-");
  const fileName = `${name.replace(/\s+/g, "-")}${title ? `-${title}` : ""}${islandFileExtension}`;
  log("Creative", `${account.displayName}'s ${name} (${plotItemId}) exported (${save.length} bytes, ${buildLabel(source.changelist)} from its ${source.from})`);
  return { fileName, contents: Buffer.from(JSON.stringify(document)) };
}

const knownMeta = (meta) => {
  const kept = {};
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return kept;
  for (const key of metaKeys) {
    if (typeof meta[key] === "string" || typeof meta[key] === "number") kept[key] = String(meta[key]).slice(0, 256);
  }
  return kept;
};

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
const invalidFile = (why) => refuse(400, "island_file_invalid", `That isn't a Core island file (${why})`);

// The file's bytes as {build, type, name, title, description, meta, save}, or throws IslandTransferError. Only the fields
// above are read; anything else in the file is ignored.
export function readIslandFile(contents) {
  if (!Buffer.isBuffer(contents) || !contents.length) throw invalidFile("the file is empty");
  if (contents.length > maxIslandFileBytes) {
    throw refuse(413, "island_file_too_large", `An island file can't be more than ${Math.floor(maxIslandFileBytes / 1048576)} MB`);
  }
  let document;
  try {
    document = JSON.parse(contents.toString("utf8").replace(/^﻿/, ""));
  } catch {
    throw invalidFile("it isn't JSON");
  }
  if (!isObject(document) || document.format !== islandFileFormat) throw invalidFile(`its format isn't ${islandFileFormat}`);
  if (!Number.isInteger(document.formatVersion) || document.formatVersion < 1) throw invalidFile("its formatVersion is missing");
  if (document.formatVersion > islandFileVersion) {
    throw refuse(400, "island_format_unsupported", `This island file was made by a newer Core-Backend (format ${document.formatVersion}); this backend reads format ${islandFileVersion}. Update Core-Backend, then import it again`);
  }
  const { build, island, save } = document;
  if (!isObject(build) || !isObject(island) || !isObject(save)) throw invalidFile("its build, island or save is missing");
  const changelist = /^\d{7,9}$/.test(String(build.changelist ?? "")) ? String(build.changelist) : null;
  if (!changelist) throw invalidFile("its build changelist is missing");
  if (Number(changelist) < creativeProfileBuild) throw invalidFile(`${buildLabel(changelist)} is older than Creative (7.00)`);
  const type = playerPlotType(island.type);
  if (!type) throw refuse(400, "island_type_unsupported", `${clean(String(island.type ?? "(none)"), 80)} isn't a player island type Core knows`);
  if (save.compression !== "gzip" && save.compression !== "none") throw invalidFile("its save's compression isn't gzip or none");
  if (!Number.isInteger(save.size) || save.size < 1 || save.size > maxIslandBytes) {
    throw save.size > maxIslandBytes ? refuse(413, "island_file_too_large", `An island's save can't be more than ${maxIslandBytes / 1048576} MB`) : invalidFile("its save's size is missing");
  }
  if (typeof save.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(save.sha256)) throw invalidFile("its save's sha256 is missing");
  if (typeof save.data !== "string" || !save.data.length || save.data.length % 4 !== 0 || !base64Pattern.test(save.data)) throw invalidFile("its save's data isn't base64");
  const packed = Buffer.from(save.data, "base64");
  if (packed.length > maxCompressedBytes) throw refuse(413, "island_file_too_large", `An island's save can't be more than ${maxIslandBytes / 1048576} MB`);
  let data;
  try {
    data = save.compression === "gzip" ? zlib.gunzipSync(packed, { maxOutputLength: maxIslandBytes }) : packed;
  } catch {
    throw invalidFile("its save doesn't unpack, or is larger than an island can be");
  }
  if (data.length !== save.size || crypto.createHash("sha256").update(data).digest("hex") !== save.sha256.toLowerCase()) {
    throw invalidFile("its save is damaged: the size or sha256 doesn't match");
  }
  // The type's first build is the oldest a save of it can come from.
  const effective = String(Math.max(Number(changelist), type.firstBuild));
  return { build: effective, type, name: clean(island.name, maxIslandName), title: clean(island.title, maxTitle),
    description: clean(island.description, maxTagline), meta: knownMeta(island.meta), save: data };
}

// Imports a file into the account: a new island (a new plot id) in the lowest free slot of the file's island type, within
// the type's limit. `build` is the importing player's game (a changelist): the island must load on it. Returns
// {plotItemId, templateId, islandIndex, name, build}; `notify(session)` gets the changed profiles for the player's game.
export function importIsland(context, account, contents, { build = null, notify = () => {} } = {}) {
  const { profiles, dataDir } = context;
  const file = readIslandFile(contents);
  const requested = build === null || build === undefined || build === "" ? null : String(build);
  if (requested !== null && !/^\d{7,9}$/.test(requested)) throw refuse(400, "build_invalid", `${clean(requested, 20)} isn't a changelist`);
  if (requested !== null && Number(requested) < creativeProfileBuild) {
    throw refuse(400, "creative_unavailable", `Creative islands need Fortnite 7.00 or later; your build is ${buildLabel(requested)}`);
  }
  const target = requested ?? String(newestBuild());
  const fileLabel = buildLabel(file.build);
  if (Number(target) < file.type.firstBuild) {
    throw refuse(400, "island_type_unavailable", `This island is a ${file.type.name}, which Creative has from ${buildLabel(file.type.firstBuild)} on; your build is ${buildLabel(target)}`);
  }
  if (Number(file.build) > Number(target)) {
    throw refuse(409, "island_newer_build", requested
      ? `This island is from a newer build (${fileLabel}) than yours (${buildLabel(target)}). An island loads on the build it was saved on or a newer one`
      : `This island is from a newer build (${fileLabel}) than this backend knows (up to ${buildLabel(target)}). Update Core-Backend, then import it again`);
  }
  // On the importing player's build, as their game's first look at the creative profile would: an entitled account gets
  // the islands it is due (profiles/creative.js), then the import takes the lowest free one of its type.
  return onTheServer(() => inBuild(target, () => {
    const session = openSession(profiles, account.id);
    settleCreativePlots(session);
    const tracker = session.profile("creative");
    const plots = plotsOf(tracker.profile).filter(([, item]) => playerPlotType(item.templateId) === file.type);
    if (!plots.length) {
      throw refuse(409, "no_islands", `${account.displayName} has no ${file.type.name} slots yet: an account gets its islands on 7.00 and later once it may play Creative. Open Creative in game once, then import again`);
    }
    const free = plots.map(([plotItemId, item]) => islandState(context, account.id, plotItemId, item)).filter((state) => state.free)
      .sort((a, b) => Number(a.item.attributes?.islandIndex ?? 0) - Number(b.item.attributes?.islandIndex ?? 0));
    if (!free.length) {
      throw refuse(409, "no_free_island_slot", `No free ${file.type.name} slots: all ${plots.length} of ${account.displayName}'s ${file.type.name} slots hold an island (the limit is ${file.type.count}). Ask the server's admin to reset one (admin panel, Players, Creative: Reset island keeps a backup of it), then import again`);
    }
    const slot = free[0];
    const islandIndex = slot.item.attributes?.islandIndex ?? null;
    const plotItemId = crypto.randomUUID();
    const island = { owner: account.id, plotItemId };
    // The save first, under the new id (the plot's id names its DSS file); a profile that failed to save after it leaves
    // only a file no plot names, which the DSS never serves.
    const info = keptHistory(dataDir, slot.island, slot.info);
    storeIsland(dataDir, island, info, file.save, file.meta, file.build);
    info.imported = { at: new Date().toISOString(), title: file.title, description: file.description };
    saveIslandInfo(dataDir, island, info);
    tracker.removeItem(slot.island.plotItemId);
    tracker.addItem(plotItemId, { templateId: slot.item.templateId, attributes: { islandIndex, islandName: file.name, item_seen: false }, quantity: 1 });
    if (tracker.profile.stats.attributes.last_used_plot === slot.island.plotItemId) tracker.setStat("last_used_plot", plotItemId);
    session.commit();
    moveSlotHistory(dataDir, slot.island, island);
    notify(session);
    const name = typeName(file.type, islandIndex);
    log("Creative", `${account.displayName} imported an island into ${name} (${plotItemId}, was ${slot.island.plotItemId}): ${file.save.length} bytes from ${fileLabel}${file.title ? `, "${file.title}"` : ""}`);
    return { plotItemId, templateId: slot.item.templateId, islandIndex, name, title: file.title, build: { changelist: file.build, version: versionOf(file.build) } };
  }));
}
