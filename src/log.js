import fs from "node:fs";
import path from "node:path";
import { getBuild } from "./builds/detect.js";
import { notFound } from "./errors.js";

export function log(category, message) {
  const time = new Date().toISOString().slice(11, 23);
  console.log(`[${time}] [${category}] ${message}`);
}

export function requestLog(req, res, next) {
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
