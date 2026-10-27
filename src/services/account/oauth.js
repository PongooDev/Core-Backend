import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { dedicatedServerClient } from "../../accounts/clients.js";
import { isServerAccountName, verifyPassword } from "../../accounts/password.js";
import { sendError } from "../../errors.js";

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

export function oauthRoutes({ accounts, tokens, settings }) {
  const router = express.Router();

  router.post("/account/api/oauth/token", (req, res) => {
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
        const requirePassword = config.requirePassword ?? false;
        const allowAutoRegistration = config.allowAutoRegistration ?? (!requirePassword);

        let account = accounts.findByName(displayName);
        const isServer = isServerAccountName(displayName);

        if (!account) {
          if (isServer) {
            // Dedicated server accounts (CoreServer{n} or Server{n}) can be created without a password
            account = accounts.getOrCreate(displayName);
          } else {
            // Player accounts cannot be created without a password!
            const plainPassword = String(body.password ?? "").trim();
            if (allowAutoRegistration && plainPassword) {
              account = accounts.createWithPassword(displayName, plainPassword);
              if (!account) {
                return sendError(res, 500, "errors.com.epicgames.server.internal_error",
                  "Failed to create account. Please try again.");
              }
            } else {
              return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
                "Your e-mail and/or password are incorrect, or this account does not exist. Only CoreServer{n} or Server{n} accounts can be created without a password. Please register first.");
            }
          }
        }

        // Server accounts bypass password authentication
        if (!isServer && requirePassword) {
          if (!account.password) {
            return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
              "This account does not have a password configured. Please set a password in the web portal.");
          }
          const plainPassword = String(body.password ?? "");
          if (!verifyPassword(plainPassword, account.password)) {
            return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
              "Your e-mail and/or password are incorrect. Please check them and try again.");
          }
        }

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
