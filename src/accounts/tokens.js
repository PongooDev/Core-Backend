import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

const accessLifetime = 8 * 60 * 60;
const refreshLifetime = 24 * 60 * 60;

function newToken() {
  return crypto.randomBytes(16).toString("hex");
}

// Tokens are saved so a running game stays logged in across a backend restart: the client checks its token every
// minute and logs out if the check fails and its refresh token is refused.
export function createTokenStore(dataDir) {
  const file = dataDir && path.join(dataDir, "tokens.json");
  const access = new Map();
  const refresh = new Map();

  if (file && fs.existsSync(file)) {
    const saved = readJson(file);
    const now = Date.now();
    for (const session of saved.access ?? []) if (session.expiresAt > now) access.set(session.token, session);
    for (const entry of saved.refresh ?? []) if (entry.expiresAt > now) refresh.set(entry.token, entry);
  }

  function save() {
    if (file) writeJson(file, { access: [...access.values()], refresh: [...refresh.values()] });
  }

  function issue(clientId, account, grantType) {
    const now = Date.now();
    const session = {
      token: newToken(),
      clientId,
      accountId: account?.id,
      grantType,
      expiresAt: now + accessLifetime * 1000
    };
    access.set(session.token, session);

    const response = {
      access_token: session.token,
      expires_in: accessLifetime,
      expires_at: new Date(session.expiresAt).toISOString(),
      token_type: "bearer",
      client_id: clientId
    };

    if (account) {
      const refreshToken = { token: newToken(), clientId, accountId: account.id, expiresAt: now + refreshLifetime * 1000 };
      refresh.set(refreshToken.token, refreshToken);
      Object.assign(response, {
        refresh_token: refreshToken.token,
        refresh_expires: refreshLifetime,
        refresh_expires_at: new Date(refreshToken.expiresAt).toISOString(),
        account_id: account.id
      });
    }

    save();
    return response;
  }

  return {
    issueClient(clientId) {
      return issue(clientId, null, "client_credentials");
    },

    issueUser(clientId, account, grantType) {
      return issue(clientId, account, grantType);
    },

    useRefreshToken(token) {
      const entry = refresh.get(token);
      if (refresh.delete(token)) save();
      return entry && entry.expiresAt > Date.now() ? entry : null;
    },

    kill(current, killType) {
      for (const [token, session] of access) {
        if (session.accountId !== current.accountId) continue;
        const sameClient = session.clientId === current.clientId;
        const isCurrent = token === current.token;
        const killed =
          (killType === "OTHERS" && !isCurrent) ||
          (killType === "ALL_ACCOUNT_CLIENT" && sameClient) ||
          ((killType === "OTHERS_ACCOUNT_CLIENT" || killType === "OTHERS_ACCOUNT_CLIENT_SERVICE") && sameClient && !isCurrent);
        if (killed) access.delete(token);
      }
      save();
    },

    // Every access and refresh token of an account (the admin panel's kick, ban and delete).
    revokeAccount(accountId) {
      for (const [token, session] of access) if (session.accountId === accountId) access.delete(token);
      for (const [token, entry] of refresh) if (entry.accountId === accountId) refresh.delete(token);
      save();
    },

    find(token) {
      const session = access.get(token);
      if (!session) return null;
      if (session.expiresAt <= Date.now()) {
        access.delete(token);
        save();
        return null;
      }
      return session;
    },

    // What the client reads from GET /account/api/oauth/verify; expires_at is the one field it can't do without.
    verify(session) {
      const response = {
        client_id: session.clientId,
        expires_in: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
        expires_at: new Date(session.expiresAt).toISOString()
      };
      if (session.accountId) response.account_id = session.accountId;
      return response;
    }
  };
}
