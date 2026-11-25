import fs from "node:fs";
import path from "node:path";
import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { currentBuild } from "../../builds/context.js";
import { versionOf } from "../../builds/detect.js";
import { sendError } from "../../errors.js";
import { log } from "../../log.js";
import { sessionMembers } from "../../matchmaking/sessions.js";
import { plotItem } from "../../profiles/creative.js";
import { creativeProfileBuild } from "../../profiles/ids.js";

// The DSS (data storage service) a 7.00 (CL-4629139) Creative server keeps its players' islands in (PongooDev/CoreV2#471).
//
// The client of it is USidecarSys (module SidecarSys, its constructor 0x2DF2D30), whose URL templates are
// /api/dss/v1/`app_name/`file_path (download), .../checkout?pid=`pid&dl=`dl, ...?autolock=`autolock (upload),
// .../restore?from=`from and .../checkin, each sent to the base URL of the "MCP" online subsystem's sidecar service
// (FOnlineSidecarServiceMcp at OSS +0x378: SendRequest 0x2DF5910 -> 0x2DF5730 -> 0x60C970; 7.00's DefaultEngine.ini has
// [OnlineSubsystemMcp.OnlineSidecarServiceMcp] Protocol "http", Domain "127.0.0.1:8000", no ServiceName: on Epic's
// servers a local sidecar process stood in front of the DSS). It sends through the MCP request queue for client
// "DedicatedServer" (0xA9A50; 0x6220D0 "Queuing Mcp request for client=%s url=%s"), so with the DedicatedServer client's
// token, and fails locally ("Unable to find service permissions for server.") where the server has no such permissions.
// Core has no sidecar: this backend answers the routes at its root (services/fortnite/cloudstorage.js gives the sidecar
// service an Epic host, mcpsidecar-public-service-prod.ol.epicgames.com, which CoreRedirect sends here; PongooDev/CoreV2#485).
//
// What the game sends (7.00's exe; the server's island save, UFortLevelSaveComponent 0xF5ADB0, with app_name "creative",
// 0xDF960, and file_path islands/personal/<owner account>/<plot item id>.island, 0xF476E0 and 0xF475F0):
// - upload (0x2DF4530): PUT, content-type application/octet-stream, the level record as the body, and one
//   X-Epic-Meta-<key> header for each of the file's meta (FSidecarFileInfo.Meta: serialized-at, num-actors-base,
//   num-actors-new, num-actors-delete; a reset's last-reset and prev-reset, 0xF5AAC0). Without autolock the client itself
//   refuses a file it hasn't checked out ("DssUpload failed: file %s/%s is not checked out (and no autolock requested)"),
//   with it one it has. Success clears the file's pending flag; nothing of the answer is read.
// - checkin (0x2DF3B40): POST .../checkin, the record as an application/octet-stream body when there is one, nothing
//   else; the client refuses a file it hasn't checked out. Success sets the file not checked out and empties its meta.
// - checkout, download and restore: their callers were the server's island load, stripped from the client (its strings,
//   "Loading cloud save %s for user %s.", "Unable to get sidecar when loading cloud save %s for user %s", "Successfully
//   downloaded %s - %s.", "No cloud save found. Loading default record for user %s cloudsave=%s - %s.", have no
//   reference left), so their answers are Core's: a checkout (the island's lock for pid, with dl=true the file in the
//   answer, its meta as X-Epic-Meta-* headers; 204 when there is no file yet or dl=false), a plain download, and a
//   restore from the version before the last write ("previous") or another of the owner's island files.
// A failure is Epic's error JSON, which the OSS turns into the request's error ("DssUpload failed: %s").
//
// Only the creative app and an island of the owner's (a CreativePlot item of their creative profile) are served, only to
// the DedicatedServer client, the owner's own account, or an account hosting a session the owner plays on (as user cloud
// storage, services/fortnite/cloudstorage.js), at most 16 MiB a file, kept on disk per account and island
// (<data>/accounts/<owner>/creative/islands/<plot>.island, its meta and lock in <plot>.island.json, the version before
// the last write in <plot>.island.prev).
//
// The checkout: a checkout's pid (Core's gameserver sends one per server process, the contract of #471) holds the island
// until checkin, and the game uploads only an island it has checked out. A player is on one server at a time, so a later
// checkout takes the island over (a crashed server, or one whose player left without a checkin, never keeps it from its
// owner); an upload without a checkout (autolock) waits until a checkout has gone unused for 15 minutes, or its pid's game
// session has ended past that.
export const dssApp = "creative";
export const maxIslandBytes = 16 * 1024 * 1024;
export const lockIdleMs = 15 * 60 * 1000;
const maxServerMs = 4 * 60 * 60 * 1000 + lockIdleMs;
const islandPath = /^islands\/personal\/([0-9a-f]{32})\/([A-Za-z0-9-]{1,64})(\.checkpoint)?\.island$/i;
// A published island's version (PongooDev/CoreV2#488): islands/public/<owner>/<code>/<version>.island, the game's own
// format ("islands/public/%s/%s/%s.island", 7.10 CL-4667333 0x3D02448), read by a server loading the code's island.
const publicIslandPathPattern = /^islands\/public\/([0-9a-f]{32})\/(\d{4}-\d{4}-\d{4})\/(\d{1,9})\.island$/i;
const operations = new Set(["checkout", "checkin", "restore"]);
const metaPrefix = "x-epic-meta-";
const metaKey = /^[A-Za-z0-9_.-]{1,64}$/;
const maxMeta = 32;

