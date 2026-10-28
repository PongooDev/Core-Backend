import crypto from "node:crypto";

export function createResetTokenStore() {
  const tokens = new Map();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of tokens.entries()) {
      if (now >= entry.expiresAt) {
        tokens.delete(token);
      }
    }
  }, 15 * 60 * 1000);
  timer.unref?.();

  return {
    createToken(account, ttlMs = 24 * 60 * 60 * 1000) {
      if (!account || !account.id) {
        throw new Error("A valid account is required to generate a reset token");
      }
      const token = crypto.randomBytes(32).toString("hex");
      const now = Date.now();
      const entry = {
        token,
        accountId: account.id,
        displayName: account.displayName,
        createdAt: now,
        expiresAt: now + ttlMs
      };
      tokens.set(token, entry);
      return entry;
    },

    getToken(token) {
      if (typeof token !== "string" || !token) return null;
      const entry = tokens.get(token);
      if (!entry) return null;
      if (Date.now() >= entry.expiresAt) {
        tokens.delete(token);
        return null;
      }
      return entry;
    },

    consumeToken(token) {
      const entry = this.getToken(token);
      if (!entry) return null;
      tokens.delete(token);
      return entry;
    },

    count() {
      return tokens.size;
    }
  };
}
