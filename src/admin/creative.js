import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { versionOf } from "../builds/detect.js";
import { sendError } from "../errors.js";
import { log } from "../log.js";
import { creativeReplayDay, daysUntilIslandsForEveryone, plotItem, plotsOf } from "../profiles/creative.js";
import { islandFileOf, islandFolder, lockIdleMs, maxIslandBytes, readIslandInfo, saveIslandInfo, storeIsland } from "../services/dss/dss.js";
import { exportIsland, importIsland, IslandTransferError, maxIslandFileBytes } from "../services/dss/transfer.js";
import { notifyProfiles } from "../services/mcp/profile.js";
import { linkJson, maxFeatured, maxTagline, maxTitle, normalizeMnemonic } from "../services/links/islands.js";
import { publisherOf } from "../services/links/links.js";
import { enabledCreators } from "../store/creators.js";
import { createAdminGate } from "./local.js";

// The admin panel's Creative tab and the Players tab's Creative section (PongooDev/CoreV2#488), Core's own:
// - Creative tab: the published islands (each a links service link, services/links/islands.js), their titles, on/off and
//   unpublishing, a player's island published by the admin, and the hub's featured islands (the hotfix's CuratedLinkCodes,
//   at most four, which servers started afterwards load into the featured rifts), and the week's suggested islands (the
//   island code screen's first entry, and the featured rifts' islands while the admin has set none) with their schedule.
// - A player's islands: each CreativePlot of their creative profile with its save on the DSS (services/dss/dss.js), its
//   in-game backup (the island menu's Backup Island, the checkpoint) and the admin's backups, which are copies of the save
//   kept beside it (<plot>.backups/<id>.island). A backup is made from the save, restored over it (the save before is kept
//   as the DSS's "previous", so a restore can be undone with Restore previous), downloaded, or made from an uploaded file.
//   A restore is refused while a server has the island checked out and has used it within 15 minutes (it would save over
//   it); the player leaving the island, or the server stopping, frees it.
const invalid = (res, message) => sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", message);
const notFound = (res, what) => sendError(res, 404, "errors.com.epicgames.common.not_found", `${what} was not found`);
const backupIdPattern = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$/;
export const maxBackups = 20;
const maxNote = 80;