const dssError = (res, status, code, message, vars) => sendError(res, status, `errors.com.epicgames.dss.${code}`, message, vars);

// An island file's path ("islands/personal/<owner>/<plot>.island") as {owner, plotItemId}, or null. The island's
// checkpoint, its backup (7.10's "islands/personal/%s/%s.%s" with "checkpoint.island", 0xF76CE0: the island menu's Backup
// Island and Restore, PongooDev/CoreV2#488), is {owner, plotItemId, checkpoint: true}.
export function parseIslandPath(filePath) {
  const match = islandPath.exec(String(filePath ?? ""));
  if (!match) return null;
  return { owner: match[1].toLowerCase(), plotItemId: match[2], ...(match[3] ? { checkpoint: true } : {}) };
}

// A published island's path as {owner, mnemonic, version}, or null.
export function parsePublicIslandPath(filePath) {
  const match = publicIslandPathPattern.exec(String(filePath ?? ""));
  return match ? { owner: match[1].toLowerCase(), mnemonic: match[2], version: Number(match[3]) } : null;
}

// Where an owner's island (or its checkpoint) is kept: <data>/accounts/<owner>/creative/islands/<plot>[.checkpoint].island.
export const islandFolder = (dataDir, owner) => path.join(dataDir, "accounts", owner, "creative", "islands");
export const islandFileOf = (dataDir, island) => path.join(islandFolder(dataDir, island.owner), `${island.plotItemId}${island.checkpoint ? ".checkpoint" : ""}.island`);

// The X-Epic-Meta-<key> headers of a request, {key: value} with the keys lower-cased.
export function metaOf(req) {
  const meta = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!name.startsWith(metaPrefix) || Object.keys(meta).length >= maxMeta) continue;
    const key = name.slice(metaPrefix.length);
    if (metaKey.test(key)) meta[key] = String(Array.isArray(value) ? value[0] : value).slice(0, 256);
  }
  return meta;
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}

// An island file's record beside it (<file>.json: its meta, lock, size, last write), and the version before its last write
// (<file>.prev). Shared with the admin panel's island tools (admin/creative.js).
export const islandInfoFile = (dataDir, island) => `${islandFileOf(dataDir, island)}.json`;
export const islandPreviousFile = (dataDir, island) => `${islandFileOf(dataDir, island)}.prev`;
// The island's last real save: its file, or the version before its last write when an older backend let a 0-byte
// upload replace the file (Core-Backend #395). Null when neither has bytes.
export function readIslandSave(dataDir, island) {
  for (const file of [islandFileOf(dataDir, island), islandPreviousFile(dataDir, island)]) {
    try {
      const data = fs.readFileSync(file);
      if (data.length) return data;
    } catch {
      // Try the previous version.
    }
  }
  return null;
}
export function readIslandInfo(dataDir, island) {
  try {
    return JSON.parse(fs.readFileSync(islandInfoFile(dataDir, island), "utf8"));
  } catch {
    return {};
  }
}
export const saveIslandInfo = (dataDir, island, info) => writeAtomic(islandInfoFile(dataDir, island), JSON.stringify(info));

