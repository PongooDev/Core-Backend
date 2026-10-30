import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isContactEmailLogin, validateEmail } from "../../accounts/email.js";
import { isServerAccountName, validatePassword, validateUsername, verifyPassword } from "../../accounts/password.js";
import { EmailError } from "../../accounts/store.js";
import { sendError } from "../../errors.js";
import { getItem } from "../../gamedata/items.js";
import { grantCosmetic } from "../../profiles/athena.js";
import { campaignAccessToken, foundersEditions, setFoundersEdition } from "../../profiles/founders.js";
import { findItem, grantItem } from "../../profiles/items.js";
import { grant } from "../../profiles/progress.js";
import { openSession } from "../../profiles/session.js";
import { notifyProfiles } from "../mcp/profile.js";
import { createFailureTracker, createRateLimiter, getClientIp } from "./ratelimit.js";
import { inBuild } from "../../builds/context.js";
import { knownTemplate } from "../../admin/describe.js";

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
  const accountLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });
  const redeemLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 10, message: "Too many redemption attempts. Please wait a few minutes." });
  const redeemFailureTracker = createFailureTracker({ windowMs: 15 * 60 * 1000, maxFailures: 5 });

  const emailError = (res, error) => error.taken
    ? sendError(res, 409, "errors.com.epicgames.account.email_already_linked", error.message)
    : sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", error.message);

  // The portal's sign-in: a name (or its <name>@core.com) or a linked email (#120), and the account's password. An
  // email that matches nothing, an account without a password and a wrong password all answer alike, so the portal
  // never tells anyone which addresses are linked. The account, or null once it has answered.
  async function signIn(res, login, password, wrongPassword = "Your username and/or password are incorrect.") {
    const account = accounts.findByLogin(login);
    let refusal = null;
    if (isContactEmailLogin(login)) {
      if (!(account?.password && password && await verifyPassword(password, account.password))) {
        refusal = [401, "errors.com.epicgames.account.invalid_account_credentials", "Your email and/or password are incorrect."];
      }
    } else if (!account) {
      refusal = [404, "errors.com.epicgames.account.account_not_found", "Account not found."];
    } else if (!account.password) {
      refusal = [401, "errors.com.epicgames.account.authentication_failed",
        "This account does not have a password configured. Please request a Password Reset Link from your host to set an initial password."];
    } else if (!password) {
      refusal = [400, "errors.com.epicgames.common.invalid_parameter", "Current password is required."];
    } else if (!(await verifyPassword(password, account.password))) {
      refusal = [401, "errors.com.epicgames.account.invalid_account_credentials", wrongPassword];
    }
    if (!refusal) return account;
    sendError(res, ...refusal);
    return null;
  }

  // What the portal shows a signed-in player of their own account: never anyone else's.
  const ownAccount = (account) => ({ id: account.id, displayName: account.displayName, email: account.contactEmail ?? null });

  // Serve the registration and player portal page
  router.get("/register", (req, res) => res.sendFile(portalFile));
  router.get("/portal", (req, res) => res.sendFile(portalFile));
  router.get("/redeem", (req, res) => res.sendFile(portalFile));
  router.get("/change-password", (req, res) => res.sendFile(portalFile));
  router.get("/password", (req, res) => res.sendFile(portalFile));
  router.get("/email", (req, res) => res.sendFile(portalFile));
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
    // Optional (#120): the player's own email, to sign in with besides their name.
    const email = String(req.body?.email ?? "").trim();

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

    if (email) {
      const error = validateEmail(email);
      if (error) return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", error);
    }

    if (accounts.findByName(username)) {
      return sendError(res, 409, "errors.com.epicgames.account.account_already_exists",
        "An account with this username already exists.");
    }

    try {
      const account = await accounts.createWithPassword(username, password, { email });
      if (!account) {
        return sendError(res, 500, "errors.com.epicgames.server.internal_error",
          "Failed to create account. Please try again.");
      }

      res.status(201).json({
        success: true,
        id: account.id,
        displayName: account.displayName,
        email: account.contactEmail ?? null,
        created: account.created
      });
    } catch (err) {
      if (err instanceof EmailError) return emailError(res, err);
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", err.message);
    }
  });

  // Change password / initial password setup
  router.post("/api/change-password", changePasswordLimiter, async (req, res) => {
    // username: the name or the linked email.
    const login = String(req.body?.username ?? "").trim();
    const currentPassword = String(req.body?.currentPassword ?? "").trim();
    const newPassword = String(req.body?.newPassword ?? "").trim();

    const account = await signIn(res, login, currentPassword, "Current password does not match.");
    if (!account) return;

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

  // {username (the name or the linked email), password}: the player's own account, with their email (#120).
  router.post("/api/account", accountLimiter, async (req, res) => {
    const account = await signIn(res, String(req.body?.username ?? "").trim(), String(req.body?.password ?? "").trim());
    if (account) res.json(ownAccount(account));
  });

  // {username, password, email}: links the email to the account, replacing any linked before; an empty one unlinks it.
  router.post("/api/account/email", accountLimiter, async (req, res) => {
    const account = await signIn(res, String(req.body?.username ?? "").trim(), String(req.body?.password ?? "").trim());
    if (!account) return;
    try {
      accounts.setContactEmail(account, String(req.body?.email ?? ""));
    } catch (err) {
      if (err instanceof EmailError) return emailError(res, err);
      throw err;
    }
    res.json({ success: true, ...ownAccount(account) });
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

  // Redeem promotional code or founder friend code
  router.post("/api/redeem", redeemLimiter, async (req, res) => {
    if (redeemFailureTracker.isBlocked(req)) {
      return sendError(res, 429, "errors.com.epicgames.common.throttled", "Too many failed redemption attempts. Please wait 15 minutes before trying again.");
    }

    const login = String(req.body?.login ?? req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "").trim();
    const code = String(req.body?.code ?? "").trim();

    if (!login) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", "Username or email is required.");
    }
    if (!code) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", "Redeem code is required.");
    }

    const account = await signIn(res, login, password);
    if (!account) {
      redeemFailureTracker.recordFailure(req);
      return;
    }
    if (account.banned) {
      return sendError(res, 403, "errors.com.epicgames.account.banned", "This account is banned and cannot redeem codes.");
    }

    if (!context.friendCodes?.redeem) {
      return sendError(res, 500, "errors.com.epicgames.server.internal_error", "Code redemption service unavailable.");
    }

    try {
      const { code: redeemedCode, rewards } = await context.friendCodes.redeem(code, account, getClientIp(req));
      const session = openSession(context.profiles, account.id);
      const grantedDetails = [];

      if (rewards.vbucks > 0) {
        grantItem(session, "Currency:MtxPurchased", rewards.vbucks);
        grantedDetails.push(`${rewards.vbucks.toLocaleString()} V-Bucks`);
      }

      if (rewards.foundersEdition > 0) {
        inBuild("3724489", () => setFoundersEdition(session, rewards.foundersEdition));
        const editionName = foundersEditions[rewards.foundersEdition - 1]?.name || `Edition ${rewards.foundersEdition}`;
        grantedDetails.push(`${editionName} Founder's Edition`);
      }

      if (rewards.campaignAccess && !findItem(session.profile("profile0").profile, campaignAccessToken)) {
        inBuild("3724489", () => grant(session, campaignAccessToken, 1));
        if (!grantedDetails.some((d) => d.includes("Founder's Edition"))) {
          grantedDetails.push("Save the World Campaign Access");
        }
      }

      if (Array.isArray(rewards.items)) {
        for (const item of rewards.items) {
          const templateId = String(item.templateId ?? "").trim();
          const qty = Number(item.quantity) || 1;
          if (!templateId) continue;
          if (templateId.toLowerCase().startsWith("athena")) {
            grantCosmetic(session, templateId);
            grantedDetails.push(getItem(templateId)?.name || templateId);
          } else {
            const known = knownTemplate(templateId);
            if (known) {
              inBuild(known.build, () => grant(session, known.templateId, qty));
            } else {
              inBuild("3724489", () => grant(session, templateId, qty));
            }
            const name = getItem(templateId)?.name || templateId;
            grantedDetails.push(qty > 1 ? `${name} (x${qty})` : name);
          }
        }
      }

      session.commit();
      notifyProfiles(context, session);

      res.json({
        success: true,
        code: redeemedCode,
        rewards,
        granted: grantedDetails,
        message: `Successfully redeemed! Granted: ${grantedDetails.join(", ") || "Rewards applied to account."}`
      });
    } catch (err) {
      redeemFailureTracker.recordFailure(req);
      return sendError(res, 400, "errors.com.epicgames.redeem.error", err.message);
    }
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