export function creativeAdminRoutes(context) {
  const { accounts, profiles, settings, islandLinks, adminAuth, dataDir } = context;
  const router = express.Router();
  router.use(["/admin/api/creative", "/admin/api/accounts/:accountId/creative"], createAdminGate({ adminAuth, settings }));
  const nameOf = (accountId) => accounts.get(accountId)?.displayName ?? null;

  const linkView = (link) => ({
    ...linkJson(link), title: link.title, tagline: link.tagline, plotItemId: link.plotItemId, size: link.size ?? null,
    publishedBy: link.publishedBy ?? "player", authorName: nameOf(link.accountId), featuredSlot: islandLinks.featured().indexOf(link.mnemonic)
  });
  const suggestionView = () => {
    const week = islandLinks.suggested();
    return { ...week, islands: week.picks.map((code) => ({ mnemonic: code, title: islandLinks.get(code)?.title ?? null })),
      featuredInRifts: islandLinks.featured().filter((code) => islandLinks.get(code)?.active !== false).length === 0 };
  };
  const overview = () => ({
    maxFeatured,
    featured: islandLinks.featured().map((code) => {
      const link = islandLinks.get(code);
      return { mnemonic: code, title: link?.title ?? null, active: Boolean(link && link.active !== false) };
    }),
    links: islandLinks.list().map(linkView),
    suggestion: suggestionView(),
    // 7.00's early access switch (Core-Backend #410) and where Season 7's replay stands.
    earlyAccess: { on: settings.get().creativeEarlyAccess !== false, replayDay: creativeReplayDay(), daysLeft: daysUntilIslandsForEveryone() },
    publishers: enabledCreators(settings.get()).filter((creator) => creator.accountId)
      .map((creator) => ({ accountId: creator.accountId, code: creator.code, displayName: nameOf(creator.accountId) }))
  });

  router.get("/admin/api/creative", (req, res) => res.json(overview()));

  // {codes: [up to four island codes]}: the featured rifts' islands, in order.
  router.post("/admin/api/creative/featured", (req, res) => {
    const codes = Array.isArray(req.body?.codes) ? req.body.codes.filter((code) => String(code ?? "").trim()) : null;
    if (!codes) return invalid(res, "codes must be a list of island codes");
    if (codes.length > maxFeatured) return invalid(res, `There are ${maxFeatured} featured rifts`);
    for (const code of codes) {
      const mnemonic = normalizeMnemonic(code);
      if (!mnemonic) return invalid(res, `${code} isn't an island code (1234-5678-9012)`);
      if (!islandLinks.get(mnemonic)) return invalid(res, `No island is published as ${mnemonic}`);
    }
    islandLinks.setFeatured(codes);
    res.json(overview());
  });

  // {weekday: 0 (Sunday) to 6, hour?: 0 to 23 UTC}: when the suggested islands change (Friday 00:00 UTC to the next by
  // default). A new schedule picks again at once.
  router.post("/admin/api/creative/suggestion", (req, res) => {
    const { weekday, hour = 0 } = req.body ?? {};
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return invalid(res, "weekday is 0 (Sunday) to 6 (Saturday)");
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return invalid(res, "hour is 0 to 23 (UTC)");
    islandLinks.setSuggestionSchedule({ weekday, hour });
    res.json(overview());
  });
  // New suggested islands now, for the rest of the period.
  router.post("/admin/api/creative/suggestion/repick", (req, res) => {
    islandLinks.repickSuggested();
    res.json(overview());
  });

  // {title?, tagline?, active?}: a published island's title, tagline or on/off.
  router.post("/admin/api/creative/links/:mnemonic", (req, res) => {
    const link = islandLinks.get(req.params.mnemonic);
    if (!link) return notFound(res, `Island ${req.params.mnemonic}`);
    const { title, tagline, active } = req.body ?? {};
    if (title !== undefined && (typeof title !== "string" || title.trim().length < 3 || title.trim().length > maxTitle)) return invalid(res, `A title is 3 to ${maxTitle} characters`);
    if (tagline !== undefined && (typeof tagline !== "string" || tagline.length > maxTagline)) return invalid(res, `A description is at most ${maxTagline} characters`);
    if (active !== undefined && typeof active !== "boolean") return invalid(res, "active must be true or false");
    islandLinks.update(link.mnemonic, { title, tagline, active });
    log("Creative", `Island ${link.mnemonic} changed by the admin${active === undefined ? "" : active ? " (on)" : " (off)"}`);
    res.json(overview());
  });

  router.delete("/admin/api/creative/links/:mnemonic", (req, res) => {
    if (!islandLinks.remove(req.params.mnemonic)) return notFound(res, `Island ${req.params.mnemonic}`);
    res.json(overview());
  });

  router.get("/admin/api/creative/links/:mnemonic/file", (req, res) => {
    const link = islandLinks.get(req.params.mnemonic);
    const file = link ? islandLinks.fileOf(link) : null;
    if (!file || !fs.existsSync(file)) return notFound(res, `Island ${req.params.mnemonic}'s file`);
    res.attachment(`${link.mnemonic}-v${link.version}.island`).type("application/octet-stream").send(fs.readFileSync(file));
  });

  // {accountId, plotItemId, title, tagline?}: the admin publishes a player's island from its last save (any player; the
  // link's creator is their Support-A-Creator code, else their display name). Publishing it again makes a new version.
  router.post("/admin/api/creative/publish", (req, res) => {
    const { accountId, plotItemId, title, tagline = "" } = req.body ?? {};
    const account = typeof accountId === "string" ? accounts.get(accountId) ?? accounts.findByName(accountId) : null;
    if (!account) return invalid(res, `No account ${accountId}`);
    if (!profiles.exists(account.id, "creative")) return invalid(res, `${account.displayName} has no Creative islands`);
    const plot = plotItem(profiles.load(account.id, "creative"), plotItemId);
    if (!plot) return invalid(res, `${plotItemId} isn't one of ${account.displayName}'s islands`);
    if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > maxTitle) return invalid(res, `A title is 3 to ${maxTitle} characters`);
    if (typeof tagline !== "string" || tagline.length > maxTagline) return invalid(res, `A description is at most ${maxTagline} characters`);
    const file = islandFileOf(dataDir, { owner: account.id, plotItemId });
    if (!fs.existsSync(file)) return invalid(res, "That island has never been saved");
    const link = islandLinks.publish({ accountId: account.id, creatorName: publisherOf(account.id, settings.get())?.code ?? account.displayName,
      plotItemId, islandType: plot.templateId, title, tagline, contents: fs.readFileSync(file), by: "admin" });
    res.json({ ...overview(), published: linkView(link) });
  });

  // A player's islands.
  const backupFolder = (accountId, plotItemId) => path.join(islandFolder(dataDir, accountId), `${plotItemId}.backups`);
  const backupFile = (accountId, plotItemId, id) => path.join(backupFolder(accountId, plotItemId), `${id}.island`);
  const backupsOf = (accountId, plotItemId) => {
    const folder = backupFolder(accountId, plotItemId);
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).map((name) => /^(.+)\.island$/.exec(name)?.[1]).filter((id) => id && backupIdPattern.test(id)).map((id) => {
      let note = {};
      try {
        note = JSON.parse(fs.readFileSync(`${backupFile(accountId, plotItemId, id)}.json`, "utf8"));
      } catch {
        // A backup without its note still lists.
      }
      return { id, created: note.created ?? null, note: note.note ?? "", size: fs.statSync(backupFile(accountId, plotItemId, id)).size, from: note.from ?? "save",
        build: note.build ?? null };
    }).sort((a, b) => b.id.localeCompare(a.id));
  };
  const fileState = (file, info) => (fs.existsSync(file) ? { size: fs.statSync(file).size, updated: info?.updated ?? fs.statSync(file).mtime.toISOString() } : null);
  const inUse = (info) => Boolean(info.lock?.pid) && Date.now() - Number(info.lock.at ?? 0) < lockIdleMs;
  function islandsOf(accountId) {
    if (!profiles.exists(accountId, "creative")) return [];
    return plotsOf(profiles.load(accountId, "creative")).map(([plotItemId, item]) => {
      const island = { owner: accountId, plotItemId };
      const info = readIslandInfo(dataDir, island);
      const checkpoint = { ...island, checkpoint: true };
      const link = islandLinks.ofIsland(accountId, plotItemId);
      return {
        plotItemId, templateId: item.templateId, islandIndex: item.attributes?.islandIndex ?? null, islandName: item.attributes?.islandName ?? "",
        save: fileState(islandFileOf(dataDir, island), info), build: info.build ? { changelist: info.build, version: versionOf(info.build) } : null,
        imported: info.imported ?? null,
        checkedOut: Boolean(info.lock?.pid), inUse: inUse(info),
        hasPrevious: fs.existsSync(`${islandFileOf(dataDir, island)}.prev`),
        checkpoint: fileState(islandFileOf(dataDir, checkpoint), readIslandInfo(dataDir, checkpoint)),
        backups: backupsOf(accountId, plotItemId), published: link ? linkView(link) : null
      };
    }).sort((a, b) => String(a.templateId).localeCompare(String(b.templateId)) || (a.islandIndex ?? 0) - (b.islandIndex ?? 0));
  }
  // The request's player and island: {account, plotItemId} or an answer sent.
  function target(req, res, needsPlot = true) {
    const account = accounts.get(req.params.accountId);
    if (!account) {
      notFound(res, `Account ${req.params.accountId}`);
      return null;
    }
    if (!needsPlot) return { account };
    const plotItemId = req.params.plotItemId;
    if (!profiles.exists(account.id, "creative") || !plotItem(profiles.load(account.id, "creative"), plotItemId)) {
      notFound(res, `${account.displayName}'s island ${plotItemId}`);
      return null;
    }
    return { account, plotItemId };
  }
  const playerView = (account) => ({ accountId: account.id, displayName: account.displayName,
    canPublish: Boolean(publisherOf(account.id, settings.get())), islands: islandsOf(account.id) });

  router.get("/admin/api/accounts/:accountId/creative", (req, res) => {
    const found = target(req, res, false);
    if (found) res.json(playerView(found.account));
  });

  // `build`: the changelist of the game that wrote the copied save (dss.js storeIsland), null for an uploaded file.
  function makeBackup(accountId, plotItemId, contents, note, from, build = null) {
    const existing = backupsOf(accountId, plotItemId);
    for (const old of existing.slice(maxBackups - 1)) {
      fs.rmSync(backupFile(accountId, plotItemId, old.id), { force: true });
      fs.rmSync(`${backupFile(accountId, plotItemId, old.id)}.json`, { force: true });
    }
    const id = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${crypto.randomBytes(3).toString("hex")}`;
    const file = backupFile(accountId, plotItemId, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    fs.writeFileSync(`${file}.json`, JSON.stringify({ created: new Date().toISOString(), note: String(note ?? "").slice(0, maxNote), from, build }));
    log("Creative", `${accountId}'s island ${plotItemId} backed up (${contents.length} bytes, from ${from})`);
    return id;
  }

  // {note?}: a backup of the island's save.
  router.post("/admin/api/accounts/:accountId/creative/:plotItemId/backups", (req, res) => {
    const found = target(req, res);
    if (!found) return;
    const file = islandFileOf(dataDir, { owner: found.account.id, plotItemId: found.plotItemId });
    if (!fs.existsSync(file)) return invalid(res, "The island has never been saved");
    const build = readIslandInfo(dataDir, { owner: found.account.id, plotItemId: found.plotItemId }).build ?? null;
    makeBackup(found.account.id, found.plotItemId, fs.readFileSync(file), req.body?.note, "save", build);
    res.json(playerView(found.account));
  });

  // {data (base64), note?}: an island file (one downloaded from here, or another backend's) kept as a backup.
  router.post("/admin/api/accounts/:accountId/creative/:plotItemId/upload", express.json({ limit: Math.ceil(maxIslandBytes * 4 / 3) + 4096 }), (req, res) => {
    const found = target(req, res);
    if (!found) return;
    const data = typeof req.body?.data === "string" ? Buffer.from(req.body.data, "base64") : null;
    if (!data?.length) return invalid(res, "No island file");
    if (data.length > maxIslandBytes) return invalid(res, `An island file can't be more than ${maxIslandBytes} bytes`);
    makeBackup(found.account.id, found.plotItemId, data, req.body?.note || "uploaded", "upload");
    res.json(playerView(found.account));
  });

  router.delete("/admin/api/accounts/:accountId/creative/:plotItemId/backups/:id", (req, res) => {
    const found = target(req, res);
    if (!found) return;
    const file = backupIdPattern.test(req.params.id) ? backupFile(found.account.id, found.plotItemId, req.params.id) : null;
    if (!file || !fs.existsSync(file)) return notFound(res, `Backup ${req.params.id}`);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.json`, { force: true });
    res.json(playerView(found.account));
  });

  // The file of the island's save ("save"), its in-game backup ("checkpoint") or one of the admin's backups.
  router.get("/admin/api/accounts/:accountId/creative/:plotItemId/file/:which", (req, res) => {
    const found = target(req, res);
    if (!found) return;
    const island = { owner: found.account.id, plotItemId: found.plotItemId };
    const { which } = req.params;
    const file = which === "save" ? islandFileOf(dataDir, island) : which === "checkpoint" ? islandFileOf(dataDir, { ...island, checkpoint: true })
      : backupIdPattern.test(which) ? backupFile(island.owner, island.plotItemId, which) : null;
    if (!file || !fs.existsSync(file)) return notFound(res, `That file of island ${found.plotItemId}`);
    res.attachment(`${found.account.displayName}-${found.plotItemId}-${which}.island`).type("application/octet-stream").send(fs.readFileSync(file));
  });

  // The island as a .coreisland file (services/dss/transfer.js, Core-Launcher #21), for another Core backend.
  const transferFailed = (res, error) => {
    if (!(error instanceof IslandTransferError)) throw error;
    sendError(res, error.status, error.errorCode, error.message);
  };
  router.get("/admin/api/accounts/:accountId/creative/:plotItemId/export", (req, res) => {
    const found = target(req, res);
    if (!found) return;
    try {
      const { fileName, contents } = exportIsland(context, found.account, found.plotItemId);
      res.attachment(`${found.account.displayName}-${fileName}`).type("application/json").send(contents);
    } catch (error) {
      transferFailed(res, error);
    }
  });

  // A .coreisland file (the body as is) made a new island of the player's, in the lowest free slot of its type; ?build=
  // checks it loads on that build (by default: on the newest build this backend knows).
  router.post("/admin/api/accounts/:accountId/creative/import", express.raw({ type: () => true, limit: maxIslandFileBytes }), (req, res) => {
    const found = target(req, res, false);
    if (!found) return;
    try {
      const imported = importIsland(context, found.account, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        { build: typeof req.query.build === "string" && req.query.build ? req.query.build : null, notify: (session) => notifyProfiles(context, session) });
      res.json({ ...playerView(found.account), imported });
    } catch (error) {
      transferFailed(res, error);
    }
  });

  // {from: a backup's id, "checkpoint" or "previous"}: the island's save replaced. Refused while a server is using it.
  router.post("/admin/api/accounts/:accountId/creative/:plotItemId/restore", (req, res) => {
    const found = target(req, res);
    if (!found) return;
    const island = { owner: found.account.id, plotItemId: found.plotItemId };
    const info = readIslandInfo(dataDir, island);
    if (inUse(info)) return sendError(res, 409, "errors.com.epicgames.dss.file_checked_out", "A server has this island loaded now: it would save over the restore. Try again once the player has left it");
    const from = String(req.body?.from ?? "");
    const file = from === "previous" ? `${islandFileOf(dataDir, island)}.prev` : from === "checkpoint" ? islandFileOf(dataDir, { ...island, checkpoint: true })
      : backupIdPattern.test(from) ? backupFile(island.owner, island.plotItemId, from) : null;
    if (!file || !fs.existsSync(file)) return invalid(res, `Nothing to restore from ${from || "(none given)"}`);
    const checkpointInfo = from === "checkpoint" ? readIslandInfo(dataDir, { ...island, checkpoint: true }) : null;
    const meta = from === "previous" ? info.previousMeta ?? {} : checkpointInfo ? checkpointInfo.meta ?? {} : {};
    const build = from === "previous" ? info.previousBuild : checkpointInfo ? checkpointInfo.build
      : backupsOf(island.owner, island.plotItemId).find((backup) => backup.id === from)?.build;
    storeIsland(dataDir, island, info, fs.readFileSync(file), { ...meta }, build ?? null);
    delete info.lock;
    saveIslandInfo(dataDir, island, info);
    log("Creative", `${island.owner}'s island ${island.plotItemId} restored from ${from} by the admin`);
    res.json(playerView(found.account));
  });

  // The island back to its template: its save goes (kept as a backup first, so it can be restored).
  router.post("/admin/api/accounts/:accountId/creative/:plotItemId/reset", (req, res) => {
    const found = target(req, res);
    if (!found) return;
    const island = { owner: found.account.id, plotItemId: found.plotItemId };
    const info = readIslandInfo(dataDir, island);
    if (inUse(info)) return sendError(res, 409, "errors.com.epicgames.dss.file_checked_out", "A server has this island loaded now. Try again once the player has left it");
    const file = islandFileOf(dataDir, island);
    if (fs.existsSync(file)) {
      makeBackup(island.owner, island.plotItemId, fs.readFileSync(file), "before reset", "save", info.build ?? null);
      fs.rmSync(file, { force: true });
    }
    saveIslandInfo(dataDir, island, { ...info, meta: {}, size: 0, updated: new Date().toISOString(), lock: undefined });
    log("Creative", `${island.owner}'s island ${island.plotItemId} reset by the admin`);
    res.json(playerView(found.account));
  });

  // An island file past the import's limit (express.raw's 413).
  router.use("/admin/api/accounts/:accountId/creative", (error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return sendError(res, 413, "errors.com.epicgames.creative.island_file_too_large", `An island file can't be more than ${Math.floor(maxIslandFileBytes / 1048576)} MB`);
    }
    next(error);
  });

  return router;
}