// The changelist of a Creative build (7.00, CL-4629139, or later) as a string, or null: what an island file's record keeps
// as the build whose server wrote it.
export const creativeChangelist = (value) => (/^\d{7,9}$/.test(String(value ?? "")) && Number(value) >= creativeProfileBuild ? String(value) : null);

// A write of the file: the version it replaces kept as "previous", the meta replaced by `meta`. The caller saves `info`.
// `build` is the changelist of the game that made the data (the uploading server's, a copied file's own), kept as the
// record's build (🟡 Core's: Epic's DSS kept no build; the island transfer, services/dss/transfer.js, needs it, because
// ULevelSaveRecord's data carries a SaveVersion, +0x30 in the 7.00 to 7.40 SDKs, that only its own build or a newer
// one is known to read); null when nobody knows it.
export function storeIsland(dataDir, island, info, data, meta, build = null) {
  const file = islandFileOf(dataDir, island);
  if (fs.existsSync(file)) {
    writeAtomic(islandPreviousFile(dataDir, island), fs.readFileSync(file));
    info.previousMeta = info.meta ?? {};
    info.previousBuild = info.build ?? null;
  }
  writeAtomic(file, data);
  info.meta = meta;
  info.build = creativeChangelist(build);
  info.size = data.length;
  info.updated = new Date().toISOString();
}

// An island file's SaveVersion: the int16 after its header's record name (an FString, "None"), before the record's
// compressed blocks (tag 0x9E2A83C1, a few bytes on). 8.00 writes 5, 8.20 8, 8.50 and 8.51 10. Null when the data doesn't
// start that way.
const compressedTag = Buffer.from([0xc1, 0x83, 0x2a, 0x9e]);
export function islandSaveVersion(data) {
  if (!Buffer.isBuffer(data) || data.length < 10) return null;
  const length = data.readInt32LE(0);
  const nameBytes = length < 0 ? -length * 2 : length;
  if (length === 0 || nameBytes > 512 || data.length < 4 + nameBytes + 2) return null;
  const terminator = length < 0 ? data.readUInt16LE(4 + nameBytes - 2) : data[4 + nameBytes - 1];
  if (terminator !== 0) return null;
  const at = 4 + nameBytes;
  const tag = data.indexOf(compressedTag, at + 2);
  if (tag < 0 || tag > at + 2 + 32) return null;
  return data.readInt16LE(at);
}

// 🟡 Core's: a save from an older SaveVersion than the island's file isn't written over it. 8.50 added
// ULevelSaveRecord::VolumeInfoActorRecords (where it keeps the MinigameSettingsMachine); 8.20 to 8.40 can't read them, so
// an 8.50+ island they load loses the machine (the island's GAME tab) at their next save, for good (PongooDev/CoreV2#661).
// Epic's DSS never served a newer build's save to an older build; this one serves an island to any build. The older
// upload is kept beside the island as <file>.v<its SaveVersion> (meta in <file>.v<N>.json), and the game is answered as
// for any save.
export const heldBackIslandFile = (dataDir, island, saveVersion) => `${islandFileOf(dataDir, island)}.v${saveVersion}`;
function holdBackOlderSave(dataDir, island, data, meta, build) {
  const incoming = islandSaveVersion(data);
  if (incoming === null) return null;
  // Only an island that has a file (an admin reset removes it and leaves .prev); a 0-byte one's save is its .prev (#395).
  if (!fs.existsSync(islandFileOf(dataDir, island))) return null;
  const stored = islandSaveVersion(readIslandSave(dataDir, island));
  if (stored === null || incoming >= stored) return null;
  const file = heldBackIslandFile(dataDir, island, incoming);
  writeAtomic(file, data);
  writeAtomic(`${file}.json`, JSON.stringify({ meta, build: creativeChangelist(build), saveVersion: incoming, islandSaveVersion: stored,
    size: data.length, updated: new Date().toISOString() }));
  return { incoming, stored, file };
}

