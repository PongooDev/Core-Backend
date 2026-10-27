import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isServerAccountName, validatePassword, validateUsername, verifyPassword } from "../../accounts/password.js";
import { sendError } from "../../errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const portalFile = path.join(here, "portal.html");

export function portalRoutes(context) {
  const { accounts, tokens, settings } = context;
  const router = express.Router();

  // Serve the registration and player portal page
  router.get("/register", (req, res) => res.sendFile(portalFile));
  router.get("/portal", (req, res) => res.sendFile(portalFile));

  // Public status check for the portal
  router.get("/api/portal/status", (req, res) => {
    const config = settings?.get?.() ?? { requirePassword: true, allowRegistration: true };
    res.json({
      status: "online",
      requirePassword: Boolean(config.requirePassword),
      allowRegistration: Boolean(config.allowRegistration)
    });
  });

  // Check username availability
  router.get("/api/check-username", (req, res) => {
    const username = String(req.query.username ?? "").trim();
    if (isServerAccountName(username)) {
      return res.json({ available: false, error: "Server account names (CoreServer{n} or Server{n}) are reserved for dedicated servers" });
    }
    const error = validateUsername(username);
    if (error) return res.status(400).json({ available: false, error });
    const exists = Boolean(accounts.findByName(username));
    res.json({ available: !exists, error: exists ? "Username already taken" : null });
  });

  // Register account with password
  router.post("/api/register", (req, res) => {
    const config = settings?.get?.() ?? {};
    if (config.allowRegistration === false) {
      return sendError(res, 403, "errors.com.epicgames.account.registration_disabled",
        "Registration is currently disabled by the server host.");
    }

    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (isServerAccountName(username)) {
      return sendError(res, 400, "errors.com.epicgames.account.reserved_name",
        "Server account names (CoreServer{n} or Server{n}) are reserved for dedicated servers.");
    }

    const usernameError = validateUsername(username);
    if (usernameError) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", usernameError);
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", passwordError);
    }

    if (accounts.findByName(username)) {
      return sendError(res, 409, "errors.com.epicgames.account.account_already_exists",
        "An account with this username already exists.");
    }

    const account = accounts.createWithPassword(username, password);
    if (!account) {
      return sendError(res, 500, "errors.com.epicgames.server.internal_error",
        "Failed to create account. Please try again.");
    }

    res.status(201).json({
      success: true,
      id: account.id,
      displayName: account.displayName,
      created: account.created
    });
  });

  // Change password
  router.post("/api/change-password", (req, res) => {
    const username = String(req.body?.username ?? "").trim();
    const currentPassword = String(req.body?.currentPassword ?? "");
    const newPassword = String(req.body?.newPassword ?? "");

    const account = accounts.findByName(username);
    if (!account) {
      return sendError(res, 404, "errors.com.epicgames.account.account_not_found",
        "Account not found.");
    }

    if (account.password) {
      if (!currentPassword) {
        return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter",
          "Current password is required.");
      }
      if (!verifyPassword(currentPassword, account.password)) {
        return sendError(res, 401, "errors.com.epicgames.account.invalid_account_credentials",
          "Current password does not match.");
      }
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", passwordError);
    }

    accounts.setPassword(account, newPassword);
    tokens.revokeAccount(account.id);

    res.json({
      success: true,
      message: "Password changed successfully. Existing sessions have been logged out."
    });
  });

  return router;
}
