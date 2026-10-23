import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");
const version = JSON.parse(fs.readFileSync(packageFile, "utf8")).version;

// Core's: whether this is a Core-Backend and which version, without logging in. The launcher checks a friend's backend
// with it before starting the game ("Join a friend"). It is the one /core/api route other machines get (when remote
// access is on): the rest is for the launcher on this PC.
export function coreStatusRoutes() {
  const router = express.Router();
  router.get("/core/api/status", (req, res) => res.json({ name: "Core-Backend", version }));
  return router;
}
