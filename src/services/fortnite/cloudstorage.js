import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { sendError } from "../../errors.js";

const validFilename = /^[A-Za-z0-9._-]{1,128}$/;

// System files are hotfixes. The client fetches them at start-up, before it logs in, and merges Default*.ini files
// into the matching config (UOnlineHotfixManager: DefaultEngine.ini -> Engine). Its XMPP connection is made at
// login and reads [OnlineSubsystemMcp.XMPP] then (sub_37C4C80 -> sub_37C22D0), so this points XMPP at the address
// and port the client reached this backend on, which is where XMPP is served. STOMP's service config takes Protocol
// and Domain from [OnlineSubsystemMcp.StompServiceMcp] the same way (sub_3808800); its URL is
// <Protocol>://<Domain>/stomp. Nothing is written on the player's PC.
function systemFiles(req) {
  const address = req.socket.localAddress.replace(/^::ffff:/, "");
  const port = req.socket.localPort;
  const engine = [
    "[OnlineSubsystemMcp.XMPP]", `ServerAddr=${address}`, `ServerPort=${port}`, "bUseSSL=false", "",
    "[OnlineSubsystemMcp.StompServiceMcp]", "Protocol=ws", `Domain=${address}:${port}`, ""
  ].join("\r\n");
  return { "DefaultEngine.ini": Buffer.from(engine, "utf8") };
}

// What the client reads per file (OnlineTitleFileMcp, sub_37C8D10): hash (SHA-1 hex, also its cache key), hash256,
// uniqueFilename (the download name), filename and length.
const header = (filename, data) => ({
  uniqueFilename: filename,
  filename,
  hash: crypto.createHash("sha1").update(data).digest("hex"),
  hash256: crypto.createHash("sha256").update(data).digest("hex"),
  length: data.length
});

export function cloudStorageRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/cloudstorage/system", requireAuth(tokens), (req, res) => {
    res.json(Object.entries(systemFiles(req)).map(([filename, data]) => header(filename, data)));
  });

  router.get("/fortnite/api/cloudstorage/system/:filename", requireAuth(tokens), (req, res) => {
    const data = systemFiles(req)[req.params.filename];
    if (!data) return sendError(res, 404, "errors.com.epicgames.cloudstorage.file_not_found", `${req.params.filename} not found`);
    res.type("application/octet-stream").send(data);
  });

  return router;
}

export function userCloudStorageRoutes({ tokens, accounts, dataDir }) {
  const router = express.Router();
  const base = "/fortnite/api/cloudstorage/user/:accountId";
  const folder = (accountId) => path.join(dataDir, "accounts", accountId, "cloudstorage");

  // A player's own files, and any existing account's for a gameserver's DedicatedServer token: a storm shield's world
  // record is its owner's, which the zone server lists, reads and writes while it hosts it (LoadingWorldRecord).
  function requireOwnerOrGameserver(req, res, next) {
    if (!isDedicatedServerToken(req.session)) return requireOwnAccount(req, res, next);
    if (accounts.get(req.params.accountId)) return next();
    sendError(res, 404, "errors.com.epicgames.account.account_not_found", `Sorry, we couldn't find an account for ${req.params.accountId}`);
  }

  function checkFilename(req, res, next) {
    if (!validFilename.test(req.params.filename) || req.params.filename.startsWith(".")) {
      return sendError(res, 400, "errors.com.epicgames.cloudstorage.invalid_filename", "Invalid file name");
    }
    req.file = path.join(folder(req.params.accountId), req.params.filename);
    next();
  }

  router.use(base, requireAuth(tokens));

  router.get(base, requireOwnerOrGameserver, (req, res) => {
    const dir = folder(req.params.accountId);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => validFilename.test(name)) : [];
    res.json(files.map((filename) => {
      const data = fs.readFileSync(path.join(dir, filename));
      return { filename, hash: crypto.createHash("sha1").update(data).digest("hex"), length: data.length };
    }));
  });

  router.get(`${base}/:filename`, requireOwnerOrGameserver, checkFilename, (req, res) => {
    if (!fs.existsSync(req.file)) {
      return sendError(res, 404, "errors.com.epicgames.cloudstorage.file_not_found", `${req.params.filename} not found`);
    }
    res.type("application/octet-stream").send(fs.readFileSync(req.file));
  });

  router.put(`${base}/:filename`, requireOwnerOrGameserver, checkFilename, express.raw({ type: () => true, limit: "16mb" }), (req, res) => {
    fs.mkdirSync(path.dirname(req.file), { recursive: true });
    fs.writeFileSync(`${req.file}.tmp`, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    fs.renameSync(`${req.file}.tmp`, req.file);
    res.status(204).end();
  });

  router.delete(`${base}/:filename`, requireOwnAccount, checkFilename, (req, res) => {
    fs.rmSync(req.file, { force: true });
    res.status(204).end();
  });

  return router;
}
