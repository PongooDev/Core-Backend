import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isServerAccountName, validatePassword, validateUsername, verifyPassword } from "../../accounts/password.js";
import { sendError } from "../../errors.js";
import { createRateLimiter } from "./ratelimit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const portalFile = path.join(here, "portal.html");

export function portalRoutes(context) {
  const { accounts, tokens, settings, resetTokens } = context;
  const router = express.Router();

  // Rate limiters (loopback/127.0.0.1 is automatically exempt)
  const registerLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });
  const changePasswordLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 5 });
  const resetPasswordLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 5 });
  const checkUsernameLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

  // Serve the registration and player portal page
  router.get("/register", (req, res) => res.sendFile(portalFile));
  router.get("/portal", (req, res) => res.sendFile(portalFile));
  router.get("/reset-password", (req, res) => res.sendFile(portalFile));

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
  router.get("/api/check-username", checkUsernameLimiter, (req, res) => {
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
  router.post("/api/register", registerLimiter, async (req, res) => {
    const config = settings?.get?.() ?? {};
    if (config.allowRegistration === false) {
      return sendError(res, 403, "errors.com.epicgames.account.registration_disabled",
        "Registration is currently disabled by the server host.");
    }

    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "").trim();

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

    try {
      const account = await accounts.createWithPassword(username, password);
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
    } catch (err) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", err.message);
    }
  });

  // Change password / initial password setup
  router.post("/api/change-password", changePasswordLimiter, async (req, res) => {
    const username = String(req.body?.username ?? "").trim();
    const currentPassword = String(req.body?.currentPassword ?? "").trim();
    const newPassword = String(req.body?.newPassword ?? "").trim();

    const account = accounts.findByName(username);
    if (!account) {
      return sendError(res, 404, "errors.com.epicgames.account.account_not_found",
        "Account not found.");
    }

    if (!account.password) {
      return sendError(res, 401, "errors.com.epicgames.account.authentication_failed",
        "This account does not have a password configured. Please request a Password Reset Link from your host to set an initial password.");
    }

    if (!currentPassword) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter",
        "Current password is required.");
    }
    const matched = await verifyPassword(currentPassword, account.password);
    if (!matched) {
      return sendError(res, 401, "errors.com.epicgames.account.invalid_account_credentials",
        "Current password does not match.");
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", passwordError);
    }

    await accounts.setPassword(account, newPassword);
    tokens.revokeAccount(account.id);

    res.json({
      success: true,
      message: "Password changed successfully. Existing sessions have been logged out."
    });
  });

  // Validate a password reset token
  router.get("/api/reset-password/validate", (req, res) => {
    const token = String(req.query.token ?? "").trim();
    const entry = resetTokens?.getToken(token);
    if (!entry) {
      return res.status(400).json({ valid: false, error: "This password reset link is invalid or has expired." });
    }
    res.json({ valid: true, displayName: entry.displayName });
  });

  // Complete password reset via token
  router.post("/api/reset-password", resetPasswordLimiter, async (req, res) => {
    const token = String(req.body?.token ?? "").trim();
    const newPassword = String(req.body?.newPassword ?? "").trim();

    if (!token) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", "A reset token is required.");
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", passwordError);
    }

    const entry = resetTokens?.consumeToken(token);
    if (!entry) {
      return sendError(res, 400, "errors.com.epicgames.account.invalid_token", "This password reset link is invalid or has expired.");
    }

    const account = accounts.get(entry.accountId);
    if (!account) {
      return sendError(res, 404, "errors.com.epicgames.account.account_not_found", "Account not found.");
    }

    await accounts.setPassword(account, newPassword);
    tokens.revokeAccount(account.id);

    res.json({
      success: true,
      message: "Your password has been successfully updated. You may now log in."
    });
  });

  return router;
}
