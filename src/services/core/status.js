import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isContactEmailLogin } from "../../accounts/email.js";
import { createRateLimiter } from "../portal/ratelimit.js";

const packageFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");
const version = JSON.parse(fs.readFileSync(packageFile, "utf8")).version;

// Core's: whether this is a Core-Backend and which version, without logging in. The launcher checks a friend's backend
// with it before starting the game ("Join a friend"). It is the one /core/api route other machines get (when remote
// access is on): the rest is for the launcher on this PC.
export function coreStatusRoutes(context = {}) {
  const router = express.Router();
  const authRequirementsLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: "Too many authentication queries. Please wait a moment before trying again."
  });

  function getAuthInfo(req) {
    const config = context.settings?.get?.() ?? {};
    const baseRequirePassword = Boolean(config.requirePassword ?? false);
    // An email sign-in (#120) always needs a password. Whether an account has the address isn't said: this answers anyone.
    if (req.query.username && isContactEmailLogin(String(req.query.username))) {
      return { requirePassword: baseRequirePassword, passwordRequired: true };
    }
    const username = req.query.username ? String(req.query.username).split("@")[0].trim() : null;

    if (username && context.accounts) {
      const account = context.accounts.findByName(username);
      const hasPassword = Boolean(account?.password);
      return {
        requirePassword: baseRequirePassword,
        passwordRequired: hasPassword || baseRequirePassword,
        accountExists: Boolean(account),
        hasPassword
      };
    }

    return {
      requirePassword: baseRequirePassword,
      passwordRequired: baseRequirePassword
    };
  }

  router.get("/core/api/status", (req, res, next) => {
    if (req.query.username !== undefined) {
      return authRequirementsLimiter(req, res, next);
    }
    next();
  }, (req, res) => {
    const base = { name: "Core-Backend", version };
    if (req.query.username !== undefined || req.query.auth !== undefined) {
      return res.json({
        ...base,
        ...getAuthInfo(req)
      });
    }
    res.json(base);
  });

  router.get("/core/api/auth-requirements", authRequirementsLimiter, (req, res) => {
    res.json(getAuthInfo(req));
  });

  return router;
}
