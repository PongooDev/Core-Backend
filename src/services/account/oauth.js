import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { dedicatedServerClient } from "../../accounts/clients.js";
import { sendError } from "../../errors.js";

function basicClient(req) {
  const [scheme, value] = (req.get("authorization") ?? "").split(" ");
  if (scheme?.toLowerCase() !== "basic" || !value) return null;
  const [clientId, ...secret] = Buffer.from(value, "base64").toString("utf8").split(":");
  return clientId ? { clientId, secret: secret.join(":") } : null;
}

function invalidGrant(res, message) {
  sendError(res, 400, "errors.com.epicgames.account.oauth.invalid_grant", message);
}

export function oauthRoutes({ accounts, tokens }) {
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
        const account = accounts.getOrCreate(displayName);
        accounts.recordLogin(account);
        return res.json(tokens.issueUser(clientId, account, "password"));
      }

      case "refresh_token": {
        const entry = tokens.useRefreshToken(String(body.refresh_token ?? ""));
        const account = entry && accounts.get(entry.accountId);
        if (!account) return invalidGrant(res, "Invalid or expired refresh token");
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
