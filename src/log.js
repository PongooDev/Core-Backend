import fs from "node:fs";
import path from "node:path";
import { getBuild } from "./builds/detect.js";
import { notFound } from "./errors.js";

// The last lines logged, for the admin panel's log view (kept in memory, so they start over with the process).
const recent = [];
const keepLines = 2000;
let nextSeq = 1;

export function log(category, message) {
  const at = new Date().toISOString();
  console.log(`[${at.slice(11, 23)}] [${category}] ${message}`);
  recent.push({ seq: nextSeq++, at, category, message });
  if (recent.length > keepLines) recent.splice(0, recent.length - keepLines);
}

// Lines after seq (0 for all kept), oldest first.
export function recentLogs(after = 0, limit = 500) {
  const lines = recent.filter((line) => line.seq > after);
  return lines.slice(Math.max(0, lines.length - limit));
}

export function requestLog(req, res, next) {
  // The admin panel polls its own API; its reads would drown out the game's requests.
  if (req.method === "GET" && req.originalUrl.startsWith("/admin/api/")) return next();
  res.on("finish", () => log("HTTP", `${res.statusCode} ${req.method} ${req.get("host") ?? ""}${req.originalUrl}`));
  next();
}

function normalizePath(urlPath) {
  return urlPath.replace(/\/[0-9a-f]{32}(?=\/|$)/gi, "/:id");
}

function describeAuth(header) {
  if (!header) return undefined;
  const [scheme, value = ""] = header.split(" ");
  if (scheme.toLowerCase() !== "basic") return scheme;
  return `${scheme} ${Buffer.from(value, "base64").toString("utf8").split(":")[0]}:<redacted>`;
}

function redact(body) {
  if (!body || typeof body !== "object" || !("password" in body)) return body;
  return { ...body, password: "<redacted>" };
}

export function recordUnknown(dataDir, req, kind = "route") {
  const dir = path.join(dataDir, "logs", "unknown");
  const build = getBuild(req);
  const entry = {
    kind,
    time: new Date().toISOString(),
    build,
    method: req.method,
    host: req.get("host"),
    path: normalizePath(req.path),
    url: req.originalUrl,
    query: req.query,
    headers: {
      authorization: describeAuth(req.get("authorization")),
      contentType: req.get("content-type"),
      userAgent: req.get("user-agent")
    },
    body: redact(req.body)
  };

  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${build}.jsonl`), JSON.stringify(entry) + "\n");
}

export function unknownRoute(dataDir) {
  return (req, res) => {
    recordUnknown(dataDir, req);
    notFound(res, req.originalUrl);
  };
}
