import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { dedicatedServerClient } from "../../accounts/clients.js";
import { isLoopbackAddress, isServerAccountName, validatePassword, verifyPassword } from "../../accounts/password.js";
import { sendError } from "../../errors.js";
import { createFailureTracker } from "../portal/ratelimit.js";

function basicClient(req) {
  const [scheme, value] = (req.get("authorization") ?? "").split(" ");
  if (scheme?.toLowerCase() !== "basic" || !value) return null;
  const [clientId, ...secret] = Buffer.from(value, "base64").toString("utf8").split(":");
  return clientId ? { clientId, secret: secret.join(":") } : null;
}

// The admin panel's ban: the account can't log in (its tokens were revoked when it was banned).
function banned(res, account) {
  sendError(res, 403, "errors.com.epicgames.account.account_not_active",
    `This account is banned${account.banned.reason ? `: ${account.banned.reason}` : ""}`);
}

function invalidGrant(res, message) {
  sendError(res, 400, "errors.com.epicgames.account.oauth.invalid_grant", message);
}

function isAuthorizedHostingRequest(req, client, allowedHostingIps = []) {
  const remoteIp = req.ip || req.socket?.remoteAddress || "";
  if (isLoopbackAddress(remoteIp)) return true;
  if (client && client.clientId === dedicatedServerClient.id && client.secret === dedicatedServerClient.secret) {
    return true;
  }
  const normalizedRemote = remoteIp.replace(/^::ffff:/, "");
  return allowedHostingIps.some((entry) => {
    if (typeof entry !== "string") return false;
    const normalizedEntry = entry.trim().replace(/^::ffff:/, "");
    return normalizedEntry === normalizedRemote;
  });
}

export function oauthRoutes({ accounts, tokens, settings, resetTokens }) {
  const router = express.Router();
  const failureTracker = createFailureTracker({ windowMs: 5 * 60 * 1000, maxFailures: 10 });

  router.post("/account/api/oauth/token", async (req, res) => {
    const client = basicClient(req);
    // Any game client id is accepted; the dedicated server client, whose tokens can act for any player, needs its secret.
    if (!client || (client.clientId === dedicatedServerClient.id && client.secret !== dedicatedServerClient.secret)) {
      return sendError(res, 401, "errors.com.epicgames.account.oauth.invalid_client", "Missing or invalid client credentials");
    }
    const { clientId } = client;

    const body = req.body ?? {};
    switch (body.grant_type) {
      case "client_credentials":
        return res.json(tokens.issueClient(clientId));

      case "password": {
        const displayName = String(body.username ?? "").split("@")[0].trim();
        if (!displayName) return invalidGrant(res, "A username is required");

        const config = settings?.get?.() ?? {};
        const requirePassword = config.requirePassword ?? true;
        const allowAutoRegistration = config.allowAutoRegistration ?? false;
        const allowedHostingIps = config.allowedHostingIps ?? ["127.0.0.1", "::1"];

        let account = accounts.findByName(displayName);
        const isServer = isServerAccountName(displayName);

        if (isServer) {
          // Dedicated servers: verify request comes from loopback, dedicatedServerClient, or whitelisted hosting IP
          if (!isAuthorizedHostingRequest(req, client, allowedHostingIps)) {
            return sendError(res, 403, "errors.com.epicgames.account.oauth.unauthorized_client",
              "This IP address is not authorized to log in as a dedicated server account.");
          }
          if (!account) {
            account = accounts.getOrCreate(displayName);
          }
          // Server accounts bypass password authentication
          if (account.banned) return banned(res, account);
          accounts.recordLogin(account);
          return res.json(tokens.issueUser(clientId, account, "password"));
        }

        // Regular player account: check IP failure tracker
        if (failureTracker.isBlocked(req)) {
          return sendError(res, 429, "errors.com.epicgames.common.throttled",
            "Too many failed password attempts. Please wait a few minutes before trying again.");
        }

        if (!account) {
          const plainPassword = String(body.password ?? "").trim();
          if (requirePassword) {
            const isValidPw = !validatePassword(plainPassword);
            if (allowAutoRegistration && plainPassword && isValidPw) {
              try {
                account = await accounts.createWithPassword(displayName, plainPassword);
              } catch {
                account = null;
              }
            }
          } else if (allowAutoRegistration) {
            account = accounts.getOrCreate(displayName);
          }

          if (!account) {
            return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
              "Your e-mail and/or password are incorrect, or the account does not exist. Please register on the web portal first.");
          }
        }

        if (account.needsPasswordReset) {
          return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
            "This account requires a password reset. Please request a Password Reset Link from your host.");
        }

        // Accounts that have a password must always be verified regardless of requirePassword setting
        if (account.password) {
          const plainPassword = String(body.password ?? "").trim();
          const matched = await verifyPassword(plainPassword, account.password);
          if (!matched) {
            failureTracker.recordFailure(req);
            return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
              "Your e-mail and/or password are incorrect. Please check them and try again.");
          }
        } else if (requirePassword) {
          // Passwordless accounts are only disallowed when requirePassword is on
          return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
            "This account does not have a password configured and is admin-managed. Please request a Password Reset Link from your host.");
        }

        failureTracker.clear(req);
        if (account.banned) return banned(res, account);
        accounts.recordLogin(account);
        return res.json(tokens.issueUser(clientId, account, "password"));
      }

      case "refresh_token": {
        const entry = tokens.useRefreshToken(String(body.refresh_token ?? ""));
        const account = entry && accounts.get(entry.accountId);
        if (!account) return invalidGrant(res, "Invalid or expired refresh token");
        if (account.banned) return banned(res, account);
        return res.json(tokens.issueUser(clientId, account, "refresh_token"));
      }

      default:
        return sendError(res, 400, "errors.com.epicgames.account.oauth.unsupported_grant_type",
          `Unsupported grant type: ${body.grant_type}`);
    }
  });

  // The client checks its token here every minute; a 401 makes it refresh, and a refused refresh logs it out.
  router.get("/account/api/oauth/verify", requireAuth(tokens), (req, res) => {
    res.json(tokens.verify(req.session));
  });

  router.delete("/account/api/oauth/sessions/kill", requireAuth(tokens), (req, res) => {
    tokens.kill(req.session, String(req.query.killType ?? ""));
    res.status(204).end();
  });

  return router;
}
