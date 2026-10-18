import crypto from "node:crypto";

const accessLifetime = 8 * 60 * 60;
const refreshLifetime = 24 * 60 * 60;

function newToken() {
  return crypto.randomBytes(16).toString("hex");
}

export function createTokenStore() {
  const access = new Map();
  const refresh = new Map();

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
      refresh.delete(token);
      return entry && entry.expiresAt > Date.now() ? entry : null;
    },

    find(token) {
      const session = access.get(token);
      if (!session) return null;
      if (session.expiresAt <= Date.now()) {
        access.delete(token);
        return null;
      }
      return session;
    }
  };
}