export function dssRoutes({ tokens, profiles, sessions, dataDir, islandLinks }) {
  const router = express.Router();
  const fileOf = (island) => islandFileOf(dataDir, island);
  const previousFile = (island) => islandPreviousFile(dataDir, island);
  const readInfo = (island) => readIslandInfo(dataDir, island);
  const saveInfo = (island, info) => saveIslandInfo(dataDir, island, info);

  // Whether the island is checked out: a checkout not checked in yet, whatever its age (the game uploads only what it has
  // checked out, and an upload never names its pid).
  const lockHeld = (lock) => Boolean(lock?.pid);
  // Whether the lock is in use now: touched within lockIdleMs, or held by a live session (a Creative server runs up to
  // four hours, Update v7.00). Only an upload without a checkout (autolock) waits for it.
  const liveSession = (pid) => Boolean(sessions?.get?.(pid));
  const lockFresh = (lock, now = Date.now()) => lockHeld(lock)
    && (now - Number(lock.at ?? 0) < lockIdleMs || (liveSession(lock.pid) && now - Number(lock.at ?? 0) < maxServerMs));

  // The owner's island, if their creative profile has the plot.
  function ownsIsland(island) {
    if (!profiles?.exists?.(island.owner, "creative")) return false;
    return Boolean(plotItem(profiles.load(island.owner, "creative"), island.plotItemId));
  }

  function mayWrite(req, owner) {
    if (isDedicatedServerToken(req.session)) return true;
    if (req.session.accountId === owner) return true;
    return (sessions?.hostedBy?.(req.session.accountId) ?? []).some((session) => sessionMembers(session).includes(owner));
  }

  // The request's island and operation: {island, operation} (operation null for the file itself), or an answer sent.
  function resolve(req, res) {
    const { appName } = req.params;
    const segments = [].concat(req.params.filePath ?? []);
    const last = segments[segments.length - 1];
    const operation = req.method === "POST" && operations.has(last) ? last : null;
    const filePath = (operation ? segments.slice(0, -1) : segments).join("/");
    if (appName !== dssApp) {
      dssError(res, 404, "app_not_found", `Sorry, the app ${appName} could not be found`, [appName]);
      return null;
    }
    // A published island's version: read-only, to any signed-in token (anyone may visit a published island), while its
    // link is active and the version is the one it serves or an earlier one still on disk.
    const published = parsePublicIslandPath(filePath);
    if (published) {
      const link = islandLinks?.get(published.mnemonic);
      const file = link && link.accountId === published.owner && link.active !== false && published.version <= link.version
        ? islandLinks.publicFile(published.owner, published.mnemonic, published.version) : null;
      if (req.method !== "GET" || !file || !fs.existsSync(file)) {
        dssError(res, 404, "file_not_found", `Sorry, the file ${appName}/${filePath} could not be found`, [appName, filePath]);
        return null;
      }
      return { published: file, filePath };
    }
    const island = parseIslandPath(filePath);
    if (!island || !ownsIsland(island)) {
      dssError(res, 404, "file_not_found", `Sorry, the file ${appName}/${filePath} could not be found`, [appName, filePath]);
      return null;
    }
    if (!mayWrite(req, island.owner)) {
      sendError(res, 403, "errors.com.epicgames.common.missing_permission", `This token can't use ${island.owner}'s islands`);
      return null;
    }
    return { island, operation, filePath };
  }

  const sendFile = (res, island, info) => {
    // A 0-byte current file is an old empty upload; serve the version before it (Core-Backend #395).
    const currentSize = fs.existsSync(fileOf(island)) ? fs.statSync(fileOf(island)).size : 0;
    const meta = currentSize ? info.meta ?? {} : info.previousMeta ?? {};
    for (const [key, value] of Object.entries(meta)) res.set(`X-Epic-Meta-${key}`, value);
    res.type("application/octet-stream").send(readIslandSave(dataDir, island) ?? Buffer.alloc(0));
  };

  const store = (island, info, data, meta, build = currentBuild()) => storeIsland(dataDir, island, info, data, meta, build);

  // An older SaveVersion's upload kept beside the island instead of over it (holdBackOlderSave), logged; null when it is
  // the island's new save.
  const holdBack = (island, data, meta, build = currentBuild()) => {
    const heldBack = holdBackOlderSave(dataDir, island, data, meta, build);
    if (heldBack) {
      log("DSS", `${island.owner}'s island ${island.plotItemId}${island.checkpoint ? "'s checkpoint" : ""}: kept its SaveVersion ${heldBack.stored} save; `
        + `the older SaveVersion ${heldBack.incoming} upload (${data.length} bytes) from build ${build ?? "unknown"}${build && versionOf(build) ? ` (${versionOf(build)})` : ""} `
        + `went to ${path.basename(heldBack.file)} instead`);
    }
    return heldBack;
  };

  const raw = express.raw({ type: () => true, limit: maxIslandBytes });
  const base = "/api/dss/v1/:appName/*filePath";
  router.use("/api/dss/v1", requireAuth(tokens));

  router.get(base, (req, res) => {
    const target = resolve(req, res);
    if (!target) return;
    if (target.published) return res.type("application/octet-stream").send(fs.readFileSync(target.published));
    // 🟡 Core's ?info=true (the gameserver's question at an island's load, PongooDev/CoreV2#488: whether the island has a
    // checkpoint and when it was made, for the island menu's Restore): the file's size, last write and meta, not its bytes.
    if (String(req.query.info ?? "") === "true") {
      if (!fs.existsSync(fileOf(target.island))) return dssError(res, 404, "file_not_found", `Sorry, the file ${dssApp}/${target.filePath} could not be found`, [dssApp, target.filePath]);
      const info = readInfo(target.island);
      const updated = info.updated ?? fs.statSync(fileOf(target.island)).mtime.toISOString();
      return res.json({ appName: dssApp, filePath: target.filePath, size: fs.statSync(fileOf(target.island)).size,
        updated, updatedUnixMs: Date.parse(updated), meta: info.meta ?? {} });
    }
    if (!fs.existsSync(fileOf(target.island))) return dssError(res, 404, "file_not_found", `Sorry, the file ${dssApp}/${target.filePath} could not be found`, [dssApp, target.filePath]);
    sendFile(res, target.island, readInfo(target.island));
  });

  // The body is read before any refusal, so the answer never cuts off an upload in progress.
  router.put(base, raw, (req, res) => {
    const target = resolve(req, res);
    if (!target) return;
    const { island, filePath } = target;
    const info = readInfo(island);
    const autolock = String(req.query.autolock ?? "false").toLowerCase() === "true";
    // A checkpoint is the island's backup, written whole by its owner's server: nobody checks it out.
    const held = lockHeld(info.lock) || Boolean(island.checkpoint);
    if (!autolock && !held) return dssError(res, 409, "file_not_checked_out", `${dssApp}/${filePath} is not checked out`, [dssApp, filePath]);
    if (autolock && !island.checkpoint && lockFresh(info.lock)) return dssError(res, 409, "file_checked_out", `${dssApp}/${filePath} is checked out by ${info.lock.pid}`, [dssApp, filePath]);
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    // An empty body isn't an island: the 7.40 client sends one after a real save, and writing it over the save left
    // the island with a 0-byte file that could no longer be published or exported (Core-Backend #395). Keep the save,
    // and end or refresh the lock as any other upload does.
    if (!data.length) {
      if (autolock) delete info.lock;
      else if (info.lock) info.lock.at = Date.now();
      saveInfo(island, info);
      log("DSS", `${island.owner}'s island ${island.plotItemId} ignored an empty upload${autolock ? ", autolock" : ""}`);
      return res.status(204).end();
    }
    const meta = metaOf(req);
    const heldBack = holdBack(island, data, meta);
    if (!heldBack) store(island, info, data, meta);
    // An autolock upload over a checkout nobody has used for lockIdleMs ends it.
    if (autolock) delete info.lock;
    else if (info.lock) info.lock.at = Date.now();
    saveInfo(island, info);
    if (!heldBack) log("DSS", `${island.owner}'s island ${island.plotItemId} saved (${data.length} bytes${autolock ? ", autolock" : ""})`);
    res.status(204).end();
  });

  router.post(base, raw, (req, res) => {
    const target = resolve(req, res);
    if (!target) return;
    const { island, operation, filePath } = target;
    const info = readInfo(island);
    const held = lockHeld(info.lock);
    if (island.checkpoint && operation !== "restore") {
      return dssError(res, 400, "operation_not_allowed", `${dssApp}/${filePath} is a checkpoint, written by a restore`, [dssApp, filePath]);
    }
    if (operation === "checkout") {
      const pid = String(req.query.pid ?? "").slice(0, 128);
      if (!pid) return sendError(res, 400, "errors.com.epicgames.validation.validation_failed", "pid is required");
      // A player is on one server at a time, so the island's newest server takes it: one that crashed, or whose player
      // left without the island being checked in, never keeps it from its owner (the contract of #471).
      if (held && info.lock.pid !== pid) {
        log("DSS", `${island.owner}'s island ${island.plotItemId}: ${lockFresh(info.lock) ? "the" : "stale"} checkout of ${info.lock.pid} taken over by ${pid}`);
      }
      info.lock = { pid, at: Date.now() };
      saveInfo(island, info);
      const download = String(req.query.dl ?? "false").toLowerCase() === "true";
      if (download && fs.existsSync(fileOf(island))) return sendFile(res, island, info);
      return res.status(204).end();
    }
    if (operation === "checkin") {
      if (!held) return dssError(res, 409, "file_not_checked_out", `${dssApp}/${filePath} is not checked out`, [dssApp, filePath]);
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const meta = { ...(info.meta ?? {}), ...metaOf(req) };
      const heldBack = data.length ? holdBack(island, data, meta) : null;
      if (data.length && !heldBack) store(island, info, data, meta);
      delete info.lock;
      saveInfo(island, info);
      log("DSS", `${island.owner}'s island ${island.plotItemId} checked in${data.length ? ` (${data.length} bytes${heldBack ? ", kept beside it" : ""})` : ""}`);
      return res.status(204).end();
    }
    if (operation === "restore") {
      // The island menu's Backup Island and Restore (PongooDev/CoreV2#488): the island copied to its checkpoint, which
      // needs no checkout, and the checkpoint copied back to the island, which needs the server's.
      if (!held && !island.checkpoint) return dssError(res, 409, "file_not_checked_out", `${dssApp}/${filePath} is not checked out`, [dssApp, filePath]);
      const from = String(req.query.from ?? "");
      const source = from === "previous" ? { file: previousFile(island), meta: info.previousMeta ?? {}, build: info.previousBuild } : (() => {
        const other = parseIslandPath(from);
        if (!other || other.owner !== island.owner || !ownsIsland(other)) return null;
        const otherInfo = readInfo(other);
        return { file: fileOf(other), meta: otherInfo.meta ?? {}, build: otherInfo.build };
      })();
      if (!source || !fs.existsSync(source.file)) return dssError(res, 404, "file_not_found", `Sorry, the file ${dssApp}/${from} could not be found`, [dssApp, from]);
      store(island, info, fs.readFileSync(source.file), { ...source.meta }, source.build);
      if (info.lock) info.lock.at = Date.now();
      saveInfo(island, info);
      log("DSS", `${island.owner}'s island ${island.plotItemId}${island.checkpoint ? "'s checkpoint" : ""} restored from ${from}`);
      return res.status(204).end();
    }
    dssError(res, 404, "operation_not_found", `Sorry, ${req.path} isn't a DSS operation`);
  });

  // An upload past the limit (express.raw's 413), as Epic's error.
  router.use("/api/dss/v1", (error, req, res, next) => {
    if (error?.type === "entity.too.large") return dssError(res, 413, "file_too_large", `An island file can't be more than ${maxIslandBytes} bytes`, [String(maxIslandBytes)]);
    next(error);
  });

  return router;
}
