import fs from "node:fs";
import path from "node:path";
import { getBuild } from "./builds/detect.js";
import { notFound } from "./errors.js";

export function log(category, message) {
  const time = new Date().toISOString().slice(11, 23);
  console.log(`[${time}] [${category}] ${message}`);
}

export function requestLog(req, res, next) {
  res.on("finish", () => log("HTTP", `${res.statusCode} ${req.method} ${req.originalUrl}`));
  next();
}

function normalizePath(urlPath) {
  return urlPath.replace(/\/[0-9a-f]{32}(?=\/|$)/gi, "/:id");
}

function redact(body) {
  if (!body || typeof body !== "object" || !("password" in body)) return body;
  return { ...body, password: "<redacted>" };
}

export function unknownRoute(dataDir) {
  const dir = path.join(dataDir, "logs", "unknown");

  return (req, res) => {
    const build = getBuild(req);
    const entry = {
      time: new Date().toISOString(),
      build,
      method: req.method,
      path: normalizePath(req.path),
      url: req.originalUrl,
      query: req.query,
      body: redact(req.body)
    };

    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${build}.jsonl`), JSON.stringify(entry) + "\n");
    notFound(res, req.originalUrl);
  };
}
