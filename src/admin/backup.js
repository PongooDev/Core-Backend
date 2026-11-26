import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import express from "express";
import { ArchiveError, createArchiveStream, limits, stateFiles, stateFolders, tlsFolder } from "../backup/archive.js";
import { backupsFolder, kinds, maxIntervalHours } from "../backup/service.js";
import { sendError } from "../errors.js";
import { log } from "../log.js";
import { createAdminGate } from "./local.js";

// The admin panel's Backup tab (Core-Backend #438): Export and Import of the data folder's state, Back up now, the list
// of backups (download, restore, delete) and the automatic backups. The archive format and what it holds are
// backup/archive.js; the backups, the schedule and the restore's staging are backup/service.js.
export const importPath = "/admin/api/backup/import";
const invalid = (res, message) => sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", message);
const tooLarge = (res) => sendError(res, 413, "errors.com.epicgames.common.payload_too_large", "The file is too large");

export function backupAdminRoutes(context) {
  const { adminAuth, settings, dataDir, backups } = context;
  const router = express.Router();
  router.use("/admin/api/backup", createAdminGate({ adminAuth, settings }));
  const record = (req, message) => log("Core", `${message} (admin panel, ${req.adminUser?.username ?? "admin"})`);
  const withTls = (req) => req.query.tls === "1" || req.body?.tls === true;

  const overview = () => ({
    included: [...stateFolders.map((name) => `${name}/`), ...stateFiles],
    optional: [{ path: `${tlsFolder}/`, what: "the local HTTPS certificate and its private key" }],
    excluded: ["logs/", "tokens.json (everyone signs in again after a restore)", `${backupsFolder}/`, "temporary files"],
    kinds,
    backups: backups.list(),
    schedule: { ...backups.schedule(), nextAt: backups.nextAt()?.toISOString() ?? null, maxIntervalHours },
    pending: backups.pending(),
    limits: { uploadBytes: limits.uploadBytes, expandedBytes: limits.expandedBytes }
  });

  const failed = (res, error, what) => {
    if (error instanceof ArchiveError) return error.status === 409 ? sendError(res, 409, "errors.com.epicgames.common.conflict", error.message) : invalid(res, error.message);
    return sendError(res, 500, "errors.com.epicgames.common.server_error", `${what}: ${error.message}`);
  };

  router.get("/admin/api/backup", (req, res) => res.json(overview()));

  // The data folder's state as a .tar.gz download. ?tls=1 adds the HTTPS private key.
  router.get("/admin/api/backup/export", async (req, res) => {
    const name = `core-data-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.tar.gz`;
    record(req, `Exported the data${withTls(req) ? " with the TLS key" : ""}`);
    res.attachment(name).type("application/gzip");
    try {
      await pipeline(createArchiveStream(dataDir, { tls: withTls(req) }), res);
    } catch {
      res.destroy();
    }
  });

  router.post("/admin/api/backup/create", async (req, res) => {
    try {
      const made = await backups.runExclusive(() => backups.create({ kind: "backup", tls: withTls(req) }));
      record(req, `Backed up the data to ${made.name}`);
      res.json({ ...made, ...overview() });
    } catch (error) {
      failed(res, error, "The backup failed");
    }
  });

  router.get("/admin/api/backup/files/:name", (req, res) => {
    const file = backups.fileOf(req.params.name);
    if (!file) return sendError(res, 404, "errors.com.epicgames.common.not_found", "That backup does not exist");
    record(req, `Downloaded the backup ${req.params.name}`);
    res.download(file, req.params.name);
  });

  router.delete("/admin/api/backup/files/:name", (req, res) => {
    if (!backups.remove(req.params.name)) return sendError(res, 404, "errors.com.epicgames.common.not_found", "That backup does not exist");
    record(req, `Deleted the backup ${req.params.name}`);
    res.json(overview());
  });

  // {confirm: true}: checks the backup and stages it; the data is replaced at the next start of the backend.
  router.post("/admin/api/backup/files/:name/restore", async (req, res) => {
    const file = backups.fileOf(req.params.name);
    if (!file) return sendError(res, 404, "errors.com.epicgames.common.not_found", "That backup does not exist");
    if (req.body?.confirm !== true) return invalid(res, "Confirm the restore with confirm: true");
    try {
      const meta = await backups.stage(file, { source: req.params.name, tls: req.body?.tls === true });
      record(req, `Staged the restore of ${req.params.name} (${meta.files} files); it is applied at the next start`);
      res.json({ ...overview(), staged: meta });
    } catch (error) {
      failed(res, error, "The restore could not be staged");
    }
  });

  // The archive as the body (any content type), ?confirm=1; ?tls=1 also takes the archive's tls/ folder. Checked and staged
  // like a restore, and kept in backups/ as core-import-* so it can be restored again.
  router.post(importPath, async (req, res) => {
    if (req.query.confirm !== "1") return invalid(res, "Confirm the import with ?confirm=1");
    if (Number(req.headers["content-length"]) > limits.uploadBytes) return tooLarge(res);
    fs.mkdirSync(backups.dir, { recursive: true });
    const temp = path.join(backups.dir, `incoming-${process.pid}-${Date.now()}.tmp`);
    try {
      let received = 0;
      let over = false;
      req.on("data", (chunk) => {
        received += chunk.length;
        if (received > limits.uploadBytes && !over) {
          over = true;
          req.unpipe();
          req.resume();
        }
      });
      await pipeline(req, fs.createWriteStream(temp)).catch((error) => {
        if (!over) throw error;
      });
      if (over) return tooLarge(res);
      const meta = await backups.stage(temp, { source: "an uploaded archive", tls: req.query.tls === "1" });
      const kept = backups.keepUpload(temp);
      record(req, `Imported an archive (${meta.files} files, kept as ${kept}); it is applied at the next start`);
      res.json({ ...overview(), staged: meta });
    } catch (error) {
      failed(res, error, "The import failed");
    } finally {
      fs.rmSync(temp, { force: true });
    }
  });

  router.post("/admin/api/backup/pending/cancel", (req, res) => {
    if (backups.cancelPending()) record(req, "Cancelled the staged restore");
    res.json(overview());
  });

  // {intervalHours: 0 for off, keep}
  router.put("/admin/api/backup/schedule", (req, res) => {
    try {
      const saved = backups.setSchedule(req.body);
      record(req, saved.intervalHours ? `Automatic backups every ${saved.intervalHours} h, keeping ${saved.keep}` : "Automatic backups turned off");
      res.json(overview());
    } catch (error) {
      failed(res, error, "The schedule could not be saved");
    }
  });

  return router;
}
