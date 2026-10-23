import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { sendError } from "../../errors.js";
import { sessionMembers } from "../../matchmaking/sessions.js";
import { createNetwork } from "../../network.js";

const validFilename = /^[A-Za-z0-9._-]{1,128}$/;

// System files are hotfixes. The client fetches them at start-up, before it logs in, and merges Default*.ini files
// into the matching config (UOnlineHotfixManager: DefaultEngine.ini -> Engine). Its XMPP connection is made at
// login and reads [OnlineSubsystemMcp.XMPP] then (sub_37C4C80 -> sub_37C22D0), so this points XMPP at the address
// and port the client reached this backend on, which is where XMPP is served (for a player on the internet, the
// public address it can reach this machine at: network.js reachableAddress). STOMP's service config takes Protocol
// and Domain from [OnlineSubsystemMcp.StompServiceMcp] the same way (sub_3808800); its URL is
// <Protocol>://<Domain>/stomp. Nothing is written on the player's PC.
const defaultNetwork = createNetwork();
function systemFiles(req, network = defaultNetwork) {
  const address = network.reachableAddress(req);
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

export function cloudStorageRoutes({ tokens, network }) {
  const router = express.Router();

  router.get("/fortnite/api/cloudstorage/system", requireAuth(tokens), (req, res) => {
    res.json(Object.entries(systemFiles(req, network)).map(([filename, data]) => header(filename, data)));
  });

  router.get("/fortnite/api/cloudstorage/system/:filename", requireAuth(tokens), (req, res) => {
    const data = systemFiles(req, network)[req.params.filename];
    if (!data) return sendError(res, 404, "errors.com.epicgames.cloudstorage.file_not_found", `${req.params.filename} not found`);
    res.type("application/octet-stream").send(data);
  });

  return router;
}

export function userCloudStorageRoutes({ tokens, accounts, sessions, dataDir }) {
  const router = express.Router();
  const base = "/fortnite/api/cloudstorage/user/:accountId";
  const folder = (accountId) => path.join(dataDir, "accounts", accountId, "cloudstorage");

  // A storm shield's build is saved in its owner's user cloud storage (<core item id>_r<zone>_a<0|1>.sav), which the
  // zone server lists, reads and writes for that owner (UFortUserCloudHelperComponent) with its own signed-in account's
  // token: the OSS falls back to the first signed-in user when it holds no login for the file's owner (sub_37E9DF0).
  // So the files of the players on a session an account hosts are open to that account's tokens, and to the
  // DedicatedServer client's. The OSS turns a 401 or 403 from any service into InvalidUser or NotAuthorized, which
  // AFortGameSessionDedicated answers by shutting the server down (exit code 6), so a gameserver is refused with a 404.
  function requireOwnerOrHost(req, res, next) {
    const { accountId } = req.params;
    if (req.session.accountId === accountId) return next();
    const dedicated = isDedicatedServerToken(req.session);
    const hosted = sessions.hostedBy(req.session.accountId);
    if (!dedicated && !hosted.length) return requireOwnAccount(req, res, next);
    if (accounts.get(accountId) && (dedicated || hosted.some((session) => sessionMembers(session).includes(accountId)))) return next();
    sendError(res, 404, "errors.com.epicgames.cloudstorage.user_not_found",
      `${accountId} isn't a player on a session this server hosts`);
  }

  function checkFilename(req, res, next) {
    if (!validFilename.test(req.params.filename) || req.params.filename.startsWith(".")) {
      return sendError(res, 400, "errors.com.epicgames.cloudstorage.invalid_filename", "Invalid file name");
    }
    req.file = path.join(folder(req.params.accountId), req.params.filename);
    next();
  }

  router.use(base, requireAuth(tokens));

  router.get(base, requireOwnerOrHost, (req, res) => {
    const dir = folder(req.params.accountId);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => validFilename.test(name)) : [];
    res.json(files.map((filename) => {
      const data = fs.readFileSync(path.join(dir, filename));
      return { filename, hash: crypto.createHash("sha1").update(data).digest("hex"), length: data.length };
    }));
  });

  router.get(`${base}/:filename`, requireOwnerOrHost, checkFilename, (req, res) => {
    if (!fs.existsSync(req.file)) {
      return sendError(res, 404, "errors.com.epicgames.cloudstorage.file_not_found", `${req.params.filename} not found`);
    }
    res.type("application/octet-stream").send(fs.readFileSync(req.file));
  });

  // The body is read before any refusal, so the answer never cuts off an upload in progress.
  router.put(`${base}/:filename`, express.raw({ type: () => true, limit: "16mb" }), requireOwnerOrHost, checkFilename, (req, res) => {
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
