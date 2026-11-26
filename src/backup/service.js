import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { readJson, writeJson } from "../json-file.js";
import { log } from "../log.js";
import { ArchiveError, createArchiveStream, limits, stateFiles, stateFolders, tlsFolder, unpackArchive } from "./archive.js";

// Backups of the data folder (Core-Backend #438), kept in <data>/backups (which no archive includes), the automatic
// ones on a timer, and the restore. A restore can't be done under the running backend: its stores keep their data in
// memory and would write it back over the restored files. So Restore and Import only check the archive and unpack it into
// <data>/.restore-pending; applyPendingRestore moves it into place at the next start, before any store loads.

export const backupsFolder = "backups";
export const pendingFolder = ".restore-pending";
const scheduleFile = "schedule.json";
export const kinds = { backup: "Manual", auto: "Automatic", prerestore: "Before a restore", import: "Imported" };
const namePattern = /^core-(backup|auto|prerestore|import)-(\d{8})T(\d{6})Z(?:-(\d+))?\.tar\.gz$/;
export const maxIntervalHours = 168; // a week: a longer wait doesn't fit setTimeout
export const defaultSchedule = { intervalHours: 0, keep: 7 };
const minDelayMs = 60 * 1000;

const busyError = () => Object.assign(new ArchiveError("Another backup or restore is running"), { status: 409 });
const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

