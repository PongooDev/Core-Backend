import express from "express";
import { sendError } from "../../errors.js";

function basicClientId(req) {
  const [scheme, value] = (req.get("authorization") ?? "").split(" ");
  if (scheme?.toLowerCase() !== "basic" || !value) return null;
  const clientId = Buffer.from(value, "base64").toString("utf8").split(":")[0];
  return clientId || null;
}

function invalidGrant(res, message) {
  sendError(res, 400, "errors.com.epicgames.account.oauth.invalid_grant", message);
}

export function oauthRoutes({ accounts, tokens }) {
  const router = express.Router();

  router.post("/account/api/oauth/token", (req, res) => {
    const clientId = basicClientId(req);
    if (!clientId) {
      return sendError(res, 401, "errors.com.epicgames.account.oauth.invalid_client", "Missing or invalid client credentials");
    }

    const body = req.body ?? {};
    switch (body.grant_type) {
      case "client_credentials":
        return res.json(tokens.issueClient(clientId));

      case "password": {
        const displayName = String(body.username ?? "").split("@")[0].trim();
        if (!displayName) return invalidGrant(res, "A username is required");
        return res.json(tokens.issueUser(clientId, accounts.getOrCreate(displayName), "password"));
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

  return router;
}