function createdOf(name) {
  const match = namePattern.exec(name);
  if (!match) return null;
  const [, , day, time] = match;
  return new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`);
}

export const isBackupName = (name) => typeof name === "string" && namePattern.test(name);

export function scheduleValue(value) {
  const intervalHours = Number(value?.intervalHours ?? defaultSchedule.intervalHours);
  const keep = Number(value?.keep ?? defaultSchedule.keep);
  if (!Number.isInteger(intervalHours) || intervalHours < 0 || intervalHours > maxIntervalHours) throw new ArchiveError(`The interval is 0 (off) to ${maxIntervalHours} hours`);
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw new ArchiveError("Keep 1 to 365 automatic backups");
  return { intervalHours, keep };
}

export function createBackupService(dataDir, { now = () => new Date(), timers = { setTimeout, clearTimeout }, write = log } = {}) {
  const dir = path.join(dataDir, backupsFolder);
  let timer = null;
  let nextAt = null;
  let running = false;

  function schedule() {
    try {
      return scheduleValue(readJson(path.join(dir, scheduleFile)));
    } catch {
      return { ...defaultSchedule };
    }
  }

  function list() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(isBackupName).map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, kind: namePattern.exec(name)[1], size: stat.size, created: createdOf(name).toISOString() };
    }).sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  const fileOf = (name) => (isBackupName(name) && fs.existsSync(path.join(dir, name)) ? path.join(dir, name) : null);

  // Writes an archive of the data folder to backups/: { name, size }.
  async function create({ kind = "backup", tls = false } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const at = now();
    let name = `core-${kind}-${stamp(at)}.tar.gz`;
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `core-${kind}-${stamp(at)}-${n}.tar.gz`;
    const temp = path.join(dir, `${name}.tmp`);
    try {
      await pipeline(createArchiveStream(dataDir, { tls }, at), fs.createWriteStream(temp));
      fs.renameSync(temp, path.join(dir, name));
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
    return { name, size: fs.statSync(path.join(dir, name)).size };
  }

  function remove(name) {
    const file = fileOf(name);
    if (!file) return false;
    fs.unlinkSync(file);
    return true;
  }

  // Keeps the newest `keep` automatic backups; the manual ones and those from before a restore are never removed.
  function prune(keep = schedule().keep) {
    const removed = list().filter((entry) => entry.kind === "auto").slice(keep).map((entry) => entry.name);
    for (const name of removed) fs.rmSync(path.join(dir, name), { force: true });
    return removed;
  }

  // Keeps an uploaded archive in backups/ as core-import-*: its name. Moves the file.
  function keepUpload(file) {
    const at = now();
    let name = `core-import-${stamp(at)}.tar.gz`;
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `core-import-${stamp(at)}-${n}.tar.gz`;
    fs.renameSync(file, path.join(dir, name));
    return name;
  }

  function pending() {
    try {
      return readJson(path.join(dataDir, pendingFolder, "meta.json"));
    } catch {
      return null;
    }
  }

  function cancelPending() {
    const had = pending() !== null;
    fs.rmSync(path.join(dataDir, pendingFolder), { recursive: true, force: true });
    return had;
  }

  // Checks the archive and unpacks it into the pending folder, replacing an earlier pending restore. Throws ArchiveError.
  async function stage(archiveFile, { source, tls = false }) {
    if (running) throw busyError();
    running = true;
    const staging = path.join(dataDir, pendingFolder);
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      const content = path.join(staging, "data");
      fs.mkdirSync(content, { recursive: true });
      let result;
      try {
        result = await unpackArchive(archiveFile, content, { allowTls: tls });
      } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
      }
      if (result.files === 0) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw new ArchiveError("The archive holds no data");
      }
      const meta = { source, staged: now().toISOString(), created: result.created, files: result.files, bytes: result.bytes, tls: result.tls };
      writeJson(path.join(staging, "meta.json"), meta);
      return meta;
    } finally {
      running = false;
    }
  }

  function arm(delayMs) {
    clearTimer();
    const { intervalHours } = schedule();
    if (!intervalHours) return;
    nextAt = new Date(now().getTime() + delayMs);
    timer = timers.setTimeout(runAutomatic, delayMs);
    timer.unref?.();
  }

  function clearTimer() {
    if (timer) timers.clearTimeout(timer);
    timer = null;
    nextAt = null;
  }

  // The timer's callback: the automatic backup, the retention, and the next timer.
  async function runAutomatic() {
    timer = null;
    try {
      if (!running) {
        running = true;
        try {
          const made = await create({ kind: "auto" });
          const removed = prune();
          write("Core", `Automatic backup ${made.name} written${removed.length ? `, ${removed.length} older one(s) removed` : ""}`);
        } finally {
          running = false;
        }
      }
    } catch (error) {
      write("Core", `Automatic backup failed: ${error.message}`);
    }
    arm(schedule().intervalHours * 3600 * 1000);
  }

  // Starts the timer from the saved interval: the first backup is one interval after the newest automatic one (at the
  // latest a minute after start when that is past), or one interval from now when there is none.
  function start() {
    const { intervalHours } = schedule();
    if (!intervalHours) return clearTimer();
    const interval = intervalHours * 3600 * 1000;
    const last = list().find((entry) => entry.kind === "auto");
    const due = last ? new Date(last.created).getTime() + interval - now().getTime() : interval;
    arm(Math.min(interval, Math.max(due, minDelayMs)));
  }

  function setSchedule(value) {
    const saved = scheduleValue(value);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, scheduleFile), saved);
    prune(saved.keep);
    start();
    return saved;
  }

  return {
    dir, list, fileOf, create, remove, prune, keepUpload, pending, cancelPending, stage, schedule, setSchedule, start,
    stop: clearTimer,
    nextAt: () => nextAt,
    isRunning: () => running,
    runExclusive: async (task) => {
      if (running) throw busyError();
      running = true;
      try {
        return await task();
      } finally {
        running = false;
      }
    }
  };
}

// At start-up, before any store loads: applies a restore staged by the panel. The state now there is archived to
// backups/core-prerestore-*.tar.gz first; then the state files and folders are swapped for the staged ones (a state path
// the archive lacks is removed: a restore is the archive's state, not a merge), tokens.json is dropped (the old sign-ins
// are for accounts that may not exist), and tls/ is replaced only when the archive carried it. A failure puts the old
// state back. Returns the pending meta that was applied, or null.
export async function applyPendingRestore(dataDir, { now = () => new Date(), write = log } = {}) {
  const staging = path.join(dataDir, pendingFolder);
  const metaFile = path.join(staging, "meta.json");
  if (!fs.existsSync(staging)) return null;
  if (!fs.existsSync(metaFile) || !fs.existsSync(path.join(staging, "data"))) {
    // An import that was cut short: never applied.
    fs.rmSync(staging, { recursive: true, force: true });
    return null;
  }
  const meta = readJson(metaFile);
  const service = createBackupService(dataDir, { now, write });
  const before = await service.create({ kind: "prerestore", tls: meta.tls });
  write("Core", `Restoring ${meta.source} (${meta.files} files); the data before it is in backups/${before.name}`);

  const content = path.join(staging, "data");
  const old = path.join(dataDir, ".restore-old");
  fs.rmSync(old, { recursive: true, force: true });
  fs.mkdirSync(old, { recursive: true });
  const names = [...stateFiles, ...stateFolders, ...(meta.tls ? [tlsFolder] : []), "tokens.json"];
  const moved = [];
  const placed = [];
  try {
    for (const name of names) {
      const from = path.join(dataDir, name);
      if (!fs.existsSync(from)) continue;
      fs.renameSync(from, path.join(old, name));
      moved.push(name);
    }
    for (const name of fs.readdirSync(content)) {
      fs.renameSync(path.join(content, name), path.join(dataDir, name));
      placed.push(name);
    }
  } catch (error) {
    for (const name of placed) fs.rmSync(path.join(dataDir, name), { recursive: true, force: true });
    for (const name of moved) fs.renameSync(path.join(old, name), path.join(dataDir, name));
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
    write("Core", `Restore failed, the data is as it was: ${error.message}`);
    return null;
  }
  fs.rmSync(old, { recursive: true, force: true });
  fs.rmSync(staging, { recursive: true, force: true });
  write("Core", `Restore of ${meta.source} done`);
  return meta;
}

export { limits };
